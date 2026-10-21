import { useTranslation } from "react-i18next";
import type { ExecutionPreview } from "@/lib/deliveryExecution";
import { designDigest, validDesignReferences } from "@/lib/designLibrary";
import { designCopy } from "@/i18n/design-library";
import { DesignReferenceFacts } from "./DeliveryDesignContextPanel";
export function ExecutionAcceptanceSnapshot({
  snapshot,
  projectId,
}: {
  snapshot: Partial<ExecutionPreview["snapshot"]>;
  projectId?: string;
}) {
  const { t, i18n } = useTranslation();
  const copy = designCopy(i18n?.language);
  const tr = (key: string) => t(`deliveryTaskAcceptance.${key}`);
  if (!Array.isArray(snapshot.task_acceptance_criteria))
    return (
      <div>
        <p className="runtime-help">{tr("unrecordedCriteria")}</p>
        <ul>
          {snapshot.acceptance_criteria?.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="task-execution-acceptance-snapshot">
      <strong>{tr("ownCriteria")}</strong>
      {snapshot.task_acceptance_criteria.length ? (
        <ul>
          {snapshot.task_acceptance_criteria.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      ) : (
        <p className="runtime-help">{tr("none")}</p>
      )}
      {snapshot.requirement && (
        <>
          <strong>
            {tr("requirementCriteria")} · {snapshot.requirement.title}
          </strong>
          <p className="runtime-help">
            {t("deliveryTaskAcceptance.requirementSnapshot", {
              revision: snapshot.requirement.revision,
            })}
          </p>
          {snapshot.requirement.criteria_indices.length ? (
            <ul>
              {snapshot.requirement.criteria_indices.map((index) => (
                <li key={index}>
                  {snapshot.requirement!.acceptance_criteria[index] ||
                    tr("unrecordedCriteria")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="runtime-help">{tr("noReferences")}</p>
          )}
        </>
      )}
      {snapshot.owner && (
        <p className="runtime-help">
          {tr("owner")}: {snapshot.owner.name || snapshot.owner.id}
        </p>
      )}
      <section className="space-y-2"><strong>{copy.context}</strong>{validDesignReferences(snapshot.designs) && designDigest(snapshot.design_basis) ? projectId ? <DesignReferenceFacts references={snapshot.designs} projectId={projectId} background={typeof location === "undefined" ? "" : location.hash} /> : <ul>{snapshot.designs.map((item) => <li key={item.slot}>{copy.slots[item.slot]} · {item.title} · v{item.revision_number}</li>)}</ul> : <p className="runtime-help">{copy.invalid}</p>}</section>
    </div>
  );
}
