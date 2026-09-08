import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/local_runtime.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/pages/settings_page.dart';
import 'package:hermes_client/src/settings_controller.dart';

class TestSettings extends SettingsController {
  @override
  Future<ConnectionSettings> build() async => const ConnectionSettings(
        baseUrl: 'http://127.0.0.1:32000',
        token: 'token',
        localPid: 42,
      );
}

class TestRuntime implements LocalRuntime {
  TestRuntime({required this.desktop, required this.snapshot});

  final bool desktop;

  @override
  LocalRuntimeSnapshot snapshot;

  @override
  Stream<LocalRuntimeSnapshot> get snapshots async* {
    yield snapshot;
  }

  @override
  bool get isDesktopSupported => desktop;

  @override
  String defaultDataDir() => '/tmp/hermes/1.0.0';

  @override
  String defaultTokenFile() => '/tmp/hermes/1.0.0/token';

  @override
  Future<HermesBootstrapReady> startBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  }) async {
    throw UnimplementedError();
  }

  @override
  Future<HermesBootstrapReady> restartBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  }) async {
    throw UnimplementedError();
  }

  @override
  Future<void> stopOwned() async {}

  @override
  Future<void> dispose() async {}
}

void main() {
  testWidgets('desktop settings show structured runtime controls',
      (tester) async {
    await tester.pumpWidget(_harness(TestRuntime(
      desktop: true,
      snapshot: const LocalRuntimeSnapshot(
        phase: LocalRuntimePhase.running,
        pid: 42,
        url: 'http://127.0.0.1:32000',
      ),
    )));
    await tester.pumpAndSettle();

    expect(find.text('本地运行时'), findsOneWidget);
    expect(find.text('运行中'), findsOneWidget);
    expect(find.text('数据目录：/tmp/hermes/1.0.0'), findsOneWidget);
    expect(find.text('重启'), findsOneWidget);
    expect(find.text('停止'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('保存远端连接'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('保存远端连接'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('retained crashed process can be stopped but not restarted',
      (tester) async {
    await tester.pumpWidget(_harness(TestRuntime(
      desktop: true,
      snapshot: const LocalRuntimeSnapshot(
        phase: LocalRuntimePhase.crashed,
        pid: 42,
        message: 'startup failed and is still exiting',
      ),
    )));
    await tester.pumpAndSettle();

    expect(find.text('已崩溃'), findsOneWidget);
    expect(find.text('已持有本地 Core 进程'), findsOneWidget);

    final start = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '启动本地 Core'),
    );
    final restart = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, '重启'),
    );
    final stop = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, '停止'),
    );

    expect(start.onPressed, isNull);
    expect(restart.onPressed, isNull);
    expect(stop.onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('non-desktop settings are remote-only', (tester) async {
    await tester.pumpWidget(_harness(TestRuntime(
      desktop: false,
      snapshot: const LocalRuntimeSnapshot(phase: LocalRuntimePhase.stopped),
    )));
    await tester.pumpAndSettle();

    expect(find.text('移动端使用远端 Core'), findsOneWidget);
    expect(find.text('启动本地 Core'), findsNothing);
    await tester.scrollUntilVisible(
      find.text('保存远端连接'),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('保存远端连接'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Widget _harness(LocalRuntime runtime) {
  return ProviderScope(
    retry: (_, __) => null,
    overrides: [
      settingsProvider.overrideWith(TestSettings.new),
      localRuntimeProvider.overrideWithValue(runtime),
      healthProvider.overrideWith((ref) async => _envelope()),
      readinessProvider.overrideWith((ref) async => _envelope()),
      diagnosticsProvider.overrideWith((ref) async => _envelope(
            summary: {
              'version': '1.0.0',
              'total': 4,
              'passed': 4,
              'failed': 0,
              'ready': true,
            },
          )),
    ],
    child: const MaterialApp(home: Scaffold(body: SettingsPage())),
  );
}

HermesEnvelope _envelope({Map<String, dynamic>? summary}) {
  return HermesEnvelope(
    ok: true,
    scope: const {},
    summary: summary ?? const {'version': '1.0.0'},
    items: const [],
    actions: const [],
    permissions: const ['read', 'write'],
    audit: const {},
    traceId: null,
  );
}
