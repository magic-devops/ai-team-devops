import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';

class AutomationPage extends ConsumerStatefulWidget {
  const AutomationPage({this.initialTabIndex = 0, super.key});

  final int initialTabIndex;

  @override
  ConsumerState<AutomationPage> createState() => _AutomationPageState();
}

class _AutomationPageState extends ConsumerState<AutomationPage> {
  int refreshNonce = 0;
  HermesEnvelope? dispatchPreview;
  String? dispatchKey;
  String? dispatchFingerprint;
  Object? scheduleActionError;
  Object? actionError;
  bool actionBusy = false;

  @override
  Widget build(BuildContext context) {
    ref.listen<String?>(workspaceSelectionProvider, (previous, next) {
      if (previous != next) {
        setState(() {
          dispatchPreview = null;
          dispatchKey = null;
          dispatchFingerprint = null;
          scheduleActionError = null;
          actionError = null;
          refreshNonce++;
        });
      }
    });
    final settings = ref.watch(settingsProvider).asData?.value;
    final workspaceId = ref.watch(workspaceSelectionProvider);
    final readiness = ref.watch(readinessProvider);
    final permissions = readiness.asData?.value.permissions ?? const <String>[];
    final configReason = _configDisabledReason(
      settings: settings,
      workspaceId: workspaceId,
      permissions: permissions,
    );
    final executeOnlyReason = _executePermissionReason(permissions);
    final executeReason = _executeDisabledReason(
      settings: settings,
      workspaceId: workspaceId,
      permissions: permissions,
    );
    return WorkbenchPage(
      title: '自动化',
      subtitle: 'Hermes 工作区自动化控制台',
      actions: [
        IconButton.filledTonal(
          tooltip: '刷新',
          onPressed: () => setState(() => refreshNonce++),
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
      child: Column(
        children: [
          _PermissionBanner(
            settings: settings,
            workspaceId: workspaceId,
            permissions: permissions,
            readiness: readiness,
          ),
          const SizedBox(height: 12),
          Expanded(
            child: DefaultTabController(
              length: 5,
              initialIndex: widget.initialTabIndex,
              child: Column(
                children: [
                  const TabBar(
                    isScrollable: true,
                    tabs: [
                      Tab(icon: Icon(Icons.smart_toy_rounded), text: 'Agents'),
                      Tab(icon: Icon(Icons.groups_2_rounded), text: 'Squads'),
                      Tab(icon: Icon(Icons.event_repeat_rounded), text: '计划'),
                      Tab(icon: Icon(Icons.devices_other_rounded), text: '设备'),
                      Tab(icon: Icon(Icons.playlist_play_rounded), text: '派发'),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: _AutomationLoader(
                      nonce: refreshNonce,
                      builder: (data) => TabBarView(
                        children: [
                          _AgentsTab(
                            data: data,
                            configReason: configReason,
                            onRefresh: _refresh,
                          ),
                          _SquadsTab(
                            data: data,
                            configReason: configReason,
                            onRefresh: _refresh,
                          ),
                          _SchedulesTab(
                            schedules: data.schedules,
                            configReason: configReason,
                            executeReason: executeOnlyReason,
                            actionError: scheduleActionError,
                            onRefresh: _refreshSchedules,
                            onActionError: _refreshSchedulesWithError,
                          ),
                          _DevicesTab(
                            data: data,
                            configReason: configReason,
                            executeOnlyReason: executeOnlyReason,
                            executeReason: executeReason,
                            onRefresh: _refresh,
                            onCreate: () => _showDeviceDialog(context),
                          ),
                          _DispatchTab(
                            data: data,
                            executeReason: executeReason,
                            preview: dispatchPreview,
                            previewFingerprint: dispatchFingerprint,
                            busy: actionBusy,
                            error: actionError,
                            onRequestChanged: _clearDispatchPreview,
                            onPreview: (request) =>
                                _agentDispatch(request, dryRun: true),
                            onApply: (request) =>
                                _agentDispatch(request, dryRun: false),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _refresh() => setState(() => refreshNonce++);

  void _refreshSchedules() => setState(() {
        scheduleActionError = null;
        refreshNonce++;
      });

  void _refreshSchedulesWithError(Object error) => setState(() {
        scheduleActionError = error;
        refreshNonce++;
      });

  void _clearDispatchPreview() {
    if (dispatchPreview == null && dispatchKey == null) return;
    setState(() {
      dispatchPreview = null;
      dispatchKey = null;
      dispatchFingerprint = null;
      actionError = null;
    });
  }

  String? _executeDisabledReason({
    required ConnectionSettings? settings,
    required String? workspaceId,
    required List<String> permissions,
  }) {
    final writeReason = writeDisabledReason(
      settings: settings,
      workspaceId: workspaceId,
      permissions: permissions,
    );
    if (writeReason != null) return writeReason;
    if (!permissions.contains('execute')) return '当前令牌缺少 execute 权限。';
    return null;
  }

  String? _configDisabledReason({
    required ConnectionSettings? settings,
    required String? workspaceId,
    required List<String> permissions,
  }) {
    if (settings?.isConfigured != true) return '请先连接 Hermes Core。';
    if (workspaceId == null || workspaceId.isEmpty) return '请先选择工作区。';
    if (!permissions.contains('config')) return '当前令牌缺少 config 权限。';
    return null;
  }

  String? _executePermissionReason(List<String> permissions) {
    if (!permissions.contains('execute')) return '当前令牌缺少 execute 权限。';
    return null;
  }

  Future<void> _agentDispatch(
    _DispatchRequest request, {
    required bool dryRun,
  }) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || workspaceId.isEmpty) {
      _snack('请先选择工作区。');
      return;
    }
    setState(() {
      actionBusy = true;
      actionError = null;
      if (dryRun) dispatchPreview = null;
    });
    final fingerprint = request.fingerprint;
    if (!dryRun &&
        (dispatchPreview == null ||
            dispatchKey == null ||
            dispatchFingerprint != fingerprint)) {
      setState(() => actionBusy = false);
      _snack('派发内容已变更，请重新预览。');
      return;
    }
    final key = dryRun || dispatchKey == null
        ? 'agent-dispatch-${DateTime.now().toUtc().microsecondsSinceEpoch}'
        : dispatchKey!;
    try {
      final envelope = await ref.read(apiProvider).taskAgentDispatch(
            request.taskId,
            workspaceId: workspaceId,
            expectedVersion: request.expectedVersion,
            targetVersion: request.targetVersion,
            prompt: request.prompt,
            agentId: request.agentId,
            squadId: request.squadId,
            targetDeviceId: request.targetDeviceId,
            isolation: request.isolation,
            baseCommit: request.baseCommit,
            idempotencyKey: key,
            dryRun: dryRun,
          );
      setState(() {
        dispatchPreview = envelope;
        dispatchKey = dryRun ? key : null;
        dispatchFingerprint = dryRun ? fingerprint : null;
        actionBusy = false;
      });
      if (!dryRun) {
        ref.invalidate(runsProvider);
        _refresh();
      }
      _snack(dryRun ? '派发预览已生成' : '派发已提交');
    } catch (error) {
      setState(() {
        actionError = error;
        dispatchPreview = null;
        dispatchKey = null;
        dispatchFingerprint = null;
        actionBusy = false;
      });
      _snack(error.toString());
    }
  }

  Future<void> _showDeviceDialog(BuildContext context) async {
    final title = TextEditingController();
    final platform = TextEditingController(text: 'desktop');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => SimpleFormDialog(
        title: '新建设备',
        fields: [
          _bounded(controller: title, label: '名称'),
          _field(controller: platform, label: '平台'),
        ],
        onSubmit: () => _saveEntity(Resource.devices, null, {
          'title': title.text.trim(),
          'name': title.text.trim(),
          'platform': platform.text.trim(),
        }),
      ),
    );
    if (saved == true) _refresh();
  }

  Future<void> _saveEntity(
    Resource resource,
    HermesEntity? entity,
    Map<String, dynamic> data,
  ) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || workspaceId.isEmpty) {
      throw const HermesUnavailableException('请先选择工作区。');
    }
    final api = ref.read(apiProvider);
    if (entity == null) {
      await api.create(resource, data, workspaceId: workspaceId);
      return;
    }
    await api.patch(resource, entity, data, workspaceId: workspaceId);
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _AutomationLoader extends ConsumerWidget {
  const _AutomationLoader({required this.nonce, required this.builder});

  final int nonce;
  final Widget Function(_AutomationData data) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider).asData?.value;
    final workspaceId = ref.watch(workspaceSelectionProvider);
    if (settings?.isConfigured != true) {
      return const Center(child: Text('请先连接 Hermes Core。'));
    }
    if (workspaceId == null || workspaceId.isEmpty) {
      return const Center(child: Text('请先选择工作区。'));
    }
    return FutureBuilder<_AutomationData>(
      key: ValueKey('$workspaceId-$nonce'),
      future: _load(ref, workspaceId),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return ErrorState(message: snapshot.error.toString());
        }
        return builder(snapshot.data!);
      },
    );
  }

  Future<_AutomationData> _load(WidgetRef ref, String workspaceId) async {
    final api = ref.read(apiProvider);
    final values = await Future.wait<dynamic>([
      api.agentCatalog(),
      api.list(Resource.agents, workspaceId: workspaceId),
      api.list(Resource.squads, workspaceId: workspaceId),
      api.list(Resource.schedules, workspaceId: workspaceId),
      api.list(Resource.devices, workspaceId: workspaceId),
      api.list(Resource.tasks, workspaceId: workspaceId),
      api.list(Resource.runs, workspaceId: workspaceId, limit: 25),
    ]);
    return _AutomationData(
      catalog: values[0] as List<Map<String, dynamic>>,
      agents: values[1] as List<HermesEntity>,
      squads: values[2] as List<HermesEntity>,
      schedules: values[3] as List<HermesEntity>,
      devices: values[4] as List<HermesEntity>,
      tasks: values[5] as List<HermesEntity>,
      runs: values[6] as List<HermesEntity>,
    );
  }
}

class _AutomationData {
  const _AutomationData({
    required this.catalog,
    required this.agents,
    required this.squads,
    required this.schedules,
    required this.devices,
    required this.tasks,
    required this.runs,
  });

  final List<Map<String, dynamic>> catalog;
  final List<HermesEntity> agents;
  final List<HermesEntity> squads;
  final List<HermesEntity> schedules;
  final List<HermesEntity> devices;
  final List<HermesEntity> tasks;
  final List<HermesEntity> runs;
}

class _PermissionBanner extends StatelessWidget {
  const _PermissionBanner({
    required this.settings,
    required this.workspaceId,
    required this.permissions,
    required this.readiness,
  });

  final ConnectionSettings? settings;
  final String? workspaceId;
  final List<String> permissions;
  final AsyncValue<HermesEnvelope> readiness;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final connected = settings?.isConfigured == true;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: connected ? scheme.primaryContainer : scheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Icon(
              connected ? Icons.verified_user_rounded : Icons.link_off_rounded),
          Text(connected ? '已连接' : '未连接'),
          Chip(label: Text('工作区 ${workspaceId ?? '未选择'}')),
          ...['read', 'write', 'execute', 'config'].map(
            (permission) => Chip(
              avatar: Icon(
                permissions.contains(permission)
                    ? Icons.check_rounded
                    : Icons.lock_outline_rounded,
                size: 16,
              ),
              label: Text(permission),
            ),
          ),
          readiness.when(
            loading: () => const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            error: (error, _) => Text(error.toString()),
            data: (value) => Text('trace ${value.traceId ?? '-'}'),
          ),
        ],
      ),
    );
  }
}

class _AgentsTab extends StatelessWidget {
  const _AgentsTab({
    required this.data,
    required this.configReason,
    required this.onRefresh,
  });

  final _AutomationData data;
  final String? configReason;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final canConfig = configReason == null;
    return SplitPane(
      left: _CatalogPanel(catalog: data.catalog),
      right: _EntityListPanel(
        title: 'Agents',
        items: data.agents,
        empty: '暂无 Agent',
        createLabel: '新建 Agent',
        canWrite: canConfig,
        disabledReason: configReason ?? '',
        onCreate: () async {
          if (await _showAgentDialog(context, null)) onRefresh();
        },
        itemBuilder: (entity) => EntityTile(
          entity: entity,
          details: [
            detailChip('provider', entity.data['provider']),
            detailChip('model', entity.data['model']),
            detailChip('timeout', entity.data['timeout_seconds']),
          ],
          trailing: _EditDeleteButtons(
            canWrite: canConfig,
            disabledReason: configReason ?? '',
            onEdit: () async {
              if (await _showAgentDialog(context, entity)) onRefresh();
            },
            onDelete: () async {
              await _archive(context, Resource.agents, entity);
              onRefresh();
            },
          ),
        ),
      ),
    );
  }

  Future<bool> _showAgentDialog(
      BuildContext context, HermesEntity? entity) async {
    final data = entity?.data ?? const <String, dynamic>{};
    final title = TextEditingController(text: _text(data['title']));
    final model = TextEditingController(text: _text(data['model']));
    final instructions =
        TextEditingController(text: _text(data['instructions']));
    final timeout = TextEditingController(
        text: _text(data['timeout_seconds']).isEmpty
            ? '300'
            : _text(data['timeout_seconds']));
    var provider = _provider(data['provider']);
    final ref = ProviderScope.containerOf(context);
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => SimpleFormDialog(
          title: entity == null ? '新建 Agent' : '编辑 Agent',
          fields: [
            _bounded(controller: title, label: '标题'),
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: provider,
              decoration: const InputDecoration(labelText: 'Provider'),
              items: const ['codex', 'claude', 'opencode']
                  .map((value) =>
                      DropdownMenuItem(value: value, child: Text(value)))
                  .toList(),
              onChanged: (value) => setLocalState(() => provider = value!),
            ),
            TextFormField(
              controller: model,
              decoration: const InputDecoration(labelText: '模型（可选）'),
            ),
            TextFormField(
              controller: timeout,
              decoration: const InputDecoration(labelText: '超时秒数'),
              keyboardType: TextInputType.number,
              validator: _positiveInt,
            ),
            TextFormField(
              controller: instructions,
              decoration: const InputDecoration(labelText: 'Instructions'),
              minLines: 4,
              maxLines: 8,
            ),
          ],
          onSubmit: () => _saveWithContainer(ref, Resource.agents, entity, {
            'title': title.text.trim(),
            'provider': provider,
            'model': model.text.trim(),
            'instructions': instructions.text.trim(),
            'timeout_seconds': int.parse(timeout.text.trim()),
          }),
        ),
      ),
    );
    return saved == true;
  }
}

class _CatalogPanel extends StatelessWidget {
  const _CatalogPanel({required this.catalog});

