import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../hermes_api_client.dart';
import '../models.dart';
import 'common.dart';
import 'labels.dart';

class TaskDeliveryDialog extends ConsumerStatefulWidget {
  const TaskDeliveryDialog(
      {required this.taskId,
      required this.workspaceId,
      required this.client,
      super.key});
  final String taskId;
  final String workspaceId;
  final HermesApiClient client;

  @override
  ConsumerState<TaskDeliveryDialog> createState() => _TaskDeliveryDialogState();
}

class _TaskDeliveryDialogState extends ConsumerState<TaskDeliveryDialog> {
  final plan = TextEditingController(
      text:
          '{"nodes":[{"id":"verify","argv":[],"expected_exit_code":0,"timeout_seconds":60}]}');
  final comment = TextEditingController();
  HermesEnvelope? envelope;
  Map<String, dynamic>? preview;
  Map<String, dynamic>? previewRequest;
  Map<String, dynamic>? repository;
  String decision = 'accept';
  String isolation = 'workspace';
  String? error;
  String? feedback;
  String? repositoryError;
  bool busy = false;
  bool repositoryBusy = false;
  bool get sameContext =>
      identical(ref.read(apiProvider), widget.client) &&
      ref.read(workspaceSelectionProvider) == widget.workspaceId;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _perform(_reload));
  }

  @override
  void dispose() {
    plan.dispose();
    comment.dispose();
    super.dispose();
  }

  Map<String, dynamic> _item(HermesEnvelope value) =>
      Map<String, dynamic>.from(value.items.first as Map);

  Future<void> _reload() async {
    final result = await widget.client
        .taskDelivery(widget.taskId, workspaceId: widget.workspaceId);
    if (mounted && sameContext) {
      setState(() {
        envelope = result;
      });
    }
  }

  Future<void> _loadRepository() async {
    if (!mounted || repositoryBusy || !sameContext) return;
    setState(() {
      repositoryBusy = true;
      repositoryError = null;
      repository = null;
      preview = null;
      previewRequest = null;
    });
    try {
      final result =
          await widget.client.workspaceRepository(widget.workspaceId);
      final item = result.items.isEmpty
          ? null
          : Map<String, dynamic>.from(result.items.first as Map);
      final head = item?['head_commit']?.toString() ?? '';
      if (item == null || head.isEmpty) {
        throw HermesApiException('Hermes 未返回仓库 head_commit。');
      }
      if (mounted && sameContext) setState(() => repository = item);
    } catch (err) {
      if (mounted && sameContext) {
        setState(() => repositoryError = err.toString());
      }
    } finally {
      if (mounted) setState(() => repositoryBusy = false);
    }
  }

  Future<void> _perform(Future<void> Function() action) async {
    if (!mounted || busy || !sameContext) return;
    setState(() {
      busy = true;
      error = null;
      feedback = null;
    });
    try {
      await action();
    } catch (err) {
      if (mounted && sameContext) setState(() => error = err.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _dispatch(HermesEntity task, {bool apply = false}) async {
    final selectedIsolation = apply
        ? (previewRequest!['isolation']?.toString() ?? 'workspace')
        : isolation;
    final String? baseCommit;
    if (apply) {
      baseCommit = previewRequest!['base_commit']?.toString();
    } else if (selectedIsolation == 'git_worktree') {
      baseCommit = repository?['head_commit']?.toString();
    } else {
      baseCommit = null;
    }
    if (selectedIsolation == 'git_worktree') {
      if (repositoryError != null && !apply) {
        throw HermesApiException(repositoryError!);
      }
      if (baseCommit == null || baseCommit.isEmpty) {
        throw HermesApiException('请选择 Git worktree 前先加载仓库当前提交。');
      }
    }
    final request = apply
        ? previewRequest!
        : <String, dynamic>{
            'kind': 'dispatch',
            'version': task.version,
            'nodes': (jsonDecode(plan.text) as Map<String, dynamic>)['nodes'],
            'key': 'task-dispatch-${DateTime.now().microsecondsSinceEpoch}',
            'isolation': selectedIsolation,
            if (baseCommit != null && baseCommit.isNotEmpty)
              'base_commit': baseCommit,
          };
    final nodes = (request['nodes'] as List)
        .map((node) => Map<String, dynamic>.from(node as Map))
        .toList();
    final result = await widget.client.taskDispatch(widget.taskId,
        workspaceId: widget.workspaceId,
        expectedVersion: request['version'] as int,
        nodes: nodes,
        idempotencyKey: request['key'] as String,
        isolation: request['isolation']?.toString() ?? 'workspace',
        baseCommit: request['base_commit']?.toString(),
        dryRun: !apply);
    if (!mounted || !sameContext) return;
    if (apply) {
      await _applied();
    } else {
      setState(() {
        preview = _item(result);
        previewRequest = request;
      });
    }
  }

  Future<void> _review(HermesEntity task, HermesEntity run,
      {bool apply = false}) async {
    final request = apply
        ? previewRequest!
        : <String, dynamic>{
            'kind': 'review',
            'version': task.version,
            'run_id': run.id,
            'run_version': run.version,
            'decision': _selectedDecision(run),
            'comment': comment.text.trim(),
            'key': 'task-review-${DateTime.now().microsecondsSinceEpoch}',
          };
    final result = await widget.client.taskReview(widget.taskId,
        workspaceId: widget.workspaceId,
        expectedVersion: request['version'] as int,
        runId: request['run_id'] as String,
        runVersion: request['run_version'] as int,
        decision: request['decision'] as String,
        comment: request['comment'] as String,
        idempotencyKey: request['key'] as String,
        dryRun: !apply);
    if (!mounted || !sameContext) return;
    if (apply) {
      await _applied();
    } else {
      setState(() {
        preview = _item(result);
        previewRequest = request;
      });
    }
  }

  Future<void> _applied() async {
    setState(() {
      preview = null;
      previewRequest = null;
      feedback = '已提交，证据已记录';
    });
    ref.invalidate(tasksProvider);
    ref.invalidate(runsProvider);
    await _reload();
  }

  void _clearPreview() => setState(() {
        preview = null;
        previewRequest = null;
      });

  @override
  Widget build(BuildContext context) {
    ref.watch(apiProvider);
    ref.watch(workspaceSelectionProvider);
    final item = envelope == null ? null : _item(envelope!);
    final task = item == null
        ? null
        : HermesEntity.fromJson(Map<String, dynamic>.from(item['task'] as Map));
    final run = item?['run'] == null
        ? null
        : HermesEntity.fromJson(Map<String, dynamic>.from(item!['run'] as Map));
    final phase = item?['phase']?.toString() ?? 'unplanned';
    final permissions = envelope?.permissions ?? [];
    final canDispatch = permissions.contains('write') &&
        permissions.contains('execute') &&
        ['unplanned', 'changes_requested'].contains(phase) &&
        !['completed', 'archived'].contains(task?.status);
    final canReview = permissions.contains('approve') &&
        ['awaiting_review', 'blocked', 'cancelled'].contains(phase);
    final canAccept = run?.status == 'completed' && _evidenceComplete(run);
    final selectedDecision = run == null ? decision : _selectedDecision(run);
    final fresh = previewRequest?['version'] == task?.version &&
        (previewRequest?['run_version'] == null ||
            previewRequest?['run_version'] == run?.version);
    final gitSelected = isolation == 'git_worktree';
    final gitDispatchBlocked = gitSelected &&
        (repositoryBusy ||
            repositoryError != null ||
            (repository?['head_commit']?.toString().isEmpty ?? true));
    final size = MediaQuery.sizeOf(context);
    return Dialog(
      insetPadding: const EdgeInsets.all(12),
      child: SizedBox(
          width: 760,
          height: size.height * .9,
          child: Column(children: [
            Padding(
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  Expanded(
                      child: Text(task?.title ?? '任务交付',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium)),
                  IconButton(
                      tooltip: '刷新',
                      onPressed:
                          busy || !sameContext ? null : () => _perform(_reload),
                      icon: const Icon(Icons.refresh)),
                  IconButton(
                      tooltip: '关闭',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close)),
                ])),
            if (busy) const LinearProgressIndicator(),
            Expanded(
                child: !sameContext
                    ? const ErrorState(message: '连接或工作区已变化，请关闭后重新打开。')
                    : ListView(padding: const EdgeInsets.all(16), children: [
                        if (error != null) ErrorState(message: error!),
                        if (feedback != null)
                          Text(feedback!,
                              style: TextStyle(
                                  color:
                                      Theme.of(context).colorScheme.primary)),
                        if (task != null) ...[
                          Text('${_phaseLabel(phase)} · v${task.version}'),
                          const SizedBox(height: 12),
                          Text('验收条件',
                              style: Theme.of(context).textTheme.titleSmall),
                          SelectableText(
                              task.data['acceptance_criteria']?.toString() ??
                                  '请先补充验收条件'),
                          if (run != null) ...[
                            const Divider(),
                            Text(
                                '执行 ${hermesStatusLabel(run.status)} · v${run.version}'),
                            Wrap(spacing: 8, children: [
                              for (final entry in {
                                'start': '启动',
                                'cancel': '取消执行',
                                'retry': '重试'
                              }.entries)
                                OutlinedButton(
                                    onPressed: busy ||
                                            !permissions.contains('execute') ||
                                            !_canRun(run, entry.key)
                                        ? null
                                        : () => _perform(() async {
                                              await widget.client.runAction(
                                                  run.id, entry.key,
                                                  workspaceId:
                                                      widget.workspaceId,
                                                  expectedVersion: run.version,
                                                  dryRun: false);
                                              if (mounted && sameContext) {
                                                await _applied();
                                              }
                                            }),
                                    child: Text(entry.value)),
                            ]),
                            for (final entry
                                in (run.data['node_results'] as Map? ?? {})
                                    .entries)
                              ExpansionTile(
                                  title: Text(
                                      '${entry.key} · ${(entry.value as Map)['succeeded'] == true ? '通过' : '失败'}'),
                                  children: [
                                    SizedBox(
                                        width: double.infinity,
                                        child: SelectableText(
                                            const JsonEncoder.withIndent('  ')
                                                .convert(entry.value)))
                                  ]),
                            _codeEvidenceSection(run),
                          ],
                          if (canDispatch) ...[
                            const Divider(),
                            DropdownButtonFormField<String>(
                                initialValue: isolation,
                                decoration:
                                    const InputDecoration(labelText: '任务隔离方式'),
                                items: const [
                                  DropdownMenuItem(
                                      value: 'workspace', child: Text('共享工作区')),
                                  DropdownMenuItem(
                                      value: 'git_worktree',
                                      child: Text('Git worktree')),
                                ],
                                onChanged: busy
                                    ? null
                                    : (value) {
                                        if (value == null) return;
                                        setState(() {
                                          isolation = value;
                                          preview = null;
                                          previewRequest = null;
                                          if (value == 'workspace') {
                                            repositoryError = null;
                                          }
                                        });
                                        if (value == 'git_worktree') {
                                          _loadRepository();
                                        }
                                      }),
                            if (gitSelected) ...[
                              const SizedBox(height: 8),
                              _repositorySnapshot(),
                            ],
                            const SizedBox(height: 8),
                            TextField(
                                controller: plan,
                                minLines: 5,
                                maxLines: 12,
                                decoration: const InputDecoration(
                                    labelText: '执行计划（nodes JSON）'),
                                onChanged: (_) => _clearPreview()),
                            const SizedBox(height: 8),
                            Align(
                                alignment: Alignment.centerLeft,
                                child: FilledButton.tonalIcon(
                                    onPressed: busy || gitDispatchBlocked
                                        ? null
                                        : () => _perform(() => _dispatch(task)),
                                    icon: const Icon(Icons.preview_outlined),
                                    label: const Text('预览执行计划'))),
                          ],
                          if (canReview && run != null) ...[
                            const Divider(),
                            DropdownButtonFormField<String>(
                                initialValue: selectedDecision,
                                decoration:
                                    const InputDecoration(labelText: '交付决策'),
                                items: [
                                  DropdownMenuItem(
                                      value: 'accept',
                                      enabled: canAccept,
                                      child: const Text('验收通过')),
                                  const DropdownMenuItem(
                                      value: 'request_changes',
                                      child: Text('要求修改'))
                                ],
                                onChanged: busy
                                    ? null
                                    : (value) {
                                        if (value == 'accept' && !canAccept) {
                                          return;
                                        }
                                        decision = value!;
                                        _clearPreview();
                                      }),
                            const SizedBox(height: 8),
                            TextField(
                                controller: comment,
                                minLines: 2,
                                maxLines: 5,
                                maxLength: 4000,
                                decoration:
                                    const InputDecoration(labelText: '审查结论与依据'),
                                onChanged: (_) => _clearPreview()),
                            Align(
                                alignment: Alignment.centerLeft,
                                child: FilledButton.tonalIcon(
                                    onPressed: busy ||
                                            comment.text.trim().isEmpty ||
                                            (selectedDecision == 'accept' &&
                                                !canAccept)
                                        ? null
                                        : () =>
                                            _perform(() => _review(task, run)),
                                    icon: const Icon(Icons.preview_outlined),
                                    label: const Text('预览审查结论'))),
                          ],
                          if (preview != null) ...[
                            const Divider(),
                            const Text('预览已生成，尚未写入'),
                            if (previewRequest?['isolation'] == 'git_worktree')
                              Text(
                                  'Git worktree @ ${_shortSha(previewRequest?['base_commit'])}'),
                            SelectableText(const JsonEncoder.withIndent('  ')
                                .convert(
                                    preview!['plan'] ?? preview!['review'])),
                            const SizedBox(height: 8),
                            FilledButton(
                                onPressed: busy ||
                                        !fresh ||
                                        (previewRequest!['kind'] ==
                                                'dispatch' &&
                                            previewRequest!['isolation'] ==
                                                'git_worktree' &&
                                            (previewRequest!['base_commit']
                                                    ?.toString()
                                                    .isEmpty ??
                                                true)) ||
                                        !(canDispatch || canReview)
                                    ? null
                                    : () => _perform(() =>
                                        previewRequest!['kind'] == 'dispatch'
                                            ? _dispatch(task, apply: true)
                                            : _review(task, run!, apply: true)),
                                child: const Text('确认提交')),
                          ],
                          if (!canDispatch &&
                              !canReview &&
                              phase == 'unplanned')
                            const Text('当前权限或任务状态不允许派发。'),
                          ExpansionTile(
                              title: const Text('CLI 与审计'),
                              children: [
                                SelectableText(
                                    'sop task v1 delivery ${widget.taskId} --json'),
                                SelectableText(
                                    const JsonEncoder.withIndent('  ').convert({
                                  'source': run?.data['task_source'],
                                  'review': item?['review'],
                                  'trace_id': envelope?.traceId
                                })),
                              ]),
                        ],
                      ])),
          ])),
    );
  }

  bool _canRun(HermesEntity run, String action) => switch (action) {
        'start' => run.status == 'planned',
        'retry' => run.status == 'failed',
        'cancel' => ['planned', 'queued', 'running', 'interrupted', 'retrying']
            .contains(run.status),
        _ => false,
      };

  Widget _repositorySnapshot() {
    if (repositoryBusy) return const LinearProgressIndicator();
    final repoError = repositoryError;
    if (repoError != null) return ErrorState(message: repoError);
    final repo = repository;
    if (repo == null) return const Text('正在读取仓库状态...');
    final head = repo['head_commit']?.toString() ?? '';
    final branch = repo['branch']?.toString() ?? '';
    final root = repo['root']?.toString() ?? '';
    final dirty = repo['dirty'] == true;
    return DecoratedBox(
      decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).dividerColor),
          borderRadius: BorderRadius.circular(8)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('当前提交 ${_shortSha(head)}',
              style: Theme.of(context).textTheme.titleSmall),
          if (branch.isNotEmpty) Text('分支 $branch'),
          if (root.isNotEmpty) SelectableText(root),
          if (dirty)
            Text('检测到未提交变更；Git worktree 只基于当前提交派发，未提交变更不会包含在内。',
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ]),
      ),
    );
  }

  Widget _codeEvidenceSection(HermesEntity run) {
    final workspace = run.data['code_workspace'];
    final evidence = run.data['code_evidence'];
    final workspaceMap = workspace is Map
        ? Map<String, dynamic>.from(workspace)
        : const <String, dynamic>{};
    if (evidence is! Map) return const SizedBox.shrink();
    final evidenceMap = Map<String, dynamic>.from(evidence);
    final files = (evidenceMap['files'] as List? ?? const [])
        .whereType<Map>()
        .map((file) => Map<String, dynamic>.from(file))
        .toList();
    final untracked = (evidenceMap['untracked'] as List? ?? const [])
        .map((v) => '$v')
        .toList();
    final patch = evidenceMap['patch']?.toString() ?? '';
    final truncated = evidenceMap['truncated'] == true;
    final complete = evidenceMap['complete'] == true;
    return ExpansionTile(
        initiallyExpanded: true,
        tilePadding: EdgeInsets.zero,
        title: const Text('代码变更证据'),
        children: [
          Align(
              alignment: Alignment.centerLeft,
              child: Wrap(spacing: 8, runSpacing: 4, children: [
                if (workspaceMap['mode'] != null)
                  Chip(label: Text('模式 ${workspaceMap['mode']}')),
                if (workspaceMap['base_commit'] != null)
                  Chip(
                      label: Text(
                          'base ${_shortSha(workspaceMap['base_commit'])}')),
                if (evidenceMap['head_commit'] != null)
                  Chip(
                      label: Text(
                          'head ${_shortSha(evidenceMap['head_commit'])}')),
                if (evidenceMap['captured_at'] != null)
                  Chip(label: Text('采集 ${evidenceMap['captured_at']}')),
              ])),
          if (truncated)
            Text('变更证据已截断，无法验收通过；请要求修改。',
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (!complete)
            Text('代码证据不完整，暂不能验收通过；仍可要求修改。',
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (files.isNotEmpty)
            ExpansionTile(title: Text('变更文件 (${files.length})'), children: [
              for (final file in files)
                ListTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    title: SelectableText(file['path']?.toString() ?? ''),
                    trailing: Text(file['status']?.toString() ?? ''))
            ]),
          if (untracked.isNotEmpty)
            ExpansionTile(
                title: Text('未跟踪文件 (${untracked.length})'),
                children: [
                  for (final path in untracked)
                    ListTile(
                        dense: true,
                        visualDensity: VisualDensity.compact,
                        title: SelectableText(path))
                ]),
          if (patch.isNotEmpty)
            ExpansionTile(title: const Text('代码 diff'), children: [
              SizedBox(
                  width: double.infinity,
                  child: SelectableText(patch,
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(fontFamily: 'monospace')))
            ]),
        ]);
  }

  bool _evidenceComplete(HermesEntity? run) {
    if (run == null) return false;
    final codeWorkspace = run.data['code_workspace'];
    final workspaceMode = codeWorkspace is Map ? codeWorkspace['mode'] : null;
    final isolation =
        run.data['isolation']?.toString() ?? workspaceMode?.toString();
    if (isolation != 'git_worktree') return true;
    final evidence = run.data['code_evidence'];
    return evidence is Map && evidence['complete'] == true;
  }

  String _selectedDecision(HermesEntity run) {
    if (decision == 'accept' &&
        !(run.status == 'completed' && _evidenceComplete(run))) {
      return 'request_changes';
    }
    return decision;
  }

  String _shortSha(Object? value) {
    final sha = value?.toString() ?? '';
    if (sha.length <= 12) return sha;
    return sha.substring(0, 12);
  }

  String _phaseLabel(String phase) => switch (phase) {
        'unplanned' => '待派发',
        'awaiting_review' => '待交付审查',
        'accepted' => '已验收',
        'changes_requested' => '待修改',
        _ => hermesStatusLabel(phase),
      };
}
