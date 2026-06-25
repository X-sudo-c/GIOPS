import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

import '../utils/geo.dart';

/// Smoothly animates the on-map puck between GPS fixes with velocity extrapolation.
class DisplayLocation {
  double? _lat;
  double? _lon;
  LatLng? _gpsTarget;
  DateTime? _gpsTargetAt;
  double _speedMps = 0;
  double? _courseDeg;

  LatLng? get point {
    if (_lat == null || _lon == null) return null;
    if (!isFiniteLatLng(_lat!, _lon!)) return null;
    return LatLng(_lat!, _lon!);
  }

  void snapTo(double latitude, double longitude) {
    if (!isFiniteLatLng(latitude, longitude)) return;
    _lat = latitude;
    _lon = longitude;
    _gpsTarget = LatLng(latitude, longitude);
    _gpsTargetAt = DateTime.now();
  }

  void setGpsTarget(
    LatLng target, {
    double speedMps = 0,
    double? courseDeg,
  }) {
    if (!isValidLatLng(target)) return;
    _gpsTarget = target;
    _gpsTargetAt = DateTime.now();
    _speedMps = speedMps.isFinite ? math.max(0, speedMps) : 0;
    _courseDeg = courseDeg != null && courseDeg.isFinite && courseDeg >= 0
        ? courseDeg
        : null;
  }

  LatLng _predictedTarget() {
    final base = _gpsTarget;
    final at = _gpsTargetAt;
    if (base == null || at == null) {
      return point ?? const LatLng(0, 0);
    }
    if (_speedMps < 0.6 || _courseDeg == null) return base;

    final elapsedSec =
        DateTime.now().difference(at).inMicroseconds / 1e6;
    if (elapsedSec <= 0 || elapsedSec > 1.8) return base;

    // Lead the puck slightly along travel direction (Google-like prediction).
    final leadMeters = _speedMps * elapsedSec * 0.85;
    return _offsetMeters(base, _courseDeg!, leadMeters);
  }

  /// Advance display point. Returns true if coordinates changed meaningfully.
  bool tick({double factor = 0.22}) {
    final target = _predictedTarget();
    if (!isValidLatLng(target)) return false;

    if (_lat == null || _lon == null) {
      _lat = target.latitude;
      _lon = target.longitude;
      return true;
    }

    final nextLat = _lat! + (target.latitude - _lat!) * factor;
    final nextLon = _lon! + (target.longitude - _lon!) * factor;
    final dLat = (nextLat - _lat!).abs();
    final dLon = (nextLon - _lon!).abs();
    _lat = nextLat;
    _lon = nextLon;
    return dLat > 1e-8 || dLon > 1e-8;
  }

  LatLng _offsetMeters(LatLng origin, double bearingDeg, double meters) {
    if (meters <= 0) return origin;
    const earthRadius = 6378137.0;
    final bearing = bearingDeg * math.pi / 180;
    final lat1 = origin.latitude * math.pi / 180;
    final lon1 = origin.longitude * math.pi / 180;
    final angDist = meters / earthRadius;

    final lat2 = math.asin(
      math.sin(lat1) * math.cos(angDist) +
          math.cos(lat1) * math.sin(angDist) * math.cos(bearing),
    );
    final lon2 = lon1 +
        math.atan2(
          math.sin(bearing) * math.sin(angDist) * math.cos(lat1),
          math.cos(angDist) - math.sin(lat1) * math.sin(lat2),
        );

    return LatLng(lat2 * 180 / math.pi, lon2 * 180 / math.pi);
  }
}