  final List<Map<String, dynamic>> catalog;

  @override
  Widget build(BuildContext context) {
    return SectionPanel(
      title: '模板目录',
      child: catalog.isEmpty
          ? const Text('暂无模板')
          : Column(
              children: [
                for (final entry in catalog.indexed) ...[
                  _CatalogTile(item: entry.$2),
                  if (entry.$1 != catalog.length - 1) const Divider(height: 1),
                ],
              ],
            ),
    );
  }
}

class _CatalogTile extends StatelessWidget {
  const _CatalogTile({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final available = item['available'] == true;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(available
          ? Icons.check_circle_outline_rounded
          : Icons.info_outline_rounded),
      title: Text(_text(item['id'])),
      subtitle: const Text('CLI 管理认证（未验证）'),
      trailing: Wrap(
        spacing: 6,
        children: [
          Chip(label: Text(available ? '已安装' : '未安装')),
          Chip(label: Text(_text(item['provider']))),
        ],
      ),
    );
  }
}

class _SquadsTab extends StatelessWidget {
  const _SquadsTab({
    required this.data,
    required this.configReason,
    required this.onRefresh,
  });

  final _AutomationData data;
  final String? configReason;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final canConfig = configReason == null;
    return _EntityListPanel(
      title: 'Squads',
      items: data.squads,
      empty: '暂无 Squad',
      createLabel: '新建 Squad',
      canWrite: canConfig,
      disabledReason: configReason ?? '',
      onCreate: () async {
        if (await _showSquadDialog(context, null)) onRefresh();
      },
      itemBuilder: (entity) => EntityTile(
        entity: entity,
        details: [
          detailChip('members', (entity.data['members'] as List?)?.length),
          detailChip('leader routes', _leaderTitle(entity, data.agents)),
        ],
        trailing: _EditDeleteButtons(
          canWrite: canConfig,
          disabledReason: configReason ?? '',
          onEdit: () async {
            if (await _showSquadDialog(context, entity)) onRefresh();
          },
          onDelete: () async {
            await _archive(context, Resource.squads, entity);
            onRefresh();
          },
        ),
      ),
    );
  }

