import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_compass/flutter_compass.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../models/asset_kind.dart';
import '../models/asset_node.dart';
import '../models/highlight_line.dart';
import '../services/capture_service.dart';
import '../services/display_location.dart';
import '../services/giop_api.dart';
import '../services/heading_fusion_service.dart';
import '../services/navigation_location_settings.dart';
import '../services/offline_db.dart';
import '../services/tile_cache_service.dart';
import '../utils/geo.dart';
import '../widgets/field_capture_sheet.dart';
import '../widgets/layer_panel_sheet.dart';
import '../widgets/map_crosshair.dart';
import '../widgets/user_location_marker.dart';

enum MapTool { pan, addPoint }

class MapScreen extends StatefulWidget {
  const MapScreen({super.key, required this.api, this.refreshTrigger = 0});

  final GiopApi api;
  final int refreshTrigger;

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final MapController _mapController = MapController();
  final LayerVisibility _layerVisibility = LayerVisibility();
  final Distance _distance = const Distance();

  List<AssetNode> _nodes = [];
  String? _selectedNodeMrid;
  List<HighlightLine> _highlightLines = [];
  String? _error;
  bool _loading = false;
  bool _usingCache = false;
  bool _followMe = true;
  bool _headingUp = false;
  bool _syncing = false;
  int _pendingCount = 0;
  MapTool _tool = MapTool.pan;
  Position? _position;
  double? _heading;
  double _headingConfidence = 0;
  double _mapRotationDeg = 0;
  final HeadingFusionService _headingFusion = HeadingFusionService();
  final DisplayLocation _displayLocation = DisplayLocation();
  StreamSubscription<Position>? _positionSub;
  StreamSubscription<CompassEvent>? _compassSub;
  StreamSubscription<MapEvent>? _mapEventSub;
  Timer? _displayTimer;
  late final CaptureService _captureService;
  late final TileCacheService _tileCacheService;
  static const _nodesRefetchMeters = 1500.0;

  LatLng? _lastNodesFetchAnchor;
  bool _programmaticCamera = false;

  static const _defaultCenter = LatLng(5.6037, -0.1870);
  static const _snapMeters = 15.0;
  static const _identifyMeters = 30.0;
  static const _minZoom = 3.0;
  static const _maxZoom = 19.0;

  bool get _hasValidPosition =>
      _position != null &&
      isFiniteLatLng(_position!.latitude, _position!.longitude);

  double _safeZoom([double? zoom]) {
    final z = zoom ?? _mapController.camera.zoom;
    if (!z.isFinite) return 16;
    return z.clamp(_minZoom, _maxZoom);
  }

  void _recoverMapCameraIfNeeded() {
    final center = _mapController.camera.center;
    if (isValidLatLng(center)) return;
    final fallback = latLngIfValid(_position?.latitude, _position?.longitude) ??
        _defaultCenter;
    _programmaticCamera = true;
    try {
      _mapController.move(fallback, _safeZoom(16));
      _mapController.rotate(0);
      _mapRotationDeg = 0;
    } finally {
      _programmaticCamera = false;
    }
  }

  @override
  void initState() {
    super.initState();
    _captureService = CaptureService(widget.api);
    _tileCacheService = TileCacheService(widget.api.config);
    _mapEventSub = _mapController.mapEventStream.listen(_onMapUserEvent);
    _headingFusion.start();
    _displayTimer = Timer.periodic(const Duration(milliseconds: 16), (_) {
      if (!_hasValidPosition || !mounted) return;
      _displayLocation.setGpsTarget(
        LatLng(_position!.latitude, _position!.longitude),
        speedMps: _position!.speed,
        courseDeg: _headingFusion.heading ?? _position!.heading,
      );
      final moved = _displayLocation.tick();
      if (_followMe && _tool == MapTool.pan) {
        _applyFollowCamera(center: _displayLocation.point);
      }
      if (moved) setState(() {});
    });
    _loadNodes();
    _startGps();
    _startCompass();
    _refreshPendingCount();
    _syncPending();
  }

