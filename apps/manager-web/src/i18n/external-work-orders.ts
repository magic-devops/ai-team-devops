import { taskSubmissionReason } from "./task-submission";

const words = {
  title: ["外部协作工单", "External work orders", "外部作業依頼"],
  description: ["从现有任务派发固定工作包，跟踪接单与报告，并回到任务验收。", "Dispatch a fixed work packet for an existing task, track the claim and report, then review delivery on the task.", "既存タスクの固定作業パケットを依頼し、受領と報告を追跡してタスクの受入確認へ進みます。"],
  task: ["关联任务", "Task", "関連タスク"],
  owner: ["任务负责人", "Task owner", "タスク責任者"],
  requirement: ["需求依据", "Requirement basis", "要件の根拠"],
  dependencies: ["依赖依据", "Dependency basis", "依存関係の根拠"],
  deliveryReview: ["交付验收", "Delivery review", "成果の受入確認"],
  chooseTask: ["选择已有任务", "Choose an existing task", "既存タスクを選択"],
  taskSearch: ["搜索任务名称或编号", "Search task title or ID", "タスク名または ID で検索"],
  noTask: ["当前没有可选择的任务", "No tasks are available", "選択できるタスクがありません"],
  openTask: ["打开任务", "Open task", "タスクを開く"],
  next: ["下一页", "Next page", "次のページ"],
  first: ["回到首页", "First page", "最初のページ"],
  refresh: ["刷新状态", "Refresh status", "状態を更新"],
  loading: ["正在读取当前事实…", "Reading current facts…", "現在の情報を読み込んでいます…"],
  readFailed: ["当前状态读取失败", "Current state could not be read", "現在の状態を読み込めませんでした"],
  readOnly: ["当前账号仅可查看工单。", "This account can view work orders only.", "このアカウントでは作業依頼の閲覧のみ可能です。"],
  scopeChanged: ["账号或项目已切换，请在当前项目重新打开。", "The account or project changed. Reopen this view in the current project.", "アカウントまたはプロジェクトが変更されました。現在のプロジェクトで開き直してください。"],
  responseInvalid: ["返回的数据与当前工单不一致，请重新读取。", "The response does not match this work order. Read it again.", "返された情報がこの作業依頼と一致しません。再読み込みしてください。"],
  empty: ["还没有外部协作工单", "No external work orders yet", "外部作業依頼はまだありません"],
  emptyHint: ["选择已有任务和正式团队成员或工具，确认工作包后派发。", "Choose an existing task and a formal team agent or tool, then confirm its work packet.", "既存タスクと正式なチームのエージェントまたはツールを選び、作業パケットを確認してください。"],
  create: ["派发工单", "Dispatch work order", "作業を依頼"],
  prepare: ["核对操作依据", "Review action basis", "操作の根拠を確認"],
  member: ["执行成员或工具", "Agent or tool", "エージェントまたはツール"],
  chooseMember: ["选择正式团队中的智能体或工具", "Choose an agent or tool from the formal team", "正式なチームのエージェントまたはツールを選択"],
  noMembers: ["尚无可用的团队智能体或工具", "No eligible team agent or tool is available", "利用可能なチームのエージェントまたはツールがありません"],
  manageTeam: ["配置团队成员", "Configure team members", "チームメンバーを設定"],
  instruction: ["本次协作说明", "Instructions for this work order", "今回の作業指示"],
  instructionHint: ["任务目标、验收标准和已采用设计会自动固定；这里只填写额外协作要求。", "The task goal, acceptance criteria and adopted designs are fixed automatically. Add only the extra instructions here.", "タスクの目標、受入基準、採用済み設計は自動的に固定されます。追加指示のみ入力してください。"],
  packet: ["固定工作包", "Fixed work packet", "固定作業パケット"],
  packetHint: ["导出的是本次派发依据，不能代表工具已经运行或测试已经通过。", "This export records the dispatch basis. It does not establish that a tool ran or tests passed.", "このエクスポートは依頼の根拠です。ツールの実行やテストの合格を示すものではありません。"],
  download: ["下载工作包原件", "Download original work packet", "元の作業パケットをダウンロード"],
  details: ["原件与技术明细", "Original and technical details", "原本と技術情報"],
  basis: ["固定依据", "Fixed basis", "固定した根拠"],
  created: ["派发时间", "Dispatched at", "依頼日時"],
  by: ["派发人", "Dispatched by", "依頼者"],
  claimedBy: ["接单人", "Claimed by", "受領者"],
  claimedAt: ["接单时间", "Claimed at", "受領日時"],
  progress: ["报告进度", "Reported progress", "報告された進捗"],
  noProgress: ["尚未报告进度", "No progress reported", "進捗はまだ報告されていません"],
  percentUnknown: ["百分比未知", "Percentage unknown", "進捗率は不明"],
  directoryHint: ["工单状态、执行方回报和人工验收分别记录；报告进度不代表验收通过。", "Work-order state, reported progress and human acceptance are recorded separately. Reported progress does not establish acceptance.", "作業依頼の状態、実行担当者の進捗報告、人による受入確認は別々に記録されます。進捗報告は受入完了を意味しません。"],
  observed: ["最近报告", "Last reported", "最終報告"],
  queuedHint: ["工单已派发，等待项目授权账号接单；此时尚未确认执行。", "The work order is queued for an authorized project account to claim. Execution has not been confirmed.", "作業依頼は承認済みプロジェクトアカウントによる受領待ちです。実行はまだ確認されていません。"],
  claim: ["由当前账号接单", "Claim with this account", "現在のアカウントで受領"],
  claimHint: ["接单会记录当前账号。之后由接单人报告真实进度和交付结果。", "Claiming records this account. The claimant then reports actual progress and delivery.", "受領すると現在のアカウントが記録されます。その受領者が実際の進捗と成果を報告します。"],
  updateProgress: ["报告当前进度", "Report current progress", "現在の進捗を報告"],
  progressHint: ["填写实际观测到的进度和说明；进度不等于验收通过。", "Report the progress you observed and its context. Progress does not establish acceptance.", "実際に確認した進捗と説明を入力してください。進捗は受入完了を意味しません。"],
  progressMessage: ["进展与当前阻碍", "Progress and current blockers", "進捗と現在の障害"],
  writeReport: ["填写任务交付报告", "Write task delivery report", "タスクの成果報告を作成"],
  reportHint: ["在关联任务中提交真实原文、逐项证据和测试报告，再将该固定报告关联到工单。", "Submit the actual delivery text, criterion evidence and test reports on the task, then link that fixed report to this work order.", "関連タスクで実際の報告本文、基準ごとの証拠、テスト報告を提出し、その固定報告をこの作業依頼に関連付けてください。"],
  linkReport: ["关联固定交付报告", "Link fixed delivery report", "固定された成果報告を関連付け"],
  chooseReport: ["选择当前任务的固定报告", "Choose a fixed report for this task", "このタスクの固定報告を選択"],
  reportedHint: ["已关联交付报告，等待任务中的人工验收。报告中的测试结果仍是报告方声明。", "The delivery report is linked for human review on the task. Test results remain claims from the report author.", "成果報告が関連付けられ、タスクでの人による受入確認待ちです。テスト結果は報告者の申告です。"],
  openReport: ["打开固定报告与验收", "Open fixed report and review", "固定報告と受入確認を開く"],
  openChanges: ["查看退回意见", "Review requested changes", "修正依頼の内容を確認"],
  openAcceptanceRecord: ["查看验收记录", "View acceptance record", "受入確認の記録を表示"],
  reviewStopAttestation: ["核对停止声明", "Review stop attestation", "停止申告を確認"],
  openBlockedOrder: ["处理受阻工单", "Open blocked work order", "作業が停止中の依頼を開く"],
  openOrder: ["打开工单", "Open work order", "作業依頼を開く"],
  cancelOrder: ["取消工单", "Cancel work order", "作業依頼を取り消す"],
  cancelQueuedHint: ["确认后将取消这张尚未被领取的工单。", "Confirm to cancel this unclaimed work order.", "確定すると、まだ受領されていない作業依頼を取り消します。"],
  cancelHint: ["取消只终止这张协作工单。请另外核对外部工具是否仍在运行。", "Cancellation closes this work order. Separately check whether the external tool is still running.", "取り消しはこの作業依頼を終了します。外部ツールが引き続き実行中かは別途確認してください。"],
  cancelRequestedHint: ["已请求取消，外部工作尚未确认停止。请由接单人核对并提交停止声明。", "Cancellation was requested. External work has not been confirmed stopped. The claimant must check and attest the stop.", "取り消しが要求されました。外部作業の停止は未確認です。受領者が確認して停止を申告してください。"],
  release: ["声明外部工作已停止", "Attest external work stopped", "外部作業の停止を申告"],
  stopConfirm: ["我已确认外部工作停止，不会继续修改本任务。", "I confirm the external work stopped and will no longer modify this task.", "外部作業が停止し、このタスクを引き続き変更しないことを確認しました。"],
  reportStopConfirm: ["外部工作已停止，关联此固定交付报告。", "External work has stopped. Link this fixed delivery report.", "外部作業は停止しました。この固定成果報告を関連付けます。"],
  stopReported: ["接单人已声明外部工作停止", "The claimant attested external work stopped", "受領者が外部作業の停止を申告済み"],
  neverClaimed: ["未被领取，工单已取消", "Cancelled before being claimed", "受領前に取り消し済み"],
  stoppedHint: ["这是接单人的停止声明，平台未独立验证外部进程。", "This is the claimant's stop attestation. The platform has not independently verified the external process.", "これは受領者による停止申告です。プラットフォームは外部プロセスを独立に検証していません。"],
  percentKnown: ["已观测到明确进度百分比", "A specific progress percentage was observed", "具体的な進捗率を確認済み"],
  runningProgress: ["执行中（自报）", "Running (reported)", "実行中（申告）"],
  blockedProgress: ["受阻（自报）", "Blocked (reported)", "作業停止中（申告）"],
  noReports: ["暂无可关联的固定交付报告", "No fixed delivery report is available to link", "関連付けできる固定成果報告がありません"],
  unavailable: ["当前不可操作", "Unavailable for this action", "現在この操作はできません"],
  reason: ["原因与说明", "Reason and context", "理由と説明"],
  confirm: ["确认提交", "Confirm", "確定"],
  close: ["关闭", "Close", "閉じる"],
  back: ["返回工单列表", "Back to work orders", "作業依頼一覧へ戻る"],
  backToPortfolio: ["返回项目组合", "Back to project portfolio", "プロジェクト一覧へ戻る"],
  pendingNavigation: ["请先关闭当前草稿再离开；提交结果尚未确认时，请先恢复原请求。", "Close the current draft before leaving. If a submitted request is unconfirmed, recover the original request first.", "画面を離れる前に現在の下書きを閉じてください。送信結果が未確認の場合は、先に元のリクエストを復元してください。"],
  edit: ["返回修改", "Edit", "編集に戻る"],
  fixed: ["已固定本次请求，确认后提交同一原件。", "This request is fixed. Confirmation submits this exact original.", "今回のリクエストは固定済みです。確定するとこの原本が送信されます。"],
  changed: ["依据已变化，请读取最新内容并重新确认。", "The basis changed. Read the latest facts and confirm again.", "根拠が変更されました。最新情報を読み込んで再確認してください。"],
  readLatest: ["读取最新依据", "Read latest basis", "最新の根拠を読み込む"],
  recover: ["恢复原请求", "Recover original request", "元のリクエストを復元"],
  unknown: ["请求结果尚未确认", "Request outcome is not confirmed", "リクエストの結果は未確認です"],
  unknownHint: ["保留的原请求可以安全恢复。请勿另建同一操作；读取失败不会阻止恢复。", "Recover the retained original request. Do not create a second operation; a failed read does not prevent recovery.", "保存された元のリクエストを復元してください。同じ操作を新しく作らないでください。読み込みの失敗は復元を妨げません。"],
  sending: ["正在提交原请求…", "Submitting original request…", "元のリクエストを送信しています…"],
  confirmed: ["操作已确认", "Operation confirmed", "操作を確認しました"],
  cleanup: ["清理已确认回执", "Clear confirmed receipt", "確認済み受領記録を整理"],
  refused: ["本次操作未被接受", "This operation was not accepted", "今回の操作は受け付けられませんでした"],
  recoveryUnavailable: ["无法读取或保存原请求。请保留当前页面并核对浏览器存储权限。", "The original request could not be read or saved. Keep this page open and check browser storage access.", "元のリクエストを読み込みまたは保存できません。ページを開いたままブラウザーの保存権限を確認してください。"],
  nextAction: ["下一步", "Next step", "次の操作"],
  history: ["工单记录", "Work orders", "作業依頼の記録"],
  order: ["工单", "Work order", "作業依頼"],
  status: ["状态", "Status", "状態"],
  all: ["全部状态", "All states", "すべての状態"],
  issue: ["查看问题与回流", "Open issue and follow-up", "問題と対応を開く"],
  agentOps: ["查看原生执行诊断", "Open native execution diagnostics", "ネイティブ実行の診断を開く"],
  reportedOnly: ["外部报告 · 待人工验收", "External report · human review required", "外部報告・人による受入確認が必要"],
  retired: ["此入口统一使用正式任务工单；成员配置请前往项目团队。", "Use formal task work orders here. Configure members in the project team.", "ここでは正式なタスク作業依頼を使用します。メンバーはプロジェクトのチームで設定してください。"],
} as const;

