import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, KeyRound, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";

type UserRow = { id: string; username: string; email?: string; role?: string; status?: string };
type ProjectRow = { id: string; name: string; status?: string; business_id?: string };
type ProjectMemberRow = { user_id: string; username: string; email?: string; role: string };

export function Organization() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, enabled: authed });
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: api.businesses, enabled: authed });
  const users = useQuery({ queryKey: ["users"], queryFn: api.authUsers, enabled: authed });
  const roles = useQuery({ queryKey: ["roleConstants"], queryFn: api.roleConstants, enabled: authed });
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", role: "developer" });
  const [newBiz, setNewBiz] = useState({ name: "", description: "" });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newMember, setNewMember] = useState({ user_id: "", role: "developer" });
  const userRoles = useMemo(() => roles.data?.user_roles?.length ? roles.data.user_roles : ["developer", "devops", "project_admin", "tenant_admin"], [roles.data]);
  const projectRoles = useMemo(() => roles.data?.project_member_roles?.length ? roles.data.project_member_roles : ["viewer", "developer", "project_admin"], [roles.data]);
  const projectMembers = useQuery({
    queryKey: ["projectMembers", selectedProjectId],
    queryFn: () => api.projectMembers(selectedProjectId),
    enabled: authed && Boolean(selectedProjectId),
  });

  useEffect(() => {
    const first = (projects.data ?? [])[0]?.id;
    if (!selectedProjectId && first) setSelectedProjectId(first);
  }, [projects.data, selectedProjectId]);

  const refreshAll = () => {
    void projects.refetch();
    void businesses.refetch();
    void users.refetch();
    void roles.refetch();
    void projectMembers.refetch();
  };

  const createUser = useMutation({
    mutationFn: api.authCreateUser,
    onSuccess: () => {
      setNewUser({ username: "", email: "", password: "", role: "developer" });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const updateUser = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, string> }) => api.authUpdateUser(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const deleteUser = useMutation({
    mutationFn: api.authDeleteUser,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const createBusiness = useMutation({
    mutationFn: api.createBusiness,
    onSuccess: () => {
      setNewBiz({ name: "", description: "" });
      void qc.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
  const addProjectMember = useMutation({
    mutationFn: () => api.projectAddMember(selectedProjectId, newMember),
    onSuccess: () => {
      setNewMember({ user_id: "", role: "developer" });
      void qc.invalidateQueries({ queryKey: ["projectMembers", selectedProjectId] });
    },
  });
  const removeProjectMember = useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) => api.projectRemoveMember(projectId, userId),
    onSuccess: (_data, vars) => void qc.invalidateQueries({ queryKey: ["projectMembers", vars.projectId] }),
  });

  if (!authed) return <NeedLogin />;

  const busy = projects.isFetching || businesses.isFetching || users.isFetching || roles.isFetching || projectMembers.isFetching;

  return (
    <div className="w-full space-y-6">
      <div className="flex justify-end">
        <RefreshButton onClick={refreshAll} pending={busy} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card
          title={t("page.organization.users")}
          actions={
            <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--muted-strong)]">
              {(users.data ?? []).length}
            </span>
          }
        >
          {users.isLoading ? <LoadingBlock /> : null}
          {users.error ? <ErrorBlock message={(users.error as Error).message} /> : null}
          {createUser.error ? <ErrorBlock message={(createUser.error as Error).message} /> : null}
          {updateUser.error ? <ErrorBlock message={(updateUser.error as Error).message} /> : null}
          {deleteUser.error ? <ErrorBlock message={(deleteUser.error as Error).message} /> : null}

          <form
            className="mb-4 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 md:grid-cols-[1fr_1fr_1fr_10rem_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              createUser.mutate({
                username: newUser.username.trim(),
                email: newUser.email.trim(),
                password: newUser.password,
                role: newUser.role,
              });
            }}
          >
            <Input value={newUser.username} onChange={(v) => setNewUser((x) => ({ ...x, username: v }))} placeholder={t("page.organization.username")} />
            <Input value={newUser.email} onChange={(v) => setNewUser((x) => ({ ...x, email: v }))} placeholder={t("page.organization.email")} />
            <Input type="password" value={newUser.password} onChange={(v) => setNewUser((x) => ({ ...x, password: v }))} placeholder={t("page.organization.password")} />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((x) => ({ ...x, role: e.target.value }))}
              className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)]"
            >
              {userRoles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <button
              type="submit"
              disabled={!newUser.username.trim() || newUser.password.length < 8 || createUser.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              {t("page.organization.addUser")}
            </button>
          </form>

          {(users.data ?? []).length === 0 && !users.isLoading ? (
            <EmptyState message={t("page.organization.emptyUsers")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2 pr-3">{t("page.organization.username")}</th>
                    <th className="py-2 pr-3">{t("page.organization.email")}</th>
                    <th className="py-2 pr-3">{t("page.organization.role")}</th>
                    <th className="py-2 pr-3">{t("page.organization.status")}</th>
                    <th className="py-2 text-right">{t("page.organization.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(users.data ?? []).map((u: UserRow) => (
                    <UserItem
                      key={u.id}
                      user={u}
                      roles={userRoles}
                      pending={updateUser.isPending || deleteUser.isPending}
                      onPatch={(patch) => updateUser.mutate({ id: u.id, patch })}
                      onDelete={() => {
                        if (window.confirm(t("page.organization.confirmDelete", { name: u.username }))) deleteUser.mutate(u.id);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-[var(--muted)]">{t("page.organization.usersHint")}</p>
        </Card>

        <Card title={t("page.organization.businesses")}>
          {businesses.isLoading ? <LoadingBlock /> : null}
          {businesses.error ? <ErrorBlock message={(businesses.error as Error).message} /> : null}
          {createBusiness.error ? <ErrorBlock message={(createBusiness.error as Error).message} /> : null}
          <form
            className="mb-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              createBusiness.mutate({ name: newBiz.name.trim(), description: newBiz.description.trim() });
            }}
          >
            <Input value={newBiz.name} onChange={(v) => setNewBiz((x) => ({ ...x, name: v }))} placeholder={t("page.organization.businessName")} />
            <Input value={newBiz.description} onChange={(v) => setNewBiz((x) => ({ ...x, description: v }))} placeholder={t("page.organization.businessDesc")} />
            <button
              type="submit"
              disabled={!newBiz.name.trim() || createBusiness.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              <Building2 className="h-4 w-4 text-[var(--brand)]" />
              {t("page.organization.addBusiness")}
            </button>
          </form>
          {(businesses.data ?? []).length === 0 && !businesses.isLoading ? (
            <EmptyState message={t("page.organization.emptyBusiness")} />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {(businesses.data ?? []).map((b: { id: string; name: string; description?: string; project_count?: number }) => (
                <li key={b.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-[var(--muted)]">{b.project_count ?? 0}</span>
                  </div>
                  {b.description ? <p className="mt-1 text-xs text-[var(--muted)]">{b.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t("page.organization.projects")}>
        {(projects.data ?? []).length === 0 && !projects.isLoading ? (
          <EmptyState message={t("page.projects.empty")} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
            <div className="grid gap-2 md:grid-cols-2">
              {(projects.data ?? []).map((p: ProjectRow) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`rounded-xl border p-3 text-left text-sm transition ${
                    selectedProjectId === p.id
                      ? "border-[var(--brand)] bg-[var(--brand-softer)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <div className="flex justify-between gap-3">
                    <div className="font-medium text-[var(--text)]">{p.name}</div>
                    <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted-strong)]">{p.status || "-"}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-[var(--muted)]">{p.id}</div>
                  {p.business_id ? <div className="mt-2 text-xs text-[var(--muted)]">{p.business_id}</div> : null}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text)]">{t("page.organization.projectMembers")}</h3>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="max-w-56 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1.5 text-sm text-[var(--text)]"
                >
                  {(projects.data ?? []).map((p: ProjectRow) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {projectMembers.error ? <ErrorBlock message={(projectMembers.error as Error).message} /> : null}
              {addProjectMember.error ? <ErrorBlock message={(addProjectMember.error as Error).message} /> : null}
              {removeProjectMember.error ? <ErrorBlock message={(removeProjectMember.error as Error).message} /> : null}
              <form
                className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  addProjectMember.mutate();
                }}
              >
                <select
                  value={newMember.user_id}
                  onChange={(e) => setNewMember((x) => ({ ...x, user_id: e.target.value }))}
                  className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-2 text-sm text-[var(--text)]"
                >
                  <option value="">{t("page.organization.pickUser")}</option>
                  {(users.data ?? []).map((u: UserRow) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
                <select
                  value={newMember.role}
                  onChange={(e) => setNewMember((x) => ({ ...x, role: e.target.value }))}
                  className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-2 text-sm text-[var(--text)]"
                >
                  {projectRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button
                  type="submit"
                  disabled={!selectedProjectId || !newMember.user_id || addProjectMember.isPending}
                  className="rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {t("page.organization.addMember")}
                </button>
              </form>
              {projectMembers.isLoading ? <LoadingBlock /> : null}
              {(projectMembers.data ?? []).length === 0 && !projectMembers.isLoading ? (
                <EmptyState message={t("page.organization.emptyMembers")} />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {(projectMembers.data ?? []).map((m: ProjectMemberRow) => (
                    <li key={m.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-[var(--text)]">{m.username}</span>
                        <span className="ml-2 text-xs text-[var(--muted)]">{m.email}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="rounded bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--muted-strong)]">{m.role}</span>
                        <button
                          type="button"
                          disabled={removeProjectMember.isPending}
                          onClick={() => removeProjectMember.mutate({ projectId: selectedProjectId, userId: m.user_id })}
                          className="rounded-lg border border-rose-500/30 p-1.5 text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
                          title={t("page.organization.removeMember")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
    />
  );
}

function UserItem({
  user,
  roles,
  pending,
  onPatch,
  onDelete,
}: {
  user: UserRow;
  roles: string[];
  pending: boolean;
  onPatch: (patch: Record<string, string>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  return (
    <tr>
      <td className="py-2 pr-3 font-medium text-[var(--text)]">{user.username}</td>
      <td className="py-2 pr-3">
        <input
          defaultValue={user.email || ""}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== (user.email || "")) onPatch({ email: next });
          }}
          className="w-full min-w-40 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1.5 text-sm text-[var(--text)]"
        />
      </td>
      <td className="py-2 pr-3">
        <select
          value={user.role || "developer"}
          onChange={(e) => onPatch({ role: e.target.value })}
          disabled={pending}
          className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1.5 text-sm text-[var(--text)]"
        >
          {roles.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      </td>
      <td className="py-2 pr-3">
        <select
          value={user.status || "active"}
          onChange={(e) => onPatch({ status: e.target.value })}
          disabled={pending}
          className="rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1.5 text-sm text-[var(--text)]"
        >
          <option value="active">{t("page.organization.active")}</option>
          <option value="disabled">{t("page.organization.disabled")}</option>
        </select>
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("page.organization.newPassword")}
            className="w-36 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1.5 text-sm text-[var(--text)]"
          />
          <button
            type="button"
            disabled={password.length < 8 || pending}
            onClick={() => {
              onPatch({ password });
              setPassword("");
            }}
            className="inline-flex items-center rounded-lg border border-[var(--border)] px-2 py-1.5 text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            title={t("page.organization.resetPassword")}
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className="inline-flex items-center rounded-lg border border-rose-500/30 px-2 py-1.5 text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
            title={t("page.organization.deleteUser")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
