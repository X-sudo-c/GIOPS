import 'package:flutter/material.dart';

enum AssetKind {
  distributionTransformer,
  powerTransformer,
  pole11kv,
  pole33kv,
  poleLv,
  connectivityNode,
  fieldCapture,
}

AssetKind assetKindFromString(String? raw) {
  switch (raw) {
    case 'distribution_transformer':
      return AssetKind.distributionTransformer;
    case 'power_transformer':
      return AssetKind.powerTransformer;
    case 'pole_11kv':
      return AssetKind.pole11kv;
    case 'pole_33kv':
      return AssetKind.pole33kv;
    case 'pole_lv':
      return AssetKind.poleLv;
    default:
      return AssetKind.connectivityNode;
  }
}

String assetKindToApiValue(AssetKind kind) {
  switch (kind) {
    case AssetKind.distributionTransformer:
      return 'distribution_transformer';
    case AssetKind.powerTransformer:
      return 'power_transformer';
    case AssetKind.pole11kv:
      return 'pole_11kv';
    case AssetKind.pole33kv:
      return 'pole_33kv';
    case AssetKind.poleLv:
      return 'pole_lv';
    case AssetKind.connectivityNode:
      return 'connectivity_node';
    case AssetKind.fieldCapture:
      return 'field_capture';
  }
}

String assetKindLabel(AssetKind kind) {
  switch (kind) {
    case AssetKind.distributionTransformer:
      return 'Distribution transformer';
    case AssetKind.powerTransformer:
      return 'Power transformer';
    case AssetKind.pole11kv:
      return 'Pole (11 kV)';
    case AssetKind.pole33kv:
      return 'Pole (33 kV)';
    case AssetKind.poleLv:
      return 'Pole (LV)';
    case AssetKind.connectivityNode:
      return 'Grid node';
    case AssetKind.fieldCapture:
      return 'Field capture';
  }
}

Color assetKindColor(AssetKind kind) {
  switch (kind) {
    case AssetKind.distributionTransformer:
      return const Color(0xFFE65100);
    case AssetKind.powerTransformer:
      return const Color(0xFFB71C1C);
    case AssetKind.pole11kv:
      return const Color(0xFF1565C0);
    case AssetKind.pole33kv:
      return const Color(0xFF6A1B9A);
    case AssetKind.poleLv:
      return const Color(0xFF546E7A);
    case AssetKind.connectivityNode:
      return const Color(0xFF2E7D32);
    case AssetKind.fieldCapture:
      return Colors.orange;
  }
}

IconData assetKindIcon(AssetKind kind) {
  switch (kind) {
    case AssetKind.distributionTransformer:
      return Icons.electrical_services;
    case AssetKind.powerTransformer:
      return Icons.transform;
    case AssetKind.pole11kv:
    case AssetKind.pole33kv:
    case AssetKind.poleLv:
      return Icons.adjust;
    case AssetKind.connectivityNode:
      return Icons.place;
    case AssetKind.fieldCapture:
      return Icons.add_location_alt;
  }
}

Color voltageLineColor(String? voltage) {
  switch (voltage) {
    case 'MV_33KV':
      return const Color(0xFFC62828);
    case 'MV_11KV':
      return const Color(0xFF1565C0);
    case 'LV_400V':
    case 'LV_230V':
    case 'LV':
      return const Color(0xFF757575);
    default:
      return const Color(0xFF455A64);
  }
}

double voltageLineWidth(String? voltage) {
  switch (voltage) {
    case 'MV_33KV':
      return 4;
    case 'MV_11KV':
      return 3;
    default:
      return 2;
  }
}
