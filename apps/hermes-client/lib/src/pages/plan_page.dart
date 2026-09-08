import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:re_editor/re_editor.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';
import '../ui/source_editor.dart';

class PlanPage extends ConsumerWidget {
  const PlanPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessions = ref.watch(sessionsProvider);
    final tasks = ref.watch(tasksProvider);
    final requirements = ref.watch(requirementsProvider);
    return WorkbenchPage(
      title: '项目',
      subtitle: '会话、任务与需求',
      actions: [
        FilledButton.icon(
          onPressed: () => _showSessionDialog(context, ref),
          icon: const Icon(Icons.note_add_rounded),
          label: const Text('会话'),
        ),
        FilledButton.tonalIcon(
          onPressed: () => _showTaskDialog(context, ref, Resource.tasks),
          icon: const Icon(Icons.add_task_rounded),
          label: const Text('任务'),
        ),
        OutlinedButton.icon(
          onPressed: () => _showTaskDialog(context, ref, Resource.requirements),
          icon: const Icon(Icons.fact_check_rounded),
          label: const Text('需求'),
        ),
      ],
      child: SplitPane(
        left: AsyncEntityList(
          value: sessions,
          empty: '暂无会话',
          itemBuilder: (entity) => EntityTile(
            entity: entity,
            trailing: IconButton(
              tooltip: '编辑会话',
              icon: const Icon(Icons.edit_rounded),
              onPressed: () async {
                final updated = await showPatchDialog(
                  context,
                  ref,
                  Resource.sessions,
                  entity,
                );
                if (updated) ref.invalidate(sessionsProvider);
              },
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
  ) {
    return EntityTile(
      entity: entity,
      trailing: IconButton(
        tooltip: '编辑',
        icon: const Icon(Icons.edit_rounded),
        onPressed: () async {
          final updated = await showPatchDialog(context, ref, resource, entity);
          if (updated) {
            if (resource == Resource.tasks) {
              ref.invalidate(tasksProvider);
            } else {
              ref.invalidate(requirementsProvider);
            }
          }
        },
      ),
    );
  }

  Future<void> _showSessionDialog(BuildContext context, WidgetRef ref) async {
    final title = TextEditingController();
    final root = TextEditingController();
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => SimpleFormDialog(
        title: '新建会话',
        fields: [
          TextFormField(
            controller: title,
            decoration: const InputDecoration(labelText: '标题'),
            validator: requiredField,
          ),
          TextFormField(
            controller: root,
            decoration: const InputDecoration(labelText: '工作目录'),
            validator: requiredField,
          ),
        ],
        onSubmit: () => createScoped(ref, Resource.sessions, {
          'title': title.text.trim(),
          'workspace_root': root.text.trim(),
        }),
      ),
    );
    if (created == true) ref.invalidate(sessionsProvider);
  }

  Future<void> _showTaskDialog(
    BuildContext context,
    WidgetRef ref,
    Resource resource,
  ) async {
    final title = TextEditingController();
    final status = TextEditingController(text: 'open');
    final source = CodeLineEditingController.fromText('');
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => SimpleFormDialog(
        title: resource == Resource.tasks ? '新建任务' : '新建需求',
        fields: [
          TextFormField(
            controller: title,
            decoration: const InputDecoration(labelText: '标题'),
            validator: requiredField,
          ),
          TextFormField(
            controller: status,
            decoration: const InputDecoration(labelText: '状态'),
            validator: requiredField,
          ),
          SourceEditor(controller: source),
        ],
        onSubmit: () => createScoped(ref, resource, {
          'title': title.text.trim(),
          'status': status.text.trim(),
          'content': source.text,
        }),
      ),
    );
    if (created == true) {
      ref.invalidate(
          resource == Resource.tasks ? tasksProvider : requirementsProvider);
    }
  }
}
