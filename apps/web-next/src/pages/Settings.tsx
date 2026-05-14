import { useState } from "react";
import { Card } from "../components/Card";

export function Settings() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  return (
    <Card title="Preferences">
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          theme:
          <select
            value={theme}
            onChange={(e) => {
              const v = e.target.value as "light" | "dark";
              setTheme(v);
              document.documentElement.classList.toggle("dark", v === "dark");
            }}
            className="rounded border border-zinc-300 px-2 py-1 dark:bg-zinc-800 dark:border-zinc-700"
          >
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </label>
      </div>
    </Card>
  );
}
