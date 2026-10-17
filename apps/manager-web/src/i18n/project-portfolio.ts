const messages = {
  executionUnavailable: [
    "执行意图不存在或不可访问",
    "Execution intent unavailable",
    "実行意図が存在しないかアクセスできません",
  ],
  title: ["项目组合", "Project portfolio", "プロジェクト一覧"],
  hint: [
    "查看交付事实和待处理事项；查看项目不会切换当前工作区。",
    "Inspect delivery facts and outstanding work without switching your workspace.",
    "現在のワークスペースを切り替えずに、進捗と対応事項を確認できます。",
  ],
  search: [
    "搜索项目名称或 ID",
    "Search project name or ID",
    "プロジェクト名・IDで検索",
  ],
  business: ["业务线", "Business", "事業"],
  status: ["项目状态", "Project status", "状態"],
  risks: ["待处理风险", "Risks to address", "対応が必要なリスク"],
  active: ["活跃", "Active", "稼働中"],
  planning: ["规划中", "Planning", "計画中"],
  paused: ["已暂停", "Paused", "一時停止"],
  archived: ["已归档", "Archived", "アーカイブ済み"],
  inspect: ["查看项目", "Inspect project", "詳細を見る"],
  enter: ["进入项目工作台", "Enter project workspace", "ワークスペースを開く"],
  openTarget: [
    "在项目工作台查看",
    "Open in project workspace",
    "ワークスペースで確認",
  ],
  current: ["当前工作区", "Current workspace", "現在のワークスペース"],
  details: ["项目详情", "Project details", "プロジェクト詳細"],
  configure: ["编辑项目配置", "Edit project settings", "設定を編集"],
  liveFacts: ["当前有效事实", "Current delivery facts", "現在の有効な状態"],
  asOf: ["事实时间", "As of", "確認時刻"],
  verified: ["已验证完成", "Verified complete", "検証済み完了"],
  recorded: ["登记完成", "Recorded complete", "記録上の完了"],
  totalTasks: ["全部任务", "Total tasks", "全タスク"],
  unclosed: [
    "未关闭执行意图",
    "Unclosed execution intents",
    "未終了の実行意図",
  ],
  uniqueRisks: ["个对象待处理", "unique items to address", "件の対応対象"],
  overlapHint: [
    "同一对象可属于多个分类；总数已去重。",
    "An item may belong to several categories; the total counts each item once.",
    "同じ対象に複数の分類が付く場合があります。合計は重複を除きます。",
  ],
  filteredScope: [
    "统计覆盖全部符合筛选条件的项目",
    "Totals cover all matching projects",
    "集計は絞り込み条件に一致する全プロジェクトが対象です",
  ],
  empty: [
    "尚无可见项目",
    "No visible projects yet",
    "表示できるプロジェクトはありません",
  ],
  noMatches: [
    "没有符合筛选的项目",
    "No projects match these filters",
    "条件に一致するプロジェクトはありません",
  ],
  clearFilters: ["清除筛选", "Clear filters", "絞り込みを解除"],
  noRisks: [
    "当前没有这类待处理事项",
    "No outstanding items in this category",
    "この分類に対応事項はありません",
  ],
  refresh: ["刷新事实", "Refresh facts", "状態を更新"],
  refreshFailed: [
    "刷新失败，以下为上次读取的事实。",
    "Refresh failed. The last retrieved facts are shown below.",
    "更新に失敗しました。前回取得した状態を表示しています。",
  ],
  unavailableProject: [
    "项目不存在或不可访问",
    "Project unavailable or inaccessible",
    "プロジェクトが存在しないかアクセスできません",
  ],
  selectorFailed: [
    "项目列表读取失败，请刷新重试",
    "Could not load projects. Refresh to retry.",
    "一覧を取得できません。更新して再試行してください。",
  ],
  viewArchived: [
    "查看归档项目",
    "View archived projects",
    "アーカイブ済みを表示",
  ],
  archivedReadOnly: [
    "已归档，只读",
    "Archived, read only",
    "アーカイブ済み・読み取り専用",
  ],
  archivedHint: [
    "此项目已归档，可查看当前事实与历史。恢复不会授予独立运行权限。",
    "This project is archived. Current facts and history remain readable. Restoring does not grant runtime permissions.",
    "アーカイブ済みです。現在の状態と履歴を確認できます。復元しても実行権限は付与されません。",
  ],
  pausedHint: [
    "此项目当前不接受新的执行派发，已交接运行可继续收尾。",
    "New dispatch is unavailable in this state. Handed-off runs may finish their workflow.",
    "この状態では新しい実行を派遣できません。引き渡し済みの実行は終了処理を続けられます。",
  ],
  next: ["下一页", "Next page", "次のページ"],
  first: ["返回第一页", "First page", "最初のページ"],
  noMilestone: [
    "未设置有日期的里程碑",
    "No dated milestone",
    "日付のあるマイルストーンはありません",
  ],
  milestone: ["最近里程碑", "Nearest milestone", "直近のマイルストーン"],
  lifecycle: ["变更项目状态", "Change project state", "状態を変更"],
  archive: ["归档项目", "Archive project", "アーカイブ"],
  restore: ["恢复项目", "Restore project", "復元"],
  targetStatus: ["目标状态", "Target state", "変更後の状態"],
  reason: ["变更理由", "Reason for this change", "変更理由"],
  reasonRequired: [
    "请填写 1 至 2000 字的理由",
    "Enter a reason of 1 to 2,000 characters",
    "理由を1～2000文字で入力してください",
  ],
  preview: ["读取固定预览", "Read fixed preview", "固定プレビューを取得"],
  previewRequired: [
    "请先读取与当前选择一致的固定预览",
    "Read a fixed preview for the current selection first",
    "現在の選択に一致する固定プレビューを取得してください",
  ],
  confirm: [
    "确认此预览并提交",
    "Confirm this preview and submit",
    "このプレビューを確認して送信",
  ],
  previewHint: [
    "以下事实已固定。变更目标或理由后必须重新预览。",
    "These facts are fixed. A changed target or reason requires a new preview.",
    "以下は固定した状態です。対象や理由を変更した場合は再取得が必要です。",
  ],
  blockers: ["阻止项", "Blocking items", "実行できない理由"],
  warnings: ["影响提示", "Impact notes", "影響について"],
  noBlockers: [
    "当前预览未发现阻止项",
    "No blockers in this preview",
    "このプレビューにブロック事項はありません",
  ],
  conflict: [
    "项目已变更。草稿已保留，请重新读取并确认。",
    "The project changed. Your draft is retained. Read and confirm a new preview.",
    "プロジェクトが変更されました。下書きを保持しています。再取得して確認してください。",
  ],
  saveFailed: [
    "保存失败；草稿与原请求身份已保留，可重试。",
    "Save failed. Your draft and original request identity are retained for retry.",
    "保存できません。下書きと元のリクエスト識別子を保持しているため再試行できます。",
  ],
  scopeChanged: [
    "账号或项目已切换，请关闭后重新操作",
    "Account or workspace changed. Close and reopen this action.",
    "アカウントまたはプロジェクトが切り替わりました。閉じてから開き直してください。",
  ],
  noPermission: [
    "当前身份没有此操作权限",
    "Your identity cannot perform this action",
    "この操作を行う権限がありません",
  ],
  readLatest: ["重新读取", "Read latest", "再取得"],
  adopt: ["确认采用此版本", "Adopt this version", "この版を採用"],
  cancel: ["关闭", "Close", "閉じる"],
  save: ["保存配置", "Save settings", "設定を保存"],
  archiveHistory: [
    "最近归档来源（历史）",
    "Last archive record (historical)",
    "直近のアーカイブ記録（履歴）",
  ],
  noArchiveHistory: [
    "尚未记录归档来源",
    "No archive provenance was recorded",
    "アーカイブ元の記録はありません",
  ],
  historyHint: [
    "归档时点事实，仅供历史核对；上方为当前有效事实。",
    "Facts at the archive boundary, for historical reference. Current effective facts are shown above.",
    "アーカイブ時点の履歴です。現在の有効な状態は上に表示しています。",
  ],
  contextTitle: [
    "此链接属于另一个项目",
    "This link belongs to another project",
    "このリンクは別のプロジェクトに属しています",
  ],
  contextHint: [
    "明确进入该项目后再读取目标，当前工作区不会自动切换。",
    "Enter that project explicitly before loading the target. Your workspace will not switch automatically.",
    "対象を読み込む前にプロジェクトを開いてください。自動では切り替わりません。",
  ],
  back: ["返回项目组合", "Return to portfolio", "プロジェクト一覧に戻る"],
  chooseProject: [
    "请选择一个可访问项目后继续",
    "Select an accessible project to continue",
    "アクセス可能なプロジェクトを選択してください",
  ],
  name: ["项目名称", "Project name", "プロジェクト名"],
  description: ["说明", "Description", "説明"],
  path: ["项目路径", "Project path", "プロジェクトパス"],
  vector: ["向量库", "Vector database", "ベクトルDB"],
  template: ["项目模板", "Project template", "テンプレート"],
  create: ["新建项目", "Create project", "プロジェクトを作成"],
  allBusinesses: ["全部业务线", "All businesses", "すべての事業"],
  noBusiness: ["未归属业务线", "No business", "事業未指定"],
  "risk.blocked": ["阻塞", "Blocked", "ブロック中"],
  "risk.awaiting_review": ["等待验收", "Awaiting review", "承認待ち"],
  "risk.recorded_completed": [
    "登记完成待验证",
    "Recorded, not verified",
    "完了記録・未検証",
  ],
  "risk.overdue_unverified": [
    "逾期未验证",
    "Overdue, not verified",
    "期限超過・未検証",
  ],
  "risk.acceptance_unavailable": [
    "验收依据失效",
    "Acceptance unavailable",
    "受入根拠が無効",
  ],
  "risk.owner_unavailable": [
    "负责人不可用",
    "Owner unavailable",
    "担当者が利用不可",
  ],
  "risk.open_issues": ["未解决问题", "Open issues", "未解決の問題"],
  "reasons.project_diagnosis_unclosed": [
    "请先核对或取消此诊断请求，再归档项目。",
    "Review or dismiss this diagnosis request before archiving the project.",
    "プロジェクトをアーカイブする前に、この診断リクエストを確認または却下してください。",
  ],
  "reasons.project_execution_unclosed": [
    "请先验收或关闭此执行意图，再归档项目。",
    "Review or close this execution intent before archiving the project.",
    "プロジェクトをアーカイブする前に、この実行意図を確認して終了してください。",
  ],
  "reasons.project_execution_stop_unresolved": [
    "请先核实并同步执行的实际停止结果，再归档项目。",
    "Confirm and synchronize the actual execution stop before archiving the project.",
    "実行の停止結果を確認して同期してから、プロジェクトをアーカイブしてください。",
  ],
  "reasons.unfinished_tasks": [
    "仍有未完成任务。",
    "Some tasks remain unfinished.",
    "未完了のタスクがあります。",
  ],
  "reasons.unaccepted_requirements": [
    "仍有需求尚未完成验收。",
    "Some requirements have not been accepted.",
    "受入が完了していない要件があります。",
  ],
  "reasons.open_issues": [
    "仍有未解决问题。",
    "Some issues remain unresolved.",
    "未解決の問題があります。",
  ],
  "reasons.project_not_active": [
    "请先将项目设为活跃状态，再准备或派发新的执行。",
    "Activate the project before preparing or dispatching new execution.",
    "新しい実行を準備・派遣する前にプロジェクトを稼働中にしてください。",
  ],
  "reasons.project_state_unchanged": [
    "请选择与当前不同的项目状态。",
    "Choose a different project state.",
    "現在とは異なる状態を選択してください。",
  ],
  "reasons.project_lifecycle_basis_changed": [
    "项目或交付事实已变更，请重新读取固定预览。",
    "Project or delivery facts changed. Read a new fixed preview.",
    "プロジェクトまたは状態が変更されました。固定プレビューを再取得してください。",
  ],
  "reasons.project_archive_blocked": [
    "归档被未关闭的执行意图阻止，请先处理全部阻止项。",
    "Unclosed execution intents prevent archiving. Resolve every blocking item first.",
    "未終了の実行意図があるためアーカイブできません。すべて対応してください。",
  ],
} as const;
function locale(index: 0 | 1 | 2) {
  const result: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(messages)) {
    if (key.includes(".")) {
      const [group, name] = key.split(".");
      result[group] ||= {};
      (result[group] as Record<string, string>)[name] = values[index];
    } else result[key] = values[index];
  }
  return result;
}
export const projectPortfolioTranslations = {
  "zh-CN": locale(0),
  "en-US": locale(1),
  "ja-JP": locale(2),
};
