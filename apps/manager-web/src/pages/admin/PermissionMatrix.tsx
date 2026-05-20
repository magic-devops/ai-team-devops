/**
 * 权限矩阵工作台
 * 角色 × 能力码 可视化，支持按域过滤、角色切换预览
 */
import { useState, useMemo } from "react";
import { ShieldCheck, Eye, Crown, Search, ChevronDown, ChevronRight, Lock, Unlock } from "lucide-react";
import { NAV, NAV_GROUPS, type NavGroupKey } from "../../navigation";
import { WorkbenchShell } from "../shared/WorkbenchShell";

const ROLES = [
  { key: "super_admin", label: "超级管理员", color: "text-rose-600 bg-rose-500/10 ring-rose-500/30" },
  { key: "tenant_admin", label: "租户管理员", color: "text-amber-600 bg-amber-500/10 ring-amber-500/30" },
  { key: "project_admin", label: "项目管理员", color: "text-sky-600 bg-sky-500/10 ring-sky-500/30" },
  { key: "developer", label: "开发者", color: "text-emerald-600 bg-emerald-500/10 ring-emerald-500/30" },
  { key: "viewer", label: "只读用户", color: "text-[var(--muted-strong)] bg-[var(--surface-muted)] ring-[var(--border)]" },
];

// 模拟权限数据：super_admin 全开，viewer 只读，其余按域
function getPermission(role: string, capability: string): { read: boolean; write: boolean; admin: boolean } {
  if (role === "super_admin") return { read: true, write: true, admin: true };
  if (role === "viewer") return { read: true, write: false, admin: false };
  const domain = capability.split(".")[0] ?? "";
  if (role === "tenant_admin") return { read: true, write: true, admin: domain === "system" || domain === "portfolio" };
  if (role === "project_admin") return { read: true, write: domain !== "system", admin: domain === "delivery" || domain === "product" };
  // developer
  return { read: true, write: domain === "delivery" || domain === "product" || domain === "data" || domain === "ai", admin: false };
}

type PermCell = { read: boolean; write: boolean; admin: boolean };

function PermIcon({ perm }: { perm: PermCell }) {
  if (perm.admin) return <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="admin" />;
  if (perm.write) return <Unlock className="h-3.5 w-3.5 text-emerald-500" aria-label="read+write" />;
  if (perm.read) return <Eye className="h-3.5 w-3.5 text-sky-500" aria-label="read only" />;
  return <Lock className="h-3.5 w-3.5 text-[var(--muted)]" aria-label="no access" />;
}

function PermDot({ perm }: { perm: PermCell }) {
  if (perm.admin) return <span className="h-2 w-2 rounded-full bg-amber-500" />;
  if (perm.write) return <span className="h-2 w-2 rounded-full bg-emerald-500" />;
  if (perm.read) return <span className="h-2 w-2 rounded-full bg-sky-400" />;
  return <span className="h-2 w-2 rounded-full bg-[var(--border)]" />;
}

