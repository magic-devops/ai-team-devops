import 'dart:convert';
import 'dart:io';

import 'package:hermes_client/src/hermes_api_client.dart';
import 'package:hermes_client/src/local_runtime.dart';
import 'package:hermes_client/src/models.dart';

Future<void> main(List<String> arguments) async {
  if (arguments.length != 1) {
    stderr.writeln('Usage: dart run tool/runtime_smoke.dart RUNTIME_DIRECTORY');
    exitCode = 2;
    return;
  }
  final root = await Directory.systemTemp.createTemp('hermes-dart-runtime-');
  final data = Directory('${root.path}/\u672c\u5730\u5de5\u4f5c\u7a7a\u95f4');
  final tokenFile = File('${data.path}/token');
  final runtime = BundledLocalRuntime(
    runtimeDirectory: Directory(arguments.single).absolute,
    dataDir: data.path,
    tokenFile: tokenFile.path,
  );
  try {
    final first = await runtime.startBundled();
    final token = (await tokenFile.readAsString()).trim();
    final client = HermesApiClient(
      settings: ConnectionSettings(baseUrl: first.url, token: token),
    );
    late final String workspaceId;
    try {
      final diagnostics = await _ready(client);
      final workspaceRoot = await Directory('${root.path}/project').create();
      final workspace = await client.create(Resource.workspaces, {
        'name': 'Desktop runtime smoke',
        'root': workspaceRoot.path,
      });
      workspaceId = workspace.id;
      stdout.writeln(jsonEncode({
        'phase': 'started',
        'ok': diagnostics.ok,
        'summary': diagnostics.summary,
        'workspace_id': workspaceId,
        'unicode_data_path': true,
      }));
    } finally {
      client.close();
    }
    final second = await runtime.restartBundled();
    final nextToken = (await tokenFile.readAsString()).trim();
    if (token != nextToken) throw StateError('Restart replaced the token');
    final reconnected = HermesApiClient(
      settings: ConnectionSettings(baseUrl: second.url, token: nextToken),
    );
    try {
      await _ready(reconnected);
      final workspaces = await reconnected.list(Resource.workspaces);
      if (!workspaces.any((workspace) => workspace.id == workspaceId)) {
        throw StateError('Restart did not retain workspace data');
      }
      stdout.writeln(jsonEncode({
        'phase': 'restarted',
        'ok': true,
        'workspace_retained': true,
        'token_retained': true,
        'owned_process': runtime.snapshot.hasOwnedProcess,
      }));
    } finally {
      reconnected.close();
    }
    await runtime.stopOwned();
    if (runtime.snapshot.hasOwnedProcess) {
      throw StateError('Stop left an owned process');
    }
    stdout.writeln(jsonEncode({'phase': 'stopped', 'ok': true}));
  } finally {
    await runtime.stopOwned();
    await runtime.dispose();
    await root.delete(recursive: true);
  }
}

Future<HermesEnvelope> _ready(HermesApiClient client) async {
  final deadline = DateTime.now().add(const Duration(seconds: 15));
  while (true) {
    try {
      await client.health().timeout(deadline.difference(DateTime.now()));
      break;
    } catch (_) {
      if (!DateTime.now().isBefore(deadline)) rethrow;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
  }
  final diagnostics = await client.diagnostics();
  if (!diagnostics.ok || diagnostics.summary['passed'] != 4) {
    throw StateError('Runtime diagnostics failed: ${diagnostics.summary}');
  }
  return diagnostics;
}
