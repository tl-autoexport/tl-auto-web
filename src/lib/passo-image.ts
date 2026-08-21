export function passoImageProxyUrl(sourceUrl: string): string {
  if (sourceUrl.includes("/storage/v1/object/public/passo-media/")) return sourceUrl;
  return `/api/image-proxy?url=${encodeURIComponent(sourceUrl)}`;
}
