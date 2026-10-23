import { Button, Input, Radio, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { dispatchChoiceKey, type DispatchChoice, type DispatchMode } from "@/lib/taskDispatchChoices";
import { taskDispatchChoiceReason, taskDispatchChoicesCopy } from "@/i18n/task-dispatch-choices";

export function TaskDispatchChoices({ options, value, search, limit, disabled, onSearch, onChoose, onMore }: {
  options: DispatchChoice[]; value: { mode: DispatchMode | null; member: string | null } | null; search: string; limit: number; disabled: boolean;
  onSearch: (value: string) => void; onChoose: (mode: DispatchMode, member: string) => void; onMore: () => void;
}) {
  const { i18n } = useTranslation(), copy = taskDispatchChoicesCopy(i18n?.language);
  const label = (row: DispatchChoice) => row.label === "member" ? row.title : copy[row.label];
  const method = (row: DispatchChoice) => row.mode === "external" ? copy.external : row.mode === "command" ? copy.command : copy.agent;
  const query = search.trim().toLowerCase(), matching = options.filter((row) => [label(row), row.tool, row.workspace, row.profile, row.member].join(" ").toLowerCase().includes(query));
  const key = value?.mode && value.member !== null ? dispatchChoiceKey(value.mode, value.member) : undefined, selected = options.find((row) => row.key === key);
  return <section className="space-y-3" aria-label={copy.title}>
    <p className="runtime-help">{copy.hint}</p>
    <label className="block"><span className="text-sm">{copy.search}</span><Input className="mt-1" aria-label={copy.search} value={search} maxLength={200} disabled={disabled} allowClear onChange={(event) => onSearch(event.target.value)} /></label>
    {selected && <p className="text-sm" role="status">{copy.selected}: <strong>{label(selected)}</strong> · {selected.mode === "external" ? copy.external : selected.mode === "command" ? copy.command : copy.agent}</p>}
    <p className="text-xs text-[var(--muted)]">{copy.results}: {matching.length} · {copy.available}: {matching.filter((row) => row.available).length}</p>
    <Radio.Group role="radiogroup" className="grid max-h-[50vh] w-full gap-2 overflow-y-auto overscroll-contain pr-1" aria-label={copy.title} value={key} disabled={disabled} onChange={(event) => { const row = options.find((item) => item.key === event.target.value); if (!disabled && row?.available) onChoose(row.mode, row.member); }}>
      {matching.slice(0, limit).map((row) => <div key={row.key} className={`rounded-lg border p-3 ${row.key === key ? "border-[var(--brand)] bg-[var(--surface-muted)]" : "border-[var(--border)]"}`}>
        <Radio className="w-full" aria-label={`${label(row)} · ${method(row)}`} value={row.key} disabled={disabled || !row.available}><strong className="break-words">{label(row)}</strong> <Tag color={row.available ? "success" : undefined}>{row.available ? copy.available : copy.unavailable}</Tag></Radio>
        <div className="mt-1 space-y-1 pl-6 text-sm"><p className="break-words">{method(row)}{row.tool && ` · ${row.tool}`}</p>
          {(row.workspace || row.profile) && <p className="break-words">{row.workspace} · {row.profile}{row.version !== undefined && ` · ${copy.version} ${row.version}`}</p>}
          {row.targetCount !== undefined && <p className="text-xs text-[var(--muted)]">{copy.targets}: {row.targetCount}</p>}
          {row.reasons.length > 0 && <><ul className="space-y-1 text-[var(--muted)]">{row.reasons.map((reason, index) => <li key={`${reason.code}:${index}`}>{taskDispatchChoiceReason(i18n?.language, reason)}</li>)}</ul><details className="text-xs text-[var(--muted)]"><summary>{copy.details}</summary>{row.reasons.map((reason, index) => <p key={index}><code>{reason.code}</code> · {reason.message}</p>)}</details></>}
        </div>
      </div>)}
    </Radio.Group>
    {!matching.length && <p className="runtime-help" role="status">{copy.noMatches}</p>}
    {matching.length > limit && <Button disabled={disabled} onClick={onMore}>{copy.more} · {Math.min(limit, matching.length)} / {matching.length}</Button>}
  </section>;
}
