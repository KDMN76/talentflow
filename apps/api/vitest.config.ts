import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest configuration for @talentflow/api.
 *
 * Tests run fully OFFLINE — no Postgres, Redis, or external API access.
 * The setup file in __tests__/setup.ts mocks all SDKs (Anthropic, OpenAI,
 * Resend, BullMQ) and provides safe env-vars for modules that read them
 * at import-time.
 *
 * Coverage thresholds enforce a quality floor (60% lines / functions /
 * statements, 50% branches). The build fails if any file slips below.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      // Scope coverage to the files we have tests for. Other modules
      // (workflows, communications, etc.) ship under separate sprints and
      // get their own coverage when their tests land.
      include: [
        'src/lib/aiDisclosure.ts',
        'src/lib/embeddings.ts',
        'src/lib/mergeVariables.ts',
        'src/modules/auth/auth.service.ts',
        'src/modules/candidates/candidates.service.ts',
        'src/modules/candidates/candidates.schema.ts',
        'src/modules/jobs/jobs.service.ts',
        'src/modules/matching/matching.service.ts',
        'src/modules/pipeline/pipeline.service.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/migrations/**',
        '**/scripts/**',
        '**/queue/workers/**',
        'dist/**',
        '__tests__/**',
      ],
      thresholds: {
        lines: 60,
        branches: 50,
        functions: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Sub-fase 2A — shared contracts package via paths-resolution.
      // Wijst naar de raw TS-source zodat tests geen `npm run build`
      // op de package nodig hebben.
      '@talentflow/contracts': path.resolve(
        __dirname,
        '../../packages/contracts/src/index.ts'
      ),
    },
  },
});
