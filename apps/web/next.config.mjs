import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles only the files needed at runtime; the
  // production Dockerfile copies that bundle for a small image footprint.
  // See https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: 'standalone',

  // Required because the monorepo has hoisted node_modules at the root —
  // without this Next won't include them in the standalone tracer.
  outputFileTracingRoot: process.cwd().includes('apps/web')
    ? new URL('../../', import.meta.url).pathname
    : undefined,

  // Sub-fase 2A — `@talentflow/contracts` levert TS-source rechtstreeks
  // (geen pre-build). Next.js moet die bestanden door z'n SWC-bundler
  // halen ipv ze als pre-built `node_modules` te behandelen. Zonder dit:
  // `SyntaxError: Cannot use import statement outside a module` op runtime.
  // Hot-reload op `packages/contracts/src/**` werkt out-of-the-box
  // zodra de package in `transpilePackages` staat.
  transpilePackages: ['@talentflow/contracts', '@talentflow/i18n'],

  // `/` redirect naar het dashboard op routing-niveau. Een `redirect()` in een
  // root `app/page.tsx` werkt NIET in deze standalone build van Next 14.2.3: het
  // renderen van `/page` (zowel statisch als met `force-dynamic`) crasht met
  // "Cannot read properties of undefined (reading 'clientModules')" omdat de
  // client-reference-manifest van `/page` niet in het render-pad wordt ingeladen
  // → HTTP 500 (incident 2026-06-19). `force-dynamic` lost dat niet op: de
  // pagina blijft renderen. Een redirect hier wordt door next-server afgehandeld
  // vóór enige page-render, dus dat kapotte render-pad wordt nooit geraakt.
  //
  // LET OP: next.config-redirects draaien VÓÓR de middleware. Zonder host-scope
  // zou deze `/`-redirect ook op white-label custom domeinen vuren, waardoor de
  // custom-domain-middleware de homepage nooit naar de career-page kan rewriten.
  // Daarom alleen op de app-eigen hosts (afgeleid uit NEXT_PUBLIC_API_URL +
  // localhost); custom domeinen matchen niet en vallen door naar de middleware.
  async redirects() {
    const appHostRe = (() => {
      const hosts = ['localhost', '127\\.0\\.0\\.1'];
      try {
        const h = new URL(process.env.NEXT_PUBLIC_API_URL || '').host;
        if (h) hosts.push(h.split(':')[0].replace(/[.]/g, '\\.'));
      } catch {
        // negeer onparsebare URL
      }
      return hosts.join('|');
    })();
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: false,
        has: [{ type: 'host', value: `^(${appHostRe})(:\\d+)?$` }],
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Strict React mode for development warnings; harmless in prod.
  reactStrictMode: true,

  // Don't break the build on lint warnings — CI runs `next lint` separately
  // and fails there. This keeps `next build` focused on type/build errors.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // PWA: zorg dat /sw.js niet door de browser wordt gecached, en dat de
  // service worker scope tot de hele site mag uitstrekken (anders zou de
  // SW alleen onder /sw.js werken).
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' },
        ],
      },
    ];
  },
};

// Wrap the Next config so source-maps + de Sentry runtime worden
// gegenereerd tijdens de build. `silent: true` onderdrukt CLI-noise; en
// `hideSourceMaps: true` voorkomt dat de webclient per ongeluk de
// gegenereerde maps publiek serveert.
//
// Zonder `authToken` upload Sentry geen artifacts — precies wat we willen
// in dev/CI zonder Sentry-creds. De Sentry-runtime client init blijft wel
// werken via sentry.{client,server,edge}.config.ts mits NEXT_PUBLIC_SENTRY_DSN
// gezet is.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? 'talentflow',
  project: process.env.SENTRY_PROJECT ?? 'talentflow-web',
  silent: true,
  hideSourceMaps: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
