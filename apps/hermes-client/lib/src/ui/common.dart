import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../models.dart';

class WorkbenchPage extends StatelessWidget {
  const WorkbenchPage({
    required this.title,
    required this.child,
    this.subtitle,
    this.actions = const [],
    super.key,
  });

  final String title;
  final String? subtitle;
  final Widget child;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 12,
            runSpacing: 12,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: Theme.of(context).textTheme.headlineSmall),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(subtitle!,
                          style: Theme.of(context).textTheme.bodyMedium),
                    ],
                  ],
                ),
              ),
              Wrap(spacing: 8, runSpacing: 8, children: actions),
            ],
          ),
          const SizedBox(height: 18),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class SplitPane extends StatelessWidget {
  const SplitPane({required this.left, required this.right, super.key});

  final Widget left;
  final Widget right;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 920) {
          return ListView(
            children: [
              SizedBox(height: 420, child: left),
              const SizedBox(height: 16),
              SizedBox(height: 420, child: right),
            ],
          );
        }
        return Row(
          children: [
            Expanded(child: left),
            const SizedBox(width: 16),
            Expanded(child: right),
          ],
        );
      },
    );
  }
}

class SectionPanel extends StatelessWidget {
  const SectionPanel({required this.title, required this.child, super.key});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

class AsyncEntityList extends StatelessWidget {
  const AsyncEntityList({
    required this.value,
    required this.itemBuilder,
    required this.empty,
    super.key,
  });

  final AsyncValue<List<HermesEntity>> value;
  final Widget Function(HermesEntity entity) itemBuilder;
  final String empty;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: ErrorState(message: error.toString())),
      data: (items) {
        if (items.isEmpty) return Center(child: Text(empty));
        return ListView.separated(
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (context, index) => itemBuilder(items[index]),
        );
      },
    );
  }
}

class EntityTile extends StatelessWidget {
  const EntityTile({
    required this.entity,
    this.trailing,
    this.selected = false,
    this.onTap,
    super.key,
  });

  final HermesEntity entity;
  final Widget? trailing;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: selected ? scheme.secondaryContainer : scheme.surfaceContainerLow,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final compact = constraints.maxWidth < 520;
              final body = Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(entity.title,
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Text(
                    '${entity.kind} · ${entity.status} · v${entity.version}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              );
              if (trailing == null) return body;
              if (compact) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    body,
                    const SizedBox(height: 8),
                    Align(alignment: Alignment.centerRight, child: trailing),
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(child: body),
                  const SizedBox(width: 8),
                  Flexible(
                      child: Align(
                          alignment: Alignment.centerRight, child: trailing)),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({required this.settings, super.key});

  final ConnectionSettings? settings;

  @override
  Widget build(BuildContext context) {
    final configured = settings?.isConfigured == true;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: configured ? scheme.primaryContainer : scheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        configured
            ? '已连接 ${settings!.baseUrl} · 工作区 ${settings!.workspaceId ?? '未选择'}'
            : 'Hermes Core 未连接',
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline_rounded,
              color: Theme.of(context).colorScheme.error),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class SimpleFormDialog extends StatefulWidget {
  const SimpleFormDialog({
    required this.title,
    required this.fields,
    required this.onSubmit,
    super.key,
  });

  final String title;
  final List<Widget> fields;
  final Future<void> Function() onSubmit;

  @override
  State<SimpleFormDialog> createState() => _SimpleFormDialogState();
}

class _SimpleFormDialogState extends State<SimpleFormDialog> {
  final key = GlobalKey<FormState>();
  bool saving = false;
  Object? error;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 560,
        child: Form(
          key: key,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ...widget.fields.map(
                  (field) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: field,
                  ),
                ),
                if (error != null) ErrorState(message: error.toString()),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: saving
              ? null
              : () async {
                  if (!key.currentState!.validate()) return;
                  setState(() {
                    saving = true;
                    error = null;
                  });
                  try {
                    await widget.onSubmit();
                    if (context.mounted) Navigator.pop(context, true);
                  } catch (err) {
                    setState(() {
                      saving = false;
                      error = err;
                    });
                  }
                },
          child: saving
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('提交'),
        ),
      ],
    );
  }
}

class EnvelopePanel extends StatelessWidget {
  const EnvelopePanel({required this.title, required this.envelope, super.key});

  final String title;
  final AsyncValue<HermesEnvelope> envelope;

  @override
  Widget build(BuildContext context) {
    return SectionPanel(
      title: title,
      child: envelope.when(
        loading: () => const LinearProgressIndicator(),
        error: (error, _) => ErrorState(message: error.toString()),
        data: (data) => SelectableText(
          const JsonEncoder.withIndent('  ').convert({
            'summary': data.summary,
            'scope': data.scope,
            'permissions': data.permissions,
            'trace_id': data.traceId,
          }),
        ),
      ),
    );
  }
}

class AsyncJsonList extends StatelessWidget {
  const AsyncJsonList({required this.title, required this.value, super.key});

  final String title;
  final AsyncValue<List<Map<String, dynamic>>> value;

  @override
  Widget build(BuildContext context) {
    return SectionPanel(
      title: title,
      child: value.when(
        loading: () => const LinearProgressIndicator(),
        error: (error, _) => ErrorState(message: error.toString()),
        data: (items) => SelectableText(
          const JsonEncoder.withIndent('  ').convert(items),
        ),
      ),
    );
  }
}

Future<void> createScoped(
  WidgetRef ref,
  Resource resource,
  Map<String, dynamic> data,
) async {
  final workspaceId = ref.read(workspaceSelectionProvider);
  if (workspaceId == null || workspaceId.isEmpty) {
    throw const HermesUnavailableException(
      '请先选择工作区。',
    );
  }
  await ref.read(apiProvider).create(resource, data, workspaceId: workspaceId);
}

Future<bool> showPatchDialog(
  BuildContext context,
  WidgetRef ref,
  Resource resource,
  HermesEntity entity,
) async {
  final raw = TextEditingController(
    text: const JsonEncoder.withIndent('  ').convert(entity.data),
  );
  final updated = await showDialog<bool>(
    context: context,
    builder: (context) => SimpleFormDialog(
      title: 'Patch ${entity.title}',
      fields: [
        TextFormField(
          controller: raw,
          decoration: const InputDecoration(labelText: '数据 JSON'),
          minLines: 8,
          maxLines: 12,
          validator: (value) {
            if (value == null || value.trim().isEmpty) return '必填';
            try {
              jsonDecode(value);
              return null;
            } catch (error) {
              return error.toString();
            }
          },
        ),
      ],
      onSubmit: () async {
        final workspaceId = ref.read(workspaceSelectionProvider);
        if (resource.scoped && workspaceId == null) {
          throw const HermesUnavailableException('请先选择工作区。');
        }
        await ref.read(apiProvider).patch(
              resource,
              entity,
              Map<String, dynamic>.from(jsonDecode(raw.text) as Map),
              workspaceId: resource.scoped ? workspaceId : null,
            );
      },
    ),
  );
  return updated == true;
}

String? requiredField(String? value) {
  if (value == null || value.trim().isEmpty) return '必填';
  return null;
}
