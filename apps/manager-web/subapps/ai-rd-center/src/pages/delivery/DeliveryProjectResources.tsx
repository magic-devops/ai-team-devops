import { Alert, Button, Empty, Select, Switch, Tag } from "antd";
import {
  Archive,
  ExternalLink,
  FileText,
  GitBranch,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getToken, getWorkspaceScope } from "@/lib/authStorage";
import {
  fetchDelivery,
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryIntent,
  type DeliveryResource,
  type DeliveryWorkspace,
} from "@/lib/delivery";
import {
  filterProjectResources,
  resourceKinds,
  resourcePayload,
  safeResourceUrl,
  type ResourceKindFilter,
} from "@/lib/deliveryProjectInbox";
import { planError } from "@/lib/deliveryTaskPlan";
import {
  DeliveryEditor,
  type EditorField,
  type EditorSpec,
} from "./DeliveryEditor";

const session = () => JSON.stringify([getToken(), getWorkspaceScope()]);
export function DeliveryProjectResources({
  projectId,
  data,
  kind,
  showArchived,
  onFilter,
  onSaved,
}: {
  projectId: string;
  data: DeliveryWorkspace;
  kind: ResourceKindFilter;
  showArchived: boolean;
  onFilter: (kind: ResourceKindFilter, archived: boolean) => void;
  onSaved: (updated: DeliveryWorkspace) => void;
}) {
  const { t } = useTranslation();
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [editorId, setEditorId] = useState(0);
  const intent = useRef<DeliveryIntent>();
  const latestWorkspace = useRef(data);
  latestWorkspace.current = data;
  const originSession = useRef(session());
  const assertConfigure = () => {
    if (originSession.current !== session())
      throw new Error(t("delivery.scopeChanged"));
    if (!latestWorkspace.current.permissions.configure)
      throw new Error(tp("noPermission"));
  };
  const resources = filterProjectResources(data.resources, kind, showArchived);
  const openEditor = (
    resource?: DeliveryResource,
    mode: "edit" | "archive" | "restore" = "edit",
  ) => {
    if (!data.permissions.configure) return;
    intent.current = { version: data.version, key: crypto.randomUUID() };
    setEditorId((value) => value + 1);
    const fields: EditorField[] = [
      {
        key: "kind",
        label: tp("kind"),
        required: true,
        options: resourceKinds.map((value) => ({
          value,
          label: tp(`resourceKinds.${value}`),
        })),
      },
      { key: "title", label: tp("resourceTitle"), required: true, max: 200 },
      { key: "url", label: tp("url"), required: true, max: 2000 },
      { key: "description", label: tp("description"), type: "area", max: 4000 },
      { key: "ref", label: tp("ref"), max: 200 },
    ];
    const action = mode === "archive" ? "resource.archive" : "resource.save";
    const values = {
      kind: "repository",
      title: "",
      url: "",
      description: "",
      ref: "",
      ...resource,
    };
    setEditor({
      title: tp(
        mode === "archive"
          ? "archive"
          : mode === "restore"
            ? "restore"
            : resource
              ? "editResource"
              : "addResource",
      ),
      hint: tp(mode === "archive" ? "archiveHint" : "resourceHint"),
      fields:
        mode === "archive"
          ? [
              {
                key: "comment",
                label: t("delivery.comment"),
                type: "area",
                max: 2000,
              },
            ]
          : fields,
      values: mode === "archive" ? {} : values,
      submit: async (draft) => {
        assertConfigure();
        let payload: Record<string, unknown>;
        if (mode === "archive")
          payload = { id: resource!.id, comment: draft.comment || "" };
        else {
          if (!safeResourceUrl(String(draft.url || "").trim()))
            throw new Error(tp("invalidUrl"));
          payload = resourcePayload({
            ...draft,
            ...(resource ? { id: resource.id } : {}),
            archived: mode === "restore" ? false : Boolean(resource?.archived),
          });
        }
        intent.current = prepareDeliveryIntent(
          intent.current!,
          action,
          payload,
        );
        try {
          const updated = await saveDelivery(
            projectId,
            action,
            payload,
            intent.current.version,
            intent.current.key,
          );
          if (originSession.current !== session())
            throw new Error(t("delivery.scopeChanged"));
          latestWorkspace.current = updated;
          onSaved(updated);
        } catch (error) {
          const failure = planError(error);
          const wrapped = new Error(
            failure.conflict ? t("delivery.conflict") : failure.message,
          );
          wrapped.name = failure.conflict ? "DeliveryConflict" : "Error";
          throw wrapped;
        }
      },
      loadLatest: async () => {
        if (originSession.current !== session())
          throw new Error(t("delivery.scopeChanged"));
        const fresh = await fetchDelivery(projectId);
        latestWorkspace.current = fresh;
        onSaved(fresh);
        const current = resource
          ? fresh.resources?.find((item) => item.id === resource.id)
          : undefined;
        if (resource && !current) throw new Error(tp("resourceMissing"));
        return {
          version: fresh.version,
          items: current
            ? [
                { label: tp("resourceIdentity"), value: current.id || "" },
                { label: tp("resourceTitle"), value: current.title },
                {
                  label: tp("kind"),
                  value: tp(`resourceKinds.${current.kind}`),
                },
                { label: tp("url"), value: current.url },
                {
                  label: tp("description"),
                  value: current.description || t("delivery.none"),
                },
                { label: tp("ref"), value: current.ref || t("delivery.none") },
                {
                  label: t("delivery.current"),
                  value: tp(current.archived ? "archived" : "active"),
                },
              ]
            : [
                {
                    label: tp("resources"),
                  value: String(fresh.resources?.length || 0),
                },
              ],
        };
      },
      adoptVersion: (version) => {
        intent.current = { version, key: crypto.randomUUID() };
      },
    });
  };
  return (
    <section className="delivery-project-resources">
      <div className="delivery-section-heading delivery-project-heading">
        <div>
          <h2>{tp("resources")}</h2>
          <p className="delivery-hint">{tp("resourceHint")}</p>
        </div>
        <Button
          type="primary"
          icon={<Plus size={15} />}
          disabled={!data.permissions.configure}
          onClick={() => openEditor()}
        >
          {tp("addResource")}
        </Button>
      </div>
      {!data.permissions.configure && (
        <Alert type="info" title={tp("configureHint")} />
      )}
      <div className="delivery-resource-toolbar">
        <Select
          aria-label={tp("kind")}
          value={kind}
          onChange={(value) => onFilter(value, showArchived)}
          options={[
            { value: "all", label: tp("allKinds") },
            ...resourceKinds.map((value) => ({
              value,
              label: tp(`resourceKinds.${value}`),
            })),
          ]}
        />
        <label className="delivery-toggle">
          <Switch
            size="small"
            aria-label={tp("showArchived")}
            checked={showArchived}
            onChange={(checked) => onFilter(kind, checked)}
          />
          <span>{tp("showArchived")}</span>
        </label>
        <small>
          {resources.length} / {data.resources?.length || 0}
        </small>
      </div>
      {resources.length ? (
        <div className="delivery-resource-list">
          {resources.map((resource) => {
            const url = safeResourceUrl(resource.url);
            const Icon = resource.kind === "repository" ? GitBranch : FileText;
            return (
              <article
                className={`delivery-resource-row ${resource.archived ? "is-archived" : ""}`}
                key={resource.id}
              >
                <span className="delivery-resource-icon">
                  <Icon size={19} />
                </span>
                <div className="delivery-resource-main">
                  <div className="delivery-resource-title">
                    <h3>{resource.title}</h3>
                    <Tag>{tp(`resourceKinds.${resource.kind}`)}</Tag>
                    {resource.archived && <Tag>{tp("archived")}</Tag>}
                  </div>
                  {resource.description && <p>{resource.description}</p>}
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="delivery-resource-link"
                      aria-label={`${resource.title} · ${tp("external")}`}
                    >
                      <span>{url}</span>
                      <ExternalLink size={13} />
                      <small>{tp("external")}</small>
                    </a>
                  ) : (
                    <p className="delivery-overdue">{tp("invalidLink")}</p>
                  )}
                  {resource.ref && (
                    <small
                      className="delivery-resource-ref"
                      title={tp("refHint")}
                    >
                      <GitBranch size={12} />
                      {resource.ref}
                    </small>
                  )}
                </div>
                <div className="delivery-actions">
                  <Button
                    size="small"
                    disabled={!data.permissions.configure}
                    onClick={() => openEditor(resource)}
                  >
                    {tp("editResource")}
                  </Button>
                  <Button
                    size="small"
                    icon={
                      resource.archived ? (
                        <RotateCcw size={13} />
                      ) : (
                        <Archive size={13} />
                      )
                    }
                    disabled={!data.permissions.configure}
                    onClick={() =>
                      openEditor(
                        resource,
                        resource.archived ? "restore" : "archive",
                      )
                    }
                  >
                    {tp(resource.archived ? "restore" : "archive")}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <strong>
                {tp(
                  data.resources?.length || 0
                    ? "noFilteredResources"
                    : "noResources",
                )}
              </strong>
              <p>{tp("resourceEmptyHint")}</p>
            </>
          }
        >
          {(kind !== "all" || showArchived) && (
            <Button onClick={() => onFilter("all", false)}>
              {tp("clearFilters")}
            </Button>
          )}
        </Empty>
      )}
      {editor && (
        <DeliveryEditor
          key={editorId}
          spec={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
