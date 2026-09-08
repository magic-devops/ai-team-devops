import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';

class WorkspacesPage extends ConsumerWidget {
  const WorkspacesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspaces = ref.watch(workspacesProvider);
    final settings = ref.watch(settingsProvider).asData?.value;
    final permissions =
        ref.watch(readinessProvider).asData?.value.permissions ?? const [];
    final writeReason = writeDisabledReason(
      settings: settings,
      workspaceId: null,
      permissions: permissions,
      scoped: false,
    );
    final canWrite = writeReason == null;
    return WorkbenchPage(
      title: '工作台',
      subtitle: '工作区与连接状态',
      actions: [
        GuardedAction(
          enabled: canWrite,
          reason: writeReason ?? '',
          child: FilledButton.icon(
            onPressed:
                canWrite ? () => _showWorkspaceDialog(context, ref) : null,
            icon: const Icon(Icons.add_rounded),
            label: const Text('新建工作区'),
          ),
        ),
      ],
      child: Column(
        children: [
          ConnectionBanner(settings: settings),
          const SizedBox(height: 16),
          Expanded(
            child: settings?.isConfigured == true
                ? AsyncEntityList(
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
                        ],
                      ),
                    ),
                  )
                : _UnconfiguredWorkspaceState(
                    canStartLocal:
                        ref.watch(localRuntimeProvider).isDesktopSupported,
                    onSettings: () => context.go('/settings'),
                    onStartLocal: () async {
                      await ref
                          .read(settingsProvider.notifier)
                          .bootstrapLocal();
                      ref.invalidate(workspacesProvider);
                      ref.invalidate(readinessProvider);
                      ref.invalidate(healthProvider);
                      ref.invalidate(diagnosticsProvider);
                    },
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

class _UnconfiguredWorkspaceState extends StatefulWidget {
  const _UnconfiguredWorkspaceState({
    required this.canStartLocal,
    required this.onSettings,
    required this.onStartLocal,
  });

  final bool canStartLocal;
  final VoidCallback onSettings;
  final Future<void> Function() onStartLocal;

  @override
  State<_UnconfiguredWorkspaceState> createState() =>
      _UnconfiguredWorkspaceStateState();
}

class _UnconfiguredWorkspaceStateState
    extends State<_UnconfiguredWorkspaceState> {
  bool busy = false;
  Object? error;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: SectionPanel(
          title: '还没有连接 Hermes Core',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.canStartLocal
                  ? '桌面端可直接启动随包 Core；也可以配置远端 Core。'
                  : '请先配置远端 Core。'),
              if (error != null) ...[
                const SizedBox(height: 8),
                Text(
                  error.toString(),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (widget.canStartLocal)
                    FilledButton.icon(
                      onPressed: busy
                          ? null
                          : () async {
                              setState(() {
                                busy = true;
                                error = null;
                              });
                              try {
                                await widget.onStartLocal();
                              } catch (failure) {
                                if (mounted) setState(() => error = failure);
                              } finally {
                                if (mounted) setState(() => busy = false);
                              }
                            },
                      icon: const Icon(Icons.play_arrow_rounded),
                      label: const Text('启动本地 Core'),
                    ),
                  OutlinedButton.icon(
                    onPressed: busy ? null : widget.onSettings,
                    icon: const Icon(Icons.settings_rounded),
                    label: const Text('打开设置'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
