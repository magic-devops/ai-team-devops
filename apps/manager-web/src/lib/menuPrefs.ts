/**
 * @module menuPrefs
 * @purpose 用户级菜单偏好持久化：收藏、最近访问、侧栏密度、键盘提示
 *
 * 设计原则：
 *   1. 本地优先 — 当前用户态在 localStorage，未来可与 Manager 同步（user_settings.menu_prefs）。
 *   2. 按租户/用户 scope — 避免不同用户/租户混用。
 *   3. 纯函数 + 事件 — 通过 window.dispatchEvent("sop-menu-prefs") 通知 UI 刷新。
 *   4. AI 安全 — 字段稳定，新增字段需 bump SCHEMA_VERSION 并提供 migrate。
 */

export const MENU_PREFS_SCHEMA_VERSION = 1;
const STORAGE_KEY = "sop-menu-prefs-v1";
const MENU_PREFS_EVENT = "sop-menu-prefs";

export type MenuDensity = "comfortable" | "compact" | "cozy";

export type MenuPrefs = {
  schema: number;
  /** 用户收藏的菜单 key，顺序即展示顺序 */
  favorites: string[];
  /** 最近访问菜单 key，最新在前，最多 8 个 */
  recents: string[];
  /** 侧栏密度 */
  density: MenuDensity;
  /** 是否显示「最近访问」分区 */
  showRecents: boolean;
  /** 是否显示「收藏」分区 */
  showFavorites: boolean;
  /** 用户手动设置过侧栏宽度（px） */
  sidebarWidth?: number;
};

const DEFAULT_PREFS: MenuPrefs = {
  schema: MENU_PREFS_SCHEMA_VERSION,
  favorites: [],
  recents: [],
  density: "comfortable",
  showRecents: true,
  showFavorites: true,
};

function readRaw(): MenuPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<MenuPrefs>;
    return migrate(parsed);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function migrate(raw: Partial<MenuPrefs>): MenuPrefs {
  return {
    ...DEFAULT_PREFS,
    ...raw,
    schema: MENU_PREFS_SCHEMA_VERSION,
    favorites: Array.isArray(raw.favorites) ? raw.favorites.slice(0, 24) : [],
    recents: Array.isArray(raw.recents) ? raw.recents.slice(0, 8) : [],
  };
}

function write(prefs: MenuPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(MENU_PREFS_EVENT, { detail: prefs }));
  } catch {
    /* 静默忽略 quota / disabled storage */
  }
}

export function getMenuPrefs(): MenuPrefs {
  return readRaw();
}

export function patchMenuPrefs(partial: Partial<MenuPrefs>): MenuPrefs {
  const next = { ...readRaw(), ...partial };
  write(next);
  return next;
}

export function toggleFavorite(key: string): MenuPrefs {
  const cur = readRaw();
  const has = cur.favorites.includes(key);
  const favorites = has ? cur.favorites.filter((k) => k !== key) : [key, ...cur.favorites].slice(0, 24);
  const next = { ...cur, favorites };
  write(next);
  return next;
}

export function moveFavorite(from: number, to: number): MenuPrefs {
  const cur = readRaw();
  if (from < 0 || to < 0 || from >= cur.favorites.length || to >= cur.favorites.length) return cur;
  const favorites = [...cur.favorites];
  const [moved] = favorites.splice(from, 1);
  favorites.splice(to, 0, moved);
  const next = { ...cur, favorites };
  write(next);
  return next;
}

export function pushRecent(key: string): MenuPrefs {
  const cur = readRaw();
  if (!key) return cur;
  const recents = [key, ...cur.recents.filter((k) => k !== key)].slice(0, 8);
  if (recents.length === cur.recents.length && recents.every((v, i) => v === cur.recents[i])) return cur;
  const next = { ...cur, recents };
  write(next);
  return next;
}

export function clearRecents(): MenuPrefs {
  const next = { ...readRaw(), recents: [] };
  write(next);
  return next;
}

export function isFavorite(key: string): boolean {
  return readRaw().favorites.includes(key);
}

/** 订阅菜单偏好变更；返回反订阅函数。 */
export function subscribeMenuPrefs(listener: (prefs: MenuPrefs) => void): () => void {
  const handler = () => listener(readRaw());
  window.addEventListener(MENU_PREFS_EVENT, handler);
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) handler();
  });
  return () => {
    window.removeEventListener(MENU_PREFS_EVENT, handler);
  };
}

/** 密度对应的纵向 padding 类名，避免多处复写。 */
export function densityPadding(density: MenuDensity): { item: string; child: string } {
  switch (density) {
    case "compact":
      return { item: "py-1", child: "py-0.5" };
    case "cozy":
      return { item: "py-3", child: "py-2" };
    case "comfortable":
    default:
      return { item: "py-2", child: "py-1.5" };
  }
}
