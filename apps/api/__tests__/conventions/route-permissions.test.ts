/**
 * Route-conventietest — bewaakt bugklasse 4 uit de systeem-audit van
 * 2026-07-22: routers waar RBAC simpelweg vergeten was (webhooks lekte HMAC-
 * secrets naar elke rol, exports dumpte PII voor viewers, career-pages/
 * custom-fields/saved-searches/workflows hadden géén permission-checks).
 *
 * INVARIANT: elke muterende route (POST/PUT/PATCH/DELETE) heeft in zijn
 * effectieve middleware-keten
 *   1) authenticatie (requireAuth / requireAuthOrApiKey), én
 *   2) een RBAC-guard (requirePermission / requireAnyPermission /
 *      requireWriteOnMutation / requireRole / requireApiScope)
 * — tenzij de route expliciet in een van de allowlists hieronder staat, mét
 * reden. Een nieuwe muterende route zonder guard faalt deze test dus meteen.
 *
 * De guards zijn herkenbaar aan fn.name (Object.defineProperty in
 * middleware/auth.ts en middleware/permissions.ts). De routers worden hier
 * allemaal geïmporteerd; queues/pg/SDK's zijn door __tests__/setup.ts gemockt.
 */

import { describe, it, expect } from 'vitest';

// Vite/vitest: importeer alle router-modules eager zodat we hun stacks
// kunnen walken. Nieuwe routerbestanden doen automatisch mee. LET OP: de
// patronen dekken alle drie de naamconventies in deze codebase
// (x.router.ts / x.routes.ts, kale routes.ts, en camelCase *Routes.ts) —
// een router die nergens op matcht ontsnapt aan de conventietest, dus bij
// een nieuwe naamvorm hier een patroon bij zetten.
const routerModules = import.meta.glob(
  [
    '../../src/modules/**/*.{router,routes}.ts',
    '../../src/modules/**/routes.ts',
    '../../src/modules/**/*Routes.ts',
  ],
  { eager: true }
) as Record<string, Record<string, unknown>>;

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
const AUTH_RE = /^require(Auth$|AuthOrApiKey\(|ApiKey$)/;
const GUARD_RE = /^require(Permission|AnyPermission|WriteOnMutation|Role|ApiScope)\(/;

/**
 * Routes die bewust GEEN requireAuth hebben. Alleen toegestaan met een
 * alternatief mechanisme (HMAC-signature, opt-in token, publieke read-flow
 * met eigen rate-limiting). Formaat: "METHOD path :: routerbestand".
 */
const PUBLIC_BY_DESIGN = new Set<string>([
  // Auth-flows: pre-auth per definitie; het meegestuurde token/credential IS
  // de authenticatie. Alle routes achter authRateLimit.
  'POST /register :: modules/auth/auth.router.ts',
  'POST /login :: modules/auth/auth.router.ts',
  'POST /refresh :: modules/auth/auth.router.ts',
  'POST /logout :: modules/auth/auth.router.ts',
  'POST /forgot-password :: modules/auth/auth.router.ts',
  'POST /reset-password :: modules/auth/auth.router.ts',
  'POST /accept-invite :: modules/auth/auth.router.ts',
  // 2FA-verify gebruikt het partial-token uit login-stap 1 (aud-gescheiden
  // van echte JWT's — zie middleware/auth.ts).
  'POST /2fa/verify :: modules/auth/auth.router.ts',
  // Publieke career page: anonieme sollicitatie is de kernfunctie.
  'POST /public/:slug/apply :: modules/career-pages/career-pages.router.ts',
  // Kandidaat-self-service (AVG): 64-hex token is de credential, plus
  // selfServiceRateLimit; tenant-isolatie via token-lookup in de service.
  'POST /:token/consent :: modules/compliance/self-service.router.ts',
  'POST /:token/correction :: modules/compliance/self-service.router.ts',
  'POST /:token/deletion :: modules/compliance/self-service.router.ts',
  'POST /:token/export :: modules/compliance/self-service.router.ts',
  // Vendor-webhooks: HMAC-signature-verificatie in de controller is de
  // authenticatie (Resend / outreach-provider / Twilio / 360dialog-Meta).
  'POST /email-inbound :: modules/email-inbound/email-inbound.router.ts',
  'POST /outreach/replies :: modules/outreach/inboundWebhook.routes.ts',
  'POST /twilio/:tenantSlug :: modules/voice/twilioWebhookRoutes.ts',
  'POST /whatsapp/:tenantSlug :: modules/whatsapp/webhookRoutes.ts',
  // Kandidaat-timesheet-portaal: sha256-gehashte opaque token in de URL is
  // de credential; Redis-backed portalRateLimit tegen brute-force (zie
  // header publicTimesheetRoutes.ts).
  'POST /:token/entries :: modules/timesheets/publicTimesheetRoutes.ts',
  'POST /:token/submit :: modules/timesheets/publicTimesheetRoutes.ts',
  // Client-portal en WhatsApp-opt-in: opaque token in URL is de credential,
  // met eigen (strengere) rate limits.
  'POST /access/:token/feedback :: modules/portal/portal.router.ts',
  'POST /access/:token/log-view/:candidateId :: modules/portal/portal.router.ts',
  'POST /opt-in/:token/accept :: modules/whatsapp/publicConsentRoutes.ts',
]);

/**
 * Muterende routes die WEL requireAuth hebben maar bewust geen RBAC-guard.
 * Alleen toegestaan voor per-user self-service (muteert uitsluitend eigen
 * data, afgedwongen in de service-laag op req.user.userId).
 */
const SELF_SERVICE_ALLOWLIST = new Set<string>([
  // 2FA-beheer op het EIGEN account (opereert uitsluitend op req.user; de
  // service eist wachtwoord/TOTP-bevestiging voor disable).
  'POST /2fa/setup :: modules/auth/auth.router.ts',
  'POST /2fa/verify-setup :: modules/auth/auth.router.ts',
  'POST /2fa/disable :: modules/auth/auth.router.ts',
  'POST /2fa/backup-codes/regenerate :: modules/auth/auth.router.ts',
  // Eigen profiel; PATCH /:id is self-or-admin — afgedwongen in
  // users.service.updateUser (rolwijziging alleen admin/super_admin/owner).
  'PATCH /me :: modules/users/users.router.ts',
  'PATCH /:id :: modules/users/users.router.ts',
  // API-explorer-playground: proxied het request in-process onder de EIGEN
  // JWT van de aanroeper — de doelroute handhaaft zijn eigen authz, dus hier
  // een extra guard zetten voegt niets toe (zie playground.controller.ts).
  'POST /run :: modules/api-keys/api-keys.router.ts',
  // Per-user inbox-state (alleen read-marker; overige thread-mutaties
  // vereisen sinds de audit-fix communications:write).
  'POST /threads/:id/read :: modules/inbox/inbox.routes.ts',
  // Push-notificaties: registratie/beheer van EIGEN devices en voorkeuren.
  'POST /subscribe :: modules/notifications/notifications.router.ts',
  'DELETE /subscriptions/:id :: modules/notifications/notifications.router.ts',
  'DELETE /devices/:id :: modules/notifications/notifications.router.ts',
  'PUT /preferences :: modules/notifications/notifications.router.ts',
  'POST /test :: modules/notifications/notifications.router.ts',
  'POST /log/:id/clicked :: modules/notifications/notifications.router.ts',
  // Read-via-POST: query-achtige endpoints die een body nodig hebben maar
  // niets tenant-breed muteren (zie ook de waarschuwing bij
  // requireWriteOnMutation in middleware/permissions.ts).
  'POST /availability/slots :: modules/interviews/interviews.router.ts',
  'POST /jobs/:jobId/candidates/:candidateId/explanation :: modules/matching/matching.router.ts',
]);

interface RouteInfo {
  file: string;
  method: string;
  path: string;
  chain: string[];
}

interface ExpressLayer {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ method?: string; handle: { name: string } }>;
  };
  handle: { name: string; stack?: ExpressLayer[] };
  name: string;
}

