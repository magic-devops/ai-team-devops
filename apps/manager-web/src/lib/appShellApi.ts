import type { SessionPayload } from "./authStorage";
import { request } from "./http";

export const appShellApi = {
  authMe: () => request<SessionPayload>("/api/v1/auth/me"),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  projects: () => request<any[]>("/api/v1/projects"),
  businesses: () => request<any[]>("/api/v1/businesses"),
  copilotCommands: (q = "", limit = 30) => {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    return request<{ ok: boolean; items: any[]; total: number }>(`/api/v1/copilot/commands?${qs}`);
  },
  workspaceSearch: (q: string) =>
    request<Array<{ type: string; id?: string; title?: string; description?: string; snippet?: string }>>(
      `/api/v1/search?q=${encodeURIComponent(q)}`,
    ),
  systemPagesMenuPreferencesMe: () => request<any>("/api/v1/system/pages/menu/preferences/me"),
  systemPagesMenuPreferencesUpdate: (body: {
    favorites?: string[];
    quick_access?: string[];
    recents?: string[];
    density?: string;
    menu_layout?: string;
    menu_effect?: string;
    show_recents?: boolean;
    show_favorites?: boolean;
    show_menu_counts?: boolean;
    show_menu_meta?: boolean;
    show_quick_panel?: boolean;
    collapsed_groups?: Record<string, boolean>;
    collapsed_categories?: Record<string, boolean>;
    collapsed_modules?: Record<string, boolean>;
  }) =>
    request<any>("/api/v1/system/pages/menu/preferences/me", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
