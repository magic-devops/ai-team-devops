const zh = {
  standaloneStageBlocked: "请先重新打开任务，再准备派发。",
  reasons: {
    task_owner_missing: "请为任务分配当前项目的人员或智能体负责人。",
    task_owner_unavailable: "当前负责人已停用或不可用，请重新分配。",
    task_owner_invalid: "请选择当前项目中的有效负责人身份。",
    task_owner_is_tool: "工具不能承担任务验收责任，请分配人员或智能体。",
    task_owner_outside_project: "负责人已离开当前项目，请重新分配。",
    task_owner_inactive: "负责人已停用，请重新分配。",
    task_owner_missing_identity: "原负责人身份已不存在或不可访问，请重新分配。",
    task_owner_id_required: "请通过负责人选择器分配稳定身份。",
    task_owner_invalid_scope: "任务项目归属不可用，请先核对任务所在项目。",
    task_acceptance_invalid: "任务自身验收条件无效，请明确填写。",
    task_requirement_criteria_invalid: "选择的需求条件无效，请重新核对。",
    task_requirement_missing: "关联需求已不存在或不在当前项目。",
    task_requirement_basis_changed: "需求已变化，请明确采用当前条件。",
    task_acceptance_missing: "请填写任务自身条件，或明确选择需求条件。",
    task_missing: "任务已不存在或不在当前项目。",
    task_dispatch_stage_blocked: "请先重新打开任务和关联需求，再准备派发。",
    task_dependencies_blocked: "请解除阻塞，并验收前置任务。",
    task_execution_active: "请先审查或取消当前运行，再次派发。",
  },
  gateHint:
    "请为关联任务填写自身验收条件，或明确选择它承担的需求条件；过期或不可用来源不能用于推进阶段。",
  cancelHistorical: "取消只关闭该旧运行和派发意图，不修改当前任务内容或状态。",
  unrecordedCriteria: "此历史记录未采集任务验收来源，不能补造当前条件。",
  standalone: "独立任务",
  linked: "关联需求任务",
  ownCriteria: "任务自身验收条件",
  requirementCriteria: "承担的需求验收条件",
  effectiveCriteria: "本次交付验收条件",
  sourceTask: "任务自身",
  sourceRequirement: "关联需求",
  add: "添加条件",
  remove: "删除条件",
  moveUp: "上移",
  moveDown: "下移",
  condition: "验收条件",
  empty: "尚未登记任务自身条件，可在计划编辑中补齐。",
  unavailable: "验收来源不可用，请修正需求关联后再派发。",
  criteriaLimit: "最多登记 80 条条件。",
  invalidCriterion: "每条条件需填写有效文本，最多 2000 字。",
  noReferences: "尚未选择需求条件，未默认采用整个需求。",
  criteriaHint:
    "任务自身条件与明确选择的需求条件共同构成交付依据。修改将使旧验收失效。",
  recordStatus: "登记状态",
  owner: "业务负责人",
  executionOwner: "执行 Agent 和设备在派发时另行选择",
  missing: "任务不存在或已移出当前项目",
  missingHint: "保留当前作用域，检查任务归属或返回列表。",
  back: "返回原工作视图",
  allTasks: "返回任务列表",
  details: "任务交付详情",
  nativeReview: "此任务由运行管理，请在执行记录中测试核验与人工审查。",
  ownSnapshot: "任务验收快照",
  requirementSnapshot: "需求修订 {{revision}}",
  blocked: "当前暂不能派发",
  editable: "维护任务计划与验收条件",
  refresh: "刷新任务",
  scopeChanged: "当前任务来源已变化；保留自身条件，需求关联需重新核对。",
  taskOnly: "任务自身条件，不关联虚构需求",
  taskMoved: "任务来源变化",
  none: "暂无",
  source: "验收来源",
  description: "任务范围",
  readonly: "当前只能查看任务",
  currentCriteria: "当前条件",
  draftRetained: "草稿已保留",
  noTests: "测试尚未配置",
  taskBasisChanged: "任务内容、验收条件或关联来源已变化，请明确采用最新依据。",
};
const en: typeof zh = {
  standaloneStageBlocked: "Reopen the task before preparing a dispatch.",
  reasons: {
    task_owner_missing: "Assign a responsible person or agent from this project.",
    task_owner_unavailable: "The current owner is inactive or unavailable. Reassign the task.",
    task_owner_invalid: "Select a valid responsible identity from this project.",
    task_owner_is_tool: "Tools cannot own task acceptance. Assign a person or agent.",
    task_owner_outside_project: "The owner has left this project. Reassign the task.",
    task_owner_inactive: "The owner is inactive. Reassign the task.",
    task_owner_missing_identity: "The original owner no longer exists or is inaccessible. Reassign the task.",
    task_owner_id_required: "Use the owner selector to assign a stable identity.",
    task_owner_invalid_scope: "The task project is unavailable. Check its project scope first.",
    task_acceptance_invalid:
      "Task acceptance criteria are invalid. Define them explicitly.",
    task_requirement_criteria_invalid:
      "Selected requirement criteria are invalid. Review the references.",
    task_requirement_missing:
      "The linked requirement no longer exists in this project.",
    task_requirement_basis_changed:
      "Requirement changed. Explicitly adopt current criteria.",
    task_acceptance_missing:
      "Add task criteria or explicitly select requirement criteria.",
    task_missing: "Task no longer exists in this project.",
    task_dispatch_stage_blocked:
      "Reopen the task and linked requirement before dispatch.",
    task_dependencies_blocked:
      "Resolve blockers and verify predecessor delivery.",
    task_execution_active:
      "Review or cancel the current execution before redispatch.",
  },
  gateHint:
    "Add task criteria or explicitly select requirement criteria for linked tasks. Stale or unavailable sources cannot advance this stage.",
  cancelHistorical:
    "Cancellation closes this previous run and dispatch intent without changing the current task content or status.",
  unrecordedCriteria:
    "Task acceptance sources were not captured in this historical record. Current criteria are not substituted.",
  standalone: "Standalone task",
  linked: "Requirement-linked task",
  ownCriteria: "Task acceptance criteria",
  requirementCriteria: "Selected requirement criteria",
  effectiveCriteria: "Delivery acceptance criteria",
  sourceTask: "Task",
  sourceRequirement: "Requirement",
  add: "Add criterion",
  remove: "Remove criterion",
  moveUp: "Move up",
  moveDown: "Move down",
  condition: "Acceptance criterion",
  empty: "No task criteria registered. Add them in the plan editor.",
  unavailable:
    "Acceptance source unavailable. Repair the requirement link before dispatching.",
  criteriaLimit: "Register at most 80 criteria.",
  invalidCriterion: "Each criterion must contain text, up to 2000 characters.",
  noReferences:
    "No requirement criteria selected. The whole requirement is not adopted automatically.",
  criteriaHint:
    "Task criteria and explicitly selected requirement criteria form the delivery basis. Changes invalidate previous acceptance.",
  recordStatus: "Recorded status",
  owner: "Accountable owner",
  executionOwner:
    "Choose the execution agent and device separately when dispatching",
  missing: "Task unavailable or moved outside this project",
  missingHint:
    "Keep the current scope. Check the task location or return to the list.",
  back: "Return to previous view",
  allTasks: "Return to task list",
  details: "Task delivery details",
  nativeReview:
    "This task is execution-managed. Verify tests and review its execution record.",
  ownSnapshot: "Task acceptance snapshot",
  requirementSnapshot: "Requirement revision {{revision}}",
  blocked: "Dispatch is currently blocked",
  editable: "Edit task plan and acceptance criteria",
  refresh: "Refresh task",
  scopeChanged:
    "Task source changed. Own criteria are retained; review requirement references again.",
  taskOnly: "Task-owned criteria with no invented requirement",
  taskMoved: "Task source changed",
  none: "None",
  source: "Acceptance source",
  description: "Task scope",
  readonly: "This task is read-only",
  currentCriteria: "Current criteria",
  draftRetained: "Draft retained",
  noTests: "Tests not configured",
  taskBasisChanged:
    "Task content, acceptance criteria or source changed. Explicitly adopt the latest basis.",
};
const ja: typeof zh = {
  standaloneStageBlocked: "タスクを再開してから割り当てを準備してください。",
  reasons: {
    task_owner_missing: "現在のプロジェクトの担当者またはエージェントを割り当ててください。",
    task_owner_unavailable: "現在の担当者は無効または利用不可です。再割当してください。",
    task_owner_invalid: "現在のプロジェクトから有効な担当者を選択してください。",
    task_owner_is_tool: "ツールはタスクの承認責任者になれません。担当者またはエージェントを選択してください。",
    task_owner_outside_project: "担当者が現在のプロジェクトを離脱しました。再割当してください。",
    task_owner_inactive: "担当者が無効です。再割当してください。",
    task_owner_missing_identity: "元の担当者が存在しないかアクセスできません。再割当してください。",
    task_owner_id_required: "担当者選択から固定識別情報を割り当ててください。",
    task_owner_invalid_scope: "タスクのプロジェクトが利用できません。所属プロジェクトを確認してください。",
    task_acceptance_invalid:
      "タスク自身の条件が無効です。明示的に入力してください。",
    task_requirement_criteria_invalid:
      "選択した要求の条件が無効です。関連付けを確認してください。",
    task_requirement_missing:
      "関連する要求が存在しないか、現在のプロジェクトにはありません。",
    task_requirement_basis_changed:
      "要求が変更されました。現在の条件を明示的に採用してください。",
    task_acceptance_missing:
      "タスク自身の条件を入力するか、要求の条件を明示的に選択してください。",
    task_missing: "タスクは現在のプロジェクトに存在しません。",
    task_dispatch_stage_blocked:
      "タスクと関連要求を再開してから割り当ててください。",
    task_dependencies_blocked:
      "阻害要因を解消し、前提タスクを検収してください。",
    task_execution_active:
      "現在の実行を検収または取り消してから再割り当てしてください。",
  },
  gateHint:
    "関連タスクに自身の条件を入力するか、担当する要求の条件を明示的に選択してください。失効・利用不可の参照元では段階を進められません。",
  cancelHistorical:
    "取り消しはこの過去の実行と割り当てだけを閉じ、現在のタスク内容や状態は変更しません。",
  unrecordedCriteria:
    "この過去の記録にはタスクの受け入れ条件の参照元がありません。現在の条件で補完しません。",
  standalone: "独立タスク",
  linked: "要求に関連するタスク",
  ownCriteria: "タスク自身の受け入れ条件",
  requirementCriteria: "選択した要求の受け入れ条件",
  effectiveCriteria: "デリバリーの受け入れ条件",
  sourceTask: "タスク自身",
  sourceRequirement: "関連する要求",
  add: "条件を追加",
  remove: "条件を削除",
  moveUp: "上へ",
  moveDown: "下へ",
  condition: "受け入れ条件",
  empty: "タスク自身の条件は未登録です。計画の編集で追加できます。",
  unavailable:
    "受け入れ条件の参照元が利用できません。要求の関連付けを修正してください。",
  criteriaLimit: "条件は最大 80 件です。",
  invalidCriterion:
    "各条件に 2000 文字以内の有効なテキストを入力してください。",
  noReferences: "要求の条件は未選択です。要求全体は自動採用されません。",
  criteriaHint:
    "タスク自身の条件と明示的に選択した要求の条件を検収の根拠にします。変更すると以前の検収は失効します。",
  recordStatus: "登録状態",
  owner: "業務の責任者",
  executionOwner: "実行 Agent とデバイスは割り当て時に別途選択します",
  missing: "タスクが存在しないか、このプロジェクトから移動しました",
  missingHint:
    "現在の範囲を維持し、タスクの所在を確認するか一覧へ戻ってください。",
  back: "前の作業画面へ戻る",
  allTasks: "タスク一覧へ戻る",
  details: "タスクのデリバリー詳細",
  nativeReview:
    "このタスクは実行管理の対象です。実行記録でテストを確認して検収してください。",
  ownSnapshot: "タスクの受け入れ条件スナップショット",
  requirementSnapshot: "要求の改訂 {{revision}}",
  blocked: "現在は割り当てできません",
  editable: "計画と受け入れ条件を編集",
  refresh: "タスクを更新",
  scopeChanged:
    "タスクの参照元が変わりました。自身の条件を保持し、要求の関連付けを確認してください。",
  taskOnly: "架空の要求に関連付けないタスク自身の条件",
  taskMoved: "タスクの参照元が変更されました",
  none: "なし",
  source: "受け入れ条件の参照元",
  description: "タスクの範囲",
  readonly: "このタスクは読み取り専用です",
  currentCriteria: "現在の条件",
  draftRetained: "下書きを保持",
  noTests: "テスト未設定",
  taskBasisChanged:
    "タスク内容、条件または参照元が変更されました。最新の根拠を明示的に採用してください。",
};
export const taskAcceptanceTranslations = {
  "zh-CN": zh,
  "en-US": en,
  "ja-JP": ja,
};