  Future<bool> _showSquadDialog(
    BuildContext context,
    HermesEntity? entity,
  ) async {
    final dataMap = entity?.data ?? const <String, dynamic>{};
    final title = TextEditingController(text: _text(dataMap['title']));
    final rows = _memberRows(dataMap['members'], data.agents);
    final ref = ProviderScope.containerOf(context);
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => SimpleFormDialog(
          title: entity == null ? '新建 Squad' : '编辑 Squad',
          fields: [
            _bounded(controller: title, label: '标题'),
            const Text('Multica Squad 唤醒 leader，由 leader 按结构化路由选择成员。'),
            ...rows.asMap().entries.map(
                  (entry) => _MemberRowEditor(
                    index: entry.key,
                    row: entry.value,
                    agents: data.agents,
                    onChanged: () => setLocalState(() {}),
                    onRemove: rows.length <= 1
                        ? null
                        : () => setLocalState(() => rows.removeAt(entry.key)),
                  ),
                ),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: data.agents.isEmpty
                    ? null
                    : () => setLocalState(
                          () => rows.add(_SquadMemberDraft(
                            agentId: data.agents.first.id,
                            role: 'implementer',
                            instructions: TextEditingController(),
                          )),
                        ),
                icon: const Icon(Icons.person_add_alt_1_rounded),
                label: const Text('添加成员'),
              ),
            ),
          ],
          onSubmit: () async {
            final members = rows
                .map((row) => {
                      'agent_id': row.agentId,
                      'role': row.role,
                      'instructions': row.instructions.text.trim(),
                    })
                .toList();
            if (members.where((member) => member['role'] == 'leader').length !=
                1) {
              throw HermesApiException('Squad 必须且只能有 1 个 leader。');
            }
            await _saveWithContainer(ref, Resource.squads, entity, {
              'title': title.text.trim(),
              'members': members,
            });
          },
        ),
      ),
    );
    return saved == true;
  }

  String _leaderTitle(HermesEntity squad, List<HermesEntity> agents) {
    final members = squad.data['members'];
    if (members is! List) return '';
    final leader = members.whereType<Map>().cast<Map>().firstWhere(
          (member) => member['role'] == 'leader',
          orElse: () => const {},
        );
    final leaderId = leader['agent_id']?.toString() ?? '';
    return agents
            .where((agent) => agent.id == leaderId)
            .map((agent) => agent.title)
            .firstOrNull ??
        leaderId;
  }

  List<_SquadMemberDraft> _memberRows(
    Object? raw,
    List<HermesEntity> agents,
  ) {
    final defaultAgent = agents.isNotEmpty ? agents.first.id : '';
    final items = raw is List ? raw : const [];
    final rows = items.whereType<Map>().map((item) {
      return _SquadMemberDraft(
        agentId: _text(item['agent_id']).isEmpty
            ? defaultAgent
            : _text(item['agent_id']),
        role: _role(item['role']),
        instructions: TextEditingController(text: _text(item['instructions'])),
      );
    }).toList();
    if (rows.isEmpty) {
      rows.add(_SquadMemberDraft(
        agentId: defaultAgent,
        role: 'leader',
        instructions: TextEditingController(),
      ));
    }
    return rows;
  }
}

class _MemberRowEditor extends StatelessWidget {
  const _MemberRowEditor({
    required this.index,
    required this.row,
    required this.agents,
    required this.onChanged,
    required this.onRemove,
  });

  final int index;
  final _SquadMemberDraft row;
  final List<HermesEntity> agents;
  final VoidCallback onChanged;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: agents.any((agent) => agent.id == row.agentId)
                        ? row.agentId
                        : null,
                    decoration:
                        InputDecoration(labelText: '成员 ${index + 1} Agent'),
                    items: agents
                        .map((agent) => DropdownMenuItem(
                              value: agent.id,
                              child: Text(agent.title),
                            ))
                        .toList(),
                    validator: (_) => row.agentId.isEmpty ? '请先创建 Agent' : null,
                    onChanged: (value) {
                      row.agentId = value ?? '';
                      onChanged();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: row.role,
                    decoration: const InputDecoration(labelText: '角色'),
                    items: const ['leader', 'implementer', 'reviewer']
                        .map((value) =>
                            DropdownMenuItem(value: value, child: Text(value)))
                        .toList(),
                    onChanged: (value) {
                      row.role = value ?? 'implementer';
                      onChanged();
                    },
                  ),
                ),
                IconButton(
                  tooltip: '移除成员',
                  onPressed: onRemove,
                  icon: const Icon(Icons.remove_circle_outline_rounded),
                ),
              ],
            ),
            TextFormField(
              controller: row.instructions,
              decoration: const InputDecoration(labelText: '成员 instructions'),
              minLines: 2,
              maxLines: 4,
            ),
          ],
        ),
      ),
    );
  }
}

class _SquadMemberDraft {
  _SquadMemberDraft({
    required this.agentId,
    required this.role,
    required this.instructions,
  });

  String agentId;
  String role;
  final TextEditingController instructions;
}

class _SchedulesTab extends ConsumerWidget {
  const _SchedulesTab({
    required this.schedules,
    required this.configReason,
    required this.executeReason,
    required this.actionError,
    required this.onRefresh,
    required this.onActionError,
  });

