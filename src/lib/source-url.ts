export function officialSourceUrl(
  value: string | null | undefined,
  source: string,
) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;

    const hostname = url.hostname.toLowerCase();
    const normalizedSource = source.toLowerCase();
    const isAllowed =
      normalizedSource === "encar" &&
      (hostname === "encar.com" || hostname.endsWith(".encar.com"));

    return isAllowed ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sourceDisplayName(source: string) {
  return source.toLowerCase() === "encar" ? "Encar" : "Неизвестный источник";
}
