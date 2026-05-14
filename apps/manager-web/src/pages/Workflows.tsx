import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Workflows() {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ["wf-types"], queryFn: api.workflowTypes });
  const [type, setType] = useState("");
  const [args, setArgs] = useState("{}");

  const start = useMutation({
    mutationFn: () => api.startWorkflow({ type, args: JSON.parse(args || "{}") }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-types"] }),
  });

  return (
    <div className="space-y-4">
      <Card title="Available Workflows">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {(types.data ?? []).map((t: any) => (
            <li key={t.type} className="py-2">
              <div className="font-mono text-sm">{t.type}</div>
              <div className="text-xs text-zinc-500">{t.description}</div>
              <div className="text-xs text-zinc-500">signals: {t.signals.join(", ") || "-"}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Start a workflow">
        <div className="space-y-2">
          <select
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:bg-zinc-800 dark:border-zinc-700"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">-- choose --</option>
            {(types.data ?? []).map((t: any) => (
              <option key={t.type} value={t.type}>
                {t.type}
              </option>
            ))}
          </select>
          <textarea
            className="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs dark:bg-zinc-800 dark:border-zinc-700"
            rows={6}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
          <button
            className="rounded bg-brand-600 px-3 py-1 text-white hover:bg-brand-700 disabled:opacity-50"
            disabled={!type || start.isPending}
            onClick={() => start.mutate()}
          >
            Start
          </button>
          {start.data ? (
            <pre className="overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
              {JSON.stringify(start.data, null, 2)}
            </pre>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
