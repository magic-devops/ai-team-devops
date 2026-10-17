import { Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ExecutionTarget } from "@/lib/deliveryExecution";

export function ExecutionTargetFacts({ target }: { target: ExecutionTarget }) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  return (
    <section className="runtime-target-facts" aria-label={tr("target")}>
      <div className="runtime-section-heading">
        <strong>{target.kind === "local" ? tr("local") : target.name}</strong>
        <span>
          <Tag>{tr(target.kind === "local" ? "local" : "device")}</Tag>
          {target.kind === "device" && (
            <>
              <Tag color={target.online ? "success" : "warning"}>
                {tr(target.online ? "online" : "offline")}
              </Tag>
              <Tag>{tr(target.paired ? "paired" : "unpaired")}</Tag>
            </>
          )}
        </span>
      </div>
      {target.kind === "device" && (
        <p className="runtime-help">
          {tr("observed")} ·{" "}
          {target.last_seen_at
            ? new Date(target.last_seen_at).toLocaleString()
            : tr("noContact")}
        </p>
      )}
      <div className="runtime-target-columns">
        <div>
          <small>{tr("configured")}</small>
          <p>
            {target.policy.allowed_runtimes.length
              ? target.policy.allowed_runtimes.join(" · ")
              : "—"}
          </p>
          <p>{target.policy.allowed_providers.join(" · ") || "—"}</p>
        </div>
        <div>
          <small>{tr("reported")}</small>
          <p>
            {target.runtime_capabilities.length
              ? target.runtime_capabilities.join(" · ")
              : tr("noCapabilities")}
          </p>
          {target.providers.map((provider) => (
            <p key={provider.id}>
              <strong>{provider.id}</strong> ·{" "}
              {tr(provider.executable_present ? "detected" : "missing")}
              <br />
              <span className="runtime-help">
                {tr("authUnknown")}
                {provider.version ? ` · ${provider.version}` : ""}
              </span>
            </p>
          ))}
        </div>
      </div>
      {target.reason_codes.length > 0 && (
        <div role="note" className="runtime-target-reasons">
          <strong>{tr("reason")}</strong>
          {target.reason_codes.map((reason) => (
            <p key={reason}>
              {t(`deliveryRuntime.reason_${reason}`, { defaultValue: reason })}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
