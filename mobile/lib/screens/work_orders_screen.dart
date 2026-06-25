import 'package:flutter/material.dart';

import '../services/giop_api.dart';
import '../services/offline_db.dart';

class WorkOrdersScreen extends StatefulWidget {
  const WorkOrdersScreen({super.key, required this.api});

  final GiopApi api;

  @override
  State<WorkOrdersScreen> createState() => _WorkOrdersScreenState();
}

class _WorkOrdersScreenState extends State<WorkOrdersScreen>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _orders = [];
  bool _loading = true;
  String? _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _sync();
    }
  }

  Future<void> _sync() async {
    setState(() {
      _loading = true;
      _status = null;
    });
    try {
      await widget.api.syncWorkOrders();
      final local = await OfflineDb.listWorkOrders();
      setState(() {
        _orders = local;
        _loading = false;
      });
    } catch (e) {
      final local = await OfflineDb.listWorkOrders();
      setState(() {
        _orders = local;
        _loading = false;
        _status = 'Offline — showing cached work orders';
      });
    }
  }

  Future<void> _advanceStatus(String id, String current) async {
    const next = {
      'DISPATCHED': 'RECEIVED',
      'RECEIVED': 'ACCEPTED',
      'ACCEPTED': 'EN_ROUTE',
      'EN_ROUTE': 'ON_SITE',
      'ON_SITE': 'IN_PROGRESS',
      'IN_PROGRESS': 'COMPLETED',
    };
    final newStatus = next[current];
    if (newStatus == null) return;
    await OfflineDb.queueWorkOrderStatusUpdate(
      workOrderId: id,
      newStatus: newStatus,
    );
    setState(() {
      _status = 'Status queued — syncing…';
    });
    await _sync();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Work Orders'),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: _loading ? null : () => _sync(),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _sync,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_status != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(_status!, style: Theme.of(context).textTheme.bodySmall),
                    ),
                  if (_orders.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text('No assigned work orders.'),
                    ),
                  ..._orders.map((wo) {
                    final id = wo['id'] as String;
                    final status = wo['status'] as String? ?? 'DISPATCHED';
                    return Card(
                      child: ListTile(
                        title: Text(wo['reference'] as String? ?? id),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const SizedBox(height: 4),
                            Text(wo['summary'] as String? ?? ''),
                            const SizedBox(height: 4),
                            Text(
                              '${wo['work_type']} · $status',
                              style: Theme.of(context).textTheme.labelSmall,
                            ),
                          ],
                        ),
                        isThreeLine: true,
                        trailing: status != 'COMPLETED' && status != 'CANCELLED'
                            ? TextButton(
                                onPressed: () => _advanceStatus(id, status),
                                child: const Text('Advance'),
                              )
                            : null,
                      ),
                    );
                  }),
                ],
              ),
            ),
    );
  }
}
