import { Drawer } from "antd";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CopilotChatPanel } from "./CopilotChatPanel";

export function AiAssistDrawer({
  open,
  onClose,
  title,
  module,
  context,
  initialPrompt = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  module: string;
  context?: Record<string, unknown>;
  initialPrompt?: string;
}) {
  const { t } = useTranslation();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={440}
      title={
        <span className="inline-flex items-center gap-2">
          <Bot className="h-4 w-4 text-[var(--brand)]" />
          {title ?? t("aiAssist.title")}
        </span>
      }
      destroyOnClose
    >
      <CopilotChatPanel module={module} context={context} initialPrompt={initialPrompt} />
    </Drawer>
  );
}

export function AiAssistButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand-softer)] px-3 py-1.5 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand-soft)]"
    >
      <Bot className="h-4 w-4" />
      {label ?? t("aiAssist.open")}
    </button>
  );
}
