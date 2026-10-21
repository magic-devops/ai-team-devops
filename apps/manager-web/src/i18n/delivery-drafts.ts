const en = {
  navigationBlocked: "This task has an open draft. Submit it or close its editor before leaving.",
  refreshFailed: "The task was saved. Refreshing the page failed; refresh its facts without submitting again.",
};
const zh: typeof en = {
  navigationBlocked: "本任务仍有打开的草稿，请先提交或关闭对应编辑窗口，再离开当前任务。",
  refreshFailed: "任务已保存，但页面刷新未完成。请刷新事实，无需再次提交。",
};
const ja: typeof en = {
  navigationBlocked: "このタスクには編集中の下書きがあります。送信するか編集画面を閉じてから移動してください。",
  refreshFailed: "タスクは保存済みです。画面の更新に失敗しました。再送信せず情報を更新してください。",
};
export function deliveryDraftCopy(language?: string) {
  return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en;
}
