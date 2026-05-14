import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration for @talentflow/web.
 *
 * Browser-only code (service workers, Notification API, IndexedDB) is
 * niet runtime-testbaar in Vitest — die hoort in Playwright (zie
 * __e2e__/). Hier draaien alleen unit tests over pure helpers en
 * library code, met een jsdom-omgeving waar `window`/`navigator`
 * indien nodig handmatig wordt gestubd.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    exclude: ["__e2e__/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
