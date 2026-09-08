import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../local_runtime.dart';
import '../models.dart';
import '../settings_controller.dart';
import '../ui/common.dart';

class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  final _formKey = GlobalKey<FormState>();
  final baseUrl = TextEditingController();
  final token = TextEditingController();
  bool initialized = false;
  bool busy = false;
  String? error;

  Future<void> _perform(Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('操作成功')));
      }
    } catch (failure) {
      if (mounted) setState(() => error = failure.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    baseUrl.dispose();
    token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider);
    final runtime = ref.watch(localRuntimeProvider);
    final runtimeState =
        ref.watch(localRuntimeStateProvider).asData?.value ?? runtime.snapshot;
    final health = ref.watch(healthProvider);
    final readiness = ref.watch(readinessProvider);
    final diagnostics = ref.watch(diagnosticsProvider);
    final current = settings.asData?.value;
    if (!initialized && current != null) {
      initialized = true;
      baseUrl.text = current.baseUrl ?? '';
      token.text = current.token ?? '';
    }
    final desktop = !kIsWeb && runtime.isDesktopSupported;
    return WorkbenchPage(
      title: '设置',
      subtitle: '连接与本地运行时',
      actions: [
        OutlinedButton.icon(
          onPressed: busy
              ? null
              : () => _perform(() async {
                    await ref.read(settingsProvider.notifier).disconnect();
                    token.clear();
                    _refreshRuntimeViews();
                  }),
          icon: const Icon(Icons.link_off_rounded),
          label: const Text('断开'),
        ),
      ],
      child: ListView(
        children: [
          ConnectionBanner(settings: current),
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          const SizedBox(height: 16),
          _ConnectionSummary(
            settings: current,
            health: health,
            readiness: readiness,
            diagnostics: diagnostics,
          ),
          const SizedBox(height: 16),
          if (desktop)
            _LocalRuntimePanel(
              state: runtimeState,
              savedLocalPid: current?.localPid,
              dataDir: runtime.defaultDataDir(),
              tokenFile: runtime.defaultTokenFile(),
              busy: busy,
              onStart: () => _perform(() async {
                await ref.read(settingsProvider.notifier).bootstrapLocal();
                _refreshRuntimeViews();
              }),
              onStop: () => _guardedStop(restart: false),
              onRestart: () => _guardedStop(restart: true),
            )
          else
            const SectionPanel(
              title: '本地运行时',
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.cloud_queue_rounded),
                title: Text('移动端使用远端 Core'),
                subtitle: Text('请配置 HTTPS Core 地址；仅 loopback 允许 HTTP。'),
              ),
            ),
          const SizedBox(height: 16),
          SectionPanel(
            title: '远端 Core',
            child: Form(
              key: _formKey,
              child: Column(
                children: [
                  TextFormField(
                    controller: baseUrl,
                    decoration: const InputDecoration(labelText: 'Base URL'),
                    validator: _requiredUrl,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: token,
                    decoration:
                        const InputDecoration(labelText: 'Bearer Token'),
                    obscureText: true,
                    validator: requiredField,
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: busy
                          ? null
                          : () => _perform(() async {
                                if (!_formKey.currentState!.validate()) return;
                                await ref
                                    .read(settingsProvider.notifier)
                                    .saveRemote(
                                      baseUrl: baseUrl.text,
                                      token: token.text,
                                    );
                                _refreshRuntimeViews();
                              }),
                      icon: const Icon(Icons.save_rounded),
                      label: const Text('保存远端连接'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _AdvancedDiagnostics(
            runtimeState: runtimeState,
            health: health,
            readiness: readiness,
            diagnostics: diagnostics,
          ),
        ],
      ),
    );
  }

  Future<void> _guardedStop({required bool restart}) {
    return _perform(() async {
      final safety =
          await ref.read(settingsProvider.notifier).checkStopSafety();
      final proceed = await _confirmStop(safety, restart: restart);
      if (proceed != true) return;
      if (restart) {
        await ref.read(settingsProvider.notifier).restartLocal();
      } else {
        await ref.read(settingsProvider.notifier).stopLocal();
      }
      _refreshRuntimeViews();
    });
  }

  Future<bool?> _confirmStop(
    RuntimeStopSafety safety, {
    required bool restart,
  }) {
    final title = restart ? '重启本地 Core' : '停止本地 Core';
    final message = safety.hasBusyRuns
        ? '检测到 ${safety.busyRuns.length} 个运行中的任务。继续会中断本次客户端启动的 Core。'
        : safety.canGuarantee
            ? '${safety.detail} 未发现运行中的任务。'
            : '无法确认所有工作区的运行状态：${safety.detail}。继续前请确认没有重要任务在运行。';
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(restart ? '确认重启' : '确认停止'),
          ),
        ],
      ),
    );
  }

  void _refreshRuntimeViews() {
    ref.invalidate(healthProvider);
    ref.invalidate(readinessProvider);
    ref.invalidate(diagnosticsProvider);
    ref.invalidate(syncProvider);
    ref.invalidate(workspacesProvider);
    ref.invalidate(runsProvider);
    ref.invalidate(sessionsProvider);
    ref.invalidate(tasksProvider);
    ref.invalidate(requirementsProvider);
    ref.invalidate(assetsProvider);
  }

  String? _requiredUrl(String? value) {
    final required = requiredField(value);
    if (required != null) return required;
    final uri = Uri.tryParse(value!.trim());
    if (uri == null || uri.host.isEmpty) return '请输入有效 URL';
    if (uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment) {
      return 'URL 不能包含用户信息、查询参数或片段';
    }
    if (uri.scheme == 'http' &&
        !{'localhost', '127.0.0.1', '::1'}.contains(uri.host)) {
      return 'HTTP 仅允许本机 loopback';
    }
    if (!{'http', 'https'}.contains(uri.scheme)) return '仅支持 HTTP/HTTPS';
    return null;
  }
}

