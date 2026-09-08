import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hermes_client/src/app.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/settings_controller.dart';

class TestSettings extends SettingsController {
  @override
  Future<ConnectionSettings> build() async => const ConnectionSettings();
}

void main() {
  for (final size in [const Size(1440, 900), const Size(390, 844)]) {
    testWidgets('Workspace shell adapts without overflow at $size',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(ProviderScope(
        retry: (_, __) => null,
        overrides: [
          settingsProvider.overrideWith(TestSettings.new),
          workspacesProvider.overrideWith((ref) async => [])
        ],
        child: const HermesApp(),
      ));
      await tester.pumpAndSettle();
      expect(find.byType(size.width < 760 ? NavigationBar : NavigationRail),
          findsOneWidget);
      expect(tester.takeException(), isNull);
      for (final label in ['项目', '资产', '收件箱', '自动化', '设置', '工作台']) {
        final navigation =
            find.byType(size.width < 760 ? NavigationBar : NavigationRail);
        await tester.tap(
            find.descendant(of: navigation, matching: find.text(label)).first);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$label at $size');
      }
    });
  }
}
