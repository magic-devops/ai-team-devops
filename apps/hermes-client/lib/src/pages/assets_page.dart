import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:re_editor/re_editor.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';
import '../ui/source_editor.dart';

class AssetsPage extends ConsumerWidget {
  const AssetsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assets = ref.watch(assetsProvider);
    return WorkbenchPage(
      title: '资产',
      subtitle: '记忆、知识与数据资产',
      actions: [
        FilledButton.icon(
          onPressed: () => _showAssetDialog(context, ref),
          icon: const Icon(Icons.add_box_rounded),
          label: const Text('资产'),
        ),
      ],
      child: AsyncEntityList(
        value: assets,
        empty: '暂无资产',
        itemBuilder: (entity) => EntityTile(
          entity: entity,
          trailing: Wrap(
            spacing: 6,
            children: [
              IconButton(
                tooltip: '编辑资产',
                icon: const Icon(Icons.edit_rounded),
                onPressed: () async {
                  final updated = await showPatchDialog(
                    context,
                    ref,
                    Resource.assets,
                    entity,
                  );
                  if (updated) ref.invalidate(assetsProvider);
                },
              ),
              IconButton(
                tooltip: '删除资产',
                icon: const Icon(Icons.delete_outline_rounded),
                onPressed: () async {
                  final workspaceId = ref.read(workspaceSelectionProvider);
                  if (workspaceId == null) return;
                  await ref.read(apiProvider).delete(
                        Resource.assets,
                        entity,
                        workspaceId: workspaceId,
                        dryRun: false,
                      );
                  ref.invalidate(assetsProvider);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showAssetDialog(BuildContext context, WidgetRef ref) async {
    final title = TextEditingController();
    final kind = TextEditingController(text: 'memory');
    final content = CodeLineEditingController.fromText('');
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => SimpleFormDialog(
        title: '新建资产',
        fields: [
          TextFormField(
            controller: title,
            decoration: const InputDecoration(labelText: '标题'),
            validator: requiredField,
          ),
          TextFormField(
            controller: kind,
            decoration: const InputDecoration(
              labelText: 'Kind',
              helperText: 'memory, knowledge, skill, plugin, data-source',
            ),
            validator: requiredField,
          ),
          SourceEditor(controller: content),
        ],
        onSubmit: () => createScoped(ref, Resource.assets, {
          'title': title.text.trim(),
          'kind': kind.text.trim(),
          'content': content.text,
        }),
      ),
    );
    if (created == true) ref.invalidate(assetsProvider);
  }
}
