const allowedImageHosts = new Set(["ci.encar.com"]);

export function isAllowedRemoteImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedImageHosts.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Encar blocks direct browser requests in some networks with 407/proxy errors.
 * Keep the source URL in the database, but load it through our server route.
 */
export function publicMediaUrl(value: string) {
  return isAllowedRemoteImageUrl(value)
    ? `/api/media?url=${encodeURIComponent(value)}`
    : value;
}
