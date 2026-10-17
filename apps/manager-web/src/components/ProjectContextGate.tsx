import { Alert, Button, Skeleton, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getProjectId, getToken } from "../lib/authStorage";
import { enterPortfolioProject, fetchProjectPortfolioDetail, projectSessionKey } from "../lib/projectPortfolio";
import { portfolioHash, portfolioReturnFromHash, routeProjectId } from "../lib/projectPortfolioRoute";
import "../../subapps/main-admin/src/pages/projects/project-portfolio.css";
const subscribe = (callback: () => void) => {
  for (const event of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(event, callback);
  return () => { for (const event of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(event, callback); };
};
const snapshot = () => JSON.stringify([window.location.hash, projectSessionKey()]);
export function ProjectContextGate({ children }: { children: ReactNode }) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const requestedId = routeProjectId(window.location.hash);
  const mismatch = Boolean(requestedId && requestedId !== getProjectId());
  const back = portfolioReturnFromHash(window.location.hash);
  const query = useQuery({ queryKey: ["projectContext", projectSessionKey(), requestedId], queryFn: ({ signal }) => fetchProjectPortfolioDetail(requestedId, signal), enabled: Boolean(mismatch && getToken()) });
  if (mismatch) return <section className="project-context-gate">
    <h2>{tr("contextTitle")}</h2><p>{tr("contextHint")}</p><span className="project-portfolio-id">{requestedId}</span>
    {query.isLoading && <Skeleton active />}
    {query.isError && <Alert type="warning" title={tr("unavailableProject")} />}
    {query.data && query.data.project.id === requestedId && <><strong>{query.data.project.name}</strong><Tag>{tr(query.data.project.status)}</Tag><Button type="primary" disabled={!query.data.project.permissions.can_enter || query.isError} onClick={() => { enterPortfolioProject(query.data!.project); }}>{tr("enter")}</Button></>}
    <Button href={back || portfolioHash()}>{tr("back")}</Button>
  </section>;
  return <>{back && <div className="mb-3"><Button href={back}>{tr("back")}</Button></div>}{children}</>;
}