  @override
  void didUpdateWidget(MapScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshTrigger != widget.refreshTrigger) {
      _loadNodes();
      _syncPending();
    }
  }

  @override
  void dispose() {
    _displayTimer?.cancel();
    _headingFusion.dispose();
    _positionSub?.cancel();
    _compassSub?.cancel();
    _mapEventSub?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  List<AssetNode> get _visibleNodes => _nodes
      .where((n) => n.hasCoordinates && _layerVisibility.isVisible(n.layer))
      .toList();

  Future<void> _refreshPendingCount() async {
    final captures = await OfflineDb.pendingCaptures();
    final bills = await OfflineDb.pendingSpotBills();
    if (mounted) setState(() => _pendingCount = captures.length + bills.length);
  }

  Future<void> _syncPending() async {
    setState(() => _syncing = true);
    await _captureService.syncAllPending();
    await _refreshPendingCount();
    if (mounted) {
      setState(() => _syncing = false);
      await _loadNodes();
    }
  }

  Future<void> _startGps() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }

      final current = await Geolocator.getCurrentPosition(
        locationSettings: navigationLocationSettings(),
      );
      if (!mounted) return;
      if (!isFiniteLatLng(current.latitude, current.longitude)) return;
      setState(() => _position = current);
      _displayLocation.snapTo(current.latitude, current.longitude);
      _displayLocation.setGpsTarget(
        LatLng(current.latitude, current.longitude),
        speedMps: current.speed,
        courseDeg: current.heading,
      );
      _headingFusion.penalizeForPoorAccuracy(current.accuracy);
      if (_followMe) {
        _applyFollowCamera(zoom: 16);
      }
      await _loadNodes(anchor: LatLng(current.latitude, current.longitude));

      _positionSub = Geolocator.getPositionStream(
        locationSettings: navigationLocationSettings(),
      ).listen((pos) {
        if (!mounted) return;
        if (!isFiniteLatLng(pos.latitude, pos.longitude)) return;
        _headingFusion.updateGpsCourse(
          courseDeg: pos.heading,
          speedMps: pos.speed,
          accuracyMeters: pos.accuracy,
        );
        _headingFusion.penalizeForPoorAccuracy(pos.accuracy);
        _displayLocation.setGpsTarget(
          LatLng(pos.latitude, pos.longitude),
          speedMps: pos.speed,
          courseDeg: _headingFusion.heading ?? pos.heading,
        );
        setState(() {
          _position = pos;
          _heading = _headingFusion.heading;
          _headingConfidence = _headingFusion.confidence;
        });
        _maybeReloadNodesNear(pos);
        // Camera smoothing handled by 60fps display timer.
      });
    } catch (_) {}
  }

  void _startCompass() {
    _compassSub = FlutterCompass.events?.listen((event) {
      if (!mounted || event.heading == null || !event.heading!.isFinite) return;
      final speed = _position?.speed ?? 0;
      if (speed < 1.5) {
        _headingFusion.updateCompass(event.heading);
        setState(() {
          _heading = _headingFusion.heading;
          _headingConfidence = _headingFusion.confidence;
        });
        if (_followMe && _headingUp && _tool == MapTool.pan) {
          _applyFollowCamera(rotateOnly: true);
        }
      }
    });
  }

  void _applyFollowCamera({
    double? zoom,
    bool rotateOnly = false,
    LatLng? center,
  }) {
    if (!_hasValidPosition || !_followMe || _tool != MapTool.pan) return;
    final mapCenter = center ??
        _displayLocation.point ??
        LatLng(_position!.latitude, _position!.longitude);
    if (!isValidLatLng(mapCenter)) return;

    _programmaticCamera = true;
    try {
      if (!rotateOnly) {
        _mapController.move(
          mapCenter,
          _safeZoom(zoom),
        );
      }
      if (_headingUp && _heading != null && _heading!.isFinite) {
        // Heading-up mode: rotate map opposite to bearing so user-facing
        // direction stays at the top, as in navigation apps.
        _mapController.rotate(-_heading!);
      }
      _syncMapRotation();
    } finally {
      _programmaticCamera = false;
    }
  }

  void _syncMapRotation() {
    final r = _mapController.camera.rotation;
    if (!r.isFinite) {
      _programmaticCamera = true;
      try {
        _mapController.rotate(0);
        _mapRotationDeg = 0;
      } finally {
        _programmaticCamera = false;
      }
      return;
    }
    if ((r - _mapRotationDeg).abs() > 0.05) {
      setState(() => _mapRotationDeg = r);
    }
  }

  void _onMapUserEvent(MapEvent event) {
    if (!_programmaticCamera) {
      if (event.source != MapEventSource.mapController &&
          event.source != MapEventSource.nonRotatedSizeChange &&
          event.source != MapEventSource.fitCamera) {
        final userMovedMap = event is MapEventMoveStart ||
            event is MapEventRotateStart ||
            event is MapEventScrollWheelZoom ||
            event is MapEventDoubleTapZoomStart ||
            event is MapEventFlingAnimationStart ||
            event.source == MapEventSource.onDrag ||
            event.source == MapEventSource.onMultiFinger ||
            event.source == MapEventSource.scrollWheel ||
            event.source == MapEventSource.doubleTapZoomAnimationController;

        if (userMovedMap) {
          final isRotate = event is MapEventRotateStart ||
              event.source == MapEventSource.onMultiFinger;
          _exitFollowMode(keepRotation: isRotate);
        }
      }
    }

    if (event is MapEventRotate ||
        event is MapEventRotateEnd ||
        event is MapEventMove ||
        event is MapEventMoveEnd ||
        event is MapEventFlingAnimation ||
        event is MapEventScrollWheelZoom) {
      _recoverMapCameraIfNeeded();
      _syncMapRotation();
    }

    if (event is MapEventMoveEnd || event is MapEventFlingAnimationEnd) {
      final center = _mapController.camera.center;
      if (isValidLatLng(center)) {
        unawaited(
          _tileCacheService.prefetchViewport(
            latitude: center.latitude,
            longitude: center.longitude,
            zoom: _mapController.camera.zoom,
          ),
        );
        _maybeReloadNodesForViewport(center);
      }
    }
  }

  void _maybeReloadNodesForViewport(LatLng center) {
    final anchor = _lastNodesFetchAnchor;
    if (anchor == null) {
      _loadNodes(anchor: center);
      return;
    }
    final movedM = _distance.as(LengthUnit.Meter, anchor, center);
    if (movedM >= _nodesRefetchMeters) {
      _loadNodes(anchor: center);
    }
  }

  /// Stop map follow/rotation; keep map position, show heading wedge only.
  void _exitFollowMode({bool keepRotation = false}) {
    if (!_followMe && !_headingUp) return;
    setState(() {
      _followMe = false;
      _headingUp = false;
    });
    if (keepRotation) return;
    _programmaticCamera = true;
    try {
      _mapController.rotate(0);
      _mapRotationDeg = 0;
    } finally {
      _programmaticCamera = false;
    }
  }

  void _resetMapNorth() {
    setState(() => _headingUp = false);
    _programmaticCamera = true;
    try {
      _mapController.rotate(0);
      _mapRotationDeg = 0;
    } finally {
      _programmaticCamera = false;
    }
  }

  LatLng? _nodesFetchAnchor({LatLng? anchor}) {
    if (anchor != null && isValidLatLng(anchor)) return anchor;
    if (_hasValidPosition) {
      return LatLng(_position!.latitude, _position!.longitude);
    }
    final center = _mapController.camera.center;
    if (isValidLatLng(center)) return center;
    return null;
  }

  void _maybeReloadNodesNear(Position pos) {
    final here = LatLng(pos.latitude, pos.longitude);
    if (!isValidLatLng(here)) return;
    final anchor = _lastNodesFetchAnchor;
    if (anchor == null) {
      _loadNodes(anchor: here);
      return;
    }
    final movedM = _distance.as(LengthUnit.Meter, anchor, here);
    if (movedM >= _nodesRefetchMeters) {
      _loadNodes(anchor: here);
    }
  }

  Future<void> _loadNodes({LatLng? anchor}) async {
    final fetchAt = _nodesFetchAnchor(anchor: anchor);
    setState(() {
      _loading = true;
      _error = null;
      _usingCache = false;
    });
    try {
      final result = await widget.api.fetchMapNodes(
        latitude: fetchAt?.latitude,
        longitude: fetchAt?.longitude,
      );
      if (!mounted) return;
      setState(() {
        _nodes = result.nodes;
        _usingCache = result.fromCache;
        _loading = false;
        if (fetchAt != null) _lastNodesFetchAnchor = fetchAt;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _setTool(MapTool tool) {
    setState(() {
      _tool = tool;
      if (tool == MapTool.addPoint) {
        _followMe = false;
        _headingUp = false;
      }
    });
    if (tool == MapTool.addPoint) {
      _programmaticCamera = true;
      try {
        _mapController.rotate(0);
        _mapRotationDeg = 0;
      } finally {
        _programmaticCamera = false;
      }
    }
  }

  void _centerOnMe() {
    if (!_hasValidPosition) return;
    setState(() {
      _followMe = true;
      _headingUp = true;
    });
    _applyFollowCamera(zoom: 17);
  }

  LatLng get _mapCenter {
    final center = _mapController.camera.center;
    if (isValidLatLng(center)) return center;
    return latLngIfValid(_position?.latitude, _position?.longitude) ??
        _defaultCenter;
  }

  (LatLng point, String? snappedName) _placementPoint(LatLng raw) {
    AssetNode? nearest;
    var nearestM = _snapMeters;
    for (final node in _nodes) {
      if (!node.hasCoordinates) continue;
      final nodePoint = LatLng(node.latitude!, node.longitude!);
      final m = _distance.as(LengthUnit.Meter, raw, nodePoint);
      if (m < nearestM) {
        nearestM = m;
        nearest = node;
      }
    }
    if (nearest != null) {
      return (
        LatLng(nearest.latitude!, nearest.longitude!),
        nearest.name,
      );
    }
    return (raw, null);
  }

  AssetNode? _nodeNear(LatLng point) {
    AssetNode? hit;
    var minM = _identifyMeters;
    for (final node in _visibleNodes) {
      final m = _distance.as(
        LengthUnit.Meter,
        point,
        LatLng(node.latitude!, node.longitude!),
      );
      if (m < minM) {
        minM = m;
        hit = node;
      }
    }
    return hit;
  }

  void _onMapTap(TapPosition tap, LatLng point) {
    if (!isValidLatLng(point)) return;
    if (_tool == MapTool.addPoint) {
      _openCaptureForm(point);
      return;
    }
    final node = _nodeNear(point);
    if (node != null) {
      _openNodeDetail(node);
      return;
    }
    setState(() {
      _selectedNodeMrid = null;
      _highlightLines = const [];
    });
  }

  Future<void> _openNodeDetail(AssetNode node) async {
    setState(() {
      _selectedNodeMrid = node.mrid;
      _highlightLines = const [];
    });

    final topology = await widget.api.fetchNodeConnections(node.mrid);
    if (!mounted) return;

    setState(() => _highlightLines = highlightLinesFromTopology(topology));

    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => _NodeDetailSheet(node: node, topology: topology),
    );

    if (mounted) {
      setState(() {
        _selectedNodeMrid = null;
        _highlightLines = const [];
      });
    }
  }

  Widget _assetMarker(AssetNode node) {
    final kind = node.displayKind;
    final color = assetKindColor(kind);
    final selected = _selectedNodeMrid == node.mrid;

    return Container(
      decoration: selected
          ? BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.black, width: 2),
              boxShadow: [
                BoxShadow(
                  color: color.withValues(alpha: 0.5),
                  blurRadius: 8,
                  spreadRadius: 2,
                ),
              ],
            )
          : null,
      child: Icon(assetKindIcon(kind), color: color, size: selected ? 32 : 26),
    );
  }

  Future<void> _openCaptureForm(LatLng rawPoint) async {
    final (placed, snappedName) = _placementPoint(rawPoint);
    final result = await showModalBottomSheet<CaptureResult>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => FieldCaptureSheet(
        captureService: _captureService,
        latitude: placed.latitude,
        longitude: placed.longitude,
        snappedToName: snappedName,
      ),
    );
    if (result != null && mounted) {
      await _refreshPendingCount();
      await _loadNodes();
      if (result.synced) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Saved — ${result.mrid}')),
        );
      }
      setState(() => _tool = MapTool.pan);
    }
  }

  void _confirmCenterPlacement() {
    _openCaptureForm(_mapCenter);
  }

  void _placeAtGps() {
    final point = latLngIfValid(_position?.latitude, _position?.longitude);
    if (point == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('GPS not available yet')),
      );
      return;
    }
    _mapController.move(point, _safeZoom());
    _openCaptureForm(point);
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }

  void _showLayers() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheetState) => LayerPanelSheet(
          visibility: _layerVisibility,
          pendingCount: _pendingCount,
          syncing: _syncing,
          onSync: () {
            Navigator.pop(ctx);
            _syncPending();
          },
          onChanged: () {
            setState(() {});
            setSheetState(() {});
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final initialCenter =
        latLngIfValid(_position?.latitude, _position?.longitude) ??
            _defaultCenter;
    final userPoint = _displayLocation.point ??
        latLngIfValid(_position?.latitude, _position?.longitude);

    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: initialCenter,
              initialZoom: 16,
              minZoom: _minZoom,
              maxZoom: _maxZoom,
              onTap: _onMapTap,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.giop.field',
              ),
              if (_highlightLines.isNotEmpty)
                PolylineLayer(
                  polylines: [
                    for (final line in _highlightLines)
                      Polyline(
                        points: line.points,
                        color: voltageLineColor(line.voltage),
                        strokeWidth: voltageLineWidth(line.voltage),
                      ),
                  ],
                ),
              MarkerLayer(
                key: ValueKey(
                  '${_layerVisibility.onGrid}'
                  '${_layerVisibility.ownStaging}'
                  '${_layerVisibility.otherStaging}'
                  '${_layerVisibility.queuedLocal}'
                  '$_selectedNodeMrid',
                ),
                markers: [
                  for (final node in _visibleNodes)
                    Marker(
                      point: LatLng(node.latitude!, node.longitude!),
                      width: _selectedNodeMrid == node.mrid ? 40 : 34,
                      height: _selectedNodeMrid == node.mrid ? 40 : 34,
                      child: _assetMarker(node),
                    ),
                  if (userPoint != null)
                    Marker(
                      point: userPoint,
                      width: 72,
                      height: 72,
                      alignment: Alignment.center,
                      child: UserLocationMarker(
                        heading: _heading,
                        headingConfidence: _headingConfidence,
                        accuracyMeters: _position!.accuracy,
                      ),
                    ),
                ],
              ),
            ],
          ),

          if (_tool == MapTool.addPoint) const MapCrosshair(),

          // Top status bar
          Positioned(
            top: MediaQuery.of(context).padding.top + 8,
            left: 12,
            right: 12,
            child: _StatusBar(
              position: _position,
              heading: _heading,
              headingConfidence: _headingConfidence,
              headingUp: _headingUp,
              mapRotationDeg: _mapRotationDeg,
              nodeCount: _visibleNodes.length,
              usingCache: _usingCache,
              tool: _tool,
              pendingCount: _pendingCount,
              onResetNorth: _resetMapNorth,
            ),
          ),

          if (_loading)
            Positioned(
              top: MediaQuery.of(context).padding.top,
              left: 0,
              right: 0,
              child: const LinearProgressIndicator(minHeight: 2),
            ),

          if (_error != null)
            Positioned(
              left: 12,
              right: 12,
              top: MediaQuery.of(context).padding.top + 56,
              child: Material(
                elevation: 2,
                borderRadius: BorderRadius.circular(8),
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Text(
                    _error!,
                    style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
                  ),
                ),
              ),
            ),

          // Add-mode action bar
          if (_tool == MapTool.addPoint)
            Positioned(
              left: 12,
              right: 12,
              bottom: 88,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Pan map or tap to place. Snap ≤${_snapMeters.toInt()}m.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                      TextButton.icon(
                        onPressed: _placeAtGps,
                        icon: const Icon(Icons.gps_fixed, size: 18),
                        label: const Text('GPS'),
                      ),
                      FilledButton(
                        onPressed: _confirmCenterPlacement,
                        child: const Text('Here'),
                      ),
                    ],
                  ),
                ),
              ),
            ),

          // Bottom toolbar (QField-style)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _MapToolbar(
              tool: _tool,
              followMe: _followMe,
              headingUp: _headingUp,
              loading: _loading,
              onPan: () => _setTool(MapTool.pan),
              onAdd: () => _setTool(MapTool.addPoint),
              onLayers: _showLayers,
              onLocate: _centerOnMe,
              onRefresh: _loadNodes,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({
    required this.position,
    required this.heading,
    required this.headingConfidence,
    required this.headingUp,
    required this.mapRotationDeg,
    required this.nodeCount,
    required this.usingCache,
    required this.tool,
    required this.pendingCount,
    required this.onResetNorth,
  });

  final Position? position;
  final double? heading;
  final double headingConfidence;
  final bool headingUp;
  final double mapRotationDeg;
  final int nodeCount;
  final bool usingCache;
  final MapTool tool;
  final int pendingCount;
  final VoidCallback onResetNorth;

  @override
  Widget build(BuildContext context) {
    final coords = position != null
        ? '${position!.latitude.toStringAsFixed(5)}, ${position!.longitude.toStringAsFixed(5)}'
        : 'No GPS';
    final accuracy = position != null
        ? '±${position!.accuracy.toStringAsFixed(0)}m'
        : '';
    final bearing = heading != null
        ? '${heading!.round()}° ${headingToCardinal(heading)}'
        : '—°';
    final headingQuality = headingConfidence < 0.45 ? ' · low heading' : '';

    return Material(
      elevation: 2,
      borderRadius: BorderRadius.circular(10),
      color: Colors.black.withValues(alpha: 0.72),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            if (heading != null)
              Transform.rotate(
                angle: headingUp
                    ? 0
                    : (heading! - mapRotationDeg) * math.pi / 180,
                child: const Icon(Icons.navigation, color: Color(0xFF64B5F6), size: 18),
              )
            else
              Icon(
                tool == MapTool.addPoint ? Icons.add_location : Icons.explore,
                color: Colors.white70,
                size: 18,
              ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '$coords  $accuracy  ·  $bearing$headingQuality',
                style: const TextStyle(color: Colors.white, fontSize: 12),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (headingUp)
              GestureDetector(
                onTap: onResetNorth,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text('N', style: TextStyle(color: Colors.white, fontSize: 11)),
                ),
              ),
            if (pendingCount > 0)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: Icon(Icons.cloud_upload, color: Colors.orange.shade300, size: 16),
              ),
            if (usingCache)
              const Padding(
                padding: EdgeInsets.only(left: 6),
                child: Icon(Icons.cloud_off, color: Colors.white54, size: 16),
              ),
            Padding(
              padding: const EdgeInsets.only(left: 6),
              child: Text(
                '$nodeCount',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MapToolbar extends StatelessWidget {
  const _MapToolbar({
    required this.tool,
    required this.followMe,
    required this.headingUp,
    required this.loading,
    required this.onPan,
    required this.onAdd,
    required this.onLayers,
    required this.onLocate,
    required this.onRefresh,
  });

  final MapTool tool;
  final bool followMe;
  final bool headingUp;
  final bool loading;
  final VoidCallback onPan;
  final VoidCallback onAdd;
  final VoidCallback onLayers;
  final VoidCallback onLocate;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 8,
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _ToolButton(
                icon: Icons.pan_tool_alt,
                label: 'Pan',
                selected: tool == MapTool.pan,
                onTap: onPan,
              ),
              _ToolButton(
                icon: Icons.add_location_alt,
                label: 'Add',
                selected: tool == MapTool.addPoint,
                onTap: onAdd,
              ),
              _ToolButton(
                icon: Icons.layers,
                label: 'Layers',
                onTap: onLayers,
              ),
              _ToolButton(
                icon: Icons.navigation,
                label: headingUp ? 'Heading' : 'Locate',
                selected: followMe,
                onTap: onLocate,
              ),
              _ToolButton(
                icon: Icons.refresh,
                label: 'Reload',
                onTap: loading ? null : onRefresh,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ToolButton extends StatelessWidget {
  const _ToolButton({
    required this.icon,
    required this.label,
    this.selected = false,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? Theme.of(context).colorScheme.primary
        : Theme.of(context).colorScheme.onSurface;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 11, color: color),
            ),
          ],
        ),
      ),
    );
  }
}

