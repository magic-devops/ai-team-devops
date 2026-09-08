import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';
import 'models.dart';

class RuntimeStopSafety {
  const RuntimeStopSafety({
    required this.canGuarantee,
    required this.busyRuns,
    required this.detail,
  });

  final bool canGuarantee;
  final List<HermesEntity> busyRuns;
  final String detail;

  bool get hasBusyRuns => busyRuns.isNotEmpty;
}

class SettingsController extends AsyncNotifier<ConnectionSettings> {
  @override
  Future<ConnectionSettings> build() {
    return ref.watch(secureStoreProvider).load();
  }

  Future<void> saveRemote({
    required String baseUrl,
    required String token,
    String? workspaceId,
  }) async {
    final trimmedWorkspace = workspaceId?.trim();
    final normalized = ConnectionSettings(
      baseUrl: baseUrl.trim().replaceAll(RegExp(r'/+$'), ''),
      token: token.trim(),
      workspaceId: trimmedWorkspace == null || trimmedWorkspace.isEmpty
          ? null
          : trimmedWorkspace,
    );
    final client = ref.read(apiClientFactoryProvider)(normalized);
    try {
      await client.list(Resource.workspaces);
    } finally {
      client.close();
    }
    await ref.read(secureStoreProvider).save(normalized);
    state = AsyncData(normalized);
  }

  Future<void> selectWorkspace(String workspaceId) async {
    final current = state.asData?.value ?? await build();
    final next = current.copyWith(workspaceId: workspaceId);
    await ref.read(secureStoreProvider).save(next);
    state = AsyncData(next);
  }

  Future<ConnectionSettings> bootstrapLocal() {
    return _startLocal(restart: false);
  }

  Future<ConnectionSettings> restartLocal() {
    return _startLocal(restart: true);
  }

  Future<ConnectionSettings> _startLocal({required bool restart}) async {
    final runtime = ref.read(localRuntimeProvider);
    try {
      final ready = restart
          ? await runtime.restartBundled()
          : await runtime.startBundled();
      final token = await ref.read(localTokenReaderProvider)(ready.tokenFile);
      final settings = ConnectionSettings(
        baseUrl: ready.url.replaceAll(RegExp(r'/+$'), ''),
        token: token.trim(),
        tokenFile: ready.tokenFile,
        localPid: ready.pid,
      );
      final client = ref.read(apiClientFactoryProvider)(settings);
      try {
        final deadline = DateTime.now().add(const Duration(seconds: 15));
        for (;;) {
          final remaining = deadline.difference(DateTime.now());
          if (remaining <= Duration.zero) {
            throw const HermesUnavailableException(
              'Hermes Core readiness did not become available within 15s.',
            );
          }
          late final HermesEnvelope readiness;
          try {
            readiness = await client.readiness().timeout(remaining);
          } on TimeoutException {
            throw const HermesUnavailableException(
              'Hermes Core readiness did not become available within 15s.',
            );
          } on HermesUnavailableException {
            final delay = _startupRetryDelay(remaining);
            if (delay == null) rethrow;
            await Future<void>.delayed(delay);
            continue;
          }
          if (!readiness.ok || readiness.summary['ready'] == false) {
            throw HermesUnavailableException(
              'Hermes Core readiness failed: ${readiness.summary}',
            );
          }
          break;
        }
        await client.list(Resource.workspaces);
      } finally {
        client.close();
      }
      await ref.read(secureStoreProvider).save(settings);
      state = AsyncData(settings);
      return settings;
    } catch (_) {
      await runtime.stopOwned();
      rethrow;
    }
  }

  Future<void> stopLocal() async {
    await ref.read(localRuntimeProvider).stopOwned();
    final current = state.asData?.value ?? await build();
    if (current.localPid != null) {
      await ref.read(secureStoreProvider).clear();
      state = const AsyncData(ConnectionSettings());
    }
  }

  Future<RuntimeStopSafety> checkStopSafety() async {
    final settings = state.asData?.value ?? await build();
    if (settings.isConfigured != true) {
      return const RuntimeStopSafety(
        canGuarantee: true,
        busyRuns: [],
        detail: 'Hermes Core is not configured.',
      );
    }
    final runtimeUrl = ref.read(localRuntimeProvider).snapshot.url;
    if (runtimeUrl != null && settings.baseUrl != runtimeUrl) {
      return RuntimeStopSafety(
        canGuarantee: false,
        busyRuns: const [],
        detail:
            'Configured endpoint ${settings.baseUrl} does not match owned runtime $runtimeUrl.',
      );
    }
    final client = ref.read(apiClientFactoryProvider)(settings);
    try {
      const workspaceLimit = 50;
      const runLimit = 100;
      final workspaces =
          await client.list(Resource.workspaces, limit: workspaceLimit);
      var truncated = workspaces.length >= workspaceLimit;
      final busy = <HermesEntity>[];
      for (final workspace in workspaces) {
        final runs = await client.list(
          Resource.runs,
          workspaceId: workspace.id,
          limit: runLimit,
        );
        if (runs.length >= runLimit) truncated = true;
        busy.addAll(runs.where(_isBusyRun));
      }
      return RuntimeStopSafety(
        canGuarantee: !truncated,
        busyRuns: busy,
        detail: truncated
            ? 'Checked result reached API limit; running job state may be incomplete.'
            : 'Checked ${workspaces.length} workspace(s).',
      );
    } catch (error) {
      return RuntimeStopSafety(
        canGuarantee: false,
        busyRuns: const [],
        detail: error.toString(),
      );
    } finally {
      client.close();
    }
  }

  Future<void> disconnect() async {
    await ref.read(secureStoreProvider).clear();
    state = const AsyncData(ConnectionSettings());
  }

  bool _isBusyRun(HermesEntity run) {
    final status = run.status.toLowerCase();
    return {
      'queued',
      'pending',
      'starting',
      'running',
      'in_progress',
      'active',
      'cancelling',
    }.contains(status);
  }

  Duration? _startupRetryDelay(Duration remaining) {
    if (remaining <= const Duration(milliseconds: 250)) return null;
    const delay = Duration(milliseconds: 250);
    return remaining < delay ? remaining : delay;
  }
}
