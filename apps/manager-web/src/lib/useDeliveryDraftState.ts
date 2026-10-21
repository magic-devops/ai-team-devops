import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// Publish ownership in the event handler, before a navigation or ACK callback can run.
export function useDeliveryDraftState<T>(initial: T, onEditingChange?: (editing: boolean) => void): readonly [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const current = useRef(value), notify = useRef(onEditingChange), mounted = useRef(true);
  notify.current = onEditingChange;
  const change = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (!mounted.current) return;
    const next = typeof update === "function" ? (update as (previous: T) => T)(current.current) : update;
    const changed = Boolean(current.current) !== Boolean(next);
    current.current = next;
    if (changed) notify.current?.(Boolean(next));
    setValue(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (current.current) notify.current?.(true);
    return () => {
      mounted.current = false;
      if (current.current) notify.current?.(false);
    };
  }, []);
  return [value, change] as const;
}
