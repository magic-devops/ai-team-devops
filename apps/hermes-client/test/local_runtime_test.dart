import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/src/local_runtime.dart';
import 'package:hermes_client/src/models.dart';

void main() {
  test('owned process state is true whenever a pid is retained', () {
    const retainedCrashed = LocalRuntimeSnapshot(
      phase: LocalRuntimePhase.crashed,
      pid: 1000,
    );
    const stopped = LocalRuntimeSnapshot(phase: LocalRuntimePhase.stopped);

    expect(retainedCrashed.hasOwnedProcess, isTrue);
    expect(retainedCrashed.isOwnedRunning, isFalse);
    expect(stopped.hasOwnedProcess, isFalse);
  });

  test('default data dir uses OS application data and Hermes 1.0.0', () {
    final runtime = BundledLocalRuntime();

    final dataDir = runtime.defaultDataDir();

    expect(dataDir, endsWith('${Platform.pathSeparator}1.0.0'));
    if (Platform.isMacOS) {
      expect(dataDir, contains('Library/Application Support/Hermes/1.0.0'));
    } else if (Platform.isWindows) {
      expect(dataDir, contains(r'\Hermes\1.0.0'));
    } else if (Platform.isLinux) {
      expect(dataDir, contains('hermes/1.0.0'));
    }
  });

  test('diagnostic redaction removes bearer tokens and token paths', () {
    final redacted = redactDiagnostic(
      'Bearer abcdefghijklmnopqrstuvwxyz123456 '
      'token=abcdefghijklmnopqrstuvwxyz123456 '
      'file=/tmp/Hermes/token-secret',
    );

    expect(redacted, contains('Bearer [REDACTED]'));
    expect(redacted, isNot(contains('abcdefghijklmnopqrstuvwxyz123456')));
    expect(redacted, contains('[REDACTED_PATH]'));
  });

  test('overlapping starts are rejected while first start is pending',
      () async {
    final fixture = await _RuntimeFixture.create();
    final process = _FakeProcess(pid: 1001);
    final started = Completer<Process>();
    final runtime = BundledLocalRuntime(
      runtimeDirectory: fixture.runtimeDir,
      dataDir: fixture.dataDir.path,
      tokenFile: fixture.tokenFile.path,
      processStarter: (_, __) => started.future,
    );

    final first = runtime.startBundled();
    await Future<void>.delayed(Duration.zero);
    await expectLater(
      runtime.startBundled(),
      throwsA(isA<HermesUnavailableException>()),
    );

    started.complete(process);
    process.stdoutController.add(utf8.encode(
      '${jsonEncode({
            'url': 'http://127.0.0.1:3000',
            'token_file': fixture.tokenFile.path,
            'pid': 1001
          })}\n',
    ));
    await first;
    await runtime.stopOwned();
    await fixture.dispose();
  });

  test('Process.start failure moves runtime to crashed state', () async {
    final fixture = await _RuntimeFixture.create();
    final runtime = BundledLocalRuntime(
      runtimeDirectory: fixture.runtimeDir,
      dataDir: fixture.dataDir.path,
      tokenFile: fixture.tokenFile.path,
      processStarter: (_, __) => throw const ProcessException(
        'hermes-core',
        [],
        'spawn failed',
      ),
    );

    await expectLater(
      runtime.startBundled(),
      throwsA(isA<ProcessException>()),
    );

    expect(runtime.snapshot.phase, LocalRuntimePhase.crashed);
    expect(runtime.snapshot.message, contains('spawn failed'));
    await fixture.dispose();
  });

  test('stop timeout keeps owned process running and blocks restart', () async {
    final fixture = await _RuntimeFixture.create();
    final process = _FakeProcess(pid: 1002, completeExitOnKill: false);
    final runtime = BundledLocalRuntime(
      runtimeDirectory: fixture.runtimeDir,
      dataDir: fixture.dataDir.path,
      tokenFile: fixture.tokenFile.path,
      stopTimeout: const Duration(milliseconds: 20),
      processStarter: (_, __) async => process,
    );
    final start = runtime.startBundled();
    process.stdoutController.add(utf8.encode(
      '${jsonEncode({
            'url': 'http://127.0.0.1:3001',
            'token_file': fixture.tokenFile.path,
            'pid': 1002
          })}\n',
    ));
    await start;

    await expectLater(
      runtime.stopOwned(),
      throwsA(isA<HermesUnavailableException>()),
    );

    expect(runtime.snapshot.phase, LocalRuntimePhase.running);
    expect(runtime.snapshot.pid, 1002);
    await expectLater(
      runtime.restartBundled(),
      throwsA(isA<HermesUnavailableException>()),
    );
    process.completeExit(0);
    await Future<void>.delayed(Duration.zero);
    await fixture.dispose();
  });

  test('dispose keeps draining until the owned process exits', () async {
    final fixture = await _RuntimeFixture.create();
    final process = _FakeProcess(pid: 1003);
    final runtime = BundledLocalRuntime(
      runtimeDirectory: fixture.runtimeDir,
      dataDir: fixture.dataDir.path,
      tokenFile: fixture.tokenFile.path,
      processStarter: (_, __) async => process,
    );
    final start = runtime.startBundled();
    process.stdoutController.add(utf8.encode(
      '${jsonEncode({
            'url': 'http://127.0.0.1:3002',
            'token_file': fixture.tokenFile.path,
            'pid': 1003
          })}\n',
    ));
    await start;

    await runtime.dispose();
    process.stderrController.add(
      utf8.encode('token=abcdefghijklmnopqrstuvwxyz123456\n'),
    );
    await Future<void>.delayed(Duration.zero);

    expect(runtime.snapshot.diagnostics.last.message, 'token=[REDACTED]');
    process.completeExit(0);
    await fixture.dispose();
  });

  test('stream framing preserves split UTF-8 and drops truncated tails',
      () async {
    final fixture = await _RuntimeFixture.create();
    final process = _FakeProcess(pid: 1005);
    final runtime = BundledLocalRuntime(
      runtimeDirectory: fixture.runtimeDir,
      dataDir: fixture.dataDir.path,
      tokenFile: fixture.tokenFile.path,
      processStarter: (_, __) async => process,
    );
    final start = runtime.startBundled();
    final tokenPath = '${fixture.dataDir.path}/\u5bc6\u94a5';
    final bytes = utf8.encode('${jsonEncode({
          'url': 'http://127.0.0.1:3005',
          'token_file': tokenPath,
          'pid': 1005
        })}\n');
    for (final byte in bytes) {
      process.stdoutController.add([byte]);
    }
    expect((await start).tokenFile, tokenPath);
    process.stderrController.add(utf8.encode('${'x' * 590}Bearer ${'s' * 80}'));
    process.stderrController.add(utf8.encode('${'s' * 80}\nnext line\n'));
    await Future<void>.delayed(Duration.zero);
    final logs =
        runtime.snapshot.diagnostics.map((item) => item.message).join('\n');
    expect(logs, isNot(contains('s' * 12)));
    expect(logs, contains('next line'));
    await runtime.stopOwned();
    await fixture.dispose();
  });

  test('bounded framing truncates no-newline output before diagnostics',
      () async {
    final fixture = await _RuntimeFixture.create();
    final process = _FakeProcess(pid: 1004);
    final runtime = BundledLocalRuntime(
      runtimeDirectory: fixture.runtimeDir,
      dataDir: fixture.dataDir.path,
      tokenFile: fixture.tokenFile.path,
      processStarter: (_, __) async => process,
    );

    final start = runtime.startBundled();
    process.stdoutController.add(utf8.encode(''.padRight(5000, 'x')));
    process.stdoutController.close();

    await expectLater(start, throwsA(isA<FormatException>()));
    expect(runtime.snapshot.diagnostics.first.message.length, lessThan(700));
    expect(runtime.snapshot.diagnostics.first.message, endsWith('...'));
    await fixture.dispose();
  });
}

