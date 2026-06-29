/**
 * Client-side download helpers. Centralises the Blob → anchor → click pattern
 * that was previously inlined per feature (audit, invoices, 2FA). New exports
 * should use these; existing inline copies stay untouched.
 */

/** Trigger a browser download for an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Quote a single CSV field when it contains a comma, quote or newline. */
function escapeCsv(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a header row + data rows (CRLF line endings). */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");
}

/** Download tabular data as a UTF-8 CSV file (BOM so Excel opens it correctly). */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): void {
  const csv = "﻿" + toCsv(headers, rows);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}
