export function passoImageProxyUrl(sourceUrl: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(sourceUrl)}`;
}
