import 'asset_kind.dart';

enum MapNodeLayer {
  onGrid,
  ownStaging,
  otherStaging,
  queuedLocal,
}

class AssetNode {
  AssetNode({
    required this.mrid,
    required this.name,
    required this.validation,
    this.latitude,
    this.longitude,
    this.boundaryFeederId,
    this.operatingUtility,
    this.substationName,
    this.tier = 'master',
    this.layer = MapNodeLayer.onGrid,
    this.assetKind = AssetKind.connectivityNode,
  });

  final String mrid;
  final String name;
  final String validation;
  final double? latitude;
  final double? longitude;
  final String? boundaryFeederId;
  final String? operatingUtility;
  final String? substationName;
  final String tier;
  final MapNodeLayer layer;
  final AssetKind assetKind;

  /// Icon/color for map display (workflow layer for staging, asset kind for master).
  AssetKind get displayKind =>
      layer == MapNodeLayer.onGrid ? assetKind : AssetKind.fieldCapture;

  bool get hasCoordinates =>
      latitude != null &&
      longitude != null &&
      latitude!.isFinite &&
      longitude!.isFinite;

  AssetNode copyWith({MapNodeLayer? layer, AssetKind? assetKind}) {
    return AssetNode(
      mrid: mrid,
      name: name,
      validation: validation,
      latitude: latitude,
      longitude: longitude,
      boundaryFeederId: boundaryFeederId,
      operatingUtility: operatingUtility,
      substationName: substationName,
      tier: tier,
      layer: layer ?? this.layer,
      assetKind: assetKind ?? this.assetKind,
    );
  }

  static (double?, double?) coordinatesFromGeom(dynamic geom) {
    if (geom is Map<String, dynamic>) {
      final coords = geom['coordinates'];
      if (coords is List && coords.length >= 2) {
        return (
          (coords[1] as num).toDouble(),
          (coords[0] as num).toDouble(),
        );
      }
    }
    return (null, null);
  }

  factory AssetNode.fromJson(Map<String, dynamic> json) {
    final identified = json['identified_objects'] as Map<String, dynamic>?;
    final ghanaRaw = identified?['ghana_grid_assets'];
    final Map<String, dynamic>? ghana = ghanaRaw is Map<String, dynamic>
        ? ghanaRaw
        : ghanaRaw is List && ghanaRaw.isNotEmpty
            ? ghanaRaw.first as Map<String, dynamic>
            : null;
    final (lat, lon) = coordinatesFromGeom(json['geom']);
    return AssetNode(
      mrid: json['mrid'] as String,
      name: identified?['name'] as String? ?? '—',
      validation: identified?['validation'] as String? ?? '—',
      latitude: lat,
      longitude: lon,
      boundaryFeederId: json['boundary_feeder_id'] as String?,
      operatingUtility: ghana?['operating_utility'] as String?,
      substationName: ghana?['substation_name'] as String?,
      tier: 'master',
      layer: MapNodeLayer.onGrid,
      assetKind: assetKindFromString(json['asset_kind'] as String?),
    );
  }

  factory AssetNode.fromStagingJson(
    Map<String, dynamic> json, {
    required bool isOwnCapture,
  }) {
    final (lat, lon) = coordinatesFromGeom(json['geom']);
    return AssetNode(
      mrid: json['mrid'] as String,
      name: json['name'] as String? ?? '—',
      validation: json['validation'] as String? ?? 'PENDING_FIELD',
      latitude: lat,
      longitude: lon,
      boundaryFeederId: json['boundary_feeder_id'] as String?,
      operatingUtility: json['operating_utility'] as String?,
      substationName: json['substation_name'] as String?,
      tier: 'staging',
      layer: isOwnCapture ? MapNodeLayer.ownStaging : MapNodeLayer.otherStaging,
    );
  }

  factory AssetNode.fromCacheRow(Map<String, dynamic> row) {
    return AssetNode(
      mrid: row['mrid'] as String,
      name: row['name'] as String,
      validation: row['validation'] as String? ?? '—',
      latitude: (row['latitude'] as num).toDouble(),
      longitude: (row['longitude'] as num).toDouble(),
      boundaryFeederId: row['boundary_feeder_id'] as String?,
      operatingUtility: row['operating_utility'] as String?,
      substationName: row['substation_name'] as String?,
      tier: row['tier'] as String? ?? 'master',
      layer: MapNodeLayer.values.byName(row['layer'] as String),
      assetKind: assetKindFromString(row['asset_kind'] as String?),
    );
  }

  Map<String, dynamic> toCacheRow() {
    return {
      'mrid': mrid,
      'name': name,
      'validation': validation,
      'latitude': latitude,
      'longitude': longitude,
      'boundary_feeder_id': boundaryFeederId,
      'operating_utility': operatingUtility,
      'substation_name': substationName,
      'tier': tier,
      'layer': layer.name,
      'asset_kind': assetKindToApiValue(assetKind),
    };
  }
}
