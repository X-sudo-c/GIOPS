import 'dart:io';

import 'package:dio/dio.dart';

import '../config/api_config.dart';
import '../models/asset_node.dart';
import 'offline_db.dart';

class FieldSubmitResult {
  const FieldSubmitResult({
    required this.success,
    this.mrid,
    this.conflict = false,
    this.conflictId,
    this.message,
  });

  final bool success;
  final String? mrid;
  final bool conflict;
  final String? conflictId;
  final String? message;
}

class GiopApi {
  GiopApi(this.config) : _dio = Dio();

  final ApiConfig config;
  final Dio _dio;

  Map<String, String> get _supabaseHeaders => {
        'apikey': config.supabaseAnonKey,
        'Authorization': 'Bearer ${config.supabaseAnonKey}',
      };

  /// Master + staging nodes with coordinates for the map.
  /// When [latitude] and [longitude] are set, loads the nearest on-grid nodes first.
  /// Returns cached nodes when the network request fails.
  Future<({List<AssetNode> nodes, bool fromCache})> fetchMapNodes({
    double? latitude,
    double? longitude,
  }) async {
    final ownMrids = await OfflineDb.knownLocalMrids();
    try {
      final results = await Future.wait([
        _fetchMasterAssets(latitude: latitude, longitude: longitude),
        _fetchStagingAssets(ownMrids),
        OfflineDb.pendingCaptures(),
      ]);
      final master = results[0] as List<AssetNode>;
      final staging = results[1] as List<AssetNode>;
      final pending = results[2] as List<Map<String, dynamic>>;

      final nodes = <AssetNode>[...master, ...staging];
      final seenMrids = nodes.map((n) => n.mrid).toSet();

      for (final row in pending) {
        final mrid = row['mrid'] as String?;
        if (mrid != null && seenMrids.contains(mrid)) continue;
        final localId = row['id'] as int;
        nodes.add(
          AssetNode(
            mrid: mrid ?? 'local-$localId',
            name: row['name'] as String,
            validation: 'PENDING_FIELD',
            latitude: (row['latitude'] as num).toDouble(),
            longitude: (row['longitude'] as num).toDouble(),
            tier: 'staging',
            layer: MapNodeLayer.queuedLocal,
          ),
        );
      }

      final withCoords = nodes.where((n) => n.hasCoordinates).toList();
      await OfflineDb.cacheMapNodes(withCoords);
      return (nodes: withCoords, fromCache: false);
    } catch (_) {
      final cached = await OfflineDb.loadCachedMapNodes();
      if (cached.isNotEmpty) {
        return (nodes: cached, fromCache: true);
      }
      rethrow;
    }
  }

  Future<List<AssetNode>> fetchAssets() async {
    final result = await fetchMapNodes();
    return result.nodes;
  }

  Future<List<AssetNode>> _fetchMasterAssets({
    double? latitude,
    double? longitude,
  }) async {
    final hasLocation = latitude != null &&
        longitude != null &&
        latitude.isFinite &&
        longitude.isFinite;

    if (hasLocation) {
      final response = await _dio.post<dynamic>(
        '${config.supabaseUrl}/rest/v1/rpc/nodes_near_location',
        data: {
          'p_lat': latitude,
          'p_lon': longitude,
          'p_limit': 1000,
        },
        options: Options(headers: _supabaseHeaders),
      );
      final raw = response.data;
      final List<dynamic> rows;
      if (raw is List) {
        rows = raw;
      } else {
        rows = const [];
      }
      return rows
          .map((row) => AssetNode.fromJson(row as Map<String, dynamic>))
          .toList();
    }

    final response = await _dio.get<List<dynamic>>(
      '${config.supabaseUrl}/rest/v1/connectivity_nodes',
      queryParameters: {
        'select':
            'mrid,boundary_feeder_id,geom,identified_objects(name,validation,ghana_grid_assets(operating_utility,substation_name))',
      },
      options: Options(headers: _supabaseHeaders),
    );
    final data = response.data ?? [];
    return data
        .map((row) => AssetNode.fromJson(row as Map<String, dynamic>))
        .toList();
  }