class _NodeDetailSheet extends StatelessWidget {
  const _NodeDetailSheet({
    required this.node,
    required this.topology,
  });

  final AssetNode node;
  final Map<String, dynamic>? topology;

  @override
  Widget build(BuildContext context) {
    final downstream = topology?['downstream'] as List<dynamic>? ?? [];
    final upstream = topology?['upstream'] as List<dynamic>? ?? [];
    final degree = topology?['degree'] as int?;
    final kind = node.displayKind;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(assetKindIcon(kind), color: assetKindColor(kind)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(node.name, style: Theme.of(context).textTheme.titleLarge),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _detailRow(context, 'Type', assetKindLabel(kind)),
            _detailRow(context, 'MRID', node.mrid),
            _detailRow(context, 'Status', node.validation),
            _detailRow(context, 'Tier', layerLabel(node.layer)),
            if (node.boundaryFeederId != null)
              _detailRow(context, 'Feeder', node.boundaryFeederId!),
            if (node.operatingUtility != null)
              _detailRow(context, 'Utility', node.operatingUtility!),
            if (node.substationName != null)
              _detailRow(context, 'District', node.substationName!),
            if (node.hasCoordinates)
              _detailRow(
                context,
                'Coordinates',
                '${node.latitude!.toStringAsFixed(6)}, ${node.longitude!.toStringAsFixed(6)}',
              ),
            if (degree != null) ...[
              const SizedBox(height: 12),
              Text(
                'Connections ($degree)',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (downstream.isNotEmpty || upstream.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Connected lines shown on map',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
            ],
            if (downstream.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Downstream', style: Theme.of(context).textTheme.labelLarge),
              ...downstream.map((row) {
                final map = row as Map<String, dynamic>;
                return _connectionTile(
                  map['neighbor_name'] as String? ?? '—',
                  map['voltage'] as String? ?? '',
                  true,
                );
              }),
            ],
            if (upstream.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Upstream', style: Theme.of(context).textTheme.labelLarge),
              ...upstream.map((row) {
                final map = row as Map<String, dynamic>;
                return _connectionTile(
                  map['neighbor_name'] as String? ?? '—',
                  map['voltage'] as String? ?? '',
                  false,
                );
              }),
            ],
            if (downstream.isEmpty && upstream.isEmpty && degree == 0) ...[
              const SizedBox(height: 12),
              Text(
                'No wired connections in master topology.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }

  static Widget _detailRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }

  static Widget _connectionTile(String name, String voltage, bool downstream) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(
        downstream ? Icons.arrow_downward : Icons.arrow_upward,
        size: 18,
        color: voltageLineColor(voltage),
      ),
      title: Text(name, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: voltage.isNotEmpty ? Text(voltage) : null,
    );
  }
}
