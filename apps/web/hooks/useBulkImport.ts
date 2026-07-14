"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ImportPreviewResponse,
  ImportStatusResponse,
  StartImportInput,
} from "@/lib/types/atsExtensions";

/**
 * Upload a CSV and request a preview. Returns the parsed preview shape used
 * by the import-wizard step 2 (column mapping + duplicate count).
 */
export function usePreviewCsv() {
  return useMutation({
    mutationFn: async (file: File): Promise<ImportPreviewResponse> => {
      const formData = new FormData();
      formData.append("file", file);

      const { data } = await api.post<ImportPreviewResponse>(
        "/candidates/import/preview",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data;
    },
  });
}

/**
 * Kick off the actual import after the user finalises the column mapping.
 * The backend `previewCsv` does not persist the file, so `start` re-uploads
 * the original CSV alongside the finalised mapping (multipart, veld 'file').
 * Returns the initial status row so the consumer can start polling.
 */
export function useStartImport() {
  return useMutation({
    mutationFn: async (
      input: StartImportInput & { file: File }
    ): Promise<ImportStatusResponse> => {
      const formData = new FormData();
      formData.append("file", input.file);
      formData.append("mapping", JSON.stringify(input.mapping));
      formData.append("import_id", input.import_id);

      const { data } = await api.post<ImportStatusResponse>(
        "/candidates/import/start",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data;
    },
  });
}

/**
 * Poll the import status every 2 seconds until status='done' or 'failed'.
 */
export function useImportStatus(id: string | null) {
  return useQuery({
    queryKey: ["candidate-import-status", id],
    queryFn: async (): Promise<ImportStatusResponse> => {
      if (!id) throw new Error("Geen import-id");
      const { data } = await api.get<ImportStatusResponse>(
        `/candidates/imports/${id}`
      );
      return data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as ImportStatusResponse | undefined;
      if (!data) return 2000;
      return data.status === "done" || data.status === "failed" ? false : 2000;
    },
  });
}
