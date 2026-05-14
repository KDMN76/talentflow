/**
 * OpenAPI public entry point.
 *
 * Importeert alle route-spec-files (side-effect: ze registreren paden bij de
 * registry) en exposed:
 *   - `getOpenApiSpec()`     — gecached OpenAPI 3.1 document
 *   - `swaggerMiddleware`    — Express handler voor `/api-docs` (assets)
 *   - `swaggerHandler`       — Express handler voor de Swagger-UI page
 *   - `getPostmanCollection`— Postman 2.1 export
 */

import swaggerUi from 'swagger-ui-express';
import { generateOpenApiSpec } from './registry';
import { openApiToPostman, type PostmanCollection } from './postman';

// Side-effect imports — iedere file roept `registry.registerPath(...)` op.
import './routes/auth';
import './routes/candidates';
import './routes/jobs';
import './routes/pipeline';
import './routes/communications';
import './routes/matching';
import './routes/webhooks';
import './routes/reports';
import './routes/api-keys';
import './routes/skills';
import './routes/compliance';
import './routes/interviews';
import './routes/job-boards';
import './routes/contracts';
import './routes/timesheets';
import './routes/billing';
import './routes/accounting';
import './routes/commissions';
import './routes/forecasting';
import './routes/sourcing';
import './routes/outreach';
import './routes/nurture';
import './routes/inbox';
import './routes/voice';
import './routes/whatsapp';
import './routes/misc';

let cachedSpec: object | null = null;
let cachedPostman: PostmanCollection | null = null;

export function getOpenApiSpec(): object {
  if (!cachedSpec) cachedSpec = generateOpenApiSpec();
  return cachedSpec;
}

export function getPostmanCollection(): PostmanCollection {
  if (!cachedPostman) {
    cachedPostman = openApiToPostman(
      getOpenApiSpec() as Parameters<typeof openApiToPostman>[0]
    );
  }
  return cachedPostman;
}

/**
 * Dev-only helper: forceer regeneratie van de cache. Gebruikt door tests die
 * in dezelfde process aparte registries opbouwen.
 */
export function resetOpenApiCache(): void {
  cachedSpec = null;
  cachedPostman = null;
}

export const swaggerMiddleware = swaggerUi.serve;
export const swaggerHandler = swaggerUi.setup(undefined, {
  swaggerOptions: {
    url: '/api-docs/openapi.json',
    persistAuthorization: true,
    tryItOutEnabled: true,
    docExpansion: 'list',
    filter: true,
    displayRequestDuration: true,
  },
  customSiteTitle: 'TalentFlow API Docs',
  customfavIcon: '/favicon.ico',
});
