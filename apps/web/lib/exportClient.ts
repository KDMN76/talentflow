/**
 * Server-side export helper. Roept de `/api/exports/*`-endpoints aan (die de
 * VOLLEDIGE gefilterde set teruggeven, tot 50k rijen) en downloadt het
 * resultaat als bestand — CSV, XLSX of PDF.
 *
 * Vervangt de oude client-side CSV-export die alleen de geladen ~20 rijen
 * meenam. De filters die je meestuurt zijn dezelfde als de lijst-UI, zodat de
 * export exact dekt wat op het scherm gefilterd is.
 */

import { api } from "@/lib/api";
import { downloadBlob } from "@/lib/downloadHelper";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV (.csv)",
  xlsx: "Excel (.xlsx)",
  pdf: "PDF (.pdf)",
};

/**
 * Download een server-export. Geeft het aantal geëxporteerde rijen terug
 * (uit de `X-Export-Row-Count`-header) zodat de UI een toast kan tonen.
 *
 * @param path    bv. "/exports/jobs" of "/exports/candidates"
 * @param format  csv | xlsx | pdf
 * @param filters actieve lijst-filters (worden 1-op-1 als query-params gestuurd)
 */
export async function downloadServerExport(
  path: string,
  format: ExportFormat,
  filters: Record<string, string | number | undefined> = {}
): Promise<number> {
  const params: Record<string, string | number> = { format };
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== "" && v !== null) params[k] = v;
  }

  const res = await api.get(path, { params, responseType: "blob" });

  // Bestandsnaam uit Content-Disposition; val terug op een nette default.
  const cd = (res.headers["content-disposition"] as string | undefined) ?? "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename =
    match?.[1] ?? `export-${new Date().toISOString().slice(0, 10)}.${format}`;

  downloadBlob(res.data as Blob, filename);
  return Number(res.headers["x-export-row-count"] ?? 0);
}
