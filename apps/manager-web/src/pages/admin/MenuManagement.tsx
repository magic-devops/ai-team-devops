/**
 * 菜单管理工作台
 * 支持：树形结构展示、菜单属性编辑、分组管理、可见性策略、批量操作
 */
import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  ShieldCheck,
  Search,
  Download,
  Upload,
  Copy,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { NAV, NAV_GROUPS, validateNavRegistry, type NavItem, type NavGroupKey } from "../../navigation";
import { WorkbenchShell } from "../shared/WorkbenchShell";

type EditingItem = {
  key: string;
  label: string;
  path: string;
  capability: string;
  group: NavGroupKey;
  category: string;
  badge: string;
  hidden: boolean;
  description: string;
};

function NavBadge({ badge }: { badge?: string }) {
  if (!badge) return null;
  const tone: Record<string, string> = {
    new: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30",
    beta: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
    preview: "bg-sky-500/15 text-sky-700 ring-sky-500/30",
    alpha: "bg-rose-500/15 text-rose-700 ring-rose-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider ring-1 ${tone[badge] ?? tone.preview}`}>
      {badge}
    </span>
  );
}

function HealthPanel({ issues }: { issues: ReturnType<typeof validateNavRegistry> }) {
  if (!issues.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        <Check className="h-4 w-4 shrink-0" />
        导航注册表健康，无问题
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <AlertCircle className="h-4 w-4" />
        发现 {issues.length} 个问题
      </div>
      <div className="space-y-1">
        {issues.slice(0, 8).map((issue, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-200">
            <span className={`mt-0.5 shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase ring-1 ${issue.level === "error" ? "bg-rose-500/15 text-rose-600 ring-rose-500/30" : "bg-amber-500/15 ring-amber-500/30"}`}>
              {issue.level}
            </span>
            <span className="font-mono text-[10px]">[{issue.key ?? issue.code}]</span>
            <span>{issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditDrawer({
  item,
  onClose,
  onSave,
}: {
  item: EditingItem;
  onClose: () => void;
  onSave: (item: EditingItem) => void;
}) {
  const [form, setForm] = useState(item);
  const set = (k: keyof EditingItem, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="flex h-full w-[420px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--text)]">编辑菜单项</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-strong)]">显示名称</label>
            <input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-strong)]">路由路径</label>
            <input
              value={form.path}
              onChange={(e) => set("path", e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-strong)]">能力码</label>
            <input
              value={form.capability}
              onChange={(e) => set("capability", e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
              placeholder="domain.module.submodule.action"
            />
            <p className="mt-1 text-[11px] text-[var(--muted)]">格式：domain.module.submodule.action</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-strong)]">能力域</label>
              <select
                value={form.group}
                onChange={(e) => set("group", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none"
              >
                {NAV_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>{g.key}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--muted-strong)]">徽标</label>
              <select
                value={form.badge}
                onChange={(e) => set("badge", e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none"
              >
                <option value="">无</option>
                <option value="new">NEW</option>
                <option value="beta">BETA</option>
                <option value="preview">PREVIEW</option>
                <option value="alpha">ALPHA</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--muted-strong)]">描述</label>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--brand)] resize-none"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">隐藏菜单项</p>
              <p className="text-xs text-[var(--muted)]">隐藏后不在侧栏显示，路由仍可访问</p>
            </div>
            <button
              type="button"
              onClick={() => set("hidden", !form.hidden)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${form.hidden ? "bg-[var(--brand)]" : "bg-[var(--border)]"}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${form.hidden ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        </div>
        <div className="flex gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={() => onSave(form)}
            className="flex-1 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            保存更改
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2.5 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function MenuManagement() {
  const [keyword, setKeyword] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<NavGroupKey | "all">("all");
  const [editing, setEditing] = useState<EditingItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showHealth, setShowHealth] = useState(false);

  const issues = useMemo(() => validateNavRegistry(), []);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return NAV.filter((item) => {
      if (item.parentKey) return false; // 只显示顶级
      if (selectedGroup !== "all" && item.group !== selectedGroup) return false;
      if (!q) return true;
      return `${item.key} ${item.path} ${item.capability ?? ""} ${item.description ?? ""}`.toLowerCase().includes(q);
    });
  }, [keyword, selectedGroup]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of NAV) {
      if (!item.parentKey) counts[item.group] = (counts[item.group] ?? 0) + 1;
    }
    return counts;
  }, []);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const openEdit = (item: NavItem) => {
    setEditing({
      key: item.key,
      label: item.key,
      path: item.path,
      capability: item.capability ?? "",
      group: item.group,
      category: item.category ?? "",
      badge: item.badge ?? "",
      hidden: item.hidden ?? false,
      description: item.description ?? "",
    });
  };

  return (
    <div className="space-y-5">
      {editing && (
        <EditDrawer
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(updated) => {
            // 实际项目中调用 API 保存；此处仅关闭抽屉
            console.info("[MenuManagement] save", updated);
            setEditing(null);
          }}
        />
      )}

      <WorkbenchShell
        title="菜单管理"
        description="管理主应用与子应用的菜单树、能力码绑定、分组策略与可见性规则。"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHealth((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                issues.length
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              健康检查 {issues.length ? `(${issues.length})` : "✓"}
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]">
              <Upload className="h-4 w-4" />
              导入
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]">
              <Download className="h-4 w-4" />
              导出
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
              <Plus className="h-4 w-4" />
              新增菜单
            </button>
          </div>
        }
      />

      {showHealth && <HealthPanel issues={issues} />}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "总菜单项", value: NAV.length },
          { label: "顶级模块", value: NAV.filter((n) => !n.parentKey && !n.hidden).length },
          { label: "隐藏项", value: NAV.filter((n) => n.hidden).length },
          { label: "健康问题", value: issues.length },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-2xl font-bold text-[var(--text)]">{stat.value}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* 过滤栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--muted)]" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索菜单 key、路径、能力码..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-9 pr-3 text-sm text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedGroup("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${selectedGroup === "all" ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}
          >
            全部 ({NAV.filter((n) => !n.parentKey).length})
          </button>
          {NAV_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setSelectedGroup(g.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${selectedGroup === g.key ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"}`}
            >
              {g.key} ({groupCounts[g.key] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {/* 批量操作栏 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--brand)]">已选 {selected.size} 项</span>
          <div className="flex gap-2 ml-auto">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-1.5 text-xs font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]">
              <EyeOff className="h-3.5 w-3.5" /> 批量隐藏
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-1.5 text-xs font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]">
              <Copy className="h-3.5 w-3.5" /> 复制能力码
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 菜单树表格 */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid grid-cols-[auto_1fr_1fr_auto_auto_auto] items-center gap-0 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          <span className="w-8" />
          <span>菜单 / 路径</span>
          <span>能力码</span>
          <span className="w-20 text-center">徽标</span>
          <span className="w-16 text-center">状态</span>
          <span className="w-20 text-center">操作</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {filtered.map((item) => {
            const Icon = item.icon;
            const children = NAV.filter((n) => n.parentKey === item.key);
            const isSelected = selected.has(item.key);
            return (
              <MenuRow
                key={item.key}
                item={item}
                Icon={Icon}
                children={children}
                isSelected={isSelected}
                onToggleSelect={() => toggleSelect(item.key)}
                onEdit={() => openEdit(item)}
              />
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">无匹配菜单项</div>
        )}
      </div>
    </div>
  );
}

function MenuRow({
  item,
  Icon,
  children,
  isSelected,
  onToggleSelect,
  onEdit,
}: {
  item: NavItem;
  Icon: React.ComponentType<{ className?: string }>;
  children: NavItem[];
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        className={`group grid grid-cols-[auto_1fr_1fr_auto_auto_auto] items-center gap-0 px-4 py-3 transition hover:bg-[var(--surface-muted)] ${isSelected ? "bg-[var(--brand-soft)]" : ""}`}
      >
        <div className="flex w-8 items-center gap-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--brand)]"
          />
          <GripVertical className="h-3.5 w-3.5 text-[var(--muted)] opacity-0 group-hover:opacity-100 cursor-grab" />
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          {children.length > 0 ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]">
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--text)]">{item.key}</p>
            <p className="truncate font-mono text-[10px] text-[var(--muted)]">{item.path}</p>
          </div>
        </div>
        <div className="min-w-0 pr-4">
          <p className="truncate font-mono text-xs text-[var(--muted-strong)]">{item.capability ?? "—"}</p>
          {item.description && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{item.description}</p>
          )}
        </div>
        <div className="w-20 text-center">
          <NavBadge badge={item.badge} />
        </div>
        <div className="w-16 text-center">
          {item.hidden ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
              <EyeOff className="h-3 w-3" /> 隐藏
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
              <Eye className="h-3 w-3" /> 显示
            </span>
          )}
        </div>
        <div className="flex w-20 items-center justify-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--brand)]"
            title="编辑"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-rose-500"
            title="删除（先标记 deprecated）"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {expanded && children.map((child) => {
        const ChildIcon = child.icon;
        return (
          <div
            key={child.key}
            className="grid grid-cols-[auto_1fr_1fr_auto_auto_auto] items-center gap-0 border-t border-[var(--border)]/50 bg-[var(--surface-muted)]/40 px-4 py-2.5"
          >
            <span className="w-8" />
            <div className="flex min-w-0 items-center gap-2.5 pl-8">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--muted-strong)]">
                <ChildIcon className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[var(--text)]">{child.key}</p>
                <p className="truncate font-mono text-[10px] text-[var(--muted)]">{child.path}</p>
              </div>
            </div>
            <p className="truncate font-mono text-xs text-[var(--muted)] pr-4">{child.capability ?? "—"}</p>
            <div className="w-20 text-center"><NavBadge badge={child.badge} /></div>
            <div className="w-16 text-center">
              {child.hidden ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                  <EyeOff className="h-3 w-3" /> 隐藏
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                  <Eye className="h-3 w-3" /> 显示
                </span>
              )}
            </div>
            <div className="w-20" />
          </div>
        );
      })}
    </>
  );
}