function collectRoutes(
  file: string,
  stack: ExpressLayer[],
  inheritedGuards: string[]
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  // Express past use-middleware alleen toe op routes die NA de use-call
  // geregistreerd zijn — we lopen de stack dus in volgorde en bouwen de
  // actieve guard-keten op.
  const activeGuards = [...inheritedGuards];
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      const handlerNames = layer.route.stack.map((l) => l.handle.name);
      for (const method of Object.keys(layer.route.methods)) {
        for (const path of paths) {
          routes.push({
            file,
            method: method.toLowerCase(),
            path,
            chain: [...activeGuards, ...handlerNames],
          });
        }
      }
    } else if (layer.handle.stack) {
      // Genest sub-router: erft de tot nu toe actieve guards.
      routes.push(...collectRoutes(file, layer.handle.stack, activeGuards));
    } else {
      activeGuards.push(layer.handle.name);
    }
  }
  return routes;
}

function isRouter(value: unknown): value is { stack: ExpressLayer[] } {
  return (
    typeof value === 'function' &&
    Array.isArray((value as { stack?: unknown }).stack)
  );
}

function allRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const [file, mod] of Object.entries(routerModules)) {
    const shortFile = file.replace(/^.*\/src\//, '');
    for (const exported of Object.values(mod)) {
      if (isRouter(exported)) {
        routes.push(...collectRoutes(shortFile, exported.stack, []));
      }
    }
  }
  return routes;
}

function key(r: RouteInfo): string {
  return `${r.method.toUpperCase()} ${r.path} :: ${r.file}`;
}

describe('route-conventies — RBAC op elke muterende route', () => {
  const mutating = allRoutes().filter((r) => MUTATING.has(r.method));

  it('sanity: de glob vindt een substantieel aantal muterende routes', () => {
    // Beschermt tegen een stille glob/walker-breuk waardoor de test
    // "groen" zou zijn omdat hij niets meer ziet.
    expect(mutating.length).toBeGreaterThan(100);
  });

  it('elke muterende route heeft authenticatie (of staat in PUBLIC_BY_DESIGN met reden)', () => {
    const missing = mutating
      .filter((r) => !r.chain.some((n) => AUTH_RE.test(n)))
      .filter((r) => !PUBLIC_BY_DESIGN.has(key(r)))
      .map(key);
    expect(missing, `Muterende routes zonder requireAuth:\n${missing.join('\n')}`).toEqual([]);
  });

  it('elke geauthenticeerde muterende route heeft een RBAC-guard (of staat in SELF_SERVICE_ALLOWLIST met reden)', () => {
    const missing = mutating
      .filter((r) => r.chain.some((n) => AUTH_RE.test(n)))
      .filter((r) => !r.chain.some((n) => GUARD_RE.test(n)))
      .filter((r) => !SELF_SERVICE_ALLOWLIST.has(key(r)))
      .map(key);
    expect(
      missing,
      `Muterende routes zonder requirePermission/requireRole — voeg een guard toe of ` +
        `(alleen voor per-user self-service) een allowlist-entry mét reden:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('allowlists bevatten geen stale entries', () => {
    const known = new Set(mutating.map(key));
    const stale = [...PUBLIC_BY_DESIGN, ...SELF_SERVICE_ALLOWLIST].filter(
      (k) => !known.has(k)
    );
    expect(stale, `Verwijder deze niet-meer-bestaande allowlist-entries:\n${stale.join('\n')}`).toEqual([]);
  });
});
