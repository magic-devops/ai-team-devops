const en = {
  title: "Review this execution", hint: "Record your conclusion against the displayed run evidence. Runtime success and human acceptance are separate decisions.",
  comment: "Review conclusion", accept: "Accept delivery", reject: "Request changes", run: "Checked run", runVersion: "Run version", projectVersion: "Project version",
  sending: "Saving the original review", unknown: "Review result is not confirmed", unknownHint: "The review may already be saved. Recover this exact decision and comment before submitting another action.",
  retry: "Recover original review", confirmed: "Review receipt confirmed", cleanupHint: "Finish local cleanup. The review will not be sent again.", finish: "Finish confirmed review",
  refused: "Review was not accepted", dismiss: "Return to editing", failed: "Unable to complete the review", refreshFailed: "The review is confirmed. Refresh the displayed data to see its latest state.",
  invalid: "The retained review cannot be verified. Keep this page open; do not submit a replacement decision.", unavailable: "The original review could not be retained. Restore browser storage before continuing.",
  details: "Original review", decisions: { accept: "Accept delivery", request_changes: "Request changes" },
};
type Copy = typeof en;
const zh: Copy = {
  title: "验收本次执行", hint: "请对照当前运行凭证填写结论。运行成功与人工验收分别记录。",
  comment: "验收结论", accept: "通过验收", reject: "要求修改", run: "已核对运行", runVersion: "运行版本", projectVersion: "项目版本",
  sending: "正在保存原验收请求", unknown: "验收结果尚未确认", unknownHint: "验收可能已经保存。请先恢复这份原决定和结论，再提交其它操作。",
  retry: "恢复原验收请求", confirmed: "验收回执已确认", cleanupHint: "请完成本地清理，不会再次提交验收。", finish: "完成已确认验收",
  refused: "本次验收未被接受", dismiss: "返回修改结论", failed: "暂时无法完成验收", refreshFailed: "验收已经确认，请刷新页面数据查看最新状态。",
  invalid: "无法核验保留的验收原件。请保留此页面，暂勿另建验收决定。", unavailable: "无法保留原验收请求，请恢复浏览器存储后继续。",
  details: "原验收请求", decisions: { accept: "通过验收", request_changes: "要求修改" },
};
const ja: Copy = {
  title: "この実行を検収", hint: "表示中の実行証拠に基づいて結論を記録してください。実行の成功と人による検収は別の判断です。",
  comment: "検収の結論", accept: "納品を承認", reject: "修正を依頼", run: "確認した実行", runVersion: "実行の版", projectVersion: "プロジェクトの版",
  sending: "元の検収要求を保存中", unknown: "検収結果を確認できません", unknownHint: "検収が既に保存されている可能性があります。別の操作の前に、同じ判断と結論を復元してください。",
  retry: "元の検収要求を復元", confirmed: "検収の受領を確認済み", cleanupHint: "ローカル情報の整理を完了してください。検収は再送しません。", finish: "確認済みの検収を完了",
  refused: "検収は受け付けられませんでした", dismiss: "結論の編集に戻る", failed: "検収を完了できません", refreshFailed: "検収は確認済みです。表示を更新して最新の状態を確認してください。",
  invalid: "保存された検収要求を検証できません。この画面を維持し、別の判断を送信しないでください。", unavailable: "元の検収要求を保存できません。ブラウザーの保存機能を復旧してから続行してください。",
  details: "元の検収要求", decisions: { accept: "納品を承認", request_changes: "修正を依頼" },
};
export function executionReviewCopy(language = "en"): Copy { return language.startsWith("zh") ? zh : language.startsWith("ja") ? ja : en; }
