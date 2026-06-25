import 'package:flutter/material.dart';

import '../services/capture_service.dart';

class FieldCaptureSheet extends StatefulWidget {
  const FieldCaptureSheet({
    super.key,
    required this.captureService,
    required this.latitude,
    required this.longitude,
    this.snappedToName,
  });

  final CaptureService captureService;
  final double latitude;
  final double longitude;
  final String? snappedToName;

  @override
  State<FieldCaptureSheet> createState() => _FieldCaptureSheetState();
}

class _FieldCaptureSheetState extends State<FieldCaptureSheet> {
  final _nameController = TextEditingController();
  final _substationController = TextEditingController();
  final _feederController = TextEditingController();
  String _utility = 'ECG_SOUTHERN';
  bool _loading = false;
  String? _message;

  static const _utilities = [
    'ECG_SOUTHERN',
    'ECG_NORTHERN',
    'NEDCO',
  ];

  @override
  void dispose() {
    _nameController.dispose();
    _substationController.dispose();
    _feederController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _message = 'Enter a node name');
      return;
    }

    setState(() {
      _loading = true;
      _message = null;
    });

    final result = await widget.captureService.submit(
      name: name,
      latitude: widget.latitude,
      longitude: widget.longitude,
      operatingUtility: _utility,
      substationName: _substationController.text.trim().isEmpty
          ? null
          : _substationController.text.trim(),
      boundaryFeederId: _feederController.text.trim().isEmpty
          ? null
          : _feederController.text.trim(),
    );

    if (!mounted) return;
    if (result.synced) {
      Navigator.pop(context, result);
      return;
    }

    setState(() {
      _loading = false;
      _message = 'Offline — queued for sync when online';
    });
    await Future<void>.delayed(const Duration(seconds: 1));
    if (mounted) Navigator.pop(context, result);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('New connectivity node', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              '${widget.latitude.toStringAsFixed(6)}, ${widget.longitude.toStringAsFixed(6)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (widget.snappedToName != null) ...[
              const SizedBox(height: 8),
              Chip(
                avatar: const Icon(Icons.link, size: 18),
                label: Text('Snapped near ${widget.snappedToName}'),
              ),
            ],
            const SizedBox(height: 16),
            TextField(
              controller: _nameController,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Node name *',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _utility,
              decoration: const InputDecoration(
                labelText: 'Operating utility',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final u in _utilities)
                  DropdownMenuItem(value: u, child: Text(u)),
              ],
              onChanged: _loading ? null : (v) => setState(() => _utility = v!),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _substationController,
              decoration: const InputDecoration(
                labelText: 'Substation (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _feederController,
              decoration: const InputDecoration(
                labelText: 'Boundary feeder ID (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loading ? null : _submit,
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save),
              label: Text(_loading ? 'Saving…' : 'Save to staging'),
            ),
          ],
        ),
      ),
    );
  }
}
