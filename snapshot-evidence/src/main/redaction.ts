const REDACTED = "[redacted]";
const SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
const URL_QUERY_SECRET_PATTERN = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;

export function redactValue<T>(value: T, key = ""): T {
  if (typeof value === "string") {
    if (SECRET_KEY_PATTERN.test(key)) {
      return REDACTED as T;
    }
    return value.replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      SECRET_KEY_PATTERN.test(childKey) ? REDACTED : redactValue(childValue, childKey),
    ]),
  ) as T;
}
