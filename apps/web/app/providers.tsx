"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            retry: (failureCount, error) => {
              if (error instanceof Error && "status" in error) {
                const status = (error as { status: number }).status;
                if (status === 401 || status === 403) return false;
              }
              return failureCount < 2;
            },
          },
        },
      })
  );

  return (
    // enableSystem bewust UIT: er is (nog) geen theme-toggle en de dark-
    // styling is niet ge-QA'd. Met system-detectie aan kreeg een bezoeker met
    // donker OS een half-geteste dark mode te zien — voor demo's moet de app
    // deterministisch licht zijn. Toggle + dark-QA: zie roadmap.
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
