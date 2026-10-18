/**
 * RFC 4180 CSV helpers. A field is quoted when it contains a comma, double
 * quote, CR or LF; embedded double quotes are doubled. Records are joined
 * with CRLF.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(",");
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(toCsvRow).join("\r\n");
}