export function PermissionMatrix() {
  const [selectedGroup, setSelectedGroup] = useState<NavGroupKey | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [previewRole, setPreviewRole] = useState("super_admin");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["overview", "portfolio", "delivery"]));

  const toggleGroup = (g: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });

  const topItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return NAV.filter((item) => {
      if (item.parentKey || item.hidden) return false;
      if (selectedGroup !== "all" && item.group !== selectedGroup) return false;
      if (!q) return true;
      return `${item.key} ${item.capability ?? ""} ${item.description ?? ""}`.toLowerCase().includes(q);
    });
  }, [keyword, selectedGroup]);

  const byGroup = useMemo(() => {
    const map = new Map<NavGroupKey, typeof topItems>();
    for (const item of topItems) {
      const rows = map.get(item.group) ?? [];
      rows.push(item);
      map.set(item.group, rows);
    }
    return map;
  }, [topItems]);

  const previewRoleDef = ROLES.find((r) => r.key === previewRole) ?? ROLES[0];

  return (
    <div className="space-y-5">
      <WorkbenchShell
        title="权限矩阵"
        description="可视化角色与能力码的读/写/管理权限映射，支持角色预览与批量策略配置。"
      />

      {/* 角色选择 */}
      <div className="flex flex-wrap gap-2">
        {ROLES.map((role) => (
          <button
            key={role.key}
            type="button"
            onClick={() => setPreviewRole(role.key)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition ${
              previewRole === role.key ? role.color + " ring-1" : "bg-[var(--control-bg)] text-[var(--muted-strong)] ring-[var(--border)] hover:bg-[var(--surface-muted)]"
            }`}
          >
            {role.key === "super_admin" && <Crown className="h-3.5 w-3.5" />}
            {role.label}
          </button>
        ))}
      </div>

      {/* 图例 + 过滤 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-[var(--muted-strong)]">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> 管理员</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 读写</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> 只读</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--border)]" /> 无权限</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索能力码..."
              className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-1.5 pl-8 pr-3 text-xs text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
            />
          </div>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value as NavGroupKey | "all")}
            className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none"
          >
            <option value="all">全部域</option>
            {NAV_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.key}</option>)}
          </select>
        </div>
      </div>

      {/* 矩阵表格 */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        {/* 表头 */}
        <div className="grid border-b border-[var(--border)] bg-[var(--surface-muted)]" style={{ gridTemplateColumns: "1fr repeat(5, 80px)" }}>
          <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">模块 / 能力码</div>
          {ROLES.map((role) => (
            <div key={role.key} className={`px-2 py-2.5 text-center text-[10px] font-semibold ${previewRole === role.key ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
              {role.label.replace("管理员", "").replace("用户", "")}
            </div>
          ))}
        </div>

        {/* 按域分组 */}
        {[...byGroup.entries()].map(([group, items]) => (
          <div key={group}>
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="flex w-full items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)]/60 px-4 py-2 text-left text-xs font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
            >
              {expandedGroups.has(group) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="uppercase tracking-wide">{group}</span>
              <span className="ml-auto rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">{items.length}</span>
            </button>
            {expandedGroups.has(group) && items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  className="grid items-center border-b border-[var(--border)]/50 hover:bg-[var(--surface-muted)]/40"
                  style={{ gridTemplateColumns: "1fr repeat(5, 80px)" }}
                >
                  <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[var(--text)]">{item.key}</p>
                      <p className="truncate font-mono text-[10px] text-[var(--muted)]">{item.capability ?? "—"}</p>
                    </div>
                  </div>
                  {ROLES.map((role) => {
                    const perm = getPermission(role.key, item.capability ?? "");
                    const isPreview = role.key === previewRole;
                    return (
                      <div key={role.key} className={`flex items-center justify-center py-2.5 ${isPreview ? "bg-[var(--brand-soft)]/30" : ""}`}>
                        <div className="flex items-center gap-1">
                          <PermDot perm={perm} />
                          {isPreview && <PermIcon perm={perm} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}

        {topItems.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">无匹配能力码</div>
        )}
      </div>

      {/* 当前预览角色说明 */}
      <div className={`rounded-xl border p-4 ring-1 ${previewRoleDef.color}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" />
          {previewRoleDef.label} — 权限说明
        </div>
        <p className="mt-1.5 text-xs opacity-80">
          {previewRole === "super_admin" && "拥有所有模块的读、写、管理权限，无任何限制。"}
          {previewRole === "tenant_admin" && "拥有全部模块读写权限；system 与 portfolio 域具备管理员权限。"}
          {previewRole === "project_admin" && "拥有全部模块读权限；delivery/product 域具备管理员权限；system 域仅读。"}
          {previewRole === "developer" && "拥有全部模块读权限；delivery/product/data/ai 域具备写权限；无管理员权限。"}
          {previewRole === "viewer" && "仅拥有所有模块的只读权限，无写入或管理操作。"}
        </p>
      </div>
    </div>
  );
}
