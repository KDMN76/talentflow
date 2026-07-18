import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry on 401/403 — axios errors carry the HTTP status at
        // error.response.status, not a top-level error.status.
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) return false;
        }
        return failureCount < 2;
      },
    },
  },
});
