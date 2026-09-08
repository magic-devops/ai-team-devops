import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'models.dart';

const hermesRuntimeVersion = '1.0.0';
const _diagnosticLimit = 80;
const _diagnosticLineLimit = 600;

enum LocalRuntimePhase { stopped, starting, running, stopping, crashed }

class LocalRuntimeDiagnostic {
  const LocalRuntimeDiagnostic({
    required this.stream,
    required this.message,
    required this.timestamp,
  });

  final String stream;
  final String message;
  final DateTime timestamp;
}

class LocalRuntimeSnapshot {
  const LocalRuntimeSnapshot({
    required this.phase,
    this.pid,
    this.url,
    this.dataDir,
    this.message,
    this.diagnostics = const [],
  });

  final LocalRuntimePhase phase;
  final int? pid;
  final String? url;
  final String? dataDir;
  final String? message;
  final List<LocalRuntimeDiagnostic> diagnostics;

  bool get hasOwnedProcess => pid != null;

  bool get isOwnedRunning =>
      phase == LocalRuntimePhase.running && hasOwnedProcess;

  LocalRuntimeSnapshot copyWith({
    LocalRuntimePhase? phase,
    int? pid,
    String? url,
    String? dataDir,
    String? message,
    List<LocalRuntimeDiagnostic>? diagnostics,
    bool clearProcess = false,
  }) {
    return LocalRuntimeSnapshot(
      phase: phase ?? this.phase,
      pid: clearProcess ? null : pid ?? this.pid,
      url: clearProcess ? null : url ?? this.url,
      dataDir: dataDir ?? this.dataDir,
      message: message,
      diagnostics: diagnostics ?? this.diagnostics,
    );
  }
}

abstract class LocalRuntime {
  LocalRuntimeSnapshot get snapshot;

  Stream<LocalRuntimeSnapshot> get snapshots;

  bool get isDesktopSupported;

  String defaultDataDir();

  String defaultTokenFile();

  Future<HermesBootstrapReady> startBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  });

  Future<void> stopOwned();

  Future<HermesBootstrapReady> restartBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  });

  Future<void> dispose();
}

typedef ProcessStarter = Future<Process> Function(
  String executable,
  List<String> arguments,
);

class BundledLocalRuntime implements LocalRuntime {
  BundledLocalRuntime({
    ProcessStarter? processStarter,
    Directory? runtimeDirectory,
    String? dataDir,
    String? tokenFile,
    Duration stopTimeout = const Duration(seconds: 5),
  })  : _processStarter = processStarter ?? Process.start,
        _runtimeDirectory = runtimeDirectory,
        _dataDirOverride = dataDir,
        _tokenFileOverride = tokenFile,
        _stopTimeout = stopTimeout;

  final ProcessStarter _processStarter;
  final Directory? _runtimeDirectory;
  final String? _dataDirOverride;
  final String? _tokenFileOverride;
  final Duration _stopTimeout;
  final _controller = StreamController<LocalRuntimeSnapshot>.broadcast();
  final List<StreamSubscription<String>> _drains = [];
  Process? _process;
  LocalRuntimeSnapshot _snapshot = const LocalRuntimeSnapshot(
    phase: LocalRuntimePhase.stopped,
  );
  bool _disposed = false;
  bool _starting = false;

  @override
  LocalRuntimeSnapshot get snapshot => _snapshot;

  @override
  Stream<LocalRuntimeSnapshot> get snapshots async* {
    yield _snapshot;
    yield* _controller.stream;
  }

  @override
  bool get isDesktopSupported =>
      !Platform.isIOS &&
      !Platform.isAndroid &&
      (Platform.isMacOS || Platform.isLinux || Platform.isWindows);

  @override
  String defaultDataDir() {
    final dataDirOverride = _dataDirOverride;
    if (dataDirOverride != null) return dataDirOverride;
    if (!isDesktopSupported) {
      throw const HermesUnavailableException(
        'Local runtime is available only on desktop.',
      );
    }
    if (Platform.isMacOS) {
      final home = Platform.environment['HOME'] ?? Directory.current.path;
      return '$home/Library/Application Support/Hermes/$hermesRuntimeVersion';
    }
    if (Platform.isWindows) {
      final root = Platform.environment['LOCALAPPDATA'] ??
          Platform.environment['APPDATA'] ??
          Directory.current.path;
      return '$root\\Hermes\\$hermesRuntimeVersion';
    }
    final root = Platform.environment['XDG_DATA_HOME'] ??
        '${Platform.environment['HOME'] ?? Directory.current.path}/.local/share';
    return '$root/hermes/$hermesRuntimeVersion';
  }

  @override
  String defaultTokenFile() =>
      _tokenFileOverride ?? '${defaultDataDir()}${Platform.pathSeparator}token';

