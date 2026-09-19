/**
 * Shared client-side state keys for catalogue browsing.
 *
 * Kept in a plain module so both the catalogue grid and the detail toolbar can
 * reference the same key without importing one page component from another.
 */
export const LAST_CATALOG_URL_KEY = "tl-auto:catalog:last-url-v1";

export function readSavedCatalogUrl(): string | null {
  try {
    return sessionStorage.getItem(LAST_CATALOG_URL_KEY);
  } catch {
    return null;
  }
}

export function writeSavedCatalogUrl(url: string) {
  try {
    sessionStorage.setItem(LAST_CATALOG_URL_KEY, url);
  } catch {
    // Storage is an optional back-navigation optimisation.
  }
}