  Future<List<AssetNode>> _fetchStagingAssets(Set<String> ownMrids) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '${config.syncBaseUrl}/api/v1/assets/staging',
    );
    final assets = response.data?['assets'] as List<dynamic>? ?? [];
    return assets.map((row) {
      final map = row as Map<String, dynamic>;
      final mrid = map['mrid'] as String;
      return AssetNode.fromStagingJson(
        map,
        isOwnCapture: ownMrids.contains(mrid),
      );
    }).toList();
  }

  Future<FieldSubmitResult> submitFieldNode({
    required String name,
    required double longitude,
    required double latitude,
    String operatingUtility = 'ECG_SOUTHERN',
    String? substationName,
    String? boundaryFeederId,
    String? mrid,
    String? offlineSessionStartedAt,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '${config.syncBaseUrl}/api/v1/field/nodes',
        data: {
          'name': name,
          'longitude': longitude,
          'latitude': latitude,
          'operating_utility': operatingUtility,
          if (substationName != null) 'substation_name': substationName,
          if (boundaryFeederId != null) 'boundary_feeder_id': boundaryFeederId,
          if (mrid != null) 'mrid': mrid,
          if (offlineSessionStartedAt != null)
            'offline_session_started_at': offlineSessionStartedAt,
        },
        options: Options(contentType: 'application/json'),
      );
      final data = response.data ?? {};
      return FieldSubmitResult(success: true, mrid: data['mrid'] as String?);
    } on DioException catch (e) {
      if (e.response?.statusCode == 409) {
        final data = e.response?.data;
        if (data is Map<String, dynamic>) {
          return FieldSubmitResult(
            success: false,
            conflict: true,
            conflictId: data['conflict_id'] as String?,
            mrid: data['asset_mrid'] as String?,
            message: data['detail'] as String?,
          );
        }
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> runMeterOcr(File imageFile) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(
        imageFile.path,
        filename: imageFile.path.split('/').last,
      ),
    });
    final response = await _dio.post<Map<String, dynamic>>(
      '${config.ocrBaseUrl}/api/v1/meter/ocr',
      data: formData,
    );
    return response.data ?? {};
  }

  Future<Map<String, dynamic>?> fetchNodeConnections(String mrid) async {
    try {
      final response = await _dio.post<dynamic>(
        '${config.supabaseUrl}/rest/v1/rpc/node_connections',
        data: {'p_mrid': mrid, 'p_limit': 25},
        options: Options(headers: _supabaseHeaders),
      );
      final raw = response.data;
      if (raw is Map<String, dynamic>) return raw;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> submitTelemetry({
    required String meterMrid,
    required double activeEnergyKwh,
  }) async {
    await _dio.post(
      '${config.syncBaseUrl}/api/v1/telemetry/submit',
      data: {
        'meter_mrid': meterMrid,
        'active_energy_kwh': activeEnergyKwh,
      },
      options: Options(contentType: 'application/json'),
    );
  }

  Future<void> submitSpotBill({
    required String accountMrid,
    required double previousReadingKwh,
    required double currentReadingKwh,
    String? meterMrid,
    String? evidencePhotoUrl,
    double? tariffRateGhs,
  }) async {
    await _dio.post(
      '${config.syncBaseUrl}/api/v1/m2c/spot-bill-sync',
      data: {
        'account_mrid': accountMrid,
        'previous_reading_kwh': previousReadingKwh,
        'current_reading_kwh': currentReadingKwh,
        if (meterMrid != null) 'meter_mrid': meterMrid,
        if (evidencePhotoUrl != null) 'evidence_photo_url': evidencePhotoUrl,
        if (tariffRateGhs != null) 'tariff_rate_ghs': tariffRateGhs,
      },
      options: Options(contentType: 'application/json'),
    );
  }

  /// Pull work orders assigned to [user] or [crew] and cache locally.
  Future<List<Map<String, dynamic>>> fetchAssignedWorkOrders({
    String? user,
    String? crew,
  }) async {
    final effectiveUser = user ?? 'tech.demo';
    final query = crew != null ? 'crew=${Uri.encodeComponent(crew)}' : 'user=${Uri.encodeComponent(effectiveUser)}';
    final response = await _dio.get<Map<String, dynamic>>(
      '${config.syncBaseUrl}/api/v1/work-orders/assigned?$query',
    );
    final list = response.data?['work_orders'];
    final orders = list is List
        ? list.map((e) => Map<String, dynamic>.from(e as Map)).toList()
        : <Map<String, dynamic>>[];
    await OfflineDb.upsertWorkOrders(orders);
    return orders;
  }

  Future<void> patchWorkOrderStatus({
    required String workOrderId,
    required String status,
    String? notes,
  }) async {
    await _dio.patch(
      '${config.syncBaseUrl}/api/v1/work-orders/$workOrderId',
      data: {
        'status': status,
        if (notes != null) 'notes': notes,
        'operator_id': 'tech.demo',
      },
      options: Options(contentType: 'application/json'),
    );
  }

  /// Push queued status updates then refresh assigned work orders.
  Future<void> syncWorkOrders({String? user}) async {
    final pending = await OfflineDb.pendingWorkOrderStatusUpdates();
    for (final row in pending) {
      final queueId = row['id'] as int;
      final woId = row['work_order_id'] as String;
      final newStatus = row['new_status'] as String;
      final notes = row['notes'] as String?;
      try {
        await patchWorkOrderStatus(
          workOrderId: woId,
          status: newStatus,
          notes: notes,
        );
        await OfflineDb.markWorkOrderStatusUpdateSynced(queueId, woId);
      } catch (_) {
        // keep queued for next sync
      }
    }
    await fetchAssignedWorkOrders(user: user ?? 'tech.demo');
  }
}