  @override
  Future<HermesBootstrapReady> startBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  }) async {
    if (!isDesktopSupported) {
      throw const HermesUnavailableException(
        'Local bootstrap is available only on desktop. Configure a remote Hermes core URL on this device.',
      );
    }
    if (_starting || _process != null) {
      throw const HermesUnavailableException(
        'A local core is already running in this client.',
      );
    }
    _starting = true;
    final dataDir = defaultDataDir();
    final tokenFile = defaultTokenFile();
    Process? process;
    try {
      await Directory(dataDir).create(recursive: true);
      final runtime = _bundledRuntimeDirectory();
      final suffix = Platform.isWindows ? '.exe' : '';
      final core = File('${runtime.path}/hermes-core/hermes-core$suffix');
      final agentd = File('${runtime.path}/agentd/sop-agentd$suffix');
      if (!await core.exists() || !await agentd.exists()) {
        throw const HermesUnavailableException(
          'Bundled runtime is missing. Install a complete Hermes desktop package.',
        );
      }

      _set(_snapshot.copyWith(
        phase: LocalRuntimePhase.starting,
        dataDir: dataDir,
        message: 'Starting bundled Hermes Core...',
      ));
      process = await _processStarter(core.path, [
        '--data-dir',
        dataDir,
        '--token-file',
        tokenFile,
        '--port',
        '0',
        '--agentd',
        agentd.path,
      ]);
      _process = process;

      final readyLine = Completer<String>();
      _drain(process.stdout, 'stdout', firstLine: readyLine);
      _drain(process.stderr, 'stderr');
      unawaited(process.exitCode.then((code) {
        if (!identical(_process, process)) return;
        _process = null;
        _cancelDrains();
        final crashed = _snapshot.phase != LocalRuntimePhase.stopping &&
            _snapshot.phase != LocalRuntimePhase.stopped;
        _set(_snapshot.copyWith(
          phase:
              crashed ? LocalRuntimePhase.crashed : LocalRuntimePhase.stopped,
          clearProcess: true,
          message: crashed ? 'Hermes Core exited early with code $code.' : null,
        ));
      }));

      final line = await _firstReadyLine(readyLine, process, startupTimeout);
      final payload = jsonDecode(line) as Map<String, dynamic>;
      final ready = HermesBootstrapReady.fromJson(payload);
      _set(_snapshot.copyWith(
        phase: LocalRuntimePhase.running,
        pid: ready.pid,
        url: ready.url.replaceAll(RegExp(r'/+$'), ''),
        dataDir: dataDir,
        message: 'Hermes Core is running.',
      ));
      return ready;
    } catch (error) {
      if (process != null) {
        process.kill();
        try {
          await process.exitCode.timeout(_stopTimeout);
          if (identical(_process, process)) {
            _process = null;
            _cancelDrains();
          }
        } on TimeoutException {
          _set(_snapshot.copyWith(
            phase: LocalRuntimePhase.crashed,
            pid: process.pid,
            dataDir: dataDir,
            message: 'Hermes Core startup failed and is still exiting: $error',
          ));
          rethrow;
        }
      }
      _set(_snapshot.copyWith(
        phase: LocalRuntimePhase.crashed,
        clearProcess: true,
        message: error.toString(),
      ));
      rethrow;
    } finally {
      _starting = false;
    }
  }

  @override
  Future<void> stopOwned() async {
    final process = _process;
    if (process == null) {
      _set(_snapshot.copyWith(
        phase: LocalRuntimePhase.stopped,
        clearProcess: true,
        message: null,
      ));
      return;
    }
    _set(_snapshot.copyWith(
      phase: LocalRuntimePhase.stopping,
      message: 'Stopping owned Hermes Core...',
    ));
    process.kill();
    try {
      await process.exitCode.timeout(_stopTimeout);
    } on TimeoutException {
      _set(_snapshot.copyWith(
        phase: LocalRuntimePhase.running,
        pid: process.pid,
        message:
            'Hermes Core did not exit after stop request; still treating it as owned.',
      ));
      throw const HermesUnavailableException(
        'Hermes Core did not exit after stop request. Restart is blocked until the owned process exits.',
      );
    }
    if (identical(_process, process)) _process = null;
    _cancelDrains();
    _set(_snapshot.copyWith(
      phase: LocalRuntimePhase.stopped,
      clearProcess: true,
      message: null,
    ));
  }

  @override
  Future<HermesBootstrapReady> restartBundled({
    Duration startupTimeout = const Duration(seconds: 20),
  }) async {
    await stopOwned();
    return startBundled(startupTimeout: startupTimeout);
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _controller.close();
  }

  Future<String> _firstReadyLine(
    Completer<String> readyLine,
    Process process,
    Duration timeout,
  ) async {
    final exit = process.exitCode.then<String>(
      (code) => throw HermesUnavailableException(
        'Hermes Core exited before readiness (code $code). ${_lastDiagnostics()}',
      ),
    );
    try {
      return await Future.any([readyLine.future, exit]).timeout(timeout);
    } on TimeoutException {
      throw HermesUnavailableException(
        'Hermes Core did not report readiness within ${timeout.inSeconds}s. ${_lastDiagnostics()}',
      );
    }
  }

  Directory _bundledRuntimeDirectory() {
    if (_runtimeDirectory != null) return _runtimeDirectory;
    final executable = File(Platform.resolvedExecutable);
    return Platform.isMacOS
        ? Directory('${executable.parent.parent.path}/Resources/runtime')
        : Directory('${executable.parent.path}/runtime');
  }

  void _drain(
    Stream<List<int>> stream,
    String name, {
    Completer<String>? firstLine,
  }) {
    final framer = _BoundedDiagnosticFramer();
    late StreamSubscription<String> subscription;
    subscription = stream
        .transform(const Utf8Decoder(allowMalformed: true))
        .listen((chunk) {
      for (final frame in framer.add(chunk)) {
        if (firstLine != null && !firstLine.isCompleted) {
          firstLine.complete(frame);
        }
        _appendDiagnostic(name, frame);
      }
    }, onError: (Object error) {
      _appendDiagnostic(name, error.toString());
    }, onDone: () {
      final tail = framer.close();
      if (tail != null) {
        if (firstLine != null && !firstLine.isCompleted) {
          firstLine.complete(tail);
        }
        _appendDiagnostic(name, tail);
      }
      if (firstLine != null && !firstLine.isCompleted) {
        firstLine.completeError(
          const HermesUnavailableException(
            'Hermes Core closed stdout before readiness.',
          ),
        );
      }
    });
    _drains.add(subscription);
  }

  void _appendDiagnostic(String stream, String line) {
    final redacted = redactDiagnostic(line);
    final entry = LocalRuntimeDiagnostic(
      stream: stream,
      message: redacted.length > _diagnosticLineLimit
          ? '${redacted.substring(0, _diagnosticLineLimit)}...'
          : redacted,
      timestamp: DateTime.now().toUtc(),
    );
    final next = [..._snapshot.diagnostics, entry];
    final bounded = next.length > _diagnosticLimit
        ? next.sublist(next.length - _diagnosticLimit)
        : next;
    _set(_snapshot.copyWith(diagnostics: bounded));
  }

  String _lastDiagnostics() {
    if (_snapshot.diagnostics.isEmpty) return '';
    return _snapshot.diagnostics
        .take(6)
        .map((item) => '${item.stream}: ${item.message}')
        .join(' | ');
  }

  void _cancelDrains() {
    for (final drain in _drains) {
      unawaited(drain.cancel());
    }
    _drains.clear();
  }

  void _set(LocalRuntimeSnapshot snapshot) {
    _snapshot = snapshot;
    if (!_controller.isClosed) _controller.add(snapshot);
  }
}

