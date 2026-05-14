"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockAgreementMatrix } from "@/lib/mockData";
import type { AgreementMatrix } from "@/lib/types/interviews";

export function useAgreementMatrix(applicationId: string | null) {
  return useQuery({
    queryKey: ["agreement-matrix", applicationId],
    queryFn: async (): Promise<AgreementMatrix | null> => {
      if (!applicationId) return null;
      try {
        const { data } = await api.get<AgreementMatrix>(
          `/applications/${applicationId}/agreement-matrix`
        );
        return data;
      } catch {
        return mockAgreementMatrix[applicationId] ?? null;
      }
    },
    enabled: !!applicationId,
  });
}
