import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../models/asset_kind.dart';
import '../utils/geo_json.dart';

class HighlightLine {
  const HighlightLine({
    required this.points,
    required this.voltage,
    this.lineMrid,
  });

  final List<LatLng> points;
  final String? voltage;
  final String? lineMrid;
}

List<HighlightLine> highlightLinesFromTopology(Map<String, dynamic>? topology) {
  if (topology == null) return const [];

  final lines = <HighlightLine>[];
  final seen = <String>{};

  void addFromList(List<dynamic> rows) {
    for (final row in rows) {
      if (row is! Map<String, dynamic>) continue;
      final lineMrid = row['line_mrid'] as String?;
      if (lineMrid != null && seen.contains(lineMrid)) continue;
      if (lineMrid != null) seen.add(lineMrid);

      final points = latLngsFromGeoJson(row['geom']);
      if (points.length < 2) continue;

      lines.add(
        HighlightLine(
          points: points,
          voltage: row['voltage'] as String?,
          lineMrid: lineMrid,
        ),
      );
    }
  }

  addFromList(topology['downstream'] as List<dynamic>? ?? []);
  addFromList(topology['upstream'] as List<dynamic>? ?? []);
  return lines;
}
