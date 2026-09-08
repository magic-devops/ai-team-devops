const taskStatuses = [
  'active',
  'in_progress',
  'blocked',
  'completed',
  'archived'
];
const requirementStatuses = [
  'active',
  'draft',
  'ready',
  'completed',
  'archived'
];
const sessionStatuses = ['active', 'paused', 'completed', 'archived'];
const assetStatuses = ['active', 'archived'];
const priorityValues = ['medium', 'high', 'low', 'urgent'];
const assetKindValues = [
  'memory',
  'knowledge',
  'data_source',
  'prompt',
  'document'
];

const statusLabels = {
  'active': '活跃',
  'in_progress': '进行中',
  'blocked': '阻塞',
  'completed': '已完成',
  'archived': '已归档',
  'draft': '草稿',
  'ready': '就绪',
  'paused': '已暂停',
};

const priorityLabels = {
  'medium': '中',
  'high': '高',
  'low': '低',
  'urgent': '紧急',
};

const assetKindLabels = {
  'memory': '记忆',
  'knowledge': '知识',
  'data_source': '数据源',
  'prompt': '提示词',
  'document': '文档',
};

String hermesStatusLabel(Object? value) {
  final text = value?.toString() ?? '';
  return statusLabels[text] ?? text;
}

String hermesPriorityLabel(Object? value) {
  final text = value?.toString() ?? '';
  return priorityLabels[text] ?? text;
}

String hermesAssetKindLabel(Object? value) {
  final text = value?.toString() ?? '';
  return assetKindLabels[text] ?? text;
}
