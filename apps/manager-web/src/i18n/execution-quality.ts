const en = {
  title: "Acceptance quality", not_configured: "No command tests were planned. This run cannot be accepted as verified delivery.",
  pending: "Command test evidence is not complete yet.", failed: "A command test failed or was skipped. Acceptance is blocked.",
  invalid: "The test plan or result no longer matches this execution. Acceptance is blocked.",
  passed: "The fixed command tests passed. An authorized reviewer can assess this delivery.",
  next: "If review is available to you, request changes first. Otherwise ask an authorized member to prepare a new execution with explicit command tests. Inspect its actual output before accepting.",
  reused: "Successful test evidence reused from an earlier attempt of this same execution", attempt: "attempt",
};
type Copy = typeof en;
const zh: Copy = {
  title: "验收质量", not_configured: "本次执行未配置命令测试，不能验收为已验证交付。",
  pending: "命令测试证据尚未完整，请等待执行完成并检查实际结果。", failed: "命令测试失败或被跳过，暂不能通过验收。",
  invalid: "测试计划或结果与本次执行不一致，暂不能通过验收。", passed: "固定计划中的命令测试已通过，可由有权限的评审人检查交付并验收。",
  next: "如果当前允许评审，可先退回修改；否则请有权限的成员准备包含明确命令测试的新执行。验收前请检查实际测试输出。",
  reused: "复用了同一次执行先前尝试中已成功的测试证据", attempt: "尝试",
};
const ja: Copy = {
  title: "受入品質", not_configured: "コマンドテストが計画されていません。検証済みの成果として受け入れできません。",
  pending: "コマンドテストの証拠がまだ揃っていません。", failed: "コマンドテストが失敗またはスキップされました。受け入れできません。",
  invalid: "テスト計画または結果がこの実行と一致しません。受け入れできません。", passed: "固定されたコマンドテストに合格しました。権限を持つ担当者が成果を審査できます。",
  next: "審査が可能な場合は修正を依頼してください。それ以外は権限を持つ担当者に明示的なコマンドテストを含む新しい実行の準備を依頼し、受け入れ前に実際の出力を確認してください。",
  reused: "同じ実行の以前の試行で成功したテスト証拠を再利用しています", attempt: "試行",
};
export function executionQualityCopy(language?: string): Copy {
  return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en;
}
