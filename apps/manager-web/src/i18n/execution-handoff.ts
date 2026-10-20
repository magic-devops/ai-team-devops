const en = {
  title: "Current delivery", loading: "Checking accepted dispatch", received: "Dispatch accepted", receivedHint: "The request is durable. A plan is prepared in the background; starting it requires separate authorization.",
  confirmDispatch: "Confirm dispatch", previewReady: "Request checked · ready to submit", refresh: "Refresh status", failed: "Handoff status unavailable", invalid: "The response could not be verified. Refresh this execution.", scopeChanged: "The account or project changed. Reopen this execution.",
  locate: "Find a pending original operation", locating: "Checking authorized task handoffs", locateFailed: "Task handoffs unavailable", pageOnly: "No pending original was found in this page. This does not cover earlier handoffs.", earlier: "Earlier operations", first: "Read the first page again", cursorChanged: "The page scope changed. Read the first page again.", locatingHint: "Only exact executions returned for this task are checked. Accepted background preparation is not an unknown browser operation.",
  preparing: "The accepted request is being prepared. You can leave this page.", retryWait: "Preparation will retry automatically using the same accepted request.", blockedHint: "Review the reason and the actual execution controls. A new dispatch must not replace this accepted request.",
  plannedHint: "A runtime plan exists. Start, tests and acceptance remain separate facts.", cancelledHint: "This handoff was closed before a runtime plan was created.", controls: "View execution controls", observed: "Updated", nextAttempt: "Next check", details: "Handoff details", attempt: "Preparation attempts", request: "Handoff", paused: "Automatic checks paused. Refresh to continue checking.",
  states: { accepted: "Accepted · preparing plan", dispatching: "Preparing plan", retry_wait: "Waiting to retry preparation", blocked: "Preparation needs attention", planned: "Plan created", cancelled: "Handoff cancelled" },
};
type Copy = typeof en;
const zh: Copy = {
  title: "当前交付", loading: "正在核对已受理派发", received: "派发已受理", receivedHint: "原请求已耐久保存，后台将准备计划；启动执行仍需另行授权。",
  confirmDispatch: "确认派发", previewReady: "请求已核对 · 待确认派发", refresh: "刷新状态", failed: "无法读取交接状态", invalid: "无法核验返回内容，请刷新本次执行。", scopeChanged: "账号或项目已切换，请重新打开本次执行。",
  locate: "定位待恢复原操作", locating: "正在核对当前授权任务交接", locateFailed: "无法读取任务交接", pageOnly: "本页未发现待恢复原操作；更早交接尚未核对。", earlier: "更早操作", first: "重新读取首屏", cursorChanged: "当前分页范围已变化，请重新读取首屏。", locatingHint: "只检查服务端返回的本任务确切执行。已受理的后台准备不等于浏览器操作结果未知。",
  preparing: "已受理，后台正在准备计划。可以离开此页。", retryWait: "系统将使用同一个已受理请求自动重试准备。", blockedHint: "请核对原因并查看实际运行控制，不能另建派发替代这次已受理请求。",
  plannedHint: "运行计划已建立；启动、测试与验收仍分别确认。", cancelledHint: "本次交接已在运行计划建立前关闭。", controls: "查看运行控制", observed: "更新时间", nextAttempt: "下次检查", details: "交接明细", attempt: "准备尝试次数", request: "交接标识", paused: "自动检查已暂停，可刷新继续核对。",
  states: { accepted: "已受理 · 等待计划", dispatching: "正在建立计划", retry_wait: "等待重试准备", blocked: "计划准备需处理", planned: "计划已建立", cancelled: "交接已取消" },
};
const ja: Copy = {
  title: "現在のデリバリー", loading: "受付済み割当を確認中", received: "実行割当を受け付けました", receivedHint: "元の要求は永続保存されました。計画はバックグラウンドで準備され、開始には別の承認が必要です。",
  confirmDispatch: "実行割当を確定", previewReady: "要求を確認済み · 割当確定待ち", refresh: "状態を更新", failed: "引継ぎ状態を取得できません", invalid: "応答を検証できません。この実行を更新してください。", scopeChanged: "アカウントまたはプロジェクトが変わりました。この実行を開き直してください。",
  locate: "未確認の元操作を探す", locating: "現在参照できるタスク引継ぎを確認中", locateFailed: "タスク引継ぎを取得できません", pageOnly: "このページに未確認の元操作はありません。以前の引継ぎは未確認です。", earlier: "以前の操作", first: "最初のページを再取得", cursorChanged: "ページの範囲が変わりました。最初から再取得してください。", locatingHint: "サーバーがこのタスクに返した正確な実行だけを確認します。受付済みの準備待ちはブラウザー操作の結果不明とは別です。",
  preparing: "受付済みの計画を準備中です。この画面を離れても構いません。", retryWait: "同じ受付済み要求で準備を自動再試行します。", blockedHint: "理由と実際の実行制御を確認してください。別の割当でこの要求を置き換えることはできません。",
  plannedHint: "実行計画が作成されました。開始・テスト・受入はそれぞれ確認が必要です。", cancelledHint: "実行計画を作成する前に、この引継ぎは終了しました。", controls: "実行制御を確認", observed: "更新日時", nextAttempt: "次の確認", details: "引継ぎの詳細", attempt: "準備の試行回数", request: "引継ぎ識別子", paused: "自動確認を停止しました。更新して確認を続けられます。",
  states: { accepted: "受付済み・計画待ち", dispatching: "計画を準備中", retry_wait: "準備の再試行待ち", blocked: "計画準備の対応が必要", planned: "計画作成済み", cancelled: "引継ぎ取消済み" },
};
export function executionHandoffCopy(language: string): Copy { return language.startsWith("zh") ? zh : language.startsWith("ja") ? ja : en; }
