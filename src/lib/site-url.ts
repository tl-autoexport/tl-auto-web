const LOCAL_SITE_URL = "http://localhost:3000";

export function normalizeSiteUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function getSiteUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    LOCAL_SITE_URL;

  return normalizeSiteUrl(configuredUrl);
}

export function isIndexableSite() {
  const url = getSiteUrl();
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return false;
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return false;
  }
  return true;
}
