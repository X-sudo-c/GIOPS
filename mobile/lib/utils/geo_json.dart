import 'package:latlong2/latlong.dart';

import '../utils/geo.dart';

List<LatLng> latLngsFromGeoJson(dynamic geom) {
  if (geom is! Map<String, dynamic>) return const [];

  final type = geom['type'] as String?;
  final coords = geom['coordinates'];
  if (coords is! List) return const [];

  if (type == 'LineString') {
    return _parseLineCoords(coords);
  }
  if (type == 'MultiLineString') {
    var best = <LatLng>[];
    for (final part in coords) {
      if (part is! List) continue;
      final line = _parseLineCoords(part);
      if (line.length > best.length) best = line;
    }
    return best;
  }
  return const [];
}

List<LatLng> _parseLineCoords(List<dynamic> coords) {
  final points = <LatLng>[];
  for (final c in coords) {
    if (c is! List || c.length < 2) continue;
    final lat = (c[1] as num).toDouble();
    final lon = (c[0] as num).toDouble();
    if (isFiniteLatLng(lat, lon)) {
      points.add(LatLng(lat, lon));
    }
  }
  return points;
}
