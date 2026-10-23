const en = {
  title: "Task workspace", navigation: "Go to task area", record: "Recorded status", effective: "Effective delivery", unknown: "Not available",
  next: "View the next handling area", complete: "Accepted against the current criteria", unverified: "Recorded completion still needs current acceptance evidence.",
  unavailable: "Current task facts are unavailable. Saved operations and their recovery areas remain below.",
  frozen: "Fixed task snapshot from when editing started. Refresh after resolving the draft or saved operation to confirm the current state.", snapshotEffective: "Snapshot delivery status",
  sections: { overview: "Task", execution: "Platform execution", "work-order": "External work", design: "Design", delivery: "Delivery & review", planning: "Plan & dependencies", discussion: "Discussion" },
};
type Copy = typeof en;
const zh: Copy = {
  title: "任务工作区", navigation: "定位任务区域", record: "记录状态", effective: "有效交付状态", unknown: "暂不可用",
  next: "查看下一步处理区域", complete: "已按当前条件验收", unverified: "记录完成仍需核对当前有效验收证据。",
  unavailable: "当前任务事实暂不可用，已保存操作及其恢复入口仍保留在下方。",
  frozen: "正在查看编辑开始时的固定任务快照。处理完草稿或已保存操作后，刷新核对当前状态。", snapshotEffective: "快照交付状态",
  sections: { overview: "任务", execution: "平台执行", "work-order": "外部工单", design: "设计依据", delivery: "交付验收", planning: "计划依赖", discussion: "讨论" },
};
const ja: Copy = {
  title: "タスク作業領域", navigation: "タスクの領域へ移動", record: "記録上の状態", effective: "有効な成果の状態", unknown: "取得できません",
  next: "次の対応領域を確認", complete: "現在の条件に基づき受入済み", unverified: "記録上の完了には、現在有効な受入証拠の確認が必要です。",
  unavailable: "現在のタスク情報を取得できません。保存した操作と復旧入口は下に残っています。",
  frozen: "編集開始時の固定タスク情報です。下書きまたは保存した操作を解決してから更新し、現在の状態を確認してください。", snapshotEffective: "固定情報の成果状態",
  sections: { overview: "タスク", execution: "プラットフォーム実行", "work-order": "外部作業", design: "設計", delivery: "成果とレビュー", planning: "計画と依存関係", discussion: "議論" },
};
export function taskDetailNavigationCopy(language?: string) { return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en; }
