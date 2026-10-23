import { runtimeTranslations } from "./delivery-runtime";
import { teamRuntimeTranslations } from "./delivery-team-runtime";
import { externalWorkOrderReason } from "./external-work-orders";
const en = { title: "Choose an execution resource", hint: "Select a resource once, then review the execution target, tests and plan before dispatch.", search: "Search member, tool or workspace", available: "Available for selection", unavailable: "Unavailable", selected: "Current selection", results: "Matching resources", more: "Show more resources", noMatches: "No matching resources. Try a different name or clear the search.", direct: "Choose an Agent configuration", command: "Create a command plan", external_empty: "No external members", agent: "Platform execution", external: "External collaboration", targets: "Eligible execution targets", version: "Version", details: "Reason details", unknown: "Current capabilities do not permit this selection." };
type Copy = typeof en;
const zh: Copy = { title: "选择执行资源", hint: "一次选择资源，下一步核对执行位置、测试与计划，再确认派发。", search: "搜索成员、工具或工作区", available: "当前可选", unavailable: "暂不可用", selected: "当前选择", results: "匹配资源", more: "显示更多资源", noMatches: "没有匹配的资源，请更换名称或清空搜索。", direct: "直接选择 Agent 配置", command: "编排命令计划", external_empty: "暂无外部协作成员", agent: "平台执行", external: "外部协作", targets: "可选执行位置", version: "版本", details: "原因详情", unknown: "当前能力不允许选择此资源。" };
const ja: Copy = { title: "実行リソースを選択", hint: "リソースを選び、次に実行先・テスト・計画を確認して依頼します。", search: "メンバー・ツール・ワークスペースを検索", available: "現在選択可能", unavailable: "利用不可", selected: "現在の選択", results: "一致するリソース", more: "さらに表示", noMatches: "一致するリソースがありません。検索を変更または解除してください。", direct: "Agent 設定を直接選択", command: "コマンド計画を作成", external_empty: "外部協業メンバーなし", agent: "プラットフォーム実行", external: "外部協業", targets: "選択可能な実行先", version: "バージョン", details: "理由の詳細", unknown: "現在の実行能力では選択できません。" };
const reasons: Record<string, readonly [string, string, string]> = {
  dispatch_write_required: ["当前项目没有写入权限。", "Project write permission is required.", "プロジェクトの書き込み権限が必要です。"],
  dispatch_task_blocked: ["任务的当前执行条件尚未满足。", "Current task execution conditions are not met.", "現在のタスク実行条件が満たされていません。"],
  dispatch_external_unreadable: ["外部工单状态未读取成功，请重新读取当前能力。", "External work-order state is unavailable. Read current capabilities again.", "外部作業状態を取得できません。現在の実行能力を再取得してください。"],
  dispatch_runtime_unreadable: ["平台执行能力未读取成功，请重新读取当前能力。", "Platform runtime facts are unavailable. Read current capabilities again.", "実行情報を取得できません。現在の実行能力を再取得してください。"],
  dispatch_runtime_unavailable: ["平台执行当前不可用，请核对执行权限和运行服务。", "Platform execution is unavailable. Review execution permissions and runtime service.", "プラットフォーム実行を利用できません。実行権限とサービスを確認してください。"],
  dispatch_active_order: ["仍有活跃外部工单，请先确认停止并结束该工单。", "An external order is active. Confirm work has stopped and close it first.", "外部作業依頼が有効です。作業停止を確認し、先に終了してください。"],
  dispatch_profile_changed: ["成员的固定配置或版本当前不可用，请更新关联。", "The member's pinned configuration or version is unavailable. Update its association.", "固定設定またはバージョンが利用できません。関連付けを更新してください。"],
  dispatch_no_targets: ["当前没有同时满足运行权限、程序与策略的执行位置。", "No execution target meets current runtime, program and policy requirements.", "現在の実行権限・プログラム・ポリシーを満たす実行先がありません。"],
  dispatch_external_unavailable: ["当前不允许派发外部工单。", "External dispatch is currently unavailable.", "現在は外部作業を依頼できません。"],
  dispatch_member_unavailable: ["此成员已停用或当前不可用。", "This member is inactive or unavailable.", "このメンバーは無効または利用不可です。"],
  dispatch_no_external_members: ["请先在团队中登记可用的 Agent 或开发工具。", "Add an available Agent or development tool to the team first.", "先に利用可能な Agent または開発ツールをチームへ登録してください。"],
};
export function taskDispatchChoicesCopy(language?: string) { return language?.startsWith("zh") ? zh : language?.startsWith("ja") ? ja : en; }
export function taskDispatchChoiceReason(language: string | undefined, value: { code: string; message: string }) {
  const locale = language?.startsWith("zh") ? "zh-CN" : language?.startsWith("ja") ? "ja-JP" : "en-US";
  return reasons[value.code]?.[locale === "zh-CN" ? 0 : locale === "ja-JP" ? 2 : 1]
    || (teamRuntimeTranslations[locale].reasons as Record<string, string>)[value.code]
    || (runtimeTranslations[locale] as Record<string, string>)[`reason_${value.code}`]
    || externalWorkOrderReason(language || "en-US", value) || taskDispatchChoicesCopy(language).unknown;
}