  final List<HermesEntity> schedules;
  final String? configReason;
  final String? executeReason;
  final Object? actionError;
  final VoidCallback onRefresh;
  final void Function(Object error) onActionError;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final configureReason = configReason ?? executeReason;
    final canConfigure = configureReason == null;
    return Column(
      children: [
        if (actionError != null) ...[
          ErrorState(message: actionError.toString()),
          const SizedBox(height: 12),
        ],
        Expanded(
          child: _EntityListPanel(
            title: '计划',
            items: schedules,
            empty: '暂无计划',
            createLabel: '配置计划',
            canWrite: canConfigure,
            disabledReason: configureReason ?? '',
            onCreate: () async {
              if (await _showScheduleDialog(context, ref, null)) onRefresh();
            },
            itemBuilder: (entity) => EntityTile(
              entity: entity,
              details: [
                detailChip('trigger', _scheduleTriggerLabel(entity.data)),
                detailChip('next', entity.data['next_due_at']),
                detailChip('last run', entity.data['last_run_id']),
              ],
              trailing: Wrap(
                spacing: 4,
                children: [
                  _ScheduleActionButton(
                    entity: entity,
                    action: 'trigger',
                    icon: Icons.play_arrow_rounded,
                    disabledReason: executeReason,
                    onDone: onRefresh,
                    onError: onActionError,
                  ),
                  _ScheduleActionButton(
                    entity: entity,
                    action: entity.status == 'paused' ? 'resume' : 'pause',
                    icon: entity.status == 'paused'
                        ? Icons.play_circle_outline_rounded
                        : Icons.pause_circle_outline_rounded,
                    disabledReason: entity.status == 'paused'
                        ? configureReason
                        : configReason,
                    onDone: onRefresh,
                    onError: onActionError,
                  ),
                  if (_scheduleTriggerType(entity.data) == 'webhook')
                    _ScheduleWebhookTestButton(
                      entity: entity,
                      disabledReason: configureReason,
                      onDone: onRefresh,
                      onError: onActionError,
                    ),
                  IconButton(
                    tooltip: '历史',
                    onPressed: () => _showScheduleHistory(context, ref, entity),
                    icon: const Icon(Icons.history_rounded),
                  ),
                  GuardedAction(
                    enabled: canConfigure,
                    reason: configureReason ?? '',
                    child: IconButton(
                      tooltip: '编辑',
                      onPressed: canConfigure
                          ? () async {
                              if (await _showScheduleDialog(
                                  context, ref, entity)) {
                                onRefresh();
                              }
                            }
                          : null,
                      icon: const Icon(Icons.edit_rounded),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Future<bool> _showScheduleDialog(
    BuildContext context,
    WidgetRef ref,
    HermesEntity? entity,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _ScheduleConfigureDialog(entity: entity),
    );
    return saved == true;
  }

  Future<void> _showScheduleHistory(
    BuildContext context,
    WidgetRef ref,
    HermesEntity entity,
  ) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || workspaceId.isEmpty) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${entity.title} 历史'),
        content: SizedBox(
          width: 620,
          height: 420,
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: ref
                .read(apiProvider)
                .scheduleHistory(entity.id, workspaceId: workspaceId),
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return ErrorState(message: snapshot.error.toString());
              }
              final items = snapshot.data ?? const [];
              if (items.isEmpty) return const Center(child: Text('暂无运行历史'));
              return ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final item = items[index];
                  return ListTile(
                    leading: const Icon(Icons.play_circle_outline_rounded),
                    title: Text(_text(item['id'])),
                    subtitle: Text([
                      _text(item['status']),
                      _text((item['data'] as Map?)?['title']),
                    ].where((part) => part.isNotEmpty).join(' · ')),
                    trailing: Wrap(
                      spacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('v${_text(item['version'])}'),
                        IconButton(
                          tooltip: '打开运行',
                          onPressed: () {
                            Navigator.pop(context);
                            context.go('/runs');
                          },
                          icon: const Icon(Icons.open_in_new_rounded),
                        ),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }
}

class _ScheduleConfigureDialog extends StatefulWidget {
  const _ScheduleConfigureDialog({required this.entity});

  final HermesEntity? entity;

  @override
  State<_ScheduleConfigureDialog> createState() =>
      _ScheduleConfigureDialogState();
}

class _ScheduleConfigureDialogState extends State<_ScheduleConfigureDialog> {
  final formKey = GlobalKey<FormState>();
  late final TextEditingController scheduleId;
  late final TextEditingController title;
  late String triggerType;
  late final TextEditingController interval;
  late final TextEditingController startsAt;
  late final TextEditingController cronExpression;
  late final TextEditingController timezone;
  late final TextEditingController webhookSecretRef;
  late final TextEditingController webhookMaxBodyBytes;
  late final TextEditingController nodes;
  bool enabled = true;
  bool misfireCoalesce = true;
  bool busy = false;
  Object? error;
  HermesEnvelope? preview;
  String? previewFingerprint;
  String? idempotencyKey;

  @override
  void initState() {
    super.initState();
    final data = widget.entity?.data ?? const <String, dynamic>{};
    final trigger = (data['trigger'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};
    scheduleId = TextEditingController(text: widget.entity?.id ?? '');
    title = TextEditingController(text: _text(data['title']));
    triggerType = _normalizeTriggerType(trigger['type']);
    interval = TextEditingController(
        text: _text(trigger['interval_seconds']).isEmpty
            ? '300'
            : _text(trigger['interval_seconds']));
    startsAt = TextEditingController(
      text: _text(trigger['starts_at']).isEmpty
          ? DateTime.now().toUtc().toIso8601String()
          : _text(trigger['starts_at']),
    );
    cronExpression = TextEditingController(
      text: _text(trigger['cron_expression']).isEmpty
          ? '30 2 * * *'
          : _text(trigger['cron_expression']),
    );
    timezone = TextEditingController(
      text: _text(trigger['timezone']).isEmpty
          ? 'Asia/Shanghai'
          : _text(trigger['timezone']),
    );
    webhookSecretRef =
        TextEditingController(text: _text(trigger['secret_ref']));
    webhookMaxBodyBytes = TextEditingController(
      text: _text(trigger['max_body_bytes']).isEmpty
          ? '65536'
          : _text(trigger['max_body_bytes']),
    );
    nodes = TextEditingController(
      text: const JsonEncoder.withIndent('  ').convert(data['nodes'] ??
          [
            {
              'id': 'check',
              'title': 'Readiness check',
              'kind': 'command',
              'argv': ['python3', 'scripts/hermes-readiness.py', '--json'],
              'expected_exit_code': 0,
              'timeout_seconds': 300,
            }
          ]),
    );
    enabled = data['enabled'] != false;
    misfireCoalesce = data['misfire_coalesce'] != false;
    for (final controller in [
      scheduleId,
      title,
      interval,
      startsAt,
      cronExpression,
      timezone,
      webhookSecretRef,
      webhookMaxBodyBytes,
      nodes,
    ]) {
      controller.addListener(_clearPreview);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      scheduleId,
      title,
      interval,
      startsAt,
      cronExpression,
      timezone,
      webhookSecretRef,
      webhookMaxBodyBytes,
      nodes,
    ]) {
      controller.removeListener(_clearPreview);
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currentFingerprint = _currentFingerprint();
    final canApply = preview != null &&
        previewFingerprint == currentFingerprint &&
        idempotencyKey != null &&
        !busy;
    return AlertDialog(
      title: Text(widget.entity == null ? '配置计划' : '编辑计划'),
      content: SizedBox(
        width: 620,
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _bounded(controller: scheduleId, label: '计划 ID'),
                const SizedBox(height: 12),
                _bounded(controller: title, label: '标题'),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerLeft,
                  child: SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'interval',
                        icon: Icon(Icons.timer_outlined),
                        label: Text('间隔'),
                      ),
                      ButtonSegment(
                        value: 'cron',
                        icon: Icon(Icons.calendar_month_outlined),
                        label: Text('Cron'),
                      ),
                      ButtonSegment(
                        value: 'webhook',
                        icon: Icon(Icons.webhook_rounded),
                        label: Text('Webhook'),
                      ),
                    ],
                    selected: {triggerType},
                    onSelectionChanged: (value) => setState(() {
                      triggerType = value.single;
                      _dropPreview();
                    }),
                  ),
                ),
                const SizedBox(height: 12),
                ..._triggerFields(),
                const SizedBox(height: 12),
                TextFormField(
                  controller: nodes,
                  decoration: const InputDecoration(labelText: '命令节点 JSON'),
                  minLines: 5,
                  maxLines: 9,
                  validator: _nodesJson,
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('启用'),
                  value: enabled,
                  onChanged: (value) => setState(() {
                    enabled = value;
                    _dropPreview();
                  }),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('合并错过的触发'),
                  value: misfireCoalesce,
                  onChanged: (value) => setState(() {
                    misfireCoalesce = value;
                    _dropPreview();
                  }),
                ),
                if (busy) const LinearProgressIndicator(),
                if (error != null) ErrorState(message: error.toString()),
                if (preview != null) ...[
                  const SizedBox(height: 12),
                  _DispatchPreview(envelope: preview),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: busy ? null : () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: busy ? null : () => _submit(dryRun: true),
          icon: const Icon(Icons.visibility_rounded),
          label: const Text('预览配置'),
        ),
        FilledButton.tonalIcon(
          onPressed: canApply ? () => _submit(dryRun: false) : null,
          icon: const Icon(Icons.check_rounded),
          label: const Text('应用配置'),
        ),
      ],
    );
  }

  Future<void> _submit({required bool dryRun}) async {
    if (!formKey.currentState!.validate()) return;
    final request = _request();
    if (!dryRun &&
        (preview == null ||
            previewFingerprint != request.fingerprint ||
            idempotencyKey == null)) {
      setState(() {
        error = HermesApiException('计划配置已变更，请重新预览。');
        preview = null;
        previewFingerprint = null;
        idempotencyKey = null;
      });
      return;
    }
    setState(() {
      busy = true;
      error = null;
      if (dryRun) {
        preview = null;
        previewFingerprint = null;
        idempotencyKey =
            'schedule-configure-${DateTime.now().microsecondsSinceEpoch}';
      }
    });
    try {
      final workspaceId =
          ProviderScope.containerOf(context).read(workspaceSelectionProvider);
      if (workspaceId == null || workspaceId.isEmpty) {
        throw const HermesUnavailableException('请先选择工作区。');
      }
      final api = ProviderScope.containerOf(context).read(apiProvider);
      final envelope = dryRun
          ? await api.schedulePreview(
              workspaceId: workspaceId,
              title: request.title,
              trigger: request.trigger,
              nodes: request.nodes,
              enabled: request.enabled,
              misfireCoalesce: request.misfireCoalesce,
              expectedVersion: widget.entity?.version,
              idempotencyKey: idempotencyKey!,
            )
          : await api.scheduleConfigure(
              request.scheduleId,
              workspaceId: workspaceId,
              title: request.title,
              trigger: request.trigger,
              nodes: request.nodes,
              enabled: request.enabled,
              misfireCoalesce: request.misfireCoalesce,
              expectedVersion: widget.entity?.version,
              idempotencyKey: idempotencyKey!,
              dryRun: false,
            );
      setState(() {
        busy = false;
        preview = envelope;
        previewFingerprint = dryRun ? request.fingerprint : null;
        if (!dryRun) idempotencyKey = null;
      });
      if (!dryRun && mounted) Navigator.pop(context, true);
    } catch (err) {
      setState(() {
        busy = false;
        error = err;
        preview = null;
        previewFingerprint = null;
        idempotencyKey = null;
      });
    }
  }

  _ScheduleConfigureRequest _request() => _ScheduleConfigureRequest(
        scheduleId: scheduleId.text.trim(),
        title: title.text.trim(),
        trigger: _trigger(),
        nodes: _parseNodes(nodes.text),
        enabled: enabled,
        misfireCoalesce: misfireCoalesce,
      );

  String? _currentFingerprint() {
    try {
      return _ScheduleConfigureRequest(
        scheduleId: scheduleId.text.trim(),
        title: title.text.trim(),
        trigger: _trigger(),
        nodes: _parseNodes(nodes.text),
        enabled: enabled,
        misfireCoalesce: misfireCoalesce,
      ).fingerprint;
    } catch (_) {
      return null;
    }
  }

  void _clearPreview() {
    if (preview == null && idempotencyKey == null) return;
    setState(() {
      _dropPreview();
    });
  }

  void _dropPreview() {
    preview = null;
    previewFingerprint = null;
    idempotencyKey = null;
    error = null;
  }

  List<Widget> _triggerFields() {
    if (triggerType == 'cron') {
      return [
        TextFormField(
          controller: cronExpression,
          decoration: const InputDecoration(labelText: 'Cron 表达式（五段）'),
          validator: (value) {
            final text = value?.trim() ?? '';
            if (text.split(RegExp(r'\s+')).length != 5) return '需要五段 cron';
            return null;
          },
        ),
        const SizedBox(height: 12),
        _field(controller: timezone, label: '时区（IANA）'),
        const SizedBox(height: 12),
        TextFormField(
          controller: startsAt,
          decoration: const InputDecoration(labelText: '开始时间（可选 UTC offset）'),
        ),
      ];
    }
    if (triggerType == 'webhook') {
      return [
        _field(controller: webhookSecretRef, label: '签名密钥环境变量名'),
        const SizedBox(height: 12),
        TextFormField(
          controller: webhookMaxBodyBytes,
          decoration: const InputDecoration(labelText: '最大请求体字节数'),
          keyboardType: TextInputType.number,
          validator: (value) {
            final parsed = int.tryParse(value?.trim() ?? '');
            if (parsed == null || parsed < 1 || parsed > 1048576) {
              return '范围 1-1048576';
            }
            return null;
          },
        ),
      ];
    }
    return [
      TextFormField(
        controller: interval,
        decoration: const InputDecoration(labelText: '间隔秒数'),
        keyboardType: TextInputType.number,
        validator: (value) {
          final parsed = int.tryParse(value?.trim() ?? '');
          if (parsed == null || parsed < 10) return '不能小于 10 秒';
          return null;
        },
      ),
      const SizedBox(height: 12),
      _field(controller: startsAt, label: '开始时间（带 UTC offset）'),
    ];
  }

  Map<String, dynamic> _trigger() {
    if (triggerType == 'cron') {
      return {
        'type': 'cron',
        'cron_expression': cronExpression.text.trim(),
        'timezone': timezone.text.trim(),
        if (startsAt.text.trim().isNotEmpty) 'starts_at': startsAt.text.trim(),
      };
    }
    if (triggerType == 'webhook') {
      return {
        'type': 'webhook',
        'secret_ref': webhookSecretRef.text.trim(),
        'max_body_bytes': int.parse(webhookMaxBodyBytes.text.trim()),
      };
    }
    return {
      'type': 'interval',
      'interval_seconds': int.parse(interval.text.trim()),
      'starts_at': startsAt.text.trim(),
    };
  }
}

class _ScheduleActionButton extends ConsumerWidget {
  const _ScheduleActionButton({
    required this.entity,
    required this.action,
    required this.icon,
    required this.disabledReason,
    required this.onDone,
    required this.onError,
  });

  final HermesEntity entity;
  final String action;
  final IconData icon;
  final String? disabledReason;
  final VoidCallback onDone;
  final void Function(Object error) onError;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = disabledReason == null;
    return GuardedAction(
      enabled: enabled,
      reason: disabledReason ?? '',
      child: IconButton(
        tooltip: switch (action) {
          'trigger' => '立即触发',
          'pause' => '暂停',
          'resume' => '恢复',
          _ => action,
        },
        onPressed: enabled
            ? () async {
                final workspaceId = ref.read(workspaceSelectionProvider);
                if (workspaceId == null || workspaceId.isEmpty) return;
                try {
                  await ref.read(apiProvider).scheduleAction(
                        entity.id,
                        action,
                        workspaceId: workspaceId,
                        expectedVersion: entity.version,
                      );
                  onDone();
                } catch (error) {
                  onError(error);
                }
              }
            : null,
        icon: Icon(icon),
      ),
    );
  }
}

class _ScheduleWebhookTestButton extends ConsumerStatefulWidget {
  const _ScheduleWebhookTestButton({
    required this.entity,
    required this.disabledReason,
    required this.onDone,
    required this.onError,
  });

  final HermesEntity entity;
  final String? disabledReason;
  final VoidCallback onDone;
  final void Function(Object error) onError;

  @override
  ConsumerState<_ScheduleWebhookTestButton> createState() =>
      _ScheduleWebhookTestButtonState();
}

class _ScheduleWebhookTestButtonState
    extends ConsumerState<_ScheduleWebhookTestButton> {
  HermesEnvelope? preview;
  String? idempotencyKey;
  bool busy = false;
  Object? error;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.disabledReason == null;
    return GuardedAction(
      enabled: enabled,
      reason: widget.disabledReason ?? '',
      child: IconButton(
        tooltip: 'Webhook 测试',
        onPressed: enabled ? _showDialog : null,
        icon: const Icon(Icons.webhook_rounded),
      ),
    );
  }

  Future<void> _showDialog() async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('${widget.entity.title} Webhook 测试'),
          content: SizedBox(
            width: 520,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (busy) const LinearProgressIndicator(),
                if (error != null) ErrorState(message: error.toString()),
                if (preview != null) _DispatchPreview(envelope: preview),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(context),
              child: const Text('关闭'),
            ),
            FilledButton.icon(
              onPressed:
                  busy ? null : () => _submit(setDialogState, dryRun: true),
              icon: const Icon(Icons.visibility_rounded),
              label: const Text('预览测试'),
            ),
            FilledButton.tonalIcon(
              onPressed: busy || preview == null
                  ? null
                  : () => _submit(setDialogState, dryRun: false),
              icon: const Icon(Icons.play_arrow_rounded),
              label: const Text('派发测试'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit(
    StateSetter setDialogState, {
    required bool dryRun,
  }) async {
    setDialogState(() {
      busy = true;
      error = null;
      if (dryRun) {
        preview = null;
        idempotencyKey =
            'schedule-webhook-test-${DateTime.now().microsecondsSinceEpoch}';
      }
    });
    try {
      final workspaceId = ref.read(workspaceSelectionProvider);
      if (workspaceId == null || workspaceId.isEmpty) {
        throw const HermesUnavailableException('请先选择工作区。');
      }
      final envelope = await ref.read(apiProvider).scheduleWebhookTest(
            widget.entity.id,
            workspaceId: workspaceId,
            expectedVersion: widget.entity.version,
            idempotencyKey: idempotencyKey!,
            dryRun: dryRun,
          );
      setDialogState(() {
        busy = false;
        preview = dryRun ? envelope : null;
        if (!dryRun) idempotencyKey = null;
      });
      if (!dryRun && mounted) {
        Navigator.pop(context);
        widget.onDone();
      }
    } catch (err) {
      setDialogState(() {
        busy = false;
        error = err;
        preview = null;
        idempotencyKey = null;
      });
      widget.onError(err);
    }
  }
}

class _DevicesTab extends ConsumerWidget {
  const _DevicesTab({
    required this.data,
    required this.configReason,
    required this.executeOnlyReason,
    required this.executeReason,
    required this.onRefresh,
    required this.onCreate,
  });

  final _AutomationData data;
  final String? configReason;
  final String? executeOnlyReason;
  final String? executeReason;
  final VoidCallback onRefresh;
  final Future<void> Function() onCreate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canConfig = configReason == null;
    final canExecute = executeReason == null;
    final pairingReason = configReason ?? executeOnlyReason;
    final canPair = pairingReason == null;
    return _EntityListPanel(
      title: '设备',
      items: data.devices,
      empty: '暂无设备',
      createLabel: '新建设备',
      canWrite: canConfig,
      disabledReason: configReason ?? '',
      onCreate: onCreate,
      itemBuilder: (entity) => EntityTile(
        entity: entity,
        details: [
          detailChip('platform', entity.data['platform']),
          detailChip('endpoint', entity.data['endpoint']),
          detailChip('runtimes', _allowedRuntimeLabel(entity)),
          detailChip('pairing expires', entity.data['pairing_expires_at']),
        ],
        trailing: Wrap(
          spacing: 4,
          children: [
            GuardedAction(
              enabled: canPair,
              reason: pairingReason ?? '',
              child: IconButton(
                tooltip: '配对密钥',
                onPressed: canPair
                    ? () => _showPairingSecret(context, ref, entity, onRefresh)
                    : null,
                icon: const Icon(Icons.key_rounded),
              ),
            ),
            GuardedAction(
              enabled: canExecute && entity.status == 'active',
              reason: entity.status == 'active'
                  ? executeReason ?? ''
                  : '设备必须已配对并处于 active。',
              child: IconButton(
                tooltip: '派发任务',
                onPressed: canExecute && entity.status == 'active'
                    ? () =>
                        _showRemoteDispatch(context, ref, entity, data.tasks)
                    : null,
                icon: const Icon(Icons.terminal_rounded),
              ),
            ),
            GuardedAction(
              enabled: canConfig && entity.status != 'revoked',
              reason: configReason ?? '',
              child: IconButton(
                tooltip: '撤销设备',
                onPressed: canConfig && entity.status != 'revoked'
                    ? () => _revokeDevice(context, ref, entity, onRefresh)
                    : null,
                icon: const Icon(Icons.block_rounded),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showPairingSecret(
    BuildContext context,
    WidgetRef ref,
    HermesEntity device,
    VoidCallback onRefresh,
  ) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || workspaceId.isEmpty) return;
    final envelope = await ref
        .read(apiProvider)
        .devicePairing(device, workspaceId: workspaceId);
    onRefresh();
    final item = envelope.items.whereType<Map>().firstOrNull;
    final secret = item?['pairing_secret']?.toString() ?? '';
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('一次性配对密钥'),
        content: SizedBox(
          width: 560,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('关闭后不会在客户端保留，请立即交给对应 worker。'),
              const SizedBox(height: 12),
              SelectableText(secret),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭并清除'),
          ),
        ],
      ),
    );
  }

  Future<void> _revokeDevice(
    BuildContext context,
    WidgetRef ref,
    HermesEntity device,
    VoidCallback onRefresh,
  ) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || workspaceId.isEmpty) return;
    await ref.read(apiProvider).deviceRevoke(device, workspaceId: workspaceId);
    onRefresh();
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('${device.title} 已撤销')));
    }
  }

  Future<void> _showRemoteDispatch(
    BuildContext context,
    WidgetRef ref,
    HermesEntity device,
    List<HermesEntity> tasks,
  ) async {
    if (tasks.isEmpty) return;
    final task = ValueNotifier<HermesEntity>(tasks.first);
    final argv = TextEditingController(
      text: const JsonEncoder.withIndent('  ').convert(
        ['python3', 'scripts/hermes-readiness.py', '--json'],
      ),
    );
    final timeout = TextEditingController(text: '300');
    HermesEnvelope? preview;
    String? previewFingerprint;
    String? idempotencyKey;
    Object? error;
    bool busy = false;
    final formKey = GlobalKey<FormState>();
    void dropPreview() {
      preview = null;
      previewFingerprint = null;
      idempotencyKey = null;
      error = null;
    }

    String? currentFingerprint() {
      final timeoutSeconds = int.tryParse(timeout.text.trim());
      if (timeoutSeconds == null) return null;
      try {
        return _RemoteDispatchRequest(
          deviceId: device.id,
          task: task.value,
          argv: _parseArgv(argv.text),
          timeoutSeconds: timeoutSeconds,
        ).fingerprint;
      } catch (_) {
        return null;
      }
    }

    void onChanged(
        void Function()? change, void Function(void Function()) setLocalState) {
      setLocalState(() {
        change?.call();
        dropPreview();
      });
    }

    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) {
          final applyFingerprint = currentFingerprint();
          final canApply = preview != null &&
              previewFingerprint == applyFingerprint &&
              idempotencyKey != null &&
              !busy;
          return AlertDialog(
            title: Text('${device.title} 派发任务'),
            content: SizedBox(
              width: 560,
              child: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                          '远程 worker 仅支持 workspace command 节点。approval、agent 与 git_worktree 会 fail closed。'),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        isExpanded: true,
                        initialValue: task.value.id,
                        decoration: const InputDecoration(labelText: '任务'),
                        items: tasks
                            .map((item) => DropdownMenuItem(
                                  value: item.id,
                                  child: Text(
                                    '${item.title} · v${item.version}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ))
                            .toList(),
                        onChanged: (value) {
                          final selected = tasks
                              .where((item) => item.id == value)
                              .firstOrNull;
                          if (selected != null) {
                            onChanged(
                                () => task.value = selected, setLocalState);
                          }
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: argv,
                        decoration:
                            const InputDecoration(labelText: 'argv JSON'),
                        minLines: 3,
                        maxLines: 6,
                        validator: _argvJson,
                        onChanged: (_) => onChanged(null, setLocalState),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: timeout,
                        decoration: const InputDecoration(labelText: '超时秒数'),
                        keyboardType: TextInputType.number,
                        validator: _positiveInt,
                        onChanged: (_) => onChanged(null, setLocalState),
                      ),
                      if (busy) ...[
                        const SizedBox(height: 12),
                        const LinearProgressIndicator(),
                      ],
                      if (error != null) ErrorState(message: error.toString()),
                      if (preview != null) _DispatchPreview(envelope: preview),
                    ],
                  ),
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: busy ? null : () => Navigator.pop(context, false),
                child: const Text('取消'),
              ),
              FilledButton.icon(
                onPressed: busy
                    ? null
                    : () async {
                        if (!formKey.currentState!.validate()) return;
                        final request = _RemoteDispatchRequest(
                          deviceId: device.id,
                          task: task.value,
                          argv: _parseArgv(argv.text),
                          timeoutSeconds: int.parse(timeout.text.trim()),
                        );
                        setLocalState(() {
                          busy = true;
                          error = null;
                          preview = null;
                          previewFingerprint = null;
                          idempotencyKey =
                              'remote-dispatch-${DateTime.now().microsecondsSinceEpoch}';
                        });
                        try {
                          preview = await _remoteDispatch(
                            ref,
                            request,
                            idempotencyKey!,
                            dryRun: true,
                          );
                          setLocalState(() {
                            busy = false;
                            previewFingerprint = request.fingerprint;
                          });
                        } catch (err) {
                          setLocalState(() {
                            busy = false;
                            dropPreview();
                            error = err;
                          });
                        }
                      },
                icon: const Icon(Icons.visibility_rounded),
                label: const Text('预览远程派发'),
              ),
              FilledButton.tonalIcon(
                onPressed: canApply
                    ? () async {
                        if (!formKey.currentState!.validate()) return;
                        final request = _RemoteDispatchRequest(
                          deviceId: device.id,
                          task: task.value,
                          argv: _parseArgv(argv.text),
                          timeoutSeconds: int.parse(timeout.text.trim()),
                        );
                        if (previewFingerprint != request.fingerprint) {
                          setLocalState(() {
                            dropPreview();
                            error = HermesApiException('远程派发内容已变更，请重新预览。');
                          });
                          return;
                        }
                        setLocalState(() {
                          busy = true;
                          error = null;
                        });
                        try {
                          preview = await _remoteDispatch(
                            ref,
                            request,
                            idempotencyKey!,
                            dryRun: false,
                          );
                          setLocalState(() {
                            busy = false;
                            previewFingerprint = null;
                            idempotencyKey = null;
                          });
                          if (context.mounted) Navigator.pop(context, true);
                        } catch (err) {
                          setLocalState(() {
                            busy = false;
                            dropPreview();
                            error = err;
                          });
                        }
                      }
                    : null,
                icon: const Icon(Icons.play_arrow_rounded),
                label: const Text('确认派发'),
              ),
            ],
          );
        },
      ),
    );
    if (saved == true && context.mounted) context.go('/runs');
  }

  Future<HermesEnvelope> _remoteDispatch(
    WidgetRef ref,
    _RemoteDispatchRequest request,
    String idempotencyKey, {
    required bool dryRun,
  }) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || workspaceId.isEmpty) {
      throw const HermesUnavailableException('请先选择工作区。');
    }
    return ref.read(apiProvider).taskDispatch(
          request.task.id,
          workspaceId: workspaceId,
          expectedVersion: request.task.version,
          nodes: [
            {
              'id': 'remote_command',
              'title': 'Remote command',
              'kind': 'command',
              'argv': request.argv,
              'expected_exit_code': 0,
              'timeout_seconds': request.timeoutSeconds,
            }
          ],
          idempotencyKey: idempotencyKey,
          isolation: 'workspace',
          targetDeviceId: request.deviceId,
          dryRun: dryRun,
        );
  }
}

