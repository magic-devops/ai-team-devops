import { Alert, Button, Drawer, Empty, Input, Select, Tag } from "antd";
import { Bot, CalendarDays, Users, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DeliveryInboxTarget, DeliveryMember, DeliveryWorkspace } from "@/lib/delivery";
import type { DeliverySchedule, SchedulingRoute } from "@/lib/deliveryScheduling";
import { filterTeamMembers } from "@/lib/deliveryTeamIdentity";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { DeliveryMemberRuntime } from "./DeliveryMemberRuntime";
import "./delivery-team.css";

export function DeliveryTeamMembers({ workspace, schedule, calendarFailed, route, onRoute, onEdit, onCalendar, onRetryCalendar, onTask, sessionId, onSaved }: {
  workspace: DeliveryWorkspace; schedule?: DeliverySchedule; calendarFailed: boolean; route: SchedulingRoute;
  onRoute: (patch: Partial<SchedulingRoute>) => void; onEdit: (member: DeliveryMember) => void;
  onCalendar: (id: string) => void; onRetryCalendar: () => void; onTask: (target: DeliveryInboxTarget) => void;
  sessionId: string; onSaved: (workspace: DeliveryWorkspace) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) => t(`deliveryTeam.${key}`, values);
  const identity = useMemberIdentity();
  const hasTaskInspector = Boolean(new URLSearchParams(location.hash.split("?")[1]).get("task"));
  const requestedMemberId = hasTaskInspector ? "" : route.teamMemberId;
  const memberInspector = useDrawerIdentity(workspace.project.id, requestedMemberId);
  const members = filterTeamMembers(workspace.members, route);
  const selected = workspace.members.find((member) => member.id === memberInspector.displayId);
  const tasks = workspace.tasks.filter((task) => selected && task.owner_id === selected.id);
  const calendar = selected && schedule?.resources.find((resource) => resource.id === selected.id);
  const reset = () => onRoute({ teamKind: "all", teamState: "all", teamSearch: "" });
  const canConfigure = workspace.permissions.configure;
  return <section className="delivery-team-registry" aria-label={tr("identity")}>
    <div className="delivery-team-filters">
      <Input.Search aria-label={tr("search")} placeholder={tr("search")} value={route.teamSearch} allowClear onChange={(event) => onRoute({ teamSearch: event.target.value })} />
      <Select aria-label={tr("allKinds")} value={route.teamKind} options={[{ value: "all", label: tr("allKinds") }, ...["human", "agent", "tool"].map((kind) => ({ value: kind, label: tr(`kinds.${kind}`) }))]} onChange={(teamKind) => onRoute({ teamKind })} />
      <Select aria-label={tr("allStates")} value={route.teamState} options={[{ value: "all", label: tr("allStates") }, ...["active", "inactive"].map((state) => ({ value: state, label: tr(state) }))]} onChange={(teamState) => onRoute({ teamState })} />
      <Button type="text" onClick={reset}>{tr("reset")}</Button>
    </div>
    <div className="delivery-team-caption"><span>{tr("count", { visible: members.length, total: workspace.members.length })}</span><span>{tr("identityHint")}</span></div>
    {!canConfigure && <p className="delivery-hint">{tr("readOnly")}</p>}
    {!members.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>{tr(workspace.members.length ? "noMatches" : "empty")}</strong><p>{tr(workspace.members.length ? "noMatchesHint" : "emptyHint")}</p></>}>
      {workspace.members.length ? <Button onClick={reset}>{tr("reset")}</Button> : <Button href="#/projects/members">{tr("people")}</Button>}
    </Empty> : <div className="delivery-schedule-members">
      {members.map((member) => {
        const Icon = member.kind === "human" ? Users : member.kind === "agent" ? Bot : Wrench;
        const resource = schedule?.resources.find((item) => item.id === member.id);
        const owned = workspace.tasks.filter((task) => task.owner_id === member.id).length;
        return <article key={member.id}>
          <div className="delivery-schedule-member-heading"><span><Icon size={20} aria-hidden /></span><div><h3><button className="delivery-team-member-link" onClick={() => onRoute({ teamMemberId: member.id })}>{member.name}</button></h3><small>{tr(`kinds.${member.kind}`)}</small></div><Tag color={member.active ? undefined : "warning"}>{tr(member.active ? "registered" : "inactive")}</Tag></div>
          <code className="delivery-team-id">{member.id}</code>
          <p>{tr("role")}: {member.role || "—"}</p>
          {member.kind !== "tool" && <p>{tr("assignedTasks")} · {owned}</p>}
          <p><CalendarDays size={14} aria-hidden />{tr(calendarFailed ? "calendarUnavailable" : resource?.calendar ? "calendar" : "calendarUnknown")}</p>
          <div className="delivery-actions"><Button size="small" onClick={() => onRoute({ teamMemberId: member.id })}>{tr("details")}</Button><Button size="small" type="text" onClick={() => onRoute({ teamMode: "capacity", memberId: member.id, teamMemberId: "" })}>{tr("viewCapacity")}</Button></div>
        </article>;
      })}
    </div>}
    <Drawer title={tr("details")} open={Boolean(requestedMemberId)} width={560} className="delivery-inspector delivery-team-inspector" destroyOnHidden afterOpenChange={memberInspector.afterOpenChange} onClose={() => onRoute({ teamMemberId: "" })}>
      {!selected ? <Alert type="warning" title={tr("missing")} description={tr("missingHint")} action={<Button onClick={() => onRoute({ teamMemberId: "" })}>{tr("back")}</Button>} /> : <>
        <div className="delivery-team-detail-heading"><h3>{selected.name}</h3><Tag>{tr(`kinds.${selected.kind}`)}</Tag><Tag color={selected.active ? undefined : "warning"}>{tr(selected.active ? "active" : "inactive")}</Tag></div>
        <dl className="delivery-team-facts"><div><dt>{tr("stableId")}</dt><dd><code>{selected.id}</code></dd></div><div><dt>{tr("role")}</dt><dd>{selected.role || "—"}</dd></div>{selected.tool && <div><dt>{t("delivery.tool")}</dt><dd>{selected.tool}</dd></div>}</dl>
        <p className="delivery-hint">{tr("roleHint")}</p>
        {selected.kind !== "human" && <p className="delivery-hint">{tr(selected.kind === "tool" ? "toolHint" : "agentHint")}</p>}
        {!selected.active && <Alert type="warning" title={tr("inactive")} description={tr("inactiveHint")} />}
        {!canConfigure && <p className="delivery-hint">{tr("readOnly")}</p>}
        <div className="delivery-actions">
          {selected.kind === "human" ? <Button href="#/projects/members">{tr("people")}</Button> : canConfigure && <Button onClick={() => onEdit(selected)}>{tr("edit")}</Button>}
          {canConfigure && selected.active && <Button disabled={!calendar?.kind || calendarFailed} onClick={() => onCalendar(selected.id)}>{tr("configureCalendar")}</Button>}
        </div>
        {calendarFailed && <Alert type="error" title={tr("calendarUnavailable")} action={<Button size="small" onClick={onRetryCalendar}>{tr("retry")}</Button>} />}
        {selected.kind === "agent" && <DeliveryMemberRuntime key={`${workspace.project.id}:${sessionId}:${selected.id}`} member={selected} projectId={workspace.project.id} sessionId={sessionId} onSaved={onSaved} />}
        {selected.kind !== "tool" && <section className="delivery-team-task-list"><h4>{tr("assignedTasks")} · {tasks.length}</h4>{!tasks.length ? <p className="delivery-hint">{tr("noTasks")}</p> : tasks.map((task) => <Button key={task.id} type="link" onClick={() => onTask({ view: "team", requirement_id: task.req_id, task_id: task.id, detail: "tasks" })}><span>{task.title}<small>{identity(workspace.members, task.owner_id)}</small></span></Button>)}</section>}
      </>}
    </Drawer>
  </section>;
}
