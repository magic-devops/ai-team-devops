import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:re_editor/re_editor.dart';

import '../app_providers.dart';
import '../models.dart';
import 'common.dart';
import 'labels.dart';
import 'source_editor.dart';

Future<bool> showEntityForm(
  BuildContext context,
  WidgetRef ref,
  Resource resource, {
  HermesEntity? entity,
}) async {
  return switch (resource) {
    Resource.sessions => _showSessionForm(context, ref, entity),
    Resource.tasks => _showTaskForm(context, ref, entity),
    Resource.requirements => _showRequirementForm(context, ref, entity),
    Resource.assets => _showAssetForm(context, ref, entity),
    _ => throw HermesApiException('该资源暂不支持表单编辑。'),
  };
}

Future<bool> _showSessionForm(
  BuildContext context,
  WidgetRef ref,
  HermesEntity? entity,
) async {
  final data = entity?.data ?? const <String, dynamic>{};
  final title = TextEditingController(text: _text(data['title']));
  final content = TextEditingController(text: _text(data['content']));
  final summary = TextEditingController(text: _text(data['summary']));
  var status =
      _allowedStatus(entity?.status ?? data['status'], sessionStatuses);
  final saveContext = _FormSaveContext.capture(ref, Resource.sessions);
  final saved = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setLocalState) => SimpleFormDialog(
        title: entity == null ? '新建会话' : '编辑会话',
        fields: [
          _boundedText(controller: title, label: '标题'),
          _statusField(status, sessionStatuses,
              onChanged: (value) => setLocalState(() => status = value)),
          TextFormField(
            controller: content,
            decoration: const InputDecoration(labelText: '会话目标（可选）'),
          ),
          TextFormField(
            controller: summary,
            decoration: const InputDecoration(labelText: '摘要（可选）'),
            minLines: 2,
            maxLines: 4,
          ),
        ],
        onSubmit: () => _save(saveContext, Resource.sessions, entity, {
          'title': title.text.trim(),
          'status': status,
          'content': content.text.trim(),
          'summary': summary.text.trim(),
        }),
      ),
    ),
  );
  return saved == true;
}

Future<bool> _showTaskForm(
  BuildContext context,
  WidgetRef ref,
  HermesEntity? entity,
) async {
  final data = entity?.data ?? const <String, dynamic>{};
  final title = TextEditingController(text: _text(data['title']));
  final owner = TextEditingController(text: _text(data['assigned_agent']));
  var acceptance = _text(data['acceptance_criteria']);
  final devTool = TextEditingController(text: _text(data['dev_tool']));
  final content = CodeLineEditingController.fromText(_text(data['content']));
  var status = _allowedStatus(entity?.status ?? data['status'], taskStatuses);
  var priority = _allowedStatus(
    data['priority'],
    priorityValues,
    fallback: priorityValues.first,
  );
  final saveContext = _FormSaveContext.capture(ref, Resource.tasks);
  final saved = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setLocalState) => SimpleFormDialog(
        title: entity == null ? '新建任务' : '编辑任务',
        fields: [
          _boundedText(controller: title, label: '标题'),
          _statusField(status, taskStatuses,
              onChanged: (value) => setLocalState(() => status = value)),
          _optionField(
            priority,
            priorityValues,
            priorityLabels,
            label: '优先级',
            onChanged: (value) => setLocalState(() => priority = value),
          ),
          TextFormField(
            controller: owner,
            decoration: const InputDecoration(labelText: '负责 Agent（可选）'),
          ),
          TextFormField(
            controller: devTool,
            decoration: const InputDecoration(labelText: '开发工具（可选）'),
          ),
          TextFormField(
            initialValue: acceptance,
            onChanged: (value) => acceptance = value,
            decoration: const InputDecoration(labelText: '验收条件'),
            minLines: 2,
            maxLines: 4,
            maxLength: 4000,
          ),
          SourceEditor(controller: content),
        ],
        onSubmit: () => _save(saveContext, Resource.tasks, entity, {
          'title': title.text.trim(),
          'status': status,
          'priority': priority,
          'assigned_agent': owner.text.trim(),
          'acceptance_criteria': acceptance.trim(),
          'dev_tool': devTool.text.trim(),
          'content': content.text,
        }),
      ),
    ),
  );
  return saved == true;
}

Future<bool> _showRequirementForm(
  BuildContext context,
  WidgetRef ref,
  HermesEntity? entity,
) async {
  final data = entity?.data ?? const <String, dynamic>{};
  final title = TextEditingController(text: _text(data['title']));
  final acceptance =
      TextEditingController(text: _text(data['acceptance_criteria']));
  final content = CodeLineEditingController.fromText(_text(data['content']));
  var status =
      _allowedStatus(entity?.status ?? data['status'], requirementStatuses);
  var priority = _allowedStatus(
    data['priority'],
    priorityValues,
    fallback: priorityValues.first,
  );
  final saveContext = _FormSaveContext.capture(ref, Resource.requirements);
  final saved = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setLocalState) => SimpleFormDialog(
        title: entity == null ? '新建需求' : '编辑需求',
        fields: [
          _boundedText(controller: title, label: '标题'),
          _statusField(status, requirementStatuses,
              onChanged: (value) => setLocalState(() => status = value)),
          _optionField(
            priority,
            priorityValues,
            priorityLabels,
            label: '优先级',
            onChanged: (value) => setLocalState(() => priority = value),
          ),
          TextFormField(
            controller: acceptance,
            decoration: const InputDecoration(labelText: '验收标准（可选）'),
            minLines: 2,
            maxLines: 4,
          ),
          SourceEditor(controller: content),
        ],
        onSubmit: () => _save(saveContext, Resource.requirements, entity, {
          'title': title.text.trim(),
          'status': status,
          'priority': priority,
          'acceptance_criteria': acceptance.text.trim(),
          'content': content.text,
        }),
      ),
    ),
  );
  return saved == true;
}