class _RuntimeFixture {
  _RuntimeFixture({
    required this.root,
    required this.runtimeDir,
    required this.dataDir,
    required this.tokenFile,
  });

  final Directory root;
  final Directory runtimeDir;
  final Directory dataDir;
  final File tokenFile;

  static Future<_RuntimeFixture> create() async {
    final root = await Directory.systemTemp.createTemp('hermes-runtime-test-');
    final runtimeDir = Directory('${root.path}/runtime');
    final coreDir = Directory('${runtimeDir.path}/hermes-core');
    final agentdDir = Directory('${runtimeDir.path}/agentd');
    await coreDir.create(recursive: true);
    await agentdDir.create(recursive: true);
    final suffix = Platform.isWindows ? '.exe' : '';
    await File('${coreDir.path}/hermes-core$suffix').writeAsString('');
    await File('${agentdDir.path}/sop-agentd$suffix').writeAsString('');
    final dataDir = Directory('${root.path}/data');
    final tokenFile = File('${dataDir.path}/token');
    return _RuntimeFixture(
      root: root,
      runtimeDir: runtimeDir,
      dataDir: dataDir,
      tokenFile: tokenFile,
    );
  }

  Future<void> dispose() async {
    if (await root.exists()) {
      await root.delete(recursive: true);
    }
  }
}

class _FakeProcess implements Process {
  _FakeProcess({required this.pid, this.completeExitOnKill = true});

  final bool completeExitOnKill;
  final stdoutController = StreamController<List<int>>();
  final stderrController = StreamController<List<int>>();
  final _exit = Completer<int>();

  @override
  final int pid;

  @override
  Stream<List<int>> get stdout => stdoutController.stream;

  @override
  Stream<List<int>> get stderr => stderrController.stream;

  @override
  IOSink get stdin => IOSink(StreamController<List<int>>().sink);

  @override
  Future<int> get exitCode => _exit.future;

  @override
  bool kill([ProcessSignal signal = ProcessSignal.sigterm]) {
    if (completeExitOnKill) completeExit(0);
    return true;
  }

  void completeExit(int code) {
    if (!_exit.isCompleted) {
      stdoutController.close();
      stderrController.close();
      _exit.complete(code);
    }
  }
}
