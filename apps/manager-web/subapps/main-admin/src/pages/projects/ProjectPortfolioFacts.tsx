import { Progress, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { activeRiskCategories, type PortfolioRow } from "@/lib/projectPortfolio";
export function ProjectPortfolioFacts({ row }: { row: Pick<PortfolioRow, "metrics" | "risk_counts" | "facts_as_of" | "unclosed_intents_total"> }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  return <section className="project-portfolio">
    <div className="project-portfolio-facts">{[["verified", row.metrics.verified_completed], ["recorded", row.metrics.recorded_completed], ["totalTasks", row.metrics.tasks_total], ["unclosed", row.unclosed_intents_total]].map(([key, value]) => <article key={key}><strong>{value}</strong><small>{tr(String(key))}</small></article>)}</div>
    <Progress percent={row.metrics.tasks_total ? Math.round(row.metrics.verified_completed / row.metrics.tasks_total * 100) : 0} size="small" />
    <div className="project-portfolio-risk-tags">{activeRiskCategories(row.risk_counts).map((code) => <Tag key={code} color="orange">{tr(`risk.${code}`)} {row.risk_counts[code]}</Tag>)}</div>
    <small>{row.risk_counts.total_items} {tr("uniqueRisks")} · {tr("overlapHint")}</small>
    <small>{tr("asOf")} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.facts_as_of))}</small>
  </section>;
}