Future<bool> _showAssetForm(
  BuildContext context,
  WidgetRef ref,
  HermesEntity? entity,
) async {
  final data = entity?.data ?? const <String, dynamic>{};
  final name =
      TextEditingController(text: _text(data['name'] ?? data['title']));
  final source = TextEditingController(text: _text(data['source']));
  final content = CodeLineEditingController.fromText(_text(data['content']));
  var status = _allowedStatus(entity?.status ?? data['status'], assetStatuses);
  var kind = _allowedStatus(data['kind'], assetKindValues,
      fallback: assetKindValues.first);
  final saveContext = _FormSaveContext.capture(ref, Resource.assets);
  final saved = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setLocalState) => SimpleFormDialog(
        title: entity == null ? '新建资产' : '编辑资产',
        fields: [
          _boundedText(controller: name, label: '名称'),
          _statusField(status, assetStatuses,
              onChanged: (value) => setLocalState(() => status = value)),
          _optionField(
            kind,
            assetKindValues,
            assetKindLabels,
            label: '类型',
            onChanged: (value) => setLocalState(() => kind = value),
          ),
          TextFormField(
            controller: source,
            decoration: const InputDecoration(labelText: '来源（可选）'),
          ),
          SourceEditor(controller: content),
        ],
        onSubmit: () => _save(saveContext, Resource.assets, entity, {
          'name': name.text.trim(),
          'title': name.text.trim(),
          'status': status,
          'kind': kind,
          'source': source.text.trim(),
          'content': content.text,
        }),
      ),
    ),
  );
  return saved == true;
}

Future<void> _save(
  _FormSaveContext saveContext,
  Resource resource,
  HermesEntity? entity,
  Map<String, dynamic> patch,
) async {
  saveContext.guardUnchanged();
  final workspaceId = saveContext.workspaceId;
  if (resource.scoped && (workspaceId == null || workspaceId.isEmpty)) {
    throw const HermesUnavailableException('请先选择工作区。');
  }
  final api = saveContext.ref.read(apiProvider);
  if (entity == null) {
    await api.create(resource, patch, workspaceId: workspaceId);
    return;
  }
  await api.patch(
    resource,
    entity,
    {...entity.data, ...patch},
    workspaceId: resource.scoped ? workspaceId : null,
  );
}

TextFormField _boundedText({
  required TextEditingController controller,
  required String label,
}) {
  return TextFormField(
    controller: controller,
    decoration: InputDecoration(labelText: '$label（1-120 字）'),
    maxLength: 120,
    validator: boundedRequiredField,
  );
}

DropdownButtonFormField<String> _statusField(
  String status,
  List<String> values, {
  required ValueChanged<String> onChanged,
}) {
  return _optionField(
    status,
    values,
    statusLabels,
    label: '状态',
    onChanged: onChanged,
  );
}

DropdownButtonFormField<String> _optionField(
  String value,
  List<String> values,
  Map<String, String> labels, {
  required String label,
  required ValueChanged<String> onChanged,
}) {
  return DropdownButtonFormField<String>(
    initialValue: value,
    decoration: InputDecoration(labelText: label),
    items: values
        .map(
          (value) => DropdownMenuItem(
            value: value,
            child: Text(labels[value] ?? value),
          ),
        )
        .toList(),
    onChanged: (value) {
      if (value != null) onChanged(value);
    },
  );
}

String _allowedStatus(
  Object? value,
  List<String> allowed, {
  String? fallback,
}) {
  final text = value?.toString();
  return allowed.contains(text) ? text! : fallback ?? allowed.first;
}

String _text(Object? value, {String fallback = ''}) {
  final text = value?.toString() ?? '';
  return text.isEmpty ? fallback : text;
}

class _FormSaveContext {
  const _FormSaveContext({
    required this.ref,
    required this.settings,
    required this.workspaceId,
    required this.resource,
  });

  final WidgetRef ref;
  final ConnectionSettings? settings;
  final String? workspaceId;
  final Resource resource;

  factory _FormSaveContext.capture(WidgetRef ref, Resource resource) {
    return _FormSaveContext(
      ref: ref,
      settings: ref.read(settingsProvider).asData?.value,
      workspaceId: ref.read(workspaceSelectionProvider),
      resource: resource,
    );
  }

  void guardUnchanged() {
    final currentSettings = ref.read(settingsProvider).asData?.value;
    if (!_sameConnection(currentSettings, settings)) {
      throw const HermesUnavailableException('连接设置已变化，请关闭表单后重新打开。');
    }
    if (!resource.scoped) {
      return;
    }
    final current = ref.read(workspaceSelectionProvider);
    if (current != workspaceId) {
      throw const HermesUnavailableException('工作区已变化，请关闭表单后重新打开。');
    }
  }

  bool _sameConnection(ConnectionSettings? a, ConnectionSettings? b) {
    return a?.baseUrl == b?.baseUrl &&
        a?.token == b?.token &&
        a?.tokenFile == b?.tokenFile &&
        a?.localPid == b?.localPid;
  }
}
