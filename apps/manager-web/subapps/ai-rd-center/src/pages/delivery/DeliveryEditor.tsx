import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
} from "antd";
import { useState, type ReactNode } from "react";
import { discussionFailure } from "@/lib/deliveryDiscussions";
import { useTranslation } from "react-i18next";
import { TaskCriteriaEditor } from "./TaskCriteriaEditor";
import { normalizeTaskCriteria } from "@/lib/taskAcceptance";
import type { DeliveryMember } from "@/lib/delivery";
import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { DeliveryReferenceSelect } from "@/components/DeliveryReferenceSelect";
import type { DeliveryReferenceKind } from "@/lib/deliveryQuery";

export type EditorField = {
  key: string;
  label: string;
  type?: "text" | "area" | "date" | "number" | "boolean" | "criteria";
  required?: boolean;
  max?: number;
  options?: { label: string; value: string }[];
  multiple?: boolean;
  members?: DeliveryMember[];
  referenceKind?: DeliveryReferenceKind;
};
export type EditorSpec = {
  title: string;
  hint?: string;
  fields: EditorField[];
  values: Record<string, unknown>;
  submit: (values: Record<string, unknown>) => Promise<void>;
  loadLatest: () => Promise<{
    version: number;
    items: { label: string; value: string }[];
  }>;
  adoptVersion: (
    version: number,
    values: Record<string, unknown>,
  ) => void | Record<string, unknown>;
};

export function DeliveryEditor({
  spec,
  onClose,
  header,
  sourceAware = false,
  onUnresolvedChange,
}: {
  spec: EditorSpec;
  onClose: () => void;
  header?: ReactNode | ((blocked: boolean) => ReactNode);
  sourceAware?: boolean;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Awaited<
    ReturnType<EditorSpec["loadLatest"]>
  > | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [originalValues, setOriginalValues] = useState<Record<
    string,
    unknown
  > | null>(null);
  const loadLatest = async () => {
    setBusy(true);
    setLatest(null);
    try {
      setLatest(await spec.loadLatest());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (retry = false) => {
    if (busy || (unknown && !retry)) return;
    let values: Record<string, unknown>;
    try {
      values =
        retry && originalValues ? originalValues : await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    setError("");
    setOriginalValues(structuredClone(values));
    let unresolved = false;
    if (sourceAware) onUnresolvedChange?.(true);
    try {
      await spec.submit(values);
      setUnknown(false);
      if (sourceAware) onUnresolvedChange?.(false);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      unresolved =
        sourceAware &&
        (e as Error).name !== "DeliveryConflict" &&
        discussionFailure(e).unknown;
      setUnknown(unresolved);
      setConflict((e as Error).name === "DeliveryConflict");
      setLatest(null);
    } finally {
      setBusy(false);
      if (sourceAware && !unresolved) onUnresolvedChange?.(false);
    }
  };
  return (
    <Modal
      open
      className="delivery-editor"
      title={spec.title}
      onCancel={() => !busy && !unknown && onClose()}
      onOk={() => void save()}
      confirmLoading={busy}
      okButtonProps={{ disabled: conflict || unknown }}
      cancelButtonProps={{ disabled: busy || unknown }}
      closable={!busy && !unknown}
      maskClosable={false}
      keyboard={!busy && !unknown}
      okText={t("delivery.save")}
      cancelText={t("delivery.cancel")}
      width={620}
    >
      {typeof header === "function" ? header(busy || unknown) : header}
      {unknown && (
        <Alert
          type="warning"
          title={t("deliveryDiscussion.unknown")}
          action={
            <Button loading={busy} onClick={() => void save(true)}>
              {t("deliveryDiscussion.retryOriginal")}
            </Button>
          }
        />
      )}
      {spec.hint && <p className="delivery-hint">{spec.hint}</p>}
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          className="delivery-form-error"
        />
      )}
      {conflict && (
        <div className="delivery-gates">
          <Button loading={busy} onClick={() => void loadLatest()}>
            {t("delivery.loadLatest")}
          </Button>
          {latest && (
            <>
              <h3 className="mt-4">{t("delivery.latestValues")}</h3>
              <dl>
                {latest.items.map((item, i) => (
                  <div key={i} className="mt-3">
                    <dt>{item.label}</dt>
                    <dd className="delivery-description">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <Button
                onClick={() => {
                  const updates = spec.adoptVersion(
                    latest.version,
                    form.getFieldsValue(),
                  );
                  if (updates) form.setFieldsValue(updates);
                  setConflict(false);
                  setLatest(null);
                  setError("");
                }}
              >
                {t("delivery.keepDraft")}
              </Button>
            </>
          )}
        </div>
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={spec.values}
        disabled={busy || unknown}
      >
        {spec.fields.map((f) => (
          <Form.Item
            key={f.key}
            name={f.key}
            label={f.label}
            valuePropName={f.type === "boolean" ? "checked" : "value"}
            rules={
              f.type === "criteria"
                ? [
                    {
                      validator: async (_rule, value) => {
                        try {
                          normalizeTaskCriteria(value || []);
                        } catch (failure) {
                          throw new Error(
                            t(
                              `deliveryTaskAcceptance.${(failure as Error).message}`,
                            ),
                          );
                        }
                      },
                    },
                  ]
                : f.required
                  ? [
                      {
                        required: true,
                        whitespace: f.type !== "number" && f.type !== "boolean",
                        message: t("delivery.required"),
                      },
                    ]
                  : []
            }
          >
            {f.members ? (
              <ProjectOwnerSelect
                members={f.members}
                label={f.label}
                disabled={busy || unknown}
              />
            ) : f.referenceKind ? (
              <DeliveryReferenceSelect
                kind={f.referenceKind}
                options={f.options}
                multiple={f.multiple}
                label={f.label}
                disabled={busy || unknown}
              />
            ) : f.type === "criteria" ? (
              <TaskCriteriaEditor disabled={busy} />
            ) : f.options ? (
              <Select
                mode={f.multiple ? "multiple" : undefined}
                options={f.options}
                showSearch
                optionFilterProp="label"
              />
            ) : f.type === "area" ? (
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 10 }}
                maxLength={f.max || 20000}
              />
            ) : f.type === "number" ? (
              <InputNumber
                min={1}
                max={f.max || 100}
                style={{ width: "100%" }}
              />
            ) : f.type === "boolean" ? (
              <Switch />
            ) : (
              <Input
                type={f.type === "date" ? "date" : "text"}
                maxLength={f.max || 256}
              />
            )}
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}
