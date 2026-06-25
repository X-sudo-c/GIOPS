import 'package:flutter/material.dart';

import '../config/api_config.dart';
import '../services/settings_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.config,
    required this.onSaved,
  });

  final ApiConfig config;
  final ValueChanged<ApiConfig> onSaved;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _syncController;
  late final TextEditingController _ocrController;
  late final TextEditingController _supabaseController;
  late final TextEditingController _anonController;
  final _settings = SettingsService();
  String? _message;

  @override
  void initState() {
    super.initState();
    _syncController = TextEditingController(text: widget.config.syncBaseUrl);
    _ocrController = TextEditingController(text: widget.config.ocrBaseUrl);
    _supabaseController = TextEditingController(text: widget.config.supabaseUrl);
    _anonController = TextEditingController(text: widget.config.supabaseAnonKey);
  }

  @override
  void dispose() {
    _syncController.dispose();
    _ocrController.dispose();
    _supabaseController.dispose();
    _anonController.dispose();
    super.dispose();
  }

  void _applyPreset(ApiConfig preset) {
    setState(() {
      _syncController.text = preset.syncBaseUrl;
      _ocrController.text = preset.ocrBaseUrl;
      _supabaseController.text = preset.supabaseUrl;
      _anonController.text = preset.supabaseAnonKey;
    });
  }

  Future<void> _save() async {
    final config = ApiConfig(
      syncBaseUrl: _syncController.text.trim(),
      ocrBaseUrl: _ocrController.text.trim(),
      supabaseUrl: _supabaseController.text.trim(),
      supabaseAnonKey: _anonController.text.trim(),
    );
    await _settings.save(config);
    widget.onSaved(config);
    setState(() => _message = 'Settings saved');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton(
                onPressed: () => _applyPreset(ApiConfig.androidEmulator()),
                child: const Text('Android emulator preset'),
              ),
              OutlinedButton(
                onPressed: () => _applyPreset(ApiConfig.localhost()),
                child: const Text('Localhost preset'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _syncController,
            decoration: const InputDecoration(
              labelText: 'Sync service URL',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _ocrController,
            decoration: const InputDecoration(
              labelText: 'OCR service URL',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _supabaseController,
            decoration: const InputDecoration(
              labelText: 'Supabase URL',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _anonController,
            decoration: const InputDecoration(
              labelText: 'Supabase anon key',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _save, child: const Text('Save')),
          if (_message != null) ...[
            const SizedBox(height: 12),
            Text(_message!),
          ],
          const SizedBox(height: 24),
          const Text(
            'Physical device: replace host with your machine LAN IP '
            '(e.g. http://192.168.1.10:5000).',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }
}
