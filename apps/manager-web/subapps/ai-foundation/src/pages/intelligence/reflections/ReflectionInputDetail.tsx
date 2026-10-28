import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { fetchReflectionInput } from "@/lib/reflectionReads";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { ReflectionProblem } from "./ReflectionCommon";
export function ReflectionInputDetail({ projectId, inputId, onOpenSource, disabled = false }: { projectId: string; inputId: string; onOpenSource: (id: string) => void; disabled?: boolean }) {
  const { t } = useTranslation(), session = projectSessionKey();
  const query = useQuery({ queryKey: ["reflection-input-exact", projectId, session, inputId], queryFn: ({ signal }) => fetchReflectionInput(projectId, inputId, signal), enabled: !!projectId && !!inputId && !disabled, retry: false, gcTime: 0, refetchOnWindowFocus: false });
  if (disabled) return null;
  if (query.error) return <ReflectionProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending || !query.data) return <Skeleton active />;
  const data = query.data;
  return <article className="reflections reflection-detail"><Tag color="blue">{t("reflections.prepared")}</Tag><h3>{data.input.title}</h3><Alert type="info" title={t("reflections.preparedHint")} /><dl className="reflection-facts"><div><dt>{t("reflections.createdAt")}</dt><dd>{data.input.created_at}</dd></div><div><dt>{t("reflections.createdBy")}</dt><dd>{data.input.created_by.name || data.input.created_by.id}</dd></div><div><dt>{t("reflections.sourceCount")}</dt><dd>{data.input.source_count}</dd></div></dl><h4>{t("reflections.rationale")}</h4><p className="reflection-statement">{data.rationale}</p>{!data.available && <Alert type="warning" title={t("reflections.membersUnavailable")} action={<Button onClick={() => void query.refetch()}>{t("reflections.refresh")}</Button>} />}<ol className="reflection-manifest">{data.sources.map((source) => <li key={source.reflection_id}><span>{source.reflection_id}</span><Tag>{t("reflections." + (source.available ? "sourceAvailable" : "sourceUnavailable"))}</Tag><Button disabled={!source.available || disabled} onClick={() => onOpenSource(source.reflection_id)}>{t("reflections.open")}</Button><details><summary>{t("reflections.identity")}</summary><code>{source.source_digest}</code><p>{source.attempt_id}</p></details></li>)}</ol><details><summary>{t("reflections.manifest")}</summary><p>{data.manifest_digest}</p><p>{t("reflections.version")} · {data.input.source_version}</p></details><Button onClick={() => void query.refetch()}>{t("reflections.refresh")}</Button></article>;
}
