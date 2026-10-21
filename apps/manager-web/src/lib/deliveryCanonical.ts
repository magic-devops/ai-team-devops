/** Canonical JSON used by fixed delivery artifacts (Unicode scalar key order). */
export function canonicalDeliveryJson(value: unknown): string {
  const scalar = (text: string) => { if (Array.from(text).some((char) => { const code = char.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; })) throw new Error("deliveryArtifactInvalid"); return JSON.stringify(text); };
  const compare = (left: string, right: string) => { const a = Array.from(left, (char) => char.codePointAt(0)!), b = Array.from(right, (char) => char.codePointAt(0)!); for (let at = 0; at < Math.min(a.length, b.length); at++) if (a[at] !== b[at]) return a[at] - b[at]; return a.length - b.length; };
  if (value === null) return "null"; if (typeof value === "string") return scalar(value); if (typeof value === "boolean") return String(value); if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalDeliveryJson).join(",")}]`;
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) { const object = value as Record<string, unknown>; return `{${Object.keys(object).sort(compare).map((key) => `${scalar(key)}:${canonicalDeliveryJson(object[key])}`).join(",")}}`; }
  throw new Error("deliveryArtifactInvalid");
}
