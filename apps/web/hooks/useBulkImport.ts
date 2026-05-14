"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockImportStatuses } from "@/lib/mockData";
import type {
  ImportPreviewResponse,
  ImportPreviewRow,
  ImportStatusResponse,
  StartImportInput,
} from "@/lib/types/atsExtensions";

/**
 * Parse a small CSV string into headers + rows for the mock-fallback path.
 * Handles quoted values and commas-in-quotes; intentionally minimal (no
 * RFC-4180 corner cases) — production CSV parsing happens server-side.
 */
function parseCsvSample(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1, 11).map(splitLine);
  return { headers, rows };
}

const HEADER_HINTS: Array<{ field: string; matchers: RegExp[] }> = [
  { field: "first_name", matchers: [/first[_\s-]?name|voornaam/i] },
  { field: "last_name", matchers: [/last[_\s-]?name|achternaam/i] },
  { field: "name", matchers: [/^name$|volledige naam|full[_\s-]?name/i] },
  { field: "email", matchers: [/e[\-_]?mail/i] },
  { field: "phone", matchers: [/phone|telefoon|gsm|mobiel/i] },
  { field: "current_position", matchers: [/title|functie|position/i] },
  { field: "current_company", matchers: [/company|bedrijf/i] },
  { field: "address_city", matchers: [/city|stad|plaats/i] },
  { field: "address_country", matchers: [/country|land/i] },
  { field: "skills", matchers: [/skills|vaardigheden/i] },
  { field: "source", matchers: [/source|bron/i] },
  { field: "linkedin_url", matchers: [/linked[\-_]?in/i] },
];

function suggestMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const hit = HEADER_HINTS.find((h) => h.matchers.some((m) => m.test(header)));
    mapping[header] = hit ? hit.field : "";
  }
  return mapping;
}

/**
 * Upload a CSV and request a preview. Returns the parsed preview shape used
 * by the import-wizard step 2 (column mapping + duplicate count).
 *
 * Mock-fallback parses the CSV client-side and synthesises a plausible
 * preview so dev-mode users can walk through the entire wizard.
 */
export function usePreviewCsv() {
  return useMutation({
    mutationFn: async (file: File): Promise<ImportPreviewResponse> => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const { data } = await api.post<ImportPreviewResponse>(
          "/candidates/import/preview",
          formData,
          { headers: { "Content-Type": "multipart/form-data" } }
        );
        return data;
      } catch {
        const text = await file.text();
        const { headers, rows: rawRows } = parseCsvSample(text);
        const totalLineCount = text.split(/\r?\n/).filter(Boolean).length;
        const totalRows = Math.max(0, totalLineCount - 1);

        const rows: ImportPreviewRow[] = rawRows.map((cells, idx) => {
          const values: Record<string, string> = {};
          headers.forEach((h, i) => {
            values[h] = cells[i] ?? "";
          });
          // Random-but-stable: mark every 7th row as a duplicate to demo UI.
          const isDup = idx > 0 && (idx + 1) % 7 === 0;
          return {
            row: idx + 2,
            values,
            duplicate_of: isDup ? "cand-1" : null,
          };
        });

        const dupCount = Math.floor(totalRows / 7);
        return {
          import_id: `imp-${Date.now()}`,
          headers,
          rows,
          total_rows: totalRows,
          suggested_mapping: suggestMapping(headers),
          duplicate_count: dupCount,
        };
      }
    },
  });
}

/**
 * Kick off the actual import after the user finalises the column mapping.
 * Returns the initial status row so the consumer can start polling.
 */
export function useStartImport() {
  return useMutation({
    mutationFn: async (input: StartImportInput): Promise<ImportStatusResponse> => {
      try {
        const { data } = await api.post<ImportStatusResponse>(
          "/candidates/import/start",
          input
        );
        return data;
      } catch {
        const initial: ImportStatusResponse = {
          id: input.import_id,
          status: "processing",
          total_rows: 50,
          processed_rows: 0,
          imported_count: 0,
          skipped_count: 0,
          error_count: 0,
          error_csv_url: null,
          started_at: new Date().toISOString(),
          finished_at: null,
        };
        mockImportStatuses[input.import_id] = initial;

        // Drive a synthetic state machine: progress over ~6 seconds, ending
        // at status='done' with a few synthetic skip/error counts so the UI
        // shows a complete result screen.
        const totalTicks = 6;
        for (let i = 1; i <= totalTicks; i++) {
          setTimeout(() => {
            const cur = mockImportStatuses[input.import_id];
            if (!cur) return;
            const ratio = i / totalTicks;
            const processed = Math.round(cur.total_rows * ratio);
            mockImportStatuses[input.import_id] = {
              ...cur,
              status: i === totalTicks ? "done" : "processing",
              processed_rows: processed,
              imported_count: i === totalTicks
                ? cur.total_rows - 7 - 2
                : Math.max(0, processed - 5),
              skipped_count: i === totalTicks ? 7 : Math.min(7, Math.floor(processed * 0.14)),
              error_count: i === totalTicks ? 2 : 0,
              error_csv_url: i === totalTicks ? "/mock/import-errors.csv" : null,
              finished_at: i === totalTicks ? new Date().toISOString() : null,
            };
          }, i * 1000);
        }

        return initial;
      }
    },
  });
}

/**
 * Poll the import status every 2 seconds until status='done' or 'failed'.
 * In dev-mode reads from the in-memory `mockImportStatuses` table.
 */
export function useImportStatus(id: string | null) {
  return useQuery({
    queryKey: ["candidate-import-status", id],
    queryFn: async (): Promise<ImportStatusResponse> => {
      if (!id) throw new Error("Geen import-id");
      try {
        const { data } = await api.get<ImportStatusResponse>(
          `/candidates/imports/${id}`
        );
        return data;
      } catch {
        const row = mockImportStatuses[id];
        if (!row) {
          // No active mock import — return a synthetic 'uploaded' row so the
          // hook never crashes on a stale id.
          return {
            id,
            status: "uploaded",
            total_rows: 0,
            processed_rows: 0,
            imported_count: 0,
            skipped_count: 0,
            error_count: 0,
          };
        }
        return row;
      }
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as ImportStatusResponse | undefined;
      if (!data) return 2000;
      return data.status === "done" || data.status === "failed" ? false : 2000;
    },
  });
}
