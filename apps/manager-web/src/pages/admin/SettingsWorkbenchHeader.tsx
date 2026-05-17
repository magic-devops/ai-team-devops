import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "../../components/ai/AiAssistDrawer";
import { RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

export function SettingsWorkbenchHeader() {
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const healthQ = useQuery({ queryKey: ["health"], queryFn: api.health });
  const billingQ = useQuery({ queryKey: ["billingSubscription"], queryFn: api.billingSubscription });
  const alertsQ = useQuery({ queryKey: ["billingAlerts"], queryFn: api.billingAlerts });
  const meQ = useQuery({ queryKey: ["authMe"], queryFn: api.authMe });

  const health = healthQ.data;
  const plan = billingQ.data?.subscription?.plan;

  return (
    <>
      <WorkbenchShell
        title={t("page.settings.title")}
        description={t("page.settings.workbenchDesc")}
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton
              onClick={() => {
                void healthQ.refetch();
                void billingQ.refetch();
                void alertsQ.refetch();
                void meQ.refetch();
              }}
              pending={healthQ.isFetching || billingQ.isFetching || alertsQ.isFetching}
            />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              {
                label: t("page.settings.healthTitle"),
                value: health?.ok ? t("page.settings.healthOk") : healthQ.isError ? t("page.settings.healthBad") : "—",
              },
              { label: t("page.settings.version"), value: String(health?.version ?? "—") },
              { label: t("page.settings.billingPlan"), value: String(plan ?? "—") },
              {
                label: t("page.settings.billingAlerts"),
                value: alertsQ.data?.total ?? 0,
              },
            ]}
          />
        }
      />

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="admin.settings"
        context={{
          health_ok: health?.ok,
          version: health?.version,
          tenant: meQ.data?.tenant_slug,
          plan,
        }}
        initialPrompt={t("page.settings.aiCopilotPrefill")}
      />
    </>
  );
}
