import { useEffect, useState } from "react";

// Keep the outgoing identity during Ant Design's close transition only.
export function useDrawerIdentity(scope: string, requestedId: string) {
  const [retained, setRetained] = useState({ scope, id: requestedId });
  useEffect(() => {
    setRetained((current) => requestedId || current.scope !== scope
      ? { scope, id: requestedId }
      : current);
  }, [scope, requestedId]);
  return {
    displayId: requestedId || (retained.scope === scope ? retained.id : ""),
    afterOpenChange: (open: boolean) => {
      if (!open && !requestedId)
        setRetained((current) => current === retained ? { scope, id: "" } : current);
    },
  };
}
