import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../ui/common.dart';

class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  final baseUrl = TextEditingController();
  final token = TextEditingController();
  bool initialized = false;
  String? dataDir;
  String? tokenFile;
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
    final health = ref.watch(healthProvider);
    final readiness = ref.watch(readinessProvider);
    final sync = ref.watch(syncProvider);
    final current = settings.asData?.value;
    if (!initialized && current != null) {
      initialized = true;
      baseUrl.text = current.baseUrl ?? '';
      token.text = current.token ?? '';
    }
    return WorkbenchPage(
      title: '设置',
      subtitle: '连接、健康与同步',
      actions: [
        OutlinedButton.icon(
          onPressed: busy
              ? null
              : () => _perform(() async {
                    await ref.read(settingsProvider.notifier).disconnect();
                    token.clear();
                    ref.invalidate(healthProvider);
                    ref.invalidate(readinessProvider);
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
          SectionPanel(
            title: '远端 Core',
            child: Column(
              children: [
                TextFormField(
                  controller: baseUrl,
                  decoration: const InputDecoration(labelText: 'Base URL'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: token,
                  decoration: const InputDecoration(labelText: 'Bearer Token'),
                  obscureText: true,
                ),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.icon(
                    onPressed: busy
                        ? null
                        : () => _perform(() async {
                              await ref
                                  .read(settingsProvider.notifier)
                                  .saveRemote(
                                    baseUrl: baseUrl.text,
                                    token: token.text,
                                  );
                              ref.invalidate(healthProvider);
                              ref.invalidate(readinessProvider);
                              ref.invalidate(syncProvider);
                            }),
                    icon: const Icon(Icons.save_rounded),
                    label: const Text('保存'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (Platform.isMacOS || Platform.isLinux || Platform.isWindows)
            SectionPanel(
              title: '本地启动',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: busy
                            ? null
                            : () => _perform(() async {
                                  final directory = await getDirectoryPath();
                                  if (mounted && directory != null) {
                                    setState(() => dataDir = directory);
                                  }
                                }),
                        icon: const Icon(Icons.folder_open_rounded),
                        label: const Text('数据目录'),
                      ),
                      OutlinedButton.icon(
                        onPressed: busy
                            ? null
                            : () => _perform(() async {
                                  final directory = await getDirectoryPath();
                                  if (mounted && directory != null) {
                                    setState(() =>
                                        tokenFile = '$directory/hermes.token');
                                  }
                                }),
                        icon: const Icon(Icons.key_rounded),
                        label: const Text('Token 文件'),
                      ),
                      FilledButton.tonalIcon(
                        onPressed: busy || dataDir == null || tokenFile == null
                            ? null
                            : () => _perform(() async {
                                  await ref
                                      .read(settingsProvider.notifier)
                                      .bootstrapLocal(
                                        dataDir: dataDir!,
                                        tokenFile: tokenFile!,
                                      );
                                  ref.invalidate(healthProvider);
                                  ref.invalidate(readinessProvider);
                                }),
                        icon: const Icon(Icons.power_settings_new_rounded),
                        label: const Text('启动'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text('数据目录：${dataDir ?? '未选择'}'),
                  Text('Token 文件：${tokenFile ?? current?.tokenFile ?? '未选择'}'),
                ],
              ),
            ),
          const SizedBox(height: 16),
          SizedBox(
            height: 420,
            child: SplitPane(
              left: EnvelopePanel(title: '健康', envelope: health),
              right: EnvelopePanel(title: '就绪', envelope: readiness),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 280,
            child: AsyncJsonList(title: '同步事件', value: sync),
          ),
        ],
      ),
    );
  }
}
