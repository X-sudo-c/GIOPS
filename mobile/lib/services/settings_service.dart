import 'dart:convert';
import 'dart:io';

import 'package:shared_preferences/shared_preferences.dart';

import '../config/api_config.dart';

class SettingsService {
  static const _key = 'giop_api_config';

  Future<ApiConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw != null) {
      return ApiConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    }
    return Platform.isAndroid ? ApiConfig.androidEmulator() : ApiConfig.localhost();
  }

  Future<void> save(ApiConfig config) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(config.toJson()));
  }
}