const stateWords = {
  queued: ["等待接单", "Awaiting claim", "受領待ち"],
  claimed: ["已接单", "Claimed", "受領済み"],
  cancel_requested: ["已请求取消 · 等待停止声明", "Cancellation requested · awaiting stop attestation", "取り消し要求済み・停止申告待ち"],
  reported: ["已交付报告", "Report delivered", "成果報告済み"],
  closed: ["已关闭", "Closed", "終了済み"],
  stale: ["依据已失效", "Basis is stale", "根拠が無効"],
  unknown: ["未知", "Unknown", "不明"],
} as const;
const deliveryWords = {
  awaiting_review: ["等待人工验收", "Awaiting human review", "人による受入確認待ち"],
  accepted: ["人工验收已通过", "Accepted by human review", "人による受入確認済み"],
  changes_requested: ["已退回修改", "Changes requested", "修正依頼済み"],
  invalidated: ["验收依据已失效", "Acceptance basis invalidated", "受入確認の根拠が無効"],
} as const;
const reasonWords = {
  external_work_order_active: ["当前任务已有外部工单，请先处理该工单的报告或停止声明。", "This task already has external work. Resolve its report or stop attestation first.", "このタスクには外部作業依頼があります。報告または停止申告を先に処理してください。"],
  work_order_executor_unavailable: ["请选择一个已启用且可用的团队智能体或工具。", "Choose an active, available team agent or tool.", "有効で利用可能なチームのエージェントまたはツールを選択してください。"],
  work_order_executor_inactive: ["请先在项目团队中启用此成员或工具。", "Enable this member or tool in the project team first.", "プロジェクトのチームでこのメンバーまたはツールを先に有効にしてください。"],
  work_order_executor_ambiguous: ["团队中存在重复的执行成员标识，请先修正。", "The executor identity is duplicated in the team. Correct it first.", "チーム内で実行担当の識別子が重複しています。先に修正してください。"],
  work_order_submission_pending: ["请先审核或处理当前未决的交付报告，再派发新的工单。", "Resolve the current pending delivery report before dispatching new work.", "現在保留中の成果報告を処理してから、新しい作業を依頼してください。"],
  work_order_packet_budget: ["完整工作包超过大小限制，请缩小任务或设计范围；原文未被截断。", "The complete packet exceeds its size budget. Narrow the task or designs; the original was not truncated.", "完全な作業パケットが容量制限を超えています。タスクまたは設計の範囲を絞ってください。原文は切り詰めていません。"],
  work_order_source_budget: ["完整资源目录暂不可读取，请先恢复目录或缩小范围。", "The complete resource catalogue is unavailable. Restore it or narrow the scope.", "完全なリソース一覧を読み込めません。復旧するか範囲を絞ってください。"],
  work_order_source_invalid: ["团队或仓库资料不符合派发要求，请先修正来源资料。", "Team or repository records do not meet dispatch requirements. Correct the source records first.", "チームまたはリポジトリの情報が作業依頼の要件を満たしていません。先に元の情報を修正してください。"],
  work_order_task_changed: ["任务依据已变化，请重新读取并确认工作包。", "The task basis changed. Read and confirm the work packet again.", "タスクの根拠が変更されました。作業パケットを読み直して確認してください。"],
  work_order_preview_changed: ["工作包或原生执行边界已变化，请重新预览。", "The packet or native execution boundary changed. Preview again.", "作業パケットまたはネイティブ実行の境界が変更されました。再度プレビューしてください。"],
  work_order_revision_changed: ["工单已被更新，请读取最新状态再确认操作。", "The work order changed. Read its latest state before confirming.", "作業依頼が更新されました。最新状態を読み込んでから操作を確認してください。"],
  work_order_catalogue_changed: ["项目或工单已变化，请刷新当前列表。", "The project or work orders changed. Refresh this list.", "プロジェクトまたは作業依頼が変更されました。一覧を更新してください。"],
  work_order_invalidated: ["固定依据或执行成员已变化；请先为原工单提交停止声明。", "The fixed basis or executor changed. Attest the original work stopped before replacing it.", "固定した根拠または実行担当が変更されました。元の作業の停止を先に申告してください。"],
  work_order_source_changed: ["任务、设计或团队来源已变化，此原件不能继续用于新的执行。", "Task, design or team sources changed. This original cannot authorize new execution.", "タスク、設計、チームの情報が変更されました。この原本で新しい実行を開始できません。"],
  work_order_claimant_required: ["只有原接单账号可以报告进度、关联交付或声明停止。", "Only the original claimant may report progress, link delivery or attest the stop.", "元の受領アカウントのみが進捗報告、成果の関連付け、停止申告を行えます。"],
  work_order_write_required: ["当前账号没有项目写入权限。", "This account does not have project write permission.", "このアカウントにはプロジェクトの書き込み権限がありません。"],
  work_order_current_unavailable: ["当前固定执行依据暂不可核对，请恢复读取后重试。", "The fixed execution basis cannot be checked. Restore the read and retry.", "固定した実行根拠を確認できません。読み込みを復旧して再試行してください。"],
  work_order_missing: ["此工单在当前项目中不可访问。", "This work order is unavailable in the current project.", "この作業依頼は現在のプロジェクトで利用できません。"],
  work_order_original_invalid: ["无法验证固定工作包，请保留工单原件并排查。", "The fixed packet could not be verified. Preserve the original and investigate.", "固定作業パケットを検証できません。原本を保持して調査してください。"],
  work_order_cancel_pending: ["已请求取消；只能报告受阻，或明确声明外部工作已停止。", "Cancellation is pending. Report a blocker or explicitly attest external work stopped.", "取り消し要求中です。障害を報告するか、外部作業の停止を明示的に申告してください。"],
  work_order_submission_missing: ["请先在此任务中提交真实交付报告。", "Submit the actual delivery report on this task first.", "このタスクで実際の成果報告を先に提出してください。"],
  work_order_submission_mismatch: ["只能关联原接单人针对同一依据提交的最新未验收报告。", "Link only the original claimant's latest unreviewed report for the same fixed basis.", "同じ固定根拠に対する、元の受領者の最新かつ未確認の報告のみ関連付けできます。"],
  project_not_active: ["请先恢复项目为进行中，再派发或接单。", "Activate the project before dispatching or claiming work.", "作業の依頼または受領前にプロジェクトを有効にしてください。"],
} as const;

