import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Alert, Button, Select, Space } from "antd";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getProjectId, getToken } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { fetchDeliveryReferences, type DeliveryReference, type DeliveryReferenceKind } from "@/lib/deliveryQuery";
import { localReferenceChoice, referenceChoices, referenceChangeAllowed, type ReferenceChoice } from "@/lib/deliveryReferenceState";
import "./delivery-reference-select.css";

type ReferenceProps = {
  kind: DeliveryReferenceKind; value?: string | string[]; onChange?: (value: any) => void;
  multiple?: boolean; disabled?: boolean; label?: string; options?: ReferenceChoice[];
  filter?: (data: Record<string, unknown>) => boolean; queryGeneration?: number | null;
  formatLabel?: (item: DeliveryReference) => string;
};
export const deliveryReferenceScope = (kind: DeliveryReferenceKind, generation?: number | null) =>
  JSON.stringify([projectSessionKey(), typeof location === "undefined" ? "" : location.hash, kind, generation === undefined ? "live" : generation]);
const subscribe = (notify: () => void) => {
  for (const event of ["sop-session", "storage", "hashchange", "popstate"]) window.addEventListener(event, notify);
  return () => { for (const event of ["sop-session", "storage", "hashchange", "popstate"]) window.removeEventListener(event, notify); };
};
export function DeliveryReferenceSelect(props: ReferenceProps) {
  const scope = useSyncExternalStore(subscribe, () => deliveryReferenceScope(props.kind, props.queryGeneration), () => "server");
  return <DeliveryReferencePicker key={scope} {...props} projectId={getProjectId() || ""} scope={scope} />;
}

