import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';
import '../ui/entity_forms.dart';
import '../ui/labels.dart';
import '../ui/task_delivery_dialog.dart';

class PlanPage extends ConsumerWidget {
  const PlanPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(sessionsProvider);
    final tasks = ref.watch(tasksProvider);
    final requirements = ref.watch(requirementsProvider);
    final settings = ref.watch(settingsProvider).asData?.value;
    final workspaceId = ref.watch(workspaceSelectionProvider);
    final permissions =
        ref.watch(readinessProvider).asData?.value.permissions ?? const [];
    final writeReason = writeDisabledReason(
      settings: settings,
      workspaceId: workspaceId,
      permissions: permissions,
    );
    final canWrite = writeReason == null;
    return WorkbenchPage(
      title: '项目',
      subtitle: '会话、任务与需求',
      actions: [
        GuardedAction(
          enabled: canWrite,
          reason: writeReason ?? '',
          child: FilledButton.icon(
            onPressed: canWrite ? () => _showSessionDialog(context, ref) : null,
            icon: const Icon(Icons.note_add_rounded),
            label: const Text('会话'),
          ),
        ),
        GuardedAction(
          enabled: canWrite,
          reason: writeReason ?? '',
          child: FilledButton.tonalIcon(
            onPressed: canWrite
                ? () => _showTaskDialog(context, ref, Resource.tasks)
                : null,
            icon: const Icon(Icons.add_task_rounded),
            label: const Text('任务'),
          ),
        ),
        GuardedAction(
          enabled: canWrite,
          reason: writeReason ?? '',
          child: OutlinedButton.icon(
            onPressed: canWrite
                ? () => _showTaskDialog(context, ref, Resource.requirements)
                : null,
            icon: const Icon(Icons.fact_check_rounded),
            label: const Text('需求'),
          ),
        ),
      ],
      child: SplitPane(
        left: AsyncEntityList(
          value: sessions,
          empty: '暂无会话',
          itemBuilder: (entity) => EntityTile(
            entity: entity,
            details: [
              detailChip('目标', entity.data['target']),
              detailChip('摘要', entity.data['summary']),
            ],
            trailing: IconButton(
              tooltip: '编辑会话',
              icon: const Icon(Icons.edit_rounded),
              onPressed: canWrite
                  ? () async {
                      final updated = await showEntityForm(
                        context,
                        ref,
                        Resource.sessions,
                        entity: entity,
                      );
                      if (updated) ref.invalidate(sessionsProvider);
                    }
                  : null,
            ),
          ),
        ),
        right: DefaultTabController(
          length: 2,
          child: Column(
            children: [
              const TabBar(
                tabs: [
                  Tab(text: '任务'),
                  Tab(text: '需求'),
                ],
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    AsyncEntityList(
                      value: tasks,
                      empty: '暂无任务',
                      itemBuilder: (entity) => _editableTile(
                        context,
                        ref,
                        Resource.tasks,
                        entity,
                        canWrite,
                      ),
                    ),
                    AsyncEntityList(
                      value: requirements,
                      empty: '暂无需求',
                      itemBuilder: (entity) => _editableTile(
                        context,
                        ref,
                        Resource.requirements,
                        entity,
                        canWrite,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _editableTile(
    BuildContext context,
    WidgetRef ref,
    Resource resource,
    HermesEntity entity,
    bool canWrite,
  ) {
    return EntityTile(
      entity: entity,
      onTap: resource == Resource.tasks
          ? () => showDialog<void>(
              context: context,
              builder: (_) => TaskDeliveryDialog(
                    taskId: entity.id,
                    workspaceId: ref.read(workspaceSelectionProvider)!,
                    client: ref.read(apiProvider),
                  ))
          : null,
      details: [
        detailChip('优先级', hermesPriorityLabel(entity.data['priority'])),
        detailChip('负责人', entity.data['assigned_agent']),
        detailChip('工具', entity.data['dev_tool']),
        detailChip('验收', entity.data['acceptance_criteria']),
      ],
      trailing: Wrap(children: [
        if (resource == Resource.tasks)
          IconButton(
              tooltip: '任务交付',
              icon: const Icon(Icons.fact_check_outlined),
              onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) => TaskDeliveryDialog(
                        taskId: entity.id,
                        workspaceId: ref.read(workspaceSelectionProvider)!,
                        client: ref.read(apiProvider),
                      ))),
        IconButton(
          tooltip: '编辑',
          icon: const Icon(Icons.edit_rounded),
          onPressed: canWrite &&
                  !['executing', 'accepted']
                      .contains((entity.data['delivery'] as Map?)?['phase'])
              ? () async {
                  final updated = await showEntityForm(context, ref, resource,
                      entity: entity);
                  if (updated) {
                    if (resource == Resource.tasks) {
                      ref.invalidate(tasksProvider);
                    } else {
                      ref.invalidate(requirementsProvider);
                    }
                  }
                }
              : null,
        )
      ]),
    );
  }

  Future<void> _showSessionDialog(BuildContext context, WidgetRef ref) async {
    final created = await showEntityForm(context, ref, Resource.sessions);
    if (created == true) ref.invalidate(sessionsProvider);
  }

  Future<void> _showTaskDialog(
    BuildContext context,
    WidgetRef ref,
    Resource resource,
  ) async {
    final created = await showEntityForm(context, ref, resource);
    if (created == true) {
      ref.invalidate(
          resource == Resource.tasks ? tasksProvider : requirementsProvider);
    }
  }
}
