import { Alert, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { TaskAcceptance } from "@/lib/taskAcceptance";
export function TaskAcceptanceFacts({
  acceptance,
}: {
  acceptance: TaskAcceptance | null;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTaskAcceptance.${key}`);
  if (!acceptance)
    return <p className="runtime-help">{tr("unrecordedCriteria")}</p>;
  return (
    <section
      className="task-acceptance-facts"
      aria-label={tr("effectiveCriteria")}
    >
      <strong>{tr("effectiveCriteria")}</strong>
      {!acceptance.available && (
        <Alert type="warning" title={tr("unavailable")} />
      )}
      {acceptance.criteria.length ? (
        <ol>
          {acceptance.sources.map((item, index) => (
            <li key={`${item.source}:${item.index}:${index}`}>
              <Tag>
                {tr(
                  item.source === "task" ? "sourceTask" : "sourceRequirement",
                )}
              </Tag>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="runtime-help">{tr("empty")}</p>
      )}
    </section>
  );
}
