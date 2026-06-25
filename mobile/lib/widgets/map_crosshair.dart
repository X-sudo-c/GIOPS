import 'package:flutter/material.dart';

/// Center-screen crosshair shown in add-point mode (QField-style placement).
class MapCrosshair extends StatelessWidget {
  const MapCrosshair({super.key});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Center(
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            border: Border.all(color: Colors.red, width: 2),
            borderRadius: BorderRadius.circular(2),
          ),
          child: const Center(
            child: Icon(Icons.add, color: Colors.red, size: 16),
          ),
        ),
      ),
    );
  }
}
