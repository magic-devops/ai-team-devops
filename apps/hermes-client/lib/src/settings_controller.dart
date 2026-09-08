import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';
import 'models.dart';
import 'hermes_api_client.dart';

class SettingsController extends AsyncNotifier<ConnectionSettings> {
  Process? _localProcess;

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
    final client = HermesApiClient(settings: normalized);
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

  Future<ConnectionSettings> bootstrapLocal({
    required String dataDir,
    required String tokenFile,
  }) async {
    if (kIsWeb ||
        !(Platform.isMacOS || Platform.isLinux || Platform.isWindows)) {
      throw const HermesUnavailableException(
        'Local bootstrap is available only on desktop. Configure a remote Hermes core URL on this device.',
      );
    }
    if (_localProcess != null) {
      throw const HermesUnavailableException(
          'A local core is already running in this client.');
    }
    final executable = File(Platform.resolvedExecutable);
    final runtime = Platform.isMacOS
        ? Directory('${executable.parent.parent.path}/Resources/runtime')
        : Directory('${executable.parent.path}/runtime');
    final suffix = Platform.isWindows ? '.exe' : '';
    final core = File('${runtime.path}/hermes-core/hermes-core$suffix');
    final agentd = File('${runtime.path}/agentd/sop-agentd$suffix');
    if (!await core.exists() || !await agentd.exists()) {
      throw const HermesUnavailableException(
          'Bundled runtime is missing. Install a complete Hermes desktop package.');
    }
    final process = await Process.start(core.path, [
      '--data-dir',
      dataDir,
      '--token-file',
      tokenFile,
      '--port',
      '0',
      '--agentd',
      agentd.path,
    ]);
    _localProcess = process;
    final stderr = process.stderr.listen((_) {});
    unawaited(process.exitCode.then((_) {
      if (identical(_localProcess, process)) _localProcess = null;
      stderr.cancel();
    }));
    try {
      final line = await process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .first
          .timeout(const Duration(seconds: 20));
      final payload = jsonDecode(line) as Map<String, dynamic>;
      final ready = HermesBootstrapReady.fromJson(payload);
      final token = await File(ready.tokenFile).readAsString();
      final settings = ConnectionSettings(
        baseUrl: ready.url.replaceAll(RegExp(r'/+$'), ''),
        token: token.trim(),
        tokenFile: ready.tokenFile,
        localPid: ready.pid,
      );
      final client = HermesApiClient(settings: settings);
      try {
        for (var attempt = 0;; attempt++) {
          try {
            await client.list(Resource.workspaces);
            break;
          } catch (_) {
            if (attempt >= 20) rethrow;
            await Future<void>.delayed(const Duration(milliseconds: 250));
          }
        }
      } finally {
        client.close();
      }
      await ref.read(secureStoreProvider).save(settings);
      state = AsyncData(settings);
      return settings;
    } catch (_) {
      process.kill();
      _localProcess = null;
      rethrow;
    }
  }

  Future<void> disconnect() async {
    await ref.read(secureStoreProvider).clear();
    state = const AsyncData(ConnectionSettings());
  }
}