class _EntityListPanel extends StatelessWidget {
  const _EntityListPanel({
    required this.title,
    required this.items,
    required this.empty,
    required this.createLabel,
    required this.canWrite,
    required this.disabledReason,
    required this.onCreate,
    required this.itemBuilder,
  });

  final String title;
  final List<HermesEntity> items;
  final String empty;
  final String createLabel;
  final bool canWrite;
  final String disabledReason;
  final Future<void> Function() onCreate;
  final Widget Function(HermesEntity entity) itemBuilder;

  @override
  Widget build(BuildContext context) {
    return SectionPanel(
      title: title,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: GuardedAction(
              enabled: canWrite,
              reason: disabledReason,
              child: FilledButton.icon(
                onPressed: canWrite ? onCreate : null,
                icon: const Icon(Icons.add_rounded),
                label: Text(createLabel),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: _panelBodyHeight(context),
            child: items.isEmpty
                ? Center(child: Text(empty))
                : ListView.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) => itemBuilder(items[index]),
                  ),
          ),
        ],
      ),
    );
  }
}

class _EditDeleteButtons extends StatelessWidget {
  const _EditDeleteButtons({
    required this.canWrite,
    required this.disabledReason,
    required this.onEdit,
    required this.onDelete,
  });

  final bool canWrite;
  final String disabledReason;
  final Future<void> Function() onEdit;
  final Future<void> Function() onDelete;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 4,
      children: [
        GuardedAction(
          enabled: canWrite,
          reason: disabledReason,
          child: IconButton(
            tooltip: '编辑',
            onPressed: canWrite ? onEdit : null,
            icon: const Icon(Icons.edit_rounded),
          ),
        ),
        GuardedAction(
          enabled: canWrite,
          reason: disabledReason,
          child: IconButton(
            tooltip: '归档',
            onPressed: canWrite ? onDelete : null,
            icon: const Icon(Icons.archive_rounded),
          ),
        ),
      ],
    );
  }
}

