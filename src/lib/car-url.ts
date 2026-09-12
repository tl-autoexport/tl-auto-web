/** Public detail URL. Source identifiers remain internal to the data layer. */
export function publicCarPath(source: string, sourceId: string) {
  const publicSource = source === "chestny_prigon" ? "korea" : source;
  return `/cars/${encodeURIComponent(publicSource)}/${encodeURIComponent(sourceId)}`;
}