class _BoundedDiagnosticFramer {
  final StringBuffer _buffer = StringBuffer();
  bool _discarding = false;

  List<String> add(String text) {
    final frames = <String>[];
    for (final codeUnit in text.codeUnits) {
      if (codeUnit == 10 || codeUnit == 13) {
        _flush(frames);
        _discarding = false;
      } else if (!_discarding) {
        if (_buffer.length < _diagnosticLineLimit) {
          _buffer.writeCharCode(codeUnit);
        } else {
          frames.add('${_buffer.toString()}...');
          _buffer.clear();
          _discarding = true;
        }
      }
    }
    return frames;
  }

  String? close() {
    if (_buffer.isEmpty) return null;
    final value = _buffer.toString();
    _buffer.clear();
    return value;
  }

  void _flush(List<String> frames) {
    if (_buffer.isEmpty) return;
    frames.add(_buffer.toString());
    _buffer.clear();
  }
}

String redactDiagnostic(String value) {
  return value
      .replaceAll(RegExp(r'Bearer\s+[A-Za-z0-9._~+/=-]+'), 'Bearer [REDACTED]')
      .replaceAllMapped(
        RegExp(r'''("?(?:token|access_token|api_key|secret)"?\s*[:=]\s*)'''
            r'''["']?[A-Za-z0-9._~+/=-]{12,}["']?'''),
        (match) => '${match.group(1)}[REDACTED]',
      )
      .replaceAll(
        RegExp(
            r'(/[^ \t\n\r:]+){2,}/[^ \t\n\r:]*'
            r'(?:token|secret|key)[^ \t\n\r:]*',
            caseSensitive: false),
        '[REDACTED_PATH]',
      );
}