class _ConnectionSummary extends StatelessWidget {
  const _ConnectionSummary({
    required this.settings,
    required this.health,
    required this.readiness,
    required this.diagnostics,
  });

  final ConnectionSettings? settings;
  final AsyncValue<HermesEnvelope> health;
  final AsyncValue<HermesEnvelope> readiness;
  final AsyncValue<HermesEnvelope> diagnostics;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 820;
        final tiles = [
          _StatusTile(
            icon: Icons.link_rounded,
            title: '连接',
            value: settings?.isConfigured == true ? '已配置' : '未配置',
            detail: settings?.baseUrl ?? '需要本地启动或远端连接',
          ),
          _EnvelopeStatusTile(
            icon: Icons.favorite_border_rounded,
            title: '健康',
            envelope: health,
          ),
          _EnvelopeStatusTile(
            icon: Icons.verified_user_outlined,
            title: '就绪',
            envelope: readiness,
          ),
          _EnvelopeStatusTile(
            icon: Icons.fact_check_outlined,
            title: '诊断',
            envelope: diagnostics,
          ),
        ];
        if (compact) {
          return Column(
            children: tiles
                .map((tile) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: tile,
                    ))
                .toList(),
          );
        }
        return Row(
          children: tiles
              .map((tile) => Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: tile,
                    ),
                  ))
              .toList(),
        );
      },
    );
  }
}

class _LocalRuntimePanel extends StatelessWidget {
  const _LocalRuntimePanel({
    required this.state,
    required this.savedLocalPid,
    required this.dataDir,
    required this.tokenFile,
    required this.busy,
    required this.onStart,
    required this.onStop,
    required this.onRestart,
  });

  final LocalRuntimeSnapshot state;
  final int? savedLocalPid;
  final String dataDir;
  final String tokenFile;
  final bool busy;
  final VoidCallback onStart;
  final VoidCallback onStop;
  final VoidCallback onRestart;

