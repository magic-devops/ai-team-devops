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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskCriteriaEditor } from "./TaskCriteriaEditor";
import { normalizeTaskCriteria } from "@/lib/taskAcceptance";

export type EditorField = {
  key: string;
  label: string;
  type?: "text" | "area" | "date" | "number" | "boolean" | "criteria";
  required?: boolean;
  max?: number;
  options?: { label: string; value: string }[];
  multiple?: boolean;
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
}: {
  spec: EditorSpec;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Awaited<
    ReturnType<EditorSpec["loadLatest"]>
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
  const save = async () => {
    if (busy) return;
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await spec.submit(values);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setConflict((e as Error).name === "DeliveryConflict");
      setLatest(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      className="delivery-editor"
      title={spec.title}
      onCancel={onClose}
      onOk={() => void save()}
      confirmLoading={busy}
      okButtonProps={{ disabled: conflict }}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      maskClosable={false}
      keyboard={!busy}
      okText={t("delivery.save")}
      cancelText={t("delivery.cancel")}
      width={620}
    >
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
        disabled={busy}
      >
        {spec.fields.map((f) => (
          <Form.Item
            key={f.key}
            name={f.key}
            label={f.label}
            valuePropName={f.type === "boolean" ? "checked" : "value"}
            rules={f.type === "criteria" ? [{ validator: async (_rule, value) => { try { normalizeTaskCriteria(value || []); } catch (failure) { throw new Error(t(`deliveryTaskAcceptance.${(failure as Error).message}`)); } } }] :
              f.required
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
            {f.type === "criteria" ? <TaskCriteriaEditor disabled={busy} /> : f.options ? (
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
