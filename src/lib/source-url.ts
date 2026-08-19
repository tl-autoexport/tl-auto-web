export function officialSourceUrl(
  value: string | null | undefined,
  source: string,
) {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const normalizedSource = source.toLowerCase();
    if (normalizedSource === "encar" && url.protocol !== "https:") return null;
    if ((normalizedSource === "passo_bike" || normalizedSource === "passo_boat") && !["http:", "https:"].includes(url.protocol)) return null;
    const isAllowed =
      (normalizedSource === "encar" &&
        (hostname === "encar.com" || hostname.endsWith(".encar.com"))) ||
      ((normalizedSource === "passo_bike" || normalizedSource === "passo_boat") &&
        (hostname === "passo.co.kr" || hostname.endsWith(".passo.co.kr")));

    return isAllowed ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sourceDisplayName(source: string) {
  if (source.toLowerCase() === "encar") return "Encar";
  if (["passo_bike", "passo_boat"].includes(source.toLowerCase())) return "Passo";
  return "Неизвестный источник";
}
