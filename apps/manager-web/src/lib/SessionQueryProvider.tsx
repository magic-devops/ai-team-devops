import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { watchSessionQueryCache } from "./sessionQueryCache";

/** A different workspace must get new observers as well as an empty cache. */
export function SessionQueryProvider({ client, children }: { client: QueryClient; children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => watchSessionQueryCache(client, () => setRevision((value) => value + 1)), [client]);
  return <QueryClientProvider key={revision} client={client}>{children}</QueryClientProvider>;
}