/** A scope change remounts search/pagination, while old event callbacks fail closed. */
export function DeliveryReferencePicker({ kind, value, onChange, multiple, disabled, label, options: initial = [], filter,
  queryGeneration, formatLabel, projectId, scope }: ReferenceProps & { projectId: string; scope: string }) {
  const { t } = useTranslation(), tr = (key: string) => t(`deliveryQuery.${key}`), statusId = useId();
  const [q, setQ] = useState(""), [attempt, setAttempt] = useState(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const localIds = new Set(initial.filter(localReferenceChoice).map((option) => option.value));
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const ids = values.filter((id) => !localIds.has(id));
  const enabled = Boolean(projectId && projectId === getProjectId() && getToken() && scope === deliveryReferenceScope(kind, queryGeneration));
  const remoteEnabled = enabled && queryGeneration !== null;
  const query = useInfiniteQuery({ queryKey: ["delivery-reference-options", projectId, scope, attempt, q], initialPageParam: "",
    queryFn: ({ pageParam, signal }) => fetchDeliveryReferences(projectId, kind, { q, cursor: pageParam, limit: 50 }, signal, queryGeneration),
    getNextPageParam: (page) => page.next_cursor || undefined, enabled: remoteEnabled, retry: false, gcTime: 0 });
  const selected = useQuery({ queryKey: ["delivery-reference-selected", projectId, scope, attempt, ids],
    queryFn: ({ signal }) => fetchDeliveryReferences(projectId, kind, { ids, limit: 100 }, signal, queryGeneration),
    enabled: remoteEnabled && ids.length > 0, retry: false, gcTime: 0 });
  const choices = referenceChoices({ projectId, kind, generation: queryGeneration, search: q, values, local: initial, filter, formatLabel,
    pages: query.data?.pages, listPending: query.isPending || query.isFetching && !query.isFetchingNextPage, listFailed: query.isError,
    selectedPage: selected.data, selectedPending: selected.isPending || selected.isFetching, selectedFailed: selected.isError });
  const requestKey = JSON.stringify([q, attempt]);
  const live = useRef({ scope, disabled, enabled, values, choices, multiple, requestKey });
  live.current = { scope, disabled, enabled, values, choices, multiple, requestKey };
  const current = () => mounted.current && live.current.scope === scope && live.current.enabled && !live.current.disabled &&
    scope === deliveryReferenceScope(kind, queryGeneration);
  const retry = () => { if (current()) setAttempt((n) => n + 1); };
  const change = (next: unknown) => {
    if (!current() || !referenceChangeAllowed(next, live.current.values, live.current.multiple, live.current.choices.allowed)) return;
    const previous = live.current.multiple ? live.current.values : live.current.values[0] || "";
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    live.current.values = Array.isArray(next) ? next : next ? [next as string] : [];
    onChange?.(next);
  };
  const options = choices.options.map((option) => ({ value: option.value, label: choices.unavailable.has(option.value)
    ? `${option.label} · ${tr(choices.selectedIssue === "loading" && ids.includes(option.value) ? "referenceChecking" : "unavailable")}` : option.label, disabled: option.disabled }));
  const issue = !enabled ? "referenceScopeUnavailable" : queryGeneration === null ? "rebuildRequired" :
    choices.listIssue === "failed" || choices.selectedIssue === "failed" ? "referenceReadFailed" :
    choices.listIssue === "changed" || choices.selectedIssue === "changed" ? "changed" : "";
  return <div className="delivery-reference-field">
    <Select className="delivery-reference-select" aria-label={label} aria-describedby={statusId}
      mode={multiple ? "multiple" : undefined} value={value} disabled={disabled || !enabled} options={options}
      showSearch filterOption={false} searchValue={q} onSearch={(text) => { if (current()) setQ(text); }}
      onChange={change} loading={remoteEnabled && (query.isFetching || ids.length > 0 && selected.isFetching)} popupMatchSelectWidth
      notFoundContent={tr(issue || (query.isPending ? "referenceLoading" : "referenceEmpty"))}
      popupRender={(menu) => <>{menu}{query.hasNextPage && !choices.listIssue && <Button type="text" block
        loading={query.isFetchingNextPage} onClick={() => { if (current() && live.current.requestKey === requestKey && !live.current.choices.listIssue && !query.isFetchingNextPage) void query.fetchNextPage(); }}>
        {tr("more")}</Button>}{issue && remoteEnabled && <Button block onClick={retry}>{tr("firstPage")}</Button>}</>} />
    <div id={statusId} className="delivery-reference-status" aria-live="polite">
      {issue ? <Alert type="warning" showIcon title={tr(issue)} description={choices.selectedIssue === "failed" ? tr("referenceSelectedFailed") : undefined}
        action={remoteEnabled ? <Button size="small" onClick={retry} disabled={disabled}>{tr("retry")}</Button> : undefined} />
        : choices.selectedIssue === "loading" ? <small>{tr("referenceSelectedLoading")}</small>
          : choices.unavailable.size > 0 ? <small>{tr("referenceSelectedUnavailable")}</small>
            : q && !choices.allowed.size ? <small>{tr("referenceEmpty")}</small> : null}
      {q && <Space size="small"><small>{t("deliveryQuery.referenceSearch", { query: q })}</small>
        <Button type="link" size="small" disabled={disabled || !enabled} onClick={() => { if (current()) setQ(""); }}>{tr("referenceClearSearch")}</Button></Space>}
      {choices.unavailable.size > 0 && (multiple || choices.allowed.has("")) && <ul className="delivery-reference-unavailable">
        {[...choices.unavailable].map((id) => <li key={id}><span>{choices.options.find((option) => option.value === id)?.label || id}</span>
          <Button type="link" size="small" disabled={disabled || !enabled} aria-label={t("deliveryQuery.referenceRemove", { id })}
            onClick={() => { if (current() && live.current.values.includes(id) && live.current.choices.unavailable.has(id))
              change(live.current.multiple ? live.current.values.filter((value) => value !== id) : ""); }}>{tr("referenceRemoveAction")}</Button>
        </li>)}
      </ul>}
    </div>
  </div>;
}
