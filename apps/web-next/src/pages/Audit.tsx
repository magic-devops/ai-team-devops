import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Audit() {
  const state = useQuery({ queryKey: ["audit-state"], queryFn: api.auditState });
  const verify = useQuery({
    queryKey: ["audit-verify"],
    queryFn: api.auditVerify,
  });
  return (
    <div className="space-y-4">
      <Card title="Chain Head">
        <pre className="overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
          {JSON.stringify(state.data, null, 2)}
        </pre>
      </Card>
      <Card title="Verify">
        <div>
          <div className="text-sm">
            ok:{" "}
            <span
              className={
                verify.data?.ok ? "text-emerald-600" : "text-red-600 font-semibold"
              }
            >
              {String(verify.data?.ok ?? "—")}
            </span>{" "}
            · total: {verify.data?.total ?? "—"}
          </div>
          {verify.data?.errors?.length ? (
            <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700">
              {JSON.stringify(verify.data.errors, null, 2)}
            </pre>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
