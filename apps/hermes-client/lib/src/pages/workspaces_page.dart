import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';

class WorkspacesPage extends ConsumerWidget {
  const WorkspacesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspaces = ref.watch(workspacesProvider);
    final settings = ref.watch(settingsProvider).asData?.value;
    final canWrite = ref
            .watch(readinessProvider)
            .asData
            ?.value
            .permissions
            .contains('write') ??
        false;
    return WorkbenchPage(
      title: '工作台',
      subtitle: '工作区与连接状态',
      actions: [
        FilledButton.icon(
          onPressed: canWrite ? () => _showWorkspaceDialog(context, ref) : null,
          icon: const Icon(Icons.add_rounded),
          label: const Text('新建工作区'),
        ),
      ],
      child: Column(
        children: [
          ConnectionBanner(settings: settings),
          const SizedBox(height: 16),
          Expanded(
            child: AsyncEntityList(
              value: workspaces,
              empty: '暂无工作区',
              itemBuilder: (workspace) => EntityTile(
                entity: workspace,
                selected: settings?.workspaceId == workspace.id,
                trailing: Wrap(
                  spacing: 6,
                  children: [
                    FilledButton.tonal(
                      onPressed: () async {
                        await ref
                            .read(settingsProvider.notifier)
                            .selectWorkspace(workspace.id);
                        ref.invalidate(workspacesProvider);
                      },
                      child: const Text('选择'),
                    ),
                    IconButton(
                      tooltip: '编辑工作区',
                      icon: const Icon(Icons.admin_panel_settings_rounded),
                      onPressed: canWrite
                          ? () async {
                              final updated = await showPatchDialog(
                                context,
                                ref,
                                Resource.workspaces,
                                workspace,
                              );
                              if (updated) ref.invalidate(workspacesProvider);
                            }
                          : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showWorkspaceDialog(BuildContext context, WidgetRef ref) async {
    final name = TextEditingController();
    final root = TextEditingController();
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => SimpleFormDialog(
        title: '新建工作区',
        fields: [
          TextFormField(
            controller: name,
            decoration: const InputDecoration(labelText: '名称'),
            validator: requiredField,
          ),
          TextFormField(
            controller: root,
            decoration: const InputDecoration(labelText: '根目录'),
            validator: requiredField,
          ),
        ],
        onSubmit: () async {
          await ref.read(apiProvider).create(Resource.workspaces, {
            'name': name.text.trim(),
            'root': root.text.trim(),
          });
        },
      ),
    );
    name.dispose();
    root.dispose();
    if (created == true) ref.invalidate(workspacesProvider);
  }
}
