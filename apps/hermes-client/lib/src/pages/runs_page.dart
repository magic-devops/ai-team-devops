import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';

class RunsPage extends ConsumerStatefulWidget {
  const RunsPage({super.key});

  @override
  ConsumerState<RunsPage> createState() => _RunsPageState();
}

class _RunsPageState extends ConsumerState<RunsPage> {
  HermesEntity? selectedRun;

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(workspaceSelectionProvider, (previous, next) {
      if (previous != next && selectedRun != null) {
        setState(() => selectedRun = null);
      }
    });
    final runs = ref.watch(runsProvider);
    final approvals = ref.watch(approvalsProvider);
    final readiness = ref.watch(readinessProvider);
    final permissions = readiness.asData?.value.permissions ?? const <String>[];
    final canExecute = permissions.contains('execute');
    final canApprove = permissions.contains('approve');
    final pendingApprovals = approvals.whenData(
      (items) => items.where((item) => item.status == 'pending').toList(),
    );
    return WorkbenchPage(
      title: '收件箱',
      subtitle: '运行、审批与证据',
      actions: [
        FilledButton.icon(
          onPressed: () => _showRunDialog(context, ref),
          icon: const Icon(Icons.rocket_launch_rounded),
          label: const Text('新建运行'),
        ),
      ],
      child: SplitPane(
        left: Column(
          children: [
            Expanded(
              child: AsyncEntityList(
                value: runs,
                empty: '暂无运行',
                itemBuilder: (entity) => EntityTile(
                  entity: entity,
                  selected: selectedRun?.id == entity.id,
                  onTap: () => setState(() => selectedRun = entity),
                  trailing: Wrap(
                    spacing: 6,
                    children: [
                      _runIcon(entity, 'start', Icons.play_arrow_rounded,
                          canExecute),
                      _runIcon(
                          entity, 'cancel', Icons.stop_rounded, canExecute),
                      _runIcon(
                          entity, 'retry', Icons.refresh_rounded, canExecute),
                      _runIcon(
                          entity, 'replay', Icons.replay_rounded, canExecute),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 240,
              child: AsyncEntityList(
                value: pendingApprovals,
                empty: '暂无待审批',
                itemBuilder: (approval) => EntityTile(
                  entity: approval,
                  trailing: Wrap(
                    spacing: 6,
                    children: [
                      FilledButton.tonal(
                        onPressed: canApprove && approval.status == 'pending'
                            ? () => _approval(approval, 'approve')
                            : null,
                        child: const Text('批准'),
                      ),
                      OutlinedButton(
                        onPressed: canApprove && approval.status == 'pending'
                            ? () => _approval(approval, 'reject')
                            : null,
                        child: const Text('驳回'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
        right: RunEvidencePanel(run: selectedRun),
      ),
    );
  }

  Widget _runIcon(
      HermesEntity run, String action, IconData icon, bool canExecute) {
    final enabled = canExecute && _canRunAction(run, action);
    return IconButton(
      tooltip: _actionLabel(action),
      icon: Icon(icon),
      onPressed: enabled ? () => _runAction(run, action) : null,
    );
  }

  Future<void> _showRunDialog(BuildContext context, WidgetRef ref) async {
    final title = TextEditingController();
    final sessionId = TextEditingController();
    final argv = TextEditingController(
      text: jsonEncode([
        'python3',
        '-c',
        'print("hermes green evidence")',
      ]),
    );
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => SimpleFormDialog(
        title: '新建运行',
        fields: [
          TextFormField(
            controller: title,
            decoration: const InputDecoration(labelText: '标题'),
            validator: requiredField,
          ),
          TextFormField(
            controller: sessionId,
            decoration: const InputDecoration(labelText: '会话 ID（可选）'),
          ),
          TextFormField(
            controller: argv,
            decoration: const InputDecoration(labelText: 'Green 命令 argv JSON'),
            minLines: 3,
            maxLines: 5,
            validator: _argvJson,
          ),
        ],
        onSubmit: () {
          final session = sessionId.text.trim();
          return createScoped(ref, Resource.runs, {
            'title': title.text.trim(),
            if (session.isNotEmpty) 'session_id': session,
            'nodes': [
              {
                'id': 'red',
                'title': 'TDD Red',
                'kind': 'command',
                'argv': ['python3', '-c', 'import sys; sys.exit(1)'],
                'expected_exit_code': 1,
                'timeout_seconds': 60,
              },
              {
                'id': 'approval',
                'title': 'Red 审批',
                'kind': 'approval',
              },
              {
                'id': 'green',
                'title': 'TDD Green',
                'kind': 'command',
                'argv': _parseArgv(argv.text),
                'expected_exit_code': 0,
                'timeout_seconds': 60,
              },
            ],
          });
        },
      ),
    );
    if (created == true) {
      ref.invalidate(runsProvider);
      ref.invalidate(approvalsProvider);
    }
  }

  Future<void> _runAction(HermesEntity run, String action) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null) return _snack('请先选择工作区。');
    try {
      await ref.read(apiProvider).runAction(
            run.id,
            action,
            expectedVersion: run.version,
            workspaceId: workspaceId,
            dryRun: false,
          );
      ref.invalidate(runsProvider);
      ref.invalidate(approvalsProvider);
      _snack('${_actionLabel(action)}已提交');
    } catch (error) {
      _snack(error.toString());
    }
  }

  Future<void> _approval(HermesEntity approval, String decision) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null) return _snack('请先选择工作区。');
    if (approval.status != 'pending') return _snack('审批已关闭，请刷新。');
    try {
      await ref.read(apiProvider).decideApproval(
            approval,
            decision: decision,
            workspaceId: workspaceId,
          );
      ref.invalidate(runsProvider);
      ref.invalidate(approvalsProvider);
      _snack('${decision == 'approve' ? '批准' : '驳回'}已提交');
    } catch (error) {
      _snack(error.toString());
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  bool _canRunAction(HermesEntity run, String action) {
    return switch (action) {
      'start' => run.status == 'planned',
      'cancel' => {'planned', 'queued', 'running', 'interrupted', 'retrying'}
          .contains(run.status),
      'retry' => run.status == 'failed',
      'replay' => true,
      _ => false,
    };
  }

  String _actionLabel(String action) {
    return switch (action) {
      'start' => '启动',
      'cancel' => '取消',
      'retry' => '重试',
      'replay' => '重放',
      _ => action,
    };
  }

  String? _argvJson(String? value) {
    final required = requiredField(value);
    if (required != null) return required;
    try {
      _parseArgv(value!);
      return null;
    } catch (error) {
      return error.toString();
    }
  }

  List<String> _parseArgv(String value) {
    final decoded = jsonDecode(value);
    if (decoded is! List || decoded.isEmpty) {
      throw const FormatException('argv 必须是非空 JSON 数组');
    }
    return decoded.map((item) {
      if (item is! String || item.isEmpty || item.contains('\u0000')) {
        throw const FormatException('argv 只能包含非空字符串');
      }
      return item;
    }).toList();
  }
}

class RunEvidencePanel extends ConsumerWidget {
  const RunEvidencePanel({required this.run, super.key});

  final HermesEntity? run;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspaceId = ref.watch(workspaceSelectionProvider);
    if (run == null || workspaceId == null) {
      return const SectionPanel(
        title: '运行证据',
        child: Text('请选择工作区和运行。'),
      );
    }
    final results = _nodeResults(run!.data['node_results']);
    return SectionPanel(
      title: '运行证据',
      child: ListView(
        children: [
          _RunSummary(run: run!),
          const SizedBox(height: 12),
          if (results.isEmpty)
            const Text('暂无节点证据。')
          else
            ...results.entries.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _NodeResultCard(nodeId: entry.key, result: entry.value),
              ),
            ),
          const SizedBox(height: 4),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: ref
                .watch(apiProvider)
                .runEvents(run!.id, workspaceId: workspaceId),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LinearProgressIndicator();
              }
              if (snapshot.hasError) {
                return ErrorState(message: snapshot.error.toString());
              }
              return _EventsBlock(events: snapshot.data ?? const []);
            },
          ),
        ],
      ),
    );
  }

  Map<String, Map<String, dynamic>> _nodeResults(Object? value) {
    if (value is! Map) return const {};
    return value.map((key, item) {
      final result =
          item is Map ? Map<String, dynamic>.from(item) : <String, dynamic>{};
      return MapEntry(key.toString(), result);
    });
  }
}

class _RunSummary extends StatelessWidget {
  const _RunSummary({required this.run});

  final HermesEntity run;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        Chip(label: Text(run.status)),
        Chip(label: Text('v${run.version}')),
        if (run.data['active_node'] != null)
          Chip(label: Text('active ${run.data['active_node']}')),
        if (run.data['error'] != null)
          Chip(label: Text(run.data['error'].toString())),
      ],
    );
  }
}

