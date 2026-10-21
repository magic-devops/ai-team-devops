const en = {
  recentBeforeControl: "Check recent requests before starting, retrying or approving another action.", targetState: "Original request state", acceptedAt: "Accepted at",
  history: "Accepted requests", back: "Recent requests", claimedHint: "An executor has claimed this launch. Process start and output are separate evidence.", launchStates: { ready: "Launch waiting to be claimed", claimed: "Executor claimed launch", revoked: "Unclaimed launch revoked" },
  title: "Execution request", loading: "Checking accepted control requests", accepted: "Request accepted", acceptedHint: "The request is durable. Processing and actual execution are checked separately. You can leave this page.",
  unavailable: "Control request status unavailable", unknownAccepted: "Acceptance is confirmed. Its latest processing state could not be read.", invalid: "This response could not be verified. Refresh the exact request.", scopeChanged: "The account or project changed. Reopen this execution.", refresh: "Refresh status", earlier: "Earlier requests", first: "Read the first page again", cursorChanged: "The page scope changed. Read the first page again.", paused: "Automatic checks paused. Refresh to continue.",
  appliedHint: "The control was applied. Check the actual run, attempt and stop evidence below.", closeHint: "This closes an accepted request only if no effect was applied. It does not stop an actual run or undo effects.", closedHint: "The original request was closed before an effect was applied.", reviewHint: "Check the actual run and stop evidence. Request a stop only if it is still running.", awaitingHint: "The exact execution handoff is pending. This does not prove that a process has started.",
  close: "Close unapplied request", closeTitle: "Close the accepted request", reason: "Reason for closing", reviewClose: "Check closure", confirmClose: "Confirm closure request", target: "Original request", details: "Request details", action: "Action", updated: "Updated", attempt: "Processing attempts", digest: "Original request digest", fixedVersion: "Checked project version", knownHistorical: "The original operation receipt is confirmed. Finish local cleanup; no control command will be sent.",
  actions: { "execution.start": "Start", "execution.retry": "Retry run", "execution.cancel": "Request stop", "execution.approval": "Approval decision", "execution.control.close": "Close unapplied request" },
  states: { accepted: "Accepted · waiting to process", applying: "Applying control", retry_wait: "Waiting to retry processing", blocked: "Processing needs attention", awaiting_executor: "Waiting for executor handoff", applied: "Control applied", closed: "Original request closed" },
};
type Copy = typeof en;
const zh: Copy = {
  recentBeforeControl: "启动、重试或审批新操作前，请先核对最近请求。", targetState: "原请求状态", acceptedAt: "受理时间",
  history: "已受理请求记录", back: "返回最近请求", claimedHint: "执行器已领取本次启动资格；进程是否启动、是否有输出，仍需查看实际凭证。", launchStates: { ready: "启动等待领取", claimed: "执行器已领取", revoked: "未领取启动已撤销" },
  title: "执行控制请求", loading: "正在核对已受理控制请求", accepted: "请求已受理", acceptedHint: "原请求已耐久保存，后台处理与实际执行分别核对。可以离开此页。",
  unavailable: "无法读取控制请求状态", unknownAccepted: "受理回执已确认，暂时无法读取最新处理状态。", invalid: "无法核验返回内容，请刷新本次确切请求。", scopeChanged: "账号或项目已切换，请重新打开本次执行。", refresh: "刷新状态", earlier: "更早请求", first: "重新读取首屏", cursorChanged: "当前分页范围已变化，请重新读取首屏。", paused: "自动检查已暂停，可刷新继续核对。",
  appliedHint: "控制指令已应用，请继续核对下方真实运行、批次与停止凭证。", closeHint: "仅在原请求尚未产生效果时关闭受理请求；不会停止真实运行或撤销已有副作用。", closedHint: "原请求已在产生效果前关闭。", reviewHint: "请核对实际运行与停止凭证；如仍在运行，再明确请求停止。", awaitingHint: "正在等待准确执行交接；这不代表进程已经启动。",
  close: "关闭未生效请求", closeTitle: "关闭已受理请求", reason: "关闭原因", reviewClose: "核对关闭请求", confirmClose: "确认提交关闭", target: "原控制请求", details: "原请求明细", action: "操作", updated: "更新时间", attempt: "处理尝试次数", digest: "原请求摘要", fixedVersion: "已核对项目版本", knownHistorical: "原操作回执已确认。仅完成本地清理，不再发送控制命令。",
  actions: { "execution.start": "启动", "execution.retry": "重试运行", "execution.cancel": "请求停止", "execution.approval": "审批决定", "execution.control.close": "关闭未生效请求" },
  states: { accepted: "已受理 · 等待处理", applying: "正在应用控制", retry_wait: "等待重试处理", blocked: "处理需要关注", awaiting_executor: "等待执行器交接", applied: "控制已应用", closed: "原请求已关闭" },
};
const ja: Copy = {
  recentBeforeControl: "新しい開始・再試行・承認の前に、最近の要求を確認してください。", targetState: "元の要求の状態", acceptedAt: "受付日時",
  history: "受付済み要求の履歴", back: "最近の要求に戻る", claimedHint: "実行器がこの起動を取得しました。プロセスの開始と出力は別の証拠で確認します。", launchStates: { ready: "起動の取得待ち", claimed: "実行器が起動を取得", revoked: "未取得の起動を無効化" },
  title: "実行制御の要求", loading: "受付済みの制御要求を確認中", accepted: "要求を受け付けました", acceptedHint: "要求は永続保存されました。処理と実際の実行は別々に確認します。この画面を離れても構いません。",
  unavailable: "制御要求の状態を取得できません", unknownAccepted: "受付は確認済みです。最新の処理状態を取得できません。", invalid: "応答を検証できません。この要求を更新してください。", scopeChanged: "アカウントまたはプロジェクトが変わりました。この実行を開き直してください。", refresh: "状態を更新", earlier: "以前の要求", first: "最初のページを再取得", cursorChanged: "ページ範囲が変わりました。最初から再取得してください。", paused: "自動確認を停止しました。更新して続行できます。",
  appliedHint: "制御を適用しました。実際の実行・試行・停止証拠を確認してください。", closeHint: "効果がまだない場合だけ受付済み要求を閉じます。実際の実行停止や副作用の取消ではありません。", closedHint: "効果が生じる前に元の要求を閉じました。", reviewHint: "実際の実行と停止証拠を確認してください。まだ実行中の場合に限り、停止を明示的に要求してください。", awaitingHint: "正確な実行引継ぎを待機中です。プロセスの開始を示すものではありません。",
  close: "未適用の要求を閉じる", closeTitle: "受付済み要求を閉じる", reason: "閉じる理由", reviewClose: "閉じる要求を確認", confirmClose: "閉じる要求を送信", target: "元の制御要求", details: "元の要求の詳細", action: "操作", updated: "更新日時", attempt: "処理の試行回数", digest: "元の要求のダイジェスト", fixedVersion: "確認済みプロジェクト版", knownHistorical: "元の操作の受領を確認しました。ローカル情報だけを整理し、制御命令は送信しません。",
  actions: { "execution.start": "開始", "execution.retry": "実行を再試行", "execution.cancel": "停止を要求", "execution.approval": "承認の判断", "execution.control.close": "未適用の要求を閉じる" },
  states: { accepted: "受付済み・処理待ち", applying: "制御を適用中", retry_wait: "処理の再試行待ち", blocked: "処理への対応が必要", awaiting_executor: "実行器への引継ぎ待ち", applied: "制御を適用済み", closed: "元の要求を終了済み" },
};
export function executionControlOperationsCopy(language = "en"): Copy { return language.startsWith("zh") ? zh : language.startsWith("ja") ? ja : en; }
