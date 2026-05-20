import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Check, KeyRound, ShieldCheck, Sparkles, X } from "lucide-react";
import { NAV, NAV_GROUPS, type NavGroupKey, type NavItem } from "../../navigation";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";

type RoleKey = "super_admin" | "tenant_admin" | "project_admin" | "developer" | "viewer";
type PermissionPoint = "read" | "write" | "admin";
type MatrixItem = {
  key: string;
  name: string;
  domain: NavGroupKey;
  path: string;
  capability: string;
  hidden?: boolean;
  icon?: NavItem["icon"];
  permission?: Partial<Record<PermissionPoint, string[]>>;
};

const roles: Array<{ key: RoleKey; name: string; description: string; tone: string }> = [
  { key: "super_admin", name: "Super Admin", description: "平台超级管理员，拥有跨租户、跨业务线和模块治理权限。", tone: "bg-rose-50 text-rose-700 border-rose-200" },
  { key: "tenant_admin", name: "Tenant Admin", description: "租户管理员，负责租户账号、组织、项目与运营配置。", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "project_admin", name: "Project Admin", description: "项目管理员，负责项目内需求、任务、数据和成员权限。", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  { key: "developer", name: "Developer", description: "研发执行者，可读大部分模块并维护交付相关数据。", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "viewer", name: "Viewer", description: "审阅和运营观察角色，仅具备只读访问能力。", tone: "bg-slate-50 text-slate-700 border-slate-200" },
];

const adminDomains: Partial<Record<RoleKey, readonly NavGroupKey[]>> = {
  super_admin: NAV_GROUPS.map((group) => group.key),
  tenant_admin: ["overview", "portfolio", "governance", "system"],
  project_admin: ["overview", "portfolio", "product", "delivery", "data"],
};

const writeDomains: Partial<Record<RoleKey, readonly NavGroupKey[]>> = {
  super_admin: NAV_GROUPS.map((group) => group.key),
  tenant_admin: ["portfolio", "governance", "system", "ecosystem"],
  project_admin: ["portfolio", "product", "delivery", "data", "ai"],
  developer: ["product", "delivery", "data", "ai"],
};

function permissionOf(role: RoleKey, item: NavItem): Record<PermissionPoint, boolean> {
  if (role === "viewer") return { read: !item.hidden, write: false, admin: false };
  return {
    read: !item.hidden || role === "super_admin",
    write: Boolean(writeDomains[role]?.includes(item.group)),
    admin: Boolean(adminDomains[role]?.includes(item.group)),
  };
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function PermissionMatrix() {
  const { t } = useTranslation();
  const capabilitiesQuery = useQuery({ queryKey: ["systemPagesCapabilities"], queryFn: api.systemPagesCapabilities, retry: false });
  const [activeRole, setActiveRole] = useState<RoleKey>("super_admin");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<NavGroupKey>>(() => new Set(["ecosystem", "system"]));

  const labelOf = (item: NavItem) => t(`nav.${item.key}`, { defaultValue: item.key });
  const groupLabel = (key: NavGroupKey) => t(`nav.group.${key}`, { defaultValue: key });

  const matrixItems = useMemo<MatrixItem[]>(() => {
    const backendItems = Array.isArray(capabilitiesQuery.data?.items) ? capabilitiesQuery.data.items : [];
    if (backendItems.length) {
      return backendItems.map((item: any) => {
        const navItem = NAV.find((nav) => nav.key === item.id || nav.capability === item.capability);
        return {
          key: String(item.id ?? item.capability),
          name: String(item.name ?? item.id ?? item.capability),
          domain: (item.domain || navItem?.group || "overview") as NavGroupKey,
          path: String(item.path ?? navItem?.path ?? ""),
          capability: String(item.capability ?? navItem?.capability ?? item.id),
          icon: navItem?.icon,
          hidden: navItem?.hidden,
          permission: item.permission,
        };
      });
    }
    return NAV.filter((item) => !item.parentKey).map((item) => ({
      key: item.key,
      name: labelOf(item),
      domain: item.group,
      path: item.path,
      capability: item.capability ?? item.key,
      icon: item.icon,
      hidden: item.hidden,
    }));
  }, [capabilitiesQuery.data?.items, t]);

  const permissionFor = (role: RoleKey, item: MatrixItem): Record<PermissionPoint, boolean> => {
    if (item.permission) {
      return {
        read: Boolean(item.permission.read?.includes(role)),
        write: Boolean(item.permission.write?.includes(role)),
        admin: Boolean(item.permission.admin?.includes(role)),
      };
    }
    return permissionOf(role, { group: item.domain, hidden: item.hidden } as NavItem);
  };

  const grouped = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return NAV_GROUPS.map((group) => {
      const rows = matrixItems.filter((item) => item.domain === group.key)
        .filter((item) => {
          const haystack = [item.key, item.name, item.path, item.capability].filter(Boolean).join(" ").toLowerCase();
          return !keyword || haystack.includes(keyword);
        })
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      return { group, rows };
    }).filter((entry) => entry.rows.length > 0);
  }, [matrixItems, query]);

  const activeStats = useMemo(() => {
    const rows = matrixItems;
    return {
      read: rows.filter((item) => permissionFor(activeRole, item).read).length,
      write: rows.filter((item) => permissionFor(activeRole, item).write).length,
      admin: rows.filter((item) => permissionFor(activeRole, item).admin).length,
    };
  }, [activeRole, matrixItems]);

  const activeRoleInfo = roles.find((role) => role.key === activeRole) ?? roles[0];

  return (
    <WorkbenchShell
      title="权限矩阵"
      description="按角色、领域和能力码横向对比 read/write/admin 权限点，实时预览角色可见能力边界。"
      actions={
        <label className="relative min-w-[18rem]">
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索菜单、路径或能力码"
          />
        </label>
      }
      metrics={
        <div className="grid gap-3 lg:grid-cols-[1.2fr_2fr]">
          <section className={cn("rounded-xl border p-4", activeRoleInfo.tone)}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={18} /> 当前预览角色
            </div>
            <h3 className="mt-2 text-xl font-semibold">{activeRoleInfo.name}</h3>
            <p className="mt-1 text-sm opacity-80">{activeRoleInfo.description}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <span className="rounded-lg bg-white/70 p-2">读 {activeStats.read}</span>
              <span className="rounded-lg bg-white/70 p-2">写 {activeStats.write}</span>
              <span className="rounded-lg bg-white/70 p-2">管 {activeStats.admin}</span>
            </div>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
              <KeyRound size={18} /> 图例
            </div>
            <div className="mt-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]">
              {capabilitiesQuery.data?.ok ? "已接入后端 /system/pages/capabilities 策略。" : "后端策略不可用时使用前端注册表兜底。"}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Legend label="Read" description="页面可见、详情可读、可作为命令面板候选。" />
              <Legend label="Write" description="可创建、编辑、批量更新或触发任务化动作。" />
              <Legend label="Admin" description="可维护策略、权限、注册表和高风险操作。" />
            </div>
          </section>
        </div>
      }
    >
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]">
        <div className="overflow-x-auto">
          <div className="min-w-[72rem]">
            <div className="grid grid-cols-[minmax(18rem,1fr)_repeat(5,10rem)] border-b border-[var(--border)] bg-[var(--surface-muted)]">
              <div className="p-3 text-sm font-semibold text-[var(--text)]">菜单能力</div>
              {roles.map((role) => (
                <button
                  key={role.key}
                  type="button"
                  className={cn(
                    "border-l border-[var(--border)] p-3 text-left text-sm transition",
                    role.key === activeRole ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--surface)]",
                  )}
                  onClick={() => setActiveRole(role.key)}
                >
                  <div className="font-semibold">{role.name}</div>
                  <div className="mt-1 font-mono text-xs">{role.key}</div>
                </button>
              ))}
            </div>

            {grouped.map(({ group, rows }) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <section key={group.key} className="border-b border-[var(--border)] last:border-b-0">
                  <button
                    type="button"
                    className="grid w-full grid-cols-[minmax(18rem,1fr)_repeat(5,10rem)] items-center bg-[var(--surface)] text-left hover:bg-[var(--surface-muted)]"
                    onClick={() =>
                      setCollapsed((next) => {
                        const clone = new Set(next);
                        if (clone.has(group.key)) clone.delete(group.key);
                        else clone.add(group.key);
                        return clone;
                      })
                    }
                  >
                    <div className="flex items-center gap-2 p-3 font-semibold text-[var(--text)]">
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      {groupLabel(group.key)}
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{rows.length}</span>
                    </div>
                    {roles.map((role) => {
                      const readable = rows.filter((item) => permissionFor(role.key, item).read).length;
                      return (
                        <div key={role.key} className={cn("border-l border-[var(--border)] p-3 text-sm", role.key === activeRole && "bg-[var(--accent-soft)] text-[var(--accent)]")}>
                          {readable}/{rows.length}
                        </div>
                      );
                    })}
                  </button>
                  {!isCollapsed
                    ? rows.map((item) => (
                        <div key={item.key} className="grid grid-cols-[minmax(18rem,1fr)_repeat(5,10rem)] items-stretch border-t border-[var(--border)]">
                          <div className="p-3">
                            <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                              {item.icon ? <item.icon size={17} className="text-[var(--accent)]" /> : <ShieldCheck size={17} className="text-[var(--accent)]" />}
                              {item.name}
                            </div>
                            <div className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{item.capability}</div>
                          </div>
                          {roles.map((role) => {
                            const permission = permissionFor(role.key, item);
                            return (
                              <div
                                key={role.key}
                                className={cn(
                                  "flex items-center gap-1 border-l border-[var(--border)] p-3",
                                  role.key === activeRole && "bg-[var(--accent-soft)]",
                                )}
                              >
                                <Point label="R" enabled={permission.read} />
                                <Point label="W" enabled={permission.write} />
                                <Point label="A" enabled={permission.admin} />
                              </div>
                            );
                          })}
                        </div>
                      ))
                    : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </WorkbenchShell>
  );
}

function Legend({ label, description }: { label: string; description: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2 font-semibold text-[var(--text)]">
        <Sparkles size={16} className="text-[var(--accent)]" />
        {label}
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
    </div>
  );
}

function Point({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold",
        enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
      )}
      title={enabled ? `${label} allowed` : `${label} denied`}
    >
      {enabled ? <Check size={14} /> : <X size={14} />}
    </span>
  );
}
