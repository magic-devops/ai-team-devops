import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';
import '../ui/entity_forms.dart';
import '../ui/labels.dart';

class AssetsPage extends ConsumerWidget {
  const AssetsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assets = ref.watch(assetsProvider);
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
      title: '资产',
      subtitle: '记忆、知识与数据资产',
      actions: [
        GuardedAction(
          enabled: canWrite,
          reason: writeReason ?? '',
          child: FilledButton.icon(
            onPressed: canWrite ? () => _showAssetDialog(context, ref) : null,
            icon: const Icon(Icons.add_box_rounded),
            label: const Text('资产'),
          ),
        ),
      ],
      child: AsyncEntityList(
        value: assets,
        empty: '暂无资产',
        itemBuilder: (entity) => EntityTile(
          entity: entity,
          details: [
            detailChip('类型', hermesAssetKindLabel(entity.data['kind'])),
            detailChip('来源', entity.data['source']),
          ],
          trailing: Wrap(
            spacing: 6,
            children: [
              IconButton(
                tooltip: '编辑资产',
                icon: const Icon(Icons.edit_rounded),
                onPressed: canWrite
                    ? () async {
                        final updated = await showEntityForm(
                          context,
                          ref,
                          Resource.assets,
                          entity: entity,
                        );
                        if (updated) ref.invalidate(assetsProvider);
                      }
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showAssetDialog(BuildContext context, WidgetRef ref) async {
    final created = await showEntityForm(context, ref, Resource.assets);
    if (created == true) ref.invalidate(assetsProvider);
  }
}
