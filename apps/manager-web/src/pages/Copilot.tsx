import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Copilot() {
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: (s: string) => api.copilotAsk(s) });
  return (
    <Card title="AI Copilot">
      <div className="space-y-2">
        <textarea
          className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:bg-zinc-800 dark:border-zinc-700"
          rows={3}
          placeholder="问点什么…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded bg-brand-600 px-3 py-1 text-white hover:bg-brand-700 disabled:opacity-50"
          disabled={!q.trim() || ask.isPending}
          onClick={() => ask.mutate(q)}
        >
          Ask
        </button>
        {ask.data ? (
          <pre className="overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
            {JSON.stringify(ask.data, null, 2)}
          </pre>
        ) : null}
        {ask.error ? (
          <div className="text-red-600">{(ask.error as Error).message}</div>
        ) : null}
      </div>
    </Card>
  );
}
