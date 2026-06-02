import { Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { getThemePreference, setThemePreference, THEME_OPTIONS, type ThemePreference } from "@/lib/theme";

export function SettingsAppearancePanel() {
  const { t } = useTranslation();
  const [themePref, setThemePref] = useState<ThemePreference>(() => getThemePreference());

  useEffect(() => {
    const sync = () => setThemePref(getThemePreference());
    window.addEventListener("sop-theme", sync);
    return () => window.removeEventListener("sop-theme", sync);
  }, []);

  return (
    <Card title={t("page.settings.themeCard")}>
      <p className="mb-3 text-sm leading-6 text-[var(--muted)]">{t("theme.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {THEME_OPTIONS.map((theme) => (
          <button
            key={theme}
            type="button"
            onClick={() => {
              setThemePreference(theme);
              setThemePref(theme);
            }}
            className={`rounded-xl border p-3 text-left transition ${
              themePref === theme
                ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
            }`}
          >
            <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
              <Palette className="h-4 w-4" />
            </span>
            <span className="block text-sm font-semibold">{t(`theme.${theme}`)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
