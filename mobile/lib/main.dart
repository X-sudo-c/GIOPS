import 'package:flutter/material.dart';

import 'config/api_config.dart';
import 'screens/map_screen.dart';
import 'screens/meter_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/work_orders_screen.dart';
import 'services/giop_api.dart';
import 'services/settings_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const GiopFieldApp());
}

class GiopFieldApp extends StatefulWidget {
  const GiopFieldApp({super.key});

  @override
  State<GiopFieldApp> createState() => _GiopFieldAppState();
}

class _GiopFieldAppState extends State<GiopFieldApp> {
  final _settings = SettingsService();
  ApiConfig? _config;
  GiopApi? _api;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final config = await _settings.load();
    setState(() {
      _config = config;
      _api = GiopApi(config);
    });
  }

  void _updateConfig(ApiConfig config) {
    setState(() {
      _config = config;
      _api = GiopApi(config);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_config == null || _api == null) {
      return MaterialApp(
        home: Scaffold(
          body: Center(
            child: CircularProgressIndicator(
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        ),
      );
    }

    return MaterialApp(
      title: 'GIOP Field',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      home: HomeShell(
        api: _api!,
        config: _config!,
        onConfigSaved: _updateConfig,
      ),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.api,
    required this.config,
    required this.onConfigSaved,
  });

  final GiopApi api;
  final ApiConfig config;
  final ValueChanged<ApiConfig> onConfigSaved;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  int _mapRefreshTrigger = 0;

  void _onTabSelected(int i) {
    setState(() {
      _index = i;
      if (i == 0) {
        _mapRefreshTrigger++;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      MapScreen(
        api: widget.api,
        refreshTrigger: _mapRefreshTrigger,
      ),
      WorkOrdersScreen(api: widget.api),
      MeterScreen(api: widget.api),
      SettingsScreen(
        config: widget.config,
        onSaved: widget.onConfigSaved,
      ),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: _onTabSelected,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.map),
            label: 'Map',
          ),
          NavigationDestination(
            icon: Icon(Icons.assignment),
            label: 'Work',
          ),
          NavigationDestination(
            icon: Icon(Icons.speed),
            label: 'Meter',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