  @override
  Widget build(BuildContext context) {
    final savedDetached = savedLocalPid != null &&
        savedLocalPid != state.pid &&
        !state.hasOwnedProcess;
    final canStart = !busy &&
        !state.hasOwnedProcess &&
        state.phase != LocalRuntimePhase.starting &&
        state.phase != LocalRuntimePhase.stopping;
    final canRestart = !busy && state.isOwnedRunning;
    final canStop = !busy &&
        state.hasOwnedProcess &&
        state.phase != LocalRuntimePhase.stopping &&
        state.phase != LocalRuntimePhase.stopped;
    return SectionPanel(
      title: '本地运行时',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Chip(label: Text(_phaseLabel(state.phase))),
              if (state.pid != null) Chip(label: Text('PID ${state.pid}')),
              if (savedDetached) Chip(label: Text('已保存 PID $savedLocalPid')),
            ],
          ),
          const SizedBox(height: 8),
          Text(state.url ??
              (state.hasOwnedProcess ? '已持有本地 Core 进程' : '未持有本地 Core 进程')),
          const SizedBox(height: 4),
          Text('数据目录：$dataDir'),
          Text('Token 文件：$tokenFile'),
          if (savedDetached) ...[
            const SizedBox(height: 8),
            const Text('该 PID 不是本次客户端启动持有的进程；停止按钮不会按保存 PID 杀进程。'),
          ],
          if (state.message != null) ...[
            const SizedBox(height: 8),
            Text(state.message!),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: canStart ? onStart : null,
                icon: const Icon(Icons.play_arrow_rounded),
                label: const Text('启动本地 Core'),
              ),
              OutlinedButton.icon(
                onPressed: canRestart ? onRestart : null,
                icon: const Icon(Icons.restart_alt_rounded),
                label: const Text('重启'),
              ),
              OutlinedButton.icon(
                onPressed: canStop ? onStop : null,
                icon: const Icon(Icons.stop_circle_outlined),
                label: const Text('停止'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AdvancedDiagnostics extends StatelessWidget {
  const _AdvancedDiagnostics({
    required this.runtimeState,
    required this.health,
    required this.readiness,
    required this.diagnostics,
  });

  final LocalRuntimeSnapshot runtimeState;
  final AsyncValue<HermesEnvelope> health;
  final AsyncValue<HermesEnvelope> readiness;
  final AsyncValue<HermesEnvelope> diagnostics;

  @override
  Widget build(BuildContext context) {
    return SectionPanel(
      title: '高级诊断',
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: const Text('原始运行与接口诊断'),
        children: [
          SizedBox(
            width: double.infinity,
            child: SelectableText(
              const JsonEncoder.withIndent('  ').convert({
                'runtime': {
                  'phase': runtimeState.phase.name,
                  'pid': runtimeState.pid,
                  'url': runtimeState.url,
                  'message': runtimeState.message,
                  'diagnostics': runtimeState.diagnostics
                      .map((item) => {
                            'stream': item.stream,
                            'message': item.message,
                            'timestamp': item.timestamp.toIso8601String(),
                          })
                      .toList(),
                },
                'health': _compactEnvelope(health),
                'readiness': _compactEnvelope(readiness),
                'diagnostics': _compactEnvelope(diagnostics),
              }),
            ),
          ),
        ],
      ),
    );
  }

  Object _compactEnvelope(AsyncValue<HermesEnvelope> value) {
    return value.when(
      loading: () => {'state': 'loading'},
      error: (error, _) => {'state': 'error', 'message': error.toString()},
      data: (data) => {
        'ok': data.ok,
        'summary': data.summary,
        'items': data.items,
        'permissions': data.permissions,
        'trace_id': data.traceId,
      },
    );
  }
}

class _EnvelopeStatusTile extends StatelessWidget {
  const _EnvelopeStatusTile({
    required this.icon,
    required this.title,
    required this.envelope,
  });

  final IconData icon;
  final String title;
  final AsyncValue<HermesEnvelope> envelope;

  @override
  Widget build(BuildContext context) {
    return envelope.when(
      loading: () => _StatusTile(
        icon: icon,
        title: title,
        value: '检查中',
        detail: '等待 Core 响应',
      ),
      error: (error, _) => _StatusTile(
        icon: icon,
        title: title,
        value: '不可用',
        detail: error.toString(),
      ),
      data: (data) {
        final summary = data.summary;
        final failed = summary['failed'];
        final passed = summary['passed'];
        final total = summary['total'];
        return _StatusTile(
          icon: icon,
          title: title,
          value: data.ok ? '正常' : '降级',
          detail: [
            if (summary['version'] != null) 'v${summary['version']}',
            if (summary['ready'] != null) 'ready=${summary['ready']}',
            if (passed != null || failed != null || total != null)
              '${passed ?? 0}/${total ?? '?'} 通过，失败 ${failed ?? 0}',
          ].join(' · '),
        );
      },
    );
  }
}

class _StatusTile extends StatelessWidget {
  const _StatusTile({
    required this.icon,
    required this.title,
    required this.value,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String value;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.labelMedium),
                  const SizedBox(height: 2),
                  Text(value, style: Theme.of(context).textTheme.titleMedium),
                  Text(
                    detail.isEmpty ? '-' : detail,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _phaseLabel(LocalRuntimePhase phase) {
  switch (phase) {
    case LocalRuntimePhase.stopped:
      return '未运行';
    case LocalRuntimePhase.starting:
      return '启动中';
    case LocalRuntimePhase.running:
      return '运行中';
    case LocalRuntimePhase.stopping:
      return '停止中';
    case LocalRuntimePhase.crashed:
      return '已崩溃';
  }
}
