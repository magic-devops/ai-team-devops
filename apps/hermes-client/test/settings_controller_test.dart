import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/hermes_api_client.dart';
import 'package:hermes_client/src/local_runtime.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/settings_store.dart';

class FakeStore extends SecureSettingsStore {
  FakeStore(this.current);

  ConnectionSettings current;
  int saves = 0;
  int clears = 0;

  @override
  Future<ConnectionSettings> load() async => current;

  @override
  Future<void> save(ConnectionSettings settings) async {
    saves += 1;
    current = settings;
  }

  @override
  Future<void> clear() async {
    clears += 1;
    current = const ConnectionSettings();
  }
}

class FakeRuntime implements LocalRuntime {
  FakeRuntime({LocalRuntimeSnapshot? initialSnapshot}) {
    if (initialSnapshot != null) snapshot = initialSnapshot;
  }

  int starts = 0;
  int restarts = 0;
  int stops = 0;

  @override
  LocalRuntimeSnapshot snapshot = const LocalRuntimeSnapshot(
    phase: LocalRuntimePhase.stopped,
  );

  @override
  Stream<LocalRuntimeSnapshot> get snapshots async* {
    yield snapshot;
  }

  @override
  bool get isDesktopSupported => true;

  @override
  String defaultDataDir() => '/tmp/hermes/1.0.0';

  @override
  String defaultTokenFile() => '/tmp/hermes/1.0.0/token';

  @override
  Future<HermesBootstrapReady> startBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  }) async {
    starts += 1;
    snapshot = const LocalRuntimeSnapshot(
      phase: LocalRuntimePhase.running,
      pid: 42,
      url: 'http://127.0.0.1:32000',
    );
    return const HermesBootstrapReady(
      url: 'http://127.0.0.1:32000',
      tokenFile: '/tmp/hermes/1.0.0/token',
      pid: 42,
    );
  }

  @override
  Future<HermesBootstrapReady> restartBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  }) async {
    restarts += 1;
    return startBundled(startupTimeout: startupTimeout);
  }

  @override
  Future<void> stopOwned() async {
    stops += 1;
    snapshot = const LocalRuntimeSnapshot(phase: LocalRuntimePhase.stopped);
  }

  @override
  Future<void> dispose() async {}
}

class FakeApi extends HermesApiClient {
  FakeApi({
    this.failReadiness = false,
    this.degradedReadiness = false,
    this.workspaceCount,
    this.runCount,
  }) : super(settings: const ConnectionSettings());

  final bool failReadiness;
  final bool degradedReadiness;
  final int? workspaceCount;
  final int? runCount;
  int readinessCalls = 0;
  final workspaceRunQueries = <String>[];

  @override
  Future<HermesEnvelope> readiness() async {
    readinessCalls += 1;
    if (failReadiness) {
      throw HermesApiException('unauthorized', statusCode: 401);
    }
    return HermesEnvelope(
      ok: !degradedReadiness,
      scope: {},
      summary: {
        'version': '1.0.0',
        'ready': !degradedReadiness,
      },
      items: const [],
      actions: const [],
      permissions: const ['read', 'write'],
      audit: const {},
      traceId: null,
    );
  }

  @override
  Future<List<HermesEntity>> list(
    Resource resource, {
    String? workspaceId,
    String? q,
    String? status,
    String? kind,
    int limit = 50,
    String? cursor,
  }) async {
    if (resource == Resource.workspaces) {
      if (workspaceCount != null) {
        return [
          for (var i = 0; i < workspaceCount!; i++)
            _entity('w$i', Resource.workspaces, 'active'),
        ];
      }
      return [
        _entity('w1', Resource.workspaces, 'active'),
        _entity('w2', Resource.workspaces, 'active'),
      ];
    }
    if (resource == Resource.runs) {
      workspaceRunQueries.add(workspaceId ?? '');
      if (runCount != null) {
        return [
          for (var i = 0; i < runCount!; i++)
            _entity('run-$workspaceId-$i', Resource.runs, 'completed'),
        ];
      }
      return workspaceId == 'w2'
          ? [_entity('run-busy', Resource.runs, 'running')]
          : [_entity('run-done', Resource.runs, 'completed')];
    }
    return [];
  }
}

