import { Button, Checkbox, Collapse, Input, InputNumber } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commandDraft,
  type ExecutionCommandDraft,
} from "@/lib/executionCommands";

export function ExecutionCommandEditor({
  rows,
  onChange,
  agent,
  disabled,
  maxCommands = 32,
}: {
  rows: ExecutionCommandDraft[];
  onChange: (rows: ExecutionCommandDraft[]) => void;
  agent: boolean;
  disabled: boolean;
  maxCommands?: number;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const update = (index: number, change: Partial<ExecutionCommandDraft>) =>
    onChange(
      rows.map((row, position) =>
        position === index ? { ...row, ...change } : row,
      ),
    );
  return (
    <section
      className="runtime-command-editor"
      aria-label={tr(agent ? "tests" : "commandPlan")}
    >
      <div className="runtime-section-heading">
        <strong>{tr(agent ? "tests" : "commandPlan")}</strong>
        <Button
          size="small"
          icon={<Plus size={14} />}
          disabled={disabled || rows.length >= maxCommands}
          onClick={() =>
            onChange([...rows, commandDraft(`tests${rows.length + 1}`)])
          }
        >
          {tr("addCommand")}
        </Button>
      </div>
      {!rows.length && <p className="runtime-help">{tr("noTests")}</p>}
      {rows.map((row, index) => (
        <div className="runtime-command-row" key={index}>
          <div className="runtime-command-title">
            <label>
              {tr("nodeId")}
              <Input
                aria-label={`${tr("nodeId")} ${index + 1}`}
                value={row.id}
                maxLength={64}
                disabled={disabled}
                onChange={(event) => update(index, { id: event.target.value })}
              />
            </label>
            <Button
              aria-label={`${tr("removeCommand")} ${index + 1}`}
              size="small"
              icon={<Trash2 size={14} />}
              disabled={disabled}
              onClick={() =>
                onChange(rows.filter((_, position) => position !== index))
              }
            />
          </div>
          <label>
            {tr("nodeTitle")}
            <Input
              aria-label={`${tr("nodeTitle")} ${index + 1}`}
              value={row.title}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => update(index, { title: event.target.value })}
            />
          </label>
          <label>
            {tr("executable")}
            <Input
              aria-label={`${tr("executable")} ${index + 1}`}
              value={row.executable}
              disabled={disabled}
              onChange={(event) =>
                update(index, { executable: event.target.value })
              }
            />
          </label>
          <div className="runtime-arguments">
            <strong>{tr("args")}</strong>
            {row.arguments.map((arg, argIndex) => (
              <div className="runtime-argument" key={argIndex}>
                <Input
                  aria-label={`${tr("args")} ${index + 1}.${argIndex + 1}`}
                  value={arg}
                  disabled={disabled}
                  onChange={(event) =>
                    update(index, {
                      arguments: row.arguments.map((value, position) =>
                        position === argIndex ? event.target.value : value,
                      ),
                    })
                  }
                />
                <Button
                  size="small"
                  aria-label={`${tr("removeArg")} ${index + 1}.${argIndex + 1}`}
                  disabled={disabled}
                  icon={<Trash2 size={13} />}
                  onClick={() =>
                    update(index, {
                      arguments: row.arguments.filter(
                        (_, position) => position !== argIndex,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <Button
              size="small"
              disabled={disabled || row.arguments.length >= 127}
              onClick={() =>
                update(index, { arguments: [...row.arguments, ""] })
              }
            >
              {tr("addArg")}
            </Button>
          </div>
          <div className="runtime-command-bounds">
            <label>
              {tr("timeout")}
              <InputNumber
                aria-label={`${tr("timeout")} ${index + 1}`}
                min={1}
                max={3600}
                precision={0}
                value={row.timeout_seconds}
                disabled={disabled}
                onChange={(value) =>
                  update(index, { timeout_seconds: value ?? 0 })
                }
              />
            </label>
            <label>
              {tr("expectedExit")}
              <InputNumber
                aria-label={`${tr("expectedExit")} ${index + 1}`}
                min={0}
                max={255}
                precision={0}
                value={row.expected_exit_code}
                disabled={disabled}
                onChange={(value) =>
                  update(index, { expected_exit_code: value ?? -1 })
                }
              />
            </label>
            {!agent && (
              <Checkbox
                disabled={disabled}
                checked={row.test}
                onChange={(event) =>
                  update(index, { test: event.target.checked })
                }
              >
                {tr("markTest")}
              </Checkbox>
            )}
          </div>
        </div>
      ))}
      {rows.length > 0 && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: "json",
              label: tr("advanced"),
              children: (
                <pre className="runtime-output">
                  {JSON.stringify(
                    rows.map(
                      ({
                        executable,
                        arguments: args,
                        test: _test,
                        ...node
                      }) => ({
                        ...node,
                        kind: "command",
                        argv: [executable, ...args],
                      }),
                    ),
                    null,
                    2,
                  )}
                </pre>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}