class _NodeResultCard extends StatelessWidget {
  const _NodeResultCard({required this.nodeId, required this.result});

  final String nodeId;
  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    final encoder = const JsonEncoder.withIndent('  ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(nodeId, style: Theme.of(context).textTheme.titleSmall),
                Chip(label: Text(result['succeeded'] == true ? '通过' : '未通过')),
                if (result['exit_code'] != null)
                  Chip(label: Text('exit ${result['exit_code']}')),
              ],
            ),
            if (result['stdout'] != null)
              _EvidenceText(label: 'stdout', value: result['stdout']),
            if (result['stderr'] != null)
              _EvidenceText(label: 'stderr', value: result['stderr']),
            if (result['evidence'] != null)
              _EvidenceText(
                  label: 'evidence',
                  value: encoder.convert(result['evidence'])),
          ],
        ),
      ),
    );
  }
}

class _EvidenceText extends StatelessWidget {
  const _EvidenceText({required this.label, required this.value});

  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: 4),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(value.toString()),
          ),
        ],
      ),
    );
  }
}

class _EventsBlock extends StatelessWidget {
  const _EventsBlock({required this.events});

  final List<Map<String, dynamic>> events;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text('事件 ${events.length}'),
      children: [
        SizedBox(
          width: double.infinity,
          child: SelectableText(
            const JsonEncoder.withIndent('  ').convert(events),
          ),
        ),
      ],
    );
  }
}
