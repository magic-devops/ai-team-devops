import { Button, Input } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
export function TaskCriteriaEditor({
  value = [],
  onChange,
  disabled = false,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTaskAcceptance.${key}`);
  const move = (from: number, to: number) => {
    const next = [...value];
    [next[from], next[to]] = [next[to], next[from]];
    onChange?.(next);
  };
  return (
    <div className="task-criteria-editor">
      {value.map((text, index) => (
        <div className="task-criterion-row" key={index}>
          <label>
            {tr("condition")} {index + 1}
            <Input.TextArea
              aria-label={`${tr("condition")} ${index + 1}`}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={2000}
              value={text}
              disabled={disabled}
              onChange={(event) =>
                onChange?.(
                  value.map((item, position) =>
                    position === index ? event.target.value : item,
                  ),
                )
              }
            />
          </label>
          <div className="task-criterion-actions">
            <Button
              size="small"
              icon={<ArrowUp size={13} />}
              aria-label={`${tr("moveUp")} ${index + 1}`}
              disabled={disabled || index === 0}
              onClick={() => move(index, index - 1)}
            />
            <Button
              size="small"
              icon={<ArrowDown size={13} />}
              aria-label={`${tr("moveDown")} ${index + 1}`}
              disabled={disabled || index === value.length - 1}
              onClick={() => move(index, index + 1)}
            />
            <Button
              size="small"
              icon={<Trash2 size={13} />}
              aria-label={`${tr("remove")} ${index + 1}`}
              disabled={disabled}
              onClick={() =>
                onChange?.(value.filter((_, position) => position !== index))
              }
            />
          </div>
        </div>
      ))}
      <Button
        size="small"
        icon={<Plus size={14} />}
        disabled={disabled || value.length >= 80}
        onClick={() => onChange?.([...value, ""])}
      >
        {tr("add")}
      </Button>
    </div>
  );
}