function selectWords<T extends Record<string, readonly [string, string, string]>>(source: T, index: number) {
  return Object.fromEntries(Object.entries(source).map(([key, values]) => [key, values[index]])) as { [K in keyof T]: string };
}
export function externalWorkOrderCopy(language = "zh-CN") {
  const index = language.startsWith("en") ? 1 : language.startsWith("ja") ? 2 : 0;
  return { ...selectWords(words, index), states: selectWords(stateWords, index), deliveryStates: selectWords(deliveryWords, index) };
}
export function externalWorkOrderReason(language: string, reason: { code: string; message: string }) {
  const index = language.startsWith("en") ? 1 : language.startsWith("ja") ? 2 : 0;
  const known = reasonWords[reason.code as keyof typeof reasonWords];
  return known ? known[index] : taskSubmissionReason(language, reason);
}

function nav(language: string) {
  const copy = externalWorkOrderCopy(language);
  return {
    a2aGateway: copy.title, a2aWorkbench: copy.history, a2aRegistry: copy.member,
    a2aNegotiate: copy.create, a2aDispatch: copy.history, a2aEvidence: copy.openReport,
    a2aSla: copy.history, a2aWindows: copy.progress,
  };
}
export const externalWorkOrderNavigation = { "zh-CN": nav("zh-CN"), "en-US": nav("en-US"), "ja-JP": nav("ja-JP") };
const pages = (language: string) => Object.fromEntries(Object.entries(nav(language)).map(([key, title]) => [key, { title, description: externalWorkOrderCopy(language).description }]));
export const externalWorkOrderPages = { "zh-CN": pages("zh-CN"), "en-US": pages("en-US"), "ja-JP": pages("ja-JP") };
export function externalWorkOrderActionLabel(language: string, action: string) {
  const copy = externalWorkOrderCopy(language);
  const labels: Record<string, string> = { "work_order.create": copy.create, "work_order.claim": copy.claim, "work_order.progress": copy.updateProgress,
    "work_order.cancel": copy.cancelOrder, "work_order.release": copy.release, "work_order.report": copy.linkReport };
  return labels[action] || "";
}
