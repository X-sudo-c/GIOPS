import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:giop_field/main.dart';

void main() {
  testWidgets('App loads', (WidgetTester tester) async {
    await tester.pumpWidget(const GiopFieldApp());
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