void main() {
  test('local bootstrap validates readiness before saving credentials',
      () async {
    final store = FakeStore(const ConnectionSettings());
    final runtime = FakeRuntime();
    final api = FakeApi();
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        localRuntimeProvider.overrideWithValue(runtime),
        localTokenReaderProvider.overrideWithValue((_) async => 'token-value'),
        apiClientFactoryProvider.overrideWithValue((_) => api),
      ],
    );
    addTearDown(container.dispose);

    final settings =
        await container.read(settingsProvider.notifier).bootstrapLocal();

    expect(api.readinessCalls, 1);
    expect(store.saves, 1);
    expect(settings.baseUrl, 'http://127.0.0.1:32000');
    expect(settings.localPid, 42);
  });

  test('unauthorized readiness stops owned process and does not save',
      () async {
    final store = FakeStore(const ConnectionSettings());
    final runtime = FakeRuntime();
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        localRuntimeProvider.overrideWithValue(runtime),
        localTokenReaderProvider.overrideWithValue((_) async => 'token-value'),
        apiClientFactoryProvider.overrideWithValue(
          (_) => FakeApi(failReadiness: true),
        ),
      ],
    );
    addTearDown(container.dispose);

    await expectLater(
      container.read(settingsProvider.notifier).bootstrapLocal(),
      throwsA(isA<HermesApiException>()),
    );
    expect(runtime.stops, 1);
    expect(store.saves, 0);
  });

  test('degraded readiness stops owned process and does not save', () async {
    final store = FakeStore(const ConnectionSettings());
    final runtime = FakeRuntime();
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        localRuntimeProvider.overrideWithValue(runtime),
        localTokenReaderProvider.overrideWithValue((_) async => 'token-value'),
        apiClientFactoryProvider.overrideWithValue(
          (_) => FakeApi(degradedReadiness: true),
        ),
      ],
    );
    addTearDown(container.dispose);

    final elapsed = Stopwatch()..start();
    await expectLater(
      container.read(settingsProvider.notifier).bootstrapLocal(),
      throwsA(isA<HermesUnavailableException>()),
    );
    elapsed.stop();
    expect(runtime.stops, 1);
    expect(store.saves, 0);
    expect(elapsed.elapsed, lessThan(const Duration(seconds: 1)));
  });

  test('stop safety checks runs across all workspaces', () async {
    final store = FakeStore(const ConnectionSettings(
      baseUrl: 'http://127.0.0.1:32000',
      token: 'token-value',
      localPid: 42,
    ));
    final api = FakeApi();
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        apiClientFactoryProvider.overrideWithValue((_) => api),
      ],
    );
    addTearDown(container.dispose);
    await container.read(settingsProvider.future);

    final safety =
        await container.read(settingsProvider.notifier).checkStopSafety();

    expect(safety.canGuarantee, isTrue);
    expect(safety.busyRuns.single.id, 'run-busy');
    expect(api.workspaceRunQueries, ['w1', 'w2']);
  });

  test('stop safety is not guaranteed when runtime and settings URLs differ',
      () async {
    final store = FakeStore(const ConnectionSettings(
      baseUrl: 'https://remote.example.org',
      token: 'token-value',
      localPid: 42,
    ));
    final runtime = FakeRuntime(
      initialSnapshot: const LocalRuntimeSnapshot(
        phase: LocalRuntimePhase.running,
        pid: 42,
        url: 'http://127.0.0.1:32000',
      ),
    );
    final api = FakeApi();
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        localRuntimeProvider.overrideWithValue(runtime),
        apiClientFactoryProvider.overrideWithValue((_) => api),
      ],
    );
    addTearDown(container.dispose);
    await container.read(settingsProvider.future);

    final safety =
        await container.read(settingsProvider.notifier).checkStopSafety();

    expect(safety.canGuarantee, isFalse);
    expect(api.workspaceRunQueries, isEmpty);
  });

  test('stop safety is not guaranteed when list results reach limits',
      () async {
    final store = FakeStore(const ConnectionSettings(
      baseUrl: 'http://127.0.0.1:32000',
      token: 'token-value',
      localPid: 42,
    ));
    final api = FakeApi(workspaceCount: 50);
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        apiClientFactoryProvider.overrideWithValue((_) => api),
      ],
    );
    addTearDown(container.dispose);
    await container.read(settingsProvider.future);

    final safety =
        await container.read(settingsProvider.notifier).checkStopSafety();

    expect(safety.canGuarantee, isFalse);
    expect(safety.detail, contains('API limit'));
  });

  test(
      'stop safety is not guaranteed when any workspace run list reaches limit',
      () async {
    final store = FakeStore(const ConnectionSettings(
      baseUrl: 'http://127.0.0.1:32000',
      token: 'token-value',
      localPid: 42,
    ));
    final api = FakeApi(workspaceCount: 1, runCount: 100);
    final container = ProviderContainer(
      retry: (_, __) => null,
      overrides: [
        secureStoreProvider.overrideWithValue(store),
        apiClientFactoryProvider.overrideWithValue((_) => api),
      ],
    );
    addTearDown(container.dispose);
    await container.read(settingsProvider.future);

    final safety =
        await container.read(settingsProvider.notifier).checkStopSafety();

    expect(safety.canGuarantee, isFalse);
    expect(api.workspaceRunQueries, ['w0']);
  });
}

HermesEntity _entity(String id, Resource resource, String status) {
  return HermesEntity(
    id: id,
    kind: resource.path,
    version: 1,
    status: status,
    data: {'title': id},
    createdAt: null,
    updatedAt: null,
  );
}
