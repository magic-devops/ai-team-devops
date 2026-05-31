import { Button, Input, Segmented, Space } from "antd";
import { ClipboardCheck, Loader2, MessageSquareText, SearchCheck, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommandTypeFilter, CopilotMode, PlanTemplate, QuickPrompt } from "./copilotTypes";

type Props = {
  mode: CopilotMode;
  chatPrompts: QuickPrompt[];
  sessionsCount: number;
  currentTurnsCount: number;
  cachedTurnsCount: number;
  onSelectPrompt: (prompt: string) => void;
  commandSearch: string;
  onCommandSearchChange: (value: string) => void;
  commandQuickFilters: string[];
  commandTypeFilter: CommandTypeFilter;
  commandTypeFilters: Array<{ label: string; value: CommandTypeFilter }>;
  onCommandTypeFilterChange: (value: CommandTypeFilter) => void;
  planTemplates: PlanTemplate[];
  canGeneratePlan: boolean;
  planPending: boolean;
  onGeneratePlan: () => void;
};

export function CopilotModeActionDock({
  mode,
  chatPrompts,
  sessionsCount,
  currentTurnsCount,
  cachedTurnsCount,
  onSelectPrompt,
  commandSearch,
  onCommandSearchChange,
  commandQuickFilters,
  commandTypeFilter,
  commandTypeFilters,
  onCommandTypeFilterChange,
  planTemplates,
  canGeneratePlan,
  planPending,
  onGeneratePlan,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="copilotModeActionDock mt-4 rounded-xl border border-white/70 bg-white/80 p-3 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
      {mode === "chat" ? (
        <div className="copilotChatSessionDock grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">接入会话上下文</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {chatPrompts.map((item) => (
                <Button key={item.label} size="small" icon={<MessageSquareText className="h-3.5 w-3.5" />} onClick={() => onSelectPrompt(item.prompt)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ["会话", sessionsCount],
              ["当前", currentTurnsCount],
              ["缓存", cachedTurnsCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-[var(--surface-muted)] px-2 py-2">
                <p className="text-base font-semibold text-[var(--text)]">{value}</p>
                <p className="text-[11px] text-[var(--muted)]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "commands" ? (
        <div className="copilotCommandHeroSearch grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <Input.Search
            allowClear
            value={commandSearch}
            onChange={(event) => onCommandSearchChange(event.target.value)}
            onSearch={onCommandSearchChange}
            placeholder={t("command.placeholder")}
          />
          <Space wrap>
            {commandQuickFilters.map((keyword) => (
              <Button key={keyword} size="small" icon={<SearchCheck className="h-3.5 w-3.5" />} onClick={() => onCommandSearchChange(keyword)}>
                {keyword}
              </Button>
            ))}
          </Space>
          <div className="copilotCommandTypeFilter max-w-full overflow-x-auto lg:col-span-2">
            <Segmented
              value={commandTypeFilter}
              onChange={(value) => onCommandTypeFilterChange(value as CommandTypeFilter)}
              options={commandTypeFilters}
            />
          </div>
        </div>
      ) : null}

      {mode === "tool-plan" ? (
        <div className="copilotPlanDraftCard grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">选择目标模板</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {planTemplates.map((item) => (
                <Button key={item.label} size="small" icon={<ClipboardCheck className="h-3.5 w-3.5" />} onClick={() => onSelectPrompt(item.prompt)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <Button
            type="primary"
            icon={planPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
            disabled={!canGeneratePlan || planPending}
            onClick={onGeneratePlan}
          >
            {t("copilot.plan")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