class _DispatchTab extends StatefulWidget {
  const _DispatchTab({
    required this.data,
    required this.executeReason,
    required this.preview,
    required this.previewFingerprint,
    required this.busy,
    required this.error,
    required this.onRequestChanged,
    required this.onPreview,
    required this.onApply,
  });

  final _AutomationData data;
  final String? executeReason;
  final HermesEnvelope? preview;
  final String? previewFingerprint;
  final bool busy;
  final Object? error;
  final VoidCallback onRequestChanged;
  final Future<void> Function(_DispatchRequest request) onPreview;
  final Future<void> Function(_DispatchRequest request) onApply;

  @override
  State<_DispatchTab> createState() => _DispatchTabState();
}

class _DispatchTabState extends State<_DispatchTab> {
  final prompt = TextEditingController();
  final baseCommit = TextEditingController();
  String taskId = '';
  String targetKind = 'agent';
  String agentId = '';
  String squadId = '';
  String targetDeviceId = '';
  String isolation = 'workspace';
  int expectedVersion = 1;

  @override
  void initState() {
    super.initState();
    _syncDefaults();
    prompt.addListener(widget.onRequestChanged);
    baseCommit.addListener(widget.onRequestChanged);
  }

  @override
  void dispose() {
    prompt.removeListener(widget.onRequestChanged);
    baseCommit.removeListener(widget.onRequestChanged);
    prompt.dispose();
    baseCommit.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _DispatchTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncDefaults();
  }

