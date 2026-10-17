const zh = {
  identity: "成员身份", unassigned: "未分配", missingOwner: "负责人已离开或不可用", reassign: "需重新分配",
  kinds: { human: "人员", agent: "智能体", tool: "工具" },
  allKinds: "全部类型", allStates: "全部状态", active: "已启用", inactive: "已停用", registered: "已登记",
  search: "搜索姓名、身份或角色", reset: "重置筛选", count: "{{visible}} / {{total}} 位成员与资源",
  empty: "团队尚未登记成员", emptyHint: "添加项目人员，或登记参与交付的智能体和工具。", noMatches: "没有匹配的成员", noMatchesHint: "尝试其他关键词或重置筛选。",
  details: "成员详情", inspect: "查看成员", role: "角色说明", roleHint: "角色说明用于协作分工，不授予账号或执行权限。",
  identityHint: "任务按稳定身份分配；改名不会转移负责人或改变验收结论。", toolHint: "工具参与能力与产能预留，不承担任务验收责任。", agentHint: "团队登记独立于运行配置；实际执行者和设备在任务派发时选择。",
  assignedTasks: "负责的任务", noTasks: "尚无分配任务", calendar: "产能日历", calendarUnavailable: "日历暂不可用，可重试读取", calendarUnknown: "尚未设置产能日历", configureCalendar: "配置日历", viewCapacity: "查看产能", edit: "编辑登记", people: "管理项目人员", readOnly: "当前权限可查看详情；修改登记和产能日历需要项目配置权限。", inactiveHint: "停用后无法再接收分配；原任务保留此身份，需要另行重新分配。", missing: "此成员已离开或不可访问", missingHint: "不会根据同名成员替换此身份。返回团队重新选择成员。", back: "返回团队", owner: "负责人", keepOwner: "保持原负责人", clearOwner: "清除负责人", rosterFailed: "成员读取失败，请重试后再分配", retry: "重试", stableId: "稳定身份", unavailableOwner: "当前负责人不可承担任务，请重新分配。",
};
const en: typeof zh = {
  identity: "Member identity", unassigned: "Unassigned", missingOwner: "Owner left or unavailable", reassign: "Reassignment required",
  kinds: { human: "Person", agent: "Agent", tool: "Tool" }, allKinds: "All types", allStates: "All states", active: "Active", inactive: "Inactive", registered: "Registered",
  search: "Search name, identity or role", reset: "Reset filters", count: "{{visible}} / {{total}} members and resources",
  empty: "No team members registered", emptyHint: "Add project people, or register agents and tools contributing to delivery.", noMatches: "No matching members", noMatchesHint: "Try another search or reset the filters.",
  details: "Member details", inspect: "View member", role: "Role description", roleHint: "Role descriptions explain collaboration responsibilities and grant no account or execution permissions.", identityHint: "Tasks are assigned by stable identity. Renaming keeps ownership and acceptance decisions intact.", toolHint: "Tools contribute capabilities and capacity reservations and cannot own task acceptance.", agentHint: "Team registration is separate from runtime configuration. Select the executor and device when dispatching a task.",
  assignedTasks: "Assigned tasks", noTasks: "No assigned tasks", calendar: "Capacity calendar", calendarUnavailable: "Calendar unavailable. Retry reading it.", calendarUnknown: "No capacity calendar configured", configureCalendar: "Configure calendar", viewCapacity: "View capacity", edit: "Edit registration", people: "Manage project people", readOnly: "You can view details. Editing registration and capacity calendars requires project configuration permission.", inactiveHint: "Inactive members cannot receive new assignments. Existing tasks retain this identity until reassigned.", missing: "Member left or is inaccessible", missingHint: "A member with the same name will not replace this identity. Return to the team and select another member.", back: "Back to team", owner: "Owner", keepOwner: "Keep current owner", clearOwner: "Clear owner", rosterFailed: "Could not read members. Retry before assigning.", retry: "Retry", stableId: "Stable identity", unavailableOwner: "The current owner cannot own this task. Reassign it.",
};
const ja: typeof zh = {
  identity: "メンバー識別", unassigned: "未割当", missingOwner: "担当者が離脱または利用不可", reassign: "再割当が必要",
  kinds: { human: "担当者", agent: "エージェント", tool: "ツール" }, allKinds: "すべての種類", allStates: "すべての状態", active: "有効", inactive: "無効", registered: "登録済み",
  search: "名前・識別情報・役割を検索", reset: "絞り込みをリセット", count: "{{visible}} / {{total}} メンバーとリソース",
  empty: "メンバーが登録されていません", emptyHint: "プロジェクト担当者、エージェント、ツールを登録してください。", noMatches: "一致するメンバーがありません", noMatchesHint: "検索条件を変更するか、絞り込みをリセットしてください。",
  details: "メンバー詳細", inspect: "メンバーを表示", role: "役割の説明", roleHint: "役割の説明は共同作業の分担を表し、アカウント権限や実行権限を付与しません。", identityHint: "タスクは固定識別情報で割り当てます。名前の変更によって担当者や承認結果は変わりません。", toolHint: "ツールは機能とキャパシティ予約に参加し、タスクの承認責任者にはなれません。", agentHint: "チーム登録と実行設定は別です。実行者とデバイスはタスクの割当時に選択します。",
  assignedTasks: "担当タスク", noTasks: "担当タスクはありません", calendar: "キャパシティカレンダー", calendarUnavailable: "カレンダーを取得できません。再試行してください。", calendarUnknown: "カレンダーが未設定です", configureCalendar: "カレンダーを設定", viewCapacity: "キャパシティを表示", edit: "登録情報を編集", people: "プロジェクト担当者を管理", readOnly: "詳細は閲覧できます。登録情報とカレンダーの変更にはプロジェクト設定権限が必要です。", inactiveHint: "無効なメンバーには新規割当できません。既存タスクは再割当するまで同じ識別情報を保持します。", missing: "メンバーが離脱またはアクセス不可", missingHint: "同名のメンバーには置き換えません。チームに戻って別のメンバーを選択してください。", back: "チームに戻る", owner: "担当者", keepOwner: "担当者を維持", clearOwner: "担当者を解除", rosterFailed: "メンバーを取得できません。再試行してから割り当ててください。", retry: "再試行", stableId: "固定識別情報", unavailableOwner: "現在の担当者はこのタスクを担当できません。再割当してください。",
};
export const teamIdentityTranslations = { "zh-CN": zh, "en-US": en, "ja-JP": ja };
