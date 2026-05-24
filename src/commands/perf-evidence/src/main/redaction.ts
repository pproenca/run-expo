export function redactPerfValue(value: any): any {
  if (Array.isArray(value)) return value.map(redactPerfValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/body|postData/i.test(key)) continue;
    result[key] = /token|authorization|cookie|password|secret|apikey/i.test(key)
      ? "[redacted]"
      : redactPerfValue(item);
  }
  return result;
}