  @override
  Widget build(BuildContext context) {
    final canExecute = widget.executeReason == null;
    final remoteAgentDevices = widget.data.devices
        .where((device) =>
            {'paired', 'active'}.contains(device.status) &&
            _deviceSupportsRuntime(device, 'agent'))
        .toList();
    final targetSegments = [
      const ButtonSegment(
        value: 'agent',
        icon: Icon(Icons.smart_toy_rounded),
        label: Text('Agent'),
      ),
      const ButtonSegment(
        value: 'squad',
        icon: Icon(Icons.groups_2_rounded),
        label: Text('Squad'),
      ),
      if (remoteAgentDevices.isNotEmpty)
        const ButtonSegment(
          value: 'remote-agent',
          icon: Icon(Icons.devices_other_rounded),
          label: Text('Remote Agent'),
        ),
    ];
    return SplitPane(
      left: SectionPanel(
        title: '任务派发',
        child: SizedBox(
          height: _panelBodyHeight(context),
          child: Form(
            child: SingleChildScrollView(
              child: Column(
                children: [
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue:
                        widget.data.tasks.any((task) => task.id == taskId)
                            ? taskId
                            : null,
                    decoration: const InputDecoration(labelText: '任务'),
                    items: widget.data.tasks
                        .map((task) => DropdownMenuItem(
                              value: task.id,
                              child: Text(
                                '${task.title} · v${task.version}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ))
                        .toList(),
                    onChanged: (value) => setState(() {
                      taskId = value ?? '';
                      final task = widget.data.tasks
                          .where((item) => item.id == taskId)
                          .firstOrNull;
                      expectedVersion = task?.version ?? 1;
                      widget.onRequestChanged();
                    }),
                  ),
                  const SizedBox(height: 12),
                  SegmentedButton<String>(
                    segments: targetSegments,
                    selected: {targetKind},
                    onSelectionChanged: (value) => setState(() {
                      targetKind = value.single;
                      if (targetKind == 'remote-agent') {
                        isolation = 'workspace';
                        targetDeviceId =
                            remoteAgentDevices.firstOrNull?.id ?? '';
                      }
                      widget.onRequestChanged();
                    }),
                  ),
                  const SizedBox(height: 12),
                  if (targetKind == 'remote-agent') ...[
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue: remoteAgentDevices
                              .any((device) => device.id == targetDeviceId)
                          ? targetDeviceId
                          : null,
                      decoration:
                          const InputDecoration(labelText: 'Remote device'),
                      items: remoteAgentDevices
                          .map((device) => DropdownMenuItem(
                                value: device.id,
                                child: Text(
                                  '${device.title} · ${_allowedRuntimeLabel(device)}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ))
                          .toList(),
                      onChanged: (value) => setState(() {
                        targetDeviceId = value ?? '';
                        widget.onRequestChanged();
                      }),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue:
                          widget.data.agents.any((agent) => agent.id == agentId)
                              ? agentId
                              : null,
                      decoration: const InputDecoration(labelText: 'Agent'),
                      items: widget.data.agents
                          .map((agent) => DropdownMenuItem(
                                value: agent.id,
                                child: Text(
                                  '${agent.title} · v${agent.version}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ))
                          .toList(),
                      onChanged: (value) => setState(() {
                        agentId = value ?? '';
                        widget.onRequestChanged();
                      }),
                    ),
                  ] else if (targetKind == 'agent')
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue:
                          widget.data.agents.any((agent) => agent.id == agentId)
                              ? agentId
                              : null,
                      decoration: const InputDecoration(labelText: 'Agent'),
                      items: widget.data.agents
                          .map((agent) => DropdownMenuItem(
                                value: agent.id,
                                child: Text(
                                  '${agent.title} · v${agent.version}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ))
                          .toList(),
                      onChanged: (value) => setState(() {
                        agentId = value ?? '';
                        widget.onRequestChanged();
                      }),
                    )
                  else
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue:
                          widget.data.squads.any((squad) => squad.id == squadId)
                              ? squadId
                              : null,
                      decoration: const InputDecoration(
                          labelText: 'Squad leader routes'),
                      items: widget.data.squads
                          .map((squad) => DropdownMenuItem(
                                value: squad.id,
                                child: Text(
                                  '${squad.title} · v${squad.version}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ))
                          .toList(),
                      onChanged: (value) => setState(() {
                        squadId = value ?? '';
                        widget.onRequestChanged();
                      }),
                    ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: prompt,
                    decoration: const InputDecoration(labelText: 'Prompt'),
                    minLines: 4,
                    maxLines: 8,
                  ),
                  if (targetKind != 'remote-agent') ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      isExpanded: true,
                      initialValue: isolation,
                      decoration: const InputDecoration(labelText: '隔离方式'),
                      items: const [
                        DropdownMenuItem(
                            value: 'workspace', child: Text('Workspace')),
                        DropdownMenuItem(
                            value: 'git_worktree', child: Text('Git worktree')),
                      ],
                      onChanged: (value) => setState(() {
                        isolation = value ?? 'workspace';
                        widget.onRequestChanged();
                      }),
                    ),
                    if (isolation == 'git_worktree') ...[
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: baseCommit,
                        decoration:
                            const InputDecoration(labelText: 'base_commit'),
                      ),
                    ],
                  ],
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      GuardedAction(
                        enabled: canExecute && !widget.busy,
                        reason: widget.executeReason ?? '',
                        child: FilledButton.icon(
                          onPressed: canExecute && !widget.busy
                              ? () => widget.onPreview(_request())
                              : null,
                          icon: const Icon(Icons.visibility_rounded),
                          label: const Text('预览派发'),
                        ),
                      ),
                      GuardedAction(
                        enabled: canExecute &&
                            widget.preview != null &&
                            widget.previewFingerprint ==
                                _request().fingerprint &&
                            !widget.busy,
                        reason: widget.preview == null
                            ? '请先预览。'
                            : widget.previewFingerprint !=
                                    _request().fingerprint
                                ? '派发内容已变更，请重新预览。'
                                : widget.executeReason ?? '',
                        child: FilledButton.tonalIcon(
                          onPressed: canExecute &&
                                  widget.preview != null &&
                                  widget.previewFingerprint ==
                                      _request().fingerprint &&
                                  !widget.busy
                              ? () => widget.onApply(_request())
                              : null,
                          icon: const Icon(Icons.play_arrow_rounded),
                          label: const Text('确认派发'),
                        ),
                      ),
                    ],
                  ),
                  if (widget.busy) ...[
                    const SizedBox(height: 12),
                    const LinearProgressIndicator(),
                  ],
                  if (widget.error != null)
                    ErrorState(message: widget.error.toString()),
                ],
              ),
            ),
          ),
        ),
      ),
      right: SectionPanel(
        title: '预览与运行历史',
        child: SizedBox(
          height: _panelBodyHeight(context),
          child: ListView(
            children: [
              _DispatchPreview(envelope: widget.preview),
              const SizedBox(height: 16),
              Text('最近运行', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (widget.data.runs.isEmpty)
                const Text('暂无运行历史')
              else
                ...widget.data.runs.map(
                  (run) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: EntityTile(
                      entity: run,
                      details: [
                        detailChip('task',
                            (run.data['task_source'] as Map?)?['task_id']),
                        detailChip('schedule', _scheduleRunId(run)),
                        detailChip('isolation', run.data['isolation']),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  _DispatchRequest _request() {
    final isRemoteAgent = targetKind == 'remote-agent';
    final target = targetKind == 'agent' || isRemoteAgent
        ? widget.data.agents.where((agent) => agent.id == agentId).firstOrNull
        : widget.data.squads.where((squad) => squad.id == squadId).firstOrNull;
    return _DispatchRequest(
      taskId: taskId,
      expectedVersion: expectedVersion,
      targetVersion: target?.version ?? 0,
      prompt: prompt.text,
      agentId: targetKind == 'agent' || isRemoteAgent ? agentId : null,
      squadId: targetKind == 'squad' ? squadId : null,
      targetDeviceId: isRemoteAgent ? targetDeviceId : null,
      isolation: isRemoteAgent ? 'workspace' : isolation,
      baseCommit: isRemoteAgent ? '' : baseCommit.text.trim(),
    );
  }

  void _syncDefaults() {
    if (taskId.isEmpty && widget.data.tasks.isNotEmpty) {
      taskId = widget.data.tasks.first.id;
      expectedVersion = widget.data.tasks.first.version;
    }
    if (agentId.isEmpty && widget.data.agents.isNotEmpty) {
      agentId = widget.data.agents.first.id;
    }
    if (squadId.isEmpty && widget.data.squads.isNotEmpty) {
      squadId = widget.data.squads.first.id;
    }
    if (targetDeviceId.isEmpty && widget.data.devices.isNotEmpty) {
      targetDeviceId = widget.data.devices
              .where((device) =>
                  {'paired', 'active'}.contains(device.status) &&
                  _deviceSupportsRuntime(device, 'agent'))
              .firstOrNull
              ?.id ??
          '';
    }
    final selectedDevice = widget.data.devices
        .where((device) => device.id == targetDeviceId)
        .firstOrNull;
    if (targetKind == 'remote-agent' &&
        (selectedDevice == null ||
            !_deviceSupportsRuntime(selectedDevice, 'agent'))) {
      targetKind = 'agent';
    }
  }
}

class _DispatchRequest {
  const _DispatchRequest({
    required this.taskId,
    required this.expectedVersion,
    required this.targetVersion,
    required this.prompt,
    required this.agentId,
    required this.squadId,
    required this.targetDeviceId,
    required this.isolation,
    required this.baseCommit,
  });

  final String taskId;
  final int expectedVersion;
  final int targetVersion;
  final String prompt;
  final String? agentId;
  final String? squadId;
  final String? targetDeviceId;
  final String isolation;
  final String baseCommit;

  String get fingerprint => jsonEncode({
        'taskId': taskId,
        'expectedVersion': expectedVersion,
        'targetVersion': targetVersion,
        'prompt': prompt.trim(),
        'agentId': agentId ?? '',
        'squadId': squadId ?? '',
        'targetDeviceId': targetDeviceId ?? '',
        'isolation': isolation,
        'baseCommit': baseCommit.trim(),
      });
}

class _ScheduleConfigureRequest {
  const _ScheduleConfigureRequest({
    required this.scheduleId,
    required this.title,
    required this.trigger,
    required this.nodes,
    required this.enabled,
    required this.misfireCoalesce,
  });

  final String scheduleId;
  final String title;
  final Map<String, dynamic> trigger;
  final List<Map<String, dynamic>> nodes;
  final bool enabled;
  final bool misfireCoalesce;

  String get fingerprint => jsonEncode({
        'scheduleId': scheduleId,
        'title': title,
        'trigger': trigger,
        'nodes': nodes,
        'enabled': enabled,
        'misfireCoalesce': misfireCoalesce,
      });
}

class _RemoteDispatchRequest {
  const _RemoteDispatchRequest({
    required this.deviceId,
    required this.task,
    required this.argv,
    required this.timeoutSeconds,
  });

  final String deviceId;
  final HermesEntity task;
  final List<String> argv;
  final int timeoutSeconds;

  String get fingerprint => jsonEncode({
        'deviceId': deviceId,
        'taskId': task.id,
        'expectedVersion': task.version,
        'argv': argv,
        'timeoutSeconds': timeoutSeconds,
      });
}

String _scheduleRunId(HermesEntity run) {
  final schedule = run.data['schedule'];
  if (schedule is! Map) return '';
  return _text(schedule['id']).isNotEmpty
      ? _text(schedule['id'])
      : _text(schedule['schedule_id']);
}

Set<String> _allowedRuntimes(HermesEntity device) {
  final raw = device.data['allowed_runtimes'];
  if (raw == null) return {'command'};
  if (raw is! List) return {};
  return raw
      .map((value) => value.toString())
      .where((value) => value.isNotEmpty)
      .toSet();
}

bool _deviceSupportsRuntime(HermesEntity device, String runtime) {
  return _allowedRuntimes(device).contains(runtime);
}

String _allowedRuntimeLabel(HermesEntity device) {
  final values = _allowedRuntimes(device).toList()..sort();
  return values.isEmpty ? 'none' : values.join(', ');
}

class _DispatchPreview extends StatelessWidget {
  const _DispatchPreview({required this.envelope});

  final HermesEnvelope? envelope;

  @override
  Widget build(BuildContext context) {
    if (envelope == null) return const Text('先预览派发，确认后再应用。');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            Chip(label: Text(envelope!.ok ? 'ok' : 'not ok')),
            if (envelope!.summary['dry_run'] != null)
              Chip(label: Text('dry_run ${envelope!.summary['dry_run']}')),
            if (envelope!.traceId != null)
              Chip(label: Text('trace ${envelope!.traceId}')),
          ],
        ),
        const SizedBox(height: 8),
        SelectableText(
          const JsonEncoder.withIndent('  ').convert({
            'summary': envelope!.summary,
            'items': envelope!.items,
          }),
        ),
      ],
    );
  }
}

String _text(Object? value) => value?.toString() ?? '';

String _provider(Object? value) {
  final text = _text(value);
  return {'codex', 'claude', 'opencode'}.contains(text) ? text : 'codex';
}

String _role(Object? value) {
  final text = _text(value);
  return {'leader', 'implementer', 'reviewer'}.contains(text)
      ? text
      : 'implementer';
}

String _normalizeTriggerType(Object? value) {
  final text = _text(value);
  return {'interval', 'cron', 'webhook'}.contains(text) ? text : 'interval';
}

String _scheduleTriggerType(Map<String, dynamic> data) {
  final trigger = (data['trigger'] as Map?)?.cast<String, dynamic>() ??
      const <String, dynamic>{};
  return _normalizeTriggerType(trigger['type']);
}

String _scheduleTriggerLabel(Map<String, dynamic> data) {
  final trigger = (data['trigger'] as Map?)?.cast<String, dynamic>() ??
      const <String, dynamic>{};
  return switch (_normalizeTriggerType(trigger['type'])) {
    'cron' =>
      'cron ${_text(trigger['cron_expression'])} ${_text(trigger['timezone'])}'
          .trim(),
    'webhook' => 'webhook ${_text(trigger['secret_ref'])}'.trim(),
    _ => 'interval ${_text(trigger['interval_seconds'])}s'.trim(),
  };
}

TextFormField _field({
  required TextEditingController controller,
  required String label,
}) {
  return TextFormField(
    controller: controller,
    decoration: InputDecoration(labelText: label),
    validator: requiredField,
  );
}

TextFormField _bounded({
  required TextEditingController controller,
  required String label,
}) {
  return TextFormField(
    controller: controller,
    decoration: InputDecoration(labelText: label),
    validator: boundedRequiredField,
  );
}

double _panelBodyHeight(BuildContext context) {
  final size = MediaQuery.sizeOf(context);
  if (size.width < 920) return 200;
  return (size.height - 520).clamp(280, 420).toDouble();
}

String? _positiveInt(String? value) {
  final required = requiredField(value);
  if (required != null) return required;
  final parsed = int.tryParse(value!.trim());
  if (parsed == null || parsed <= 0) return '请输入正整数';
  return null;
}

String? _nodesJson(String? value) {
  final required = requiredField(value);
  if (required != null) return required;
  try {
    _parseNodes(value!);
    return null;
  } catch (error) {
    return error.toString();
  }
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

List<Map<String, dynamic>> _parseNodes(String value) {
  final decoded = jsonDecode(value);
  if (decoded is! List || decoded.isEmpty) {
    throw const FormatException('nodes 必须是非空 JSON 数组');
  }
  return decoded.map((item) {
    if (item is! Map) throw const FormatException('node 必须是对象');
    return Map<String, dynamic>.from(item);
  }).toList();
}

List<String> _parseArgv(String value) {
  final decoded = jsonDecode(value);
  if (decoded is! List || decoded.isEmpty) {
    throw const FormatException('argv 必须是非空 JSON 字符串数组');
  }
  return decoded.map((item) {
    if (item is! String || item.trim().isEmpty || item.contains('\u0000')) {
      throw const FormatException('argv 只能包含非空字符串');
    }
    return item;
  }).toList();
}

Future<void> _saveWithContainer(
  ProviderContainer ref,
  Resource resource,
  HermesEntity? entity,
  Map<String, dynamic> data,
) async {
  final workspaceId = ref.read(workspaceSelectionProvider);
  if (workspaceId == null || workspaceId.isEmpty) {
    throw const HermesUnavailableException('请先选择工作区。');
  }
  final api = ref.read(apiProvider);
  if (entity == null) {
    await api.create(resource, data, workspaceId: workspaceId);
    return;
  }
  await api.patch(resource, entity, data, workspaceId: workspaceId);
}

Future<void> _archive(
  BuildContext context,
  Resource resource,
  HermesEntity entity,
) async {
  final ref = ProviderScope.containerOf(context);
  final workspaceId = ref.read(workspaceSelectionProvider);
  if (workspaceId == null || workspaceId.isEmpty) {
    throw const HermesUnavailableException('请先选择工作区。');
  }
  await ref.read(apiProvider).patch(resource, entity, {'status': 'archived'},
      workspaceId: workspaceId);
}
