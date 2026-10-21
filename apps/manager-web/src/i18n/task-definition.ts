const en = {
  retryRecovery: "Read recovery records again", currentDefinition: "Current task definition", currentVersion: "Current version", edit: "Edit task", title: "Task title", description: "Description", criteria: "Task acceptance criteria", requirementCriteria: "Requirement acceptance links", dependencies: "Predecessor tasks", starts: "Start date", ends: "End date", blocker: "Recorded blocker",
  save: "Save task", cancel: "Close draft", loading: "Reading the exact task definition", readFailed: "Task definition unavailable", retry: "Read current definition", source: "Discussion source retained", sourceInvalid: "The discussion source changed or is unavailable. No new edit was submitted.",
  invalidRoute: "This editing link does not match the current task or project.", invalidInput: "Check the title, criteria, references and dates before saving.", changed: "The task basis changed. Your values are retained; review the current definition before adopting it.", adopt: "Use this basis and keep my values", relink: "Earlier requirement links need to be selected again because their original text is unavailable.",
  recovery: "Task change needs confirmation", recoveryHint: "The original request is retained in this authorized browser session. Recover that same request before making another change.", replay: "Recover same request", confirmed: "Task saved; local confirmation remains", finish: "Finish local confirmation", refused: "Task change was refused", discard: "Close refused request", original: "Original request", originalFields: "Submitted task fields", version: "Submitted version", unavailable: "The retained original is unavailable or invalid. Restore access to this browser session's storage before continuing.",
  stageLocked: "Reopen this requirement before changing its task definition.", saved: "Task saved", refreshFailed: "The task was saved. Refreshing its current facts failed; refresh without submitting again.", required: "A task title is required.", owner: "Responsible member", status: "Recorded status", trace: "Request details",
};
type Copy = typeof en;
const zh: Copy = {
  retryRecovery: "重新读取恢复记录", currentDefinition: "当前任务定义", currentVersion: "当前版本", edit: "编辑任务", title: "任务标题", description: "任务说明", criteria: "任务验收条件", requirementCriteria: "关联需求验收条件", dependencies: "前置任务", starts: "开始日期", ends: "结束日期", blocker: "记录的阻塞原因",
  save: "保存任务", cancel: "关闭草稿", loading: "正在读取任务的精确定义", readFailed: "任务定义暂不可用", retry: "读取当前定义", source: "已保留讨论来源引用", sourceInvalid: "讨论来源已变化或暂不可用，尚未提交新的任务修改。",
  invalidRoute: "编辑链接与当前任务或项目不一致。", invalidInput: "请检查任务标题、验收条件、关联和日期后再保存。", changed: "任务依据已变化，填写内容已保留，请核对当前定义后明确采用。", adopt: "采用此依据并保留填写内容", relink: "原需求验收文字不可用，请重新选择需求验收关联，避免按旧位置误关联。",
  recovery: "任务修改结果待确认", recoveryHint: "原请求已保留在当前授权的浏览器会话中，请先恢复同一请求，再进行其他修改。", replay: "恢复同一请求", confirmed: "任务已保存，尚需完成本地确认", finish: "完成本地确认", refused: "任务修改被拒绝", discard: "关闭已拒绝请求", original: "原请求", originalFields: "提交的任务字段", version: "提交时版本", unavailable: "无法读取或校验保留的原请求，请先恢复当前浏览器会话的存储访问。",
  stageLocked: "请先重新打开需求，再修改其任务定义。", saved: "任务已保存", refreshFailed: "任务已保存，但当前事实刷新未完成。请刷新事实，无需再次提交。", required: "请填写任务标题。", owner: "责任成员", status: "记录状态", trace: "请求明细",
};
const ja: Copy = {
  retryRecovery: "復旧記録を再取得", currentDefinition: "現在のタスク定義", currentVersion: "現在の版", edit: "タスクを編集", title: "タスク名", description: "説明", criteria: "タスクの受入条件", requirementCriteria: "要件の受入条件との関連", dependencies: "前提タスク", starts: "開始日", ends: "終了日", blocker: "記録した阻害要因",
  save: "タスクを保存", cancel: "下書きを閉じる", loading: "正確なタスク定義を取得中", readFailed: "タスク定義を取得できません", retry: "現在の定義を取得", source: "議論の出典を保持しています", sourceInvalid: "議論の出典が変わったか取得できません。新しい変更は送信していません。",
  invalidRoute: "編集リンクが現在のタスクまたはプロジェクトと一致しません。", invalidInput: "タスク名、条件、関連、日付を確認してください。", changed: "タスクの根拠が変わりました。入力を保持しています。最新の定義を確認して採用してください。", adopt: "この根拠を採用して入力を保持", relink: "以前の要件条件の本文を確認できません。位置による誤関連を防ぐため、関連条件を選び直してください。",
  recovery: "タスク変更の結果を確認してください", recoveryHint: "元の要求を現在の認証済みブラウザーセッションに保持しています。別の変更を行う前に同じ要求を復旧してください。", replay: "同じ要求で復旧", confirmed: "タスク保存済み・ローカル確認が必要", finish: "ローカル確認を完了", refused: "タスクの変更が拒否されました", discard: "拒否された要求を閉じる", original: "元の要求", originalFields: "送信したタスク項目", version: "送信時の版", unavailable: "保存した元の要求を取得または検証できません。現在のブラウザーセッションの保存領域を復旧してください。",
  stageLocked: "タスク定義を変更する前に要件を再開してください。", saved: "タスクを保存しました", refreshFailed: "タスクは保存済みですが現在の情報を更新できません。再送信せず更新してください。", required: "タスク名を入力してください。", owner: "責任メンバー", status: "記録した状態", trace: "要求の詳細",
};
export function taskDefinitionCopy(language?: string) { return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en; }
