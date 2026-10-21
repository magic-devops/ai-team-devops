const en = {
  title: "Finish a retained operation", hint: "Your original request is preserved. Resolve its result before starting another operation.",
  submission: "Delivery report or review", workOrder: "External work order", unknown: "Result needs confirmation", confirmed: "Result confirmed",
  refused: "Request was declined", sending: "Confirming the original request…", replay: "Confirm original result", finish: "Finish locally", discard: "Close declined request",
  unavailable: "The retained request cannot be accessed safely. Keep this page open and retry recovery.", retry: "Retry recovery",
  invalid: "The retained request is incomplete or invalid. It remains preserved and cannot be replayed or discarded here.",
  receiptMismatch: "The server receipt does not match the original request. Its result remains unconfirmed. Keep the original and confirm its result again.",
  recoveryFailed: "The result could not be confirmed. The original request is preserved; try confirming it again.", version: "Original version", target: "Original target",
  reload: "Reload recovery page", reloadHint: "When local storage is available again, reload this recovery page to read the preserved request. The browser may ask you to confirm leaving this page.",
  refreshFailed: "The operation is finished. Refresh the workspace to see the latest information.", original: "Original request", receipt: "Confirmed result", details: "Request and result details",
};
const zh: typeof en = {
  title: "完成保留的操作", hint: "原始请求已保留。请先确认或收尾，再开始新操作。", submission: "交付报告或评审", workOrder: "外部工单",
  unknown: "操作结果待确认", confirmed: "操作结果已确认", refused: "请求未被接受", sending: "正在确认原始请求…", replay: "确认原操作结果", finish: "完成本地收尾", discard: "关闭未接受的请求",
  unavailable: "暂时无法安全访问保留的请求。请保留此页面并重试恢复。", retry: "重试恢复", invalid: "保留的请求不完整或无法校验。原件仍被保留，暂不能在此重放或丢弃。",
  receiptMismatch: "服务端回执与原始请求不匹配，操作结果仍未确认。请保留原件，再次确认原操作结果。", recoveryFailed: "暂时未能确认操作结果。原始请求仍被保留，请再次确认。", version: "原始版本", target: "原始目标",
  reload: "重新载入恢复页", reloadHint: "本地存储恢复后，请重新载入此恢复页读取保留的原件。浏览器可能会要求确认离开当前页面。",
  refreshFailed: "操作已完成，请刷新工作区查看最新信息。", original: "完整原始请求", receipt: "已确认结果", details: "请求与结果详情",
};
const ja: typeof en = {
  title: "保存された操作を完了", hint: "元のリクエストは保存されています。新しい操作の前に結果を確認し、完了してください。", submission: "納品レポートまたはレビュー", workOrder: "外部作業依頼",
  unknown: "操作結果の確認が必要です", confirmed: "操作結果を確認しました", refused: "リクエストは拒否されました", sending: "元のリクエストを確認中…", replay: "元の操作結果を確認", finish: "ローカルで完了", discard: "拒否されたリクエストを閉じる",
  unavailable: "保存されたリクエストに安全にアクセスできません。このページを保持し、復元を再試行してください。", retry: "復元を再試行", invalid: "保存されたリクエストが不完全か、検証できません。元の内容を保持し、ここでの再送と破棄を停止しています。",
  receiptMismatch: "サーバーの応答が元のリクエストと一致しないため、結果は未確認です。元の内容を保持し、結果を再確認してください。", recoveryFailed: "操作結果を確認できませんでした。元のリクエストを保持しています。もう一度確認してください。", version: "元のバージョン", target: "元の対象",
  reload: "復元ページを再読み込み", reloadHint: "ローカルストレージが利用可能になったら、この復元ページを再読み込みして保存されたリクエストを読み取ってください。ブラウザーでページを離れる確認が表示される場合があります。",
  refreshFailed: "操作は完了しました。ワークスペースを更新して最新情報を確認してください。", original: "元のリクエスト全体", receipt: "確認済みの結果", details: "リクエストと結果の詳細",
};
export function deliveryOperationRecoveryCopy(language?: string) { return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en; }
