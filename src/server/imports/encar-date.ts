/**
 * Encar date-time fields are Korean local wall-clock values and commonly omit
 * an offset. Normalize them to an explicit instant before writing timestamptz.
 */
export function normalizeEncarTimestamp(value: string | null | undefined): string | null {
  const input = value?.trim();
  if (!input) return null;
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)
    ? input
    : `${input}+09:00`;
  const timestamp = new Date(zoned);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
