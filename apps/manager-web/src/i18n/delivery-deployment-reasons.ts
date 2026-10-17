const en = {
  deployment_action_invalid: "This operation is not supported.",
  deployment_actor_inactive: "The current account is inactive.",
  deployment_artifact_origin:
    "The artifact source is not permitted by this environment.",
  deployment_baseline_incompatible:
    "The verified baseline is incompatible with the current environment or target.",
  deployment_baseline_invalid:
    "The frozen rollback baseline is no longer applicable.",
  deployment_baseline_missing:
    "No actually verified stable baseline is available.",
  deployment_basis_changed:
    "The deployment changed. Read and review its latest state.",
  deployment_candidate_changed:
    "The candidate or its evidence changed. Prepare a fresh fixed plan.",
  deployment_candidate_missing:
    "The selected release candidate is unavailable.",
  deployment_candidate_unapproved:
    "The candidate must be approved and currently valid.",
  deployment_environment_busy:
    "Another outstanding deployment owns this environment. Query its actual outcome first.",
  deployment_environment_changed:
    "The environment configuration changed. Prepare a fresh plan.",
  deployment_environment_duplicate:
    "This environment name already exists in the project.",
  deployment_environment_inactive: "The selected environment is inactive.",
  deployment_environment_mismatch:
    "The candidate and controlled environment names must match exactly.",
  deployment_execute_required:
    "Project approval and runtime execution permissions are both required.",
  deployment_ineligible: "Deployment is blocked. Review the listed reasons.",
  deployment_not_found:
    "This deployment is unavailable in the current project.",
  deployment_originator_inactive: "The original operation account is inactive.",
  deployment_originator_permission:
    "The original operation account no longer has the required permissions.",
  deployment_originator_scope:
    "The original runtime identity no longer matches this operation.",
  deployment_permission_required:
    "The current project permission does not allow this operation.",
  deployment_plan_invalid: "The controlled execution plan is invalid.",
  deployment_preview_changed:
    "The preview no longer matches. Keep your input and preview again.",
  deployment_rollback_superseded:
    "A later deployment changed this environment. Review its actual state first.",
  deployment_run_mismatch:
    "The run does not match the frozen deployment operation.",
  deployment_run_missing:
    "The fixed run is not available. Query the original handoff.",
  deployment_runtime_scope:
    "The execution workspace or runtime scope is unavailable.",
  deployment_runtime_unavailable:
    "The runtime is not configured or currently available.",
  deployment_target_unavailable:
    "The selected execution target is unavailable or unauthorized.",
  deployment_transition_invalid:
    "The actual state does not allow this transition.",
  project_archived: "The project is archived; new operations are unavailable.",
  project_not_active:
    "The project is not active. Resume it before starting a new operation.",
};
const zh: typeof en = {
  deployment_action_invalid: "不支持此操作。",
  deployment_actor_inactive: "当前账号已失活。",
  deployment_artifact_origin: "制品来源不在环境允许范围内。",
  deployment_baseline_incompatible: "已验证基线与当前环境或执行目标不相容。",
  deployment_baseline_invalid: "冻结的回滚基线已不适用。",
  deployment_baseline_missing: "没有实际验证的稳定基线。",
  deployment_basis_changed: "部署依据已变化，请读取并核对最新状态。",
  deployment_candidate_changed: "候选或证据已变化，请重新准备固定计划。",
  deployment_candidate_missing: "所选发布候选不可用。",
  deployment_candidate_unapproved: "候选必须已批准且当前仍有效。",
  deployment_environment_busy: "环境存在其他在途部署，请先查询其真实结果。",
  deployment_environment_changed: "环境配置已变化，请重新准备计划。",
  deployment_environment_duplicate: "项目中已存在此环境名称。",
  deployment_environment_inactive: "所选环境尚未启用。",
  deployment_environment_mismatch: "候选环境名称必须与受控环境精确一致。",
  deployment_execute_required: "需要同时具备项目审批和运行时执行权限。",
  deployment_ineligible: "部署已阻塞，请核对具体原因。",
  deployment_not_found: "当前项目中找不到此部署。",
  deployment_originator_inactive: "原操作账号已失活。",
  deployment_originator_permission: "原操作账号已不具备所需权限。",
  deployment_originator_scope: "原运行时身份与此操作不再匹配。",
  deployment_permission_required: "当前项目权限不允许此操作。",
  deployment_plan_invalid: "受控执行计划不合法。",
  deployment_preview_changed: "预览已不匹配，请保留输入并重新预览。",
  deployment_rollback_superseded: "后续部署已改变此环境，请先核对其真实状态。",
  deployment_run_mismatch: "运行与冻结的部署操作不匹配。",
  deployment_run_missing: "固定运行不可用，请查询原交接请求。",
  deployment_runtime_scope: "执行工作区或运行时作用域不可用。",
  deployment_runtime_unavailable: "运行时尚未配置或当前不可用。",
  deployment_target_unavailable: "所选设备不可用或未获得执行授权。",
  deployment_transition_invalid: "实际状态不允许此流转。",
  project_archived: "项目已归档，不能发起新操作。",
  project_not_active: "项目当前未启用，请恢复项目后再发起新操作。",
};
const ja: typeof en = {
  deployment_action_invalid: "この操作はサポートされていません。",
  deployment_actor_inactive: "現在のアカウントは無効です。",
  deployment_artifact_origin:
    "この環境では成果物のオリジンが許可されていません。",
  deployment_baseline_incompatible:
    "検証済み基準は現在の環境または実行先と互換性がありません。",
  deployment_baseline_invalid: "固定されたロールバック基準は適用できません。",
  deployment_baseline_missing: "実際に検証された安定基準がありません。",
  deployment_basis_changed:
    "デプロイの基準が変わりました。最新状態を確認してください。",
  deployment_candidate_changed:
    "候補または証拠が変わりました。固定計画を準備し直してください。",
  deployment_candidate_missing: "選択したリリース候補は利用できません。",
  deployment_candidate_unapproved: "承認済みで現在有効な候補が必要です。",
  deployment_environment_busy:
    "別のデプロイがこの環境を使用中です。実際の結果を先に照会してください。",
  deployment_environment_changed:
    "環境設定が変わりました。計画を準備し直してください。",
  deployment_environment_duplicate: "この環境名はプロジェクト内に存在します。",
  deployment_environment_inactive: "選択した環境は無効です。",
  deployment_environment_mismatch:
    "候補と管理対象環境の名前は完全一致が必要です。",
  deployment_execute_required:
    "プロジェクト承認権限と実行権限の両方が必要です。",
  deployment_ineligible:
    "デプロイはブロックされています。理由を確認してください。",
  deployment_not_found: "現在のプロジェクトにこのデプロイはありません。",
  deployment_originator_inactive: "元の操作アカウントは無効です。",
  deployment_originator_permission:
    "元の操作アカウントに必要な権限がありません。",
  deployment_originator_scope: "元の実行IDはこの操作と一致しません。",
  deployment_permission_required: "現在のプロジェクト権限では操作できません。",
  deployment_plan_invalid: "管理された実行計画は無効です。",
  deployment_preview_changed:
    "プレビューが一致しません。入力を保持して再確認してください。",
  deployment_rollback_superseded:
    "後続のデプロイが環境を変更しました。実際の状態を先に確認してください。",
  deployment_run_mismatch: "実行は固定デプロイ操作と一致しません。",
  deployment_run_missing:
    "固定実行は利用できません。元の引き継ぎを照会してください。",
  deployment_runtime_scope:
    "実行ワークスペースまたはスコープは利用できません。",
  deployment_runtime_unavailable:
    "ランタイムが未設定、または現在利用できません。",
  deployment_target_unavailable:
    "選択したデバイスが利用不可、または実行権限がありません。",
  deployment_transition_invalid: "実際の状態ではこの遷移はできません。",
  project_archived:
    "プロジェクトはアーカイブ済みです。新しい操作はできません。",
  project_not_active:
    "プロジェクトは稼働中ではありません。再開してから新しい操作を開始してください。",
};
export const deploymentReasonTranslations = {
  "zh-CN": zh,
  "en-US": en,
  "ja-JP": ja,
};
