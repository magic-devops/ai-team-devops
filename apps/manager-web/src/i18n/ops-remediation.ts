const en = {
  title: "Bring an operational suggestion into remediation", reported: "Reported suggestion · not execution evidence",
  hint: "Review the fixed source and create one project problem. Continue through diagnosis, requirements, task execution and acceptance. Deployment and rollback use controlled releases.",
  create: "Add to problems", open: "Open the original problem", source: "Fixed source", issueTitle: "Problem title", description: "Additional context", severity: "Severity",
  retry: "Read source again", failed: "Source is unavailable", changed: "Facts or the project version changed. Read and explicitly adopt the current source before another submission.",
  adopt: "Adopt the current source", close: "Close", unknown: "The result is unknown. Recover exactly the saved request; do not create another problem.", recover: "Recover original request",
  confirmed: "The original problem is confirmed. Open it to continue remediation.", apply: "Apply receipt and open problem", unavailable: "Durable request storage is unavailable. No new request will be sent.",
  original: "Saved original request", details: "Source and digest", recorded: "Recorded state", preview: "Suggestion preview", tasks: "Preview remediation tasks",
  flow: "Suggestion → problem → diagnosis / requirement → task / test → controlled release", releases: "Open controlled releases", history: "Suggestion records", handle: "Review and add to problems", empty: "No operational suggestions in this project.", missingIssue: "The original problem is unavailable. It has not been recreated.",
  defer: "Keep operation and recover later", sending: "Saving the fixed request and awaiting its receipt…",
};
type Copy = typeof en;
const zh: Copy = {
  title: "纳入正式运维处置", reported: "运维建议 · 非执行证明",
  hint: "核对固定来源后纳入一个项目问题，再进入诊断、需求、任务执行和验收。实际部署与回滚使用受控发布。",
  create: "纳入问题", open: "打开原问题", source: "固定来源", issueTitle: "问题标题", description: "补充说明", severity: "严重程度",
  retry: "重新读取来源", failed: "来源暂不可用", changed: "来源或项目版本已变化，请重新读取并明确采用当前来源后再提交。",
  adopt: "采用当前来源", close: "关闭", unknown: "结果未知，请恢复已保存的同一请求，勿另建问题。", recover: "恢复原请求",
  confirmed: "原问题已确认，可以打开后继续正式处置。", apply: "应用回执并打开问题", unavailable: "无法安全保存原请求，当前不会发起新的提交。",
  original: "已保存的原请求", details: "来源与摘要", recorded: "旧记录状态", preview: "建议预览", tasks: "预览治理任务",
  flow: "建议 → 问题 → 诊断 / 需求 → 任务 / 测试 → 受控发布", releases: "打开受控发布", history: "运维建议记录", handle: "核对并纳入问题", empty: "当前项目暂无运维建议。", missingIssue: "原问题暂不可用，未另建替代问题。",
  defer: "保留操作，稍后恢复", sending: "正在保存固定请求并等待回执…",
};
const ja: Copy = {
  title: "正式な運用対応に取り込む", reported: "運用提案 · 実行証拠ではありません",
  hint: "固定した出所を確認し、プロジェクトの問題を一件作成します。診断、要件、タスク実行と受入へ進みます。デプロイとロールバックは管理されたリリースを使います。",
  create: "問題へ取り込む", open: "元の問題を開く", source: "固定した出所", issueTitle: "問題のタイトル", description: "補足", severity: "重大度",
  retry: "出所を再取得", failed: "出所を取得できません", changed: "出所かプロジェクト版が変わりました。現在の情報を再取得し、明示的に採用してから送信してください。",
  adopt: "現在の出所を採用", close: "閉じる", unknown: "結果が不明です。保存した同じ要求を復旧し、別の問題を作らないでください。", recover: "元の要求を復旧",
  confirmed: "元の問題が確認されました。開いて正式な対応を続けてください。", apply: "受領結果を適用して問題を開く", unavailable: "要求を安全に保存できません。新たな送信は行いません。",
  original: "保存済みの元の要求", details: "出所とダイジェスト", recorded: "旧記録の状態", preview: "提案のプレビュー", tasks: "対応タスクのプレビュー",
  flow: "提案 → 問題 → 診断 / 要件 → タスク / テスト → 管理されたリリース", releases: "管理されたリリースを開く", history: "運用提案の記録", handle: "確認して問題へ取り込む", empty: "このプロジェクトに運用提案はありません。", missingIssue: "元の問題を取得できません。代替の問題は作成していません。",
  defer: "操作を保存し後で復旧", sending: "固定要求を保存し、受領結果を待っています…",
};
export function opsRemediationCopy(language?: string) { return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en; }
