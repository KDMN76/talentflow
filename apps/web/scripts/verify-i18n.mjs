// Verifieert de i18n-migratie end-to-end: login → wissel naar EN → bezoek alle
// kern-pagina's → check (1) geen rauwe i18n-sleutels zichtbaar, (2) verwachte
// EN-teksten aanwezig, (3) geen crashes; rapporteert resterende NL-markers ter
// review (kan legitieme tenant-data zijn). Daarna terug naar NL als sanity-check.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "http://localhost:3000";
const dir = dirname(fileURLToPath(import.meta.url));

// [route, label, verwachte EN-snippets]
const PAGES = [
  ["/dashboard", "dashboard", ["Candidates", "Jobs"]],
  ["/candidates", "candidates", ["Candidates"]],
  ["/jobs", "jobs", ["Jobs"]],
  ["/pipeline", "pipeline", ["Pipeline"]],
  ["/interviews", "interviews", ["Interviews"]],
  ["/jobs/cccccccc-cccc-cccc-cccc-333333333333", "job-detail", ["Jobs"]],
];

// Rauwe sleutels zoals "jobs:list.title" of zichtbare "list.emptyTitle".
const RAW_KEY_RE = /\b(?:common|auth|dashboard|jobs|candidates|pipeline|interviews):[a-zA-Z][a-zA-Z0-9_.]+\b|\b[a-z][a-zA-Z]+\.(?:title|label|empty|description|placeholder)[a-zA-Z]*\b/;
// NL-woorden die op gemigreerde chrome niet meer voor horen te komen.
const NL_MARKERS = /(Kandidaten|Vacatures|Instellingen|Zoeken|Nieuwe kandidaat|Sollicitaties|Rapporten|Geen .* gevonden)/;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1100 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message || e).slice(0, 150)));

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.fill("#tenantSlug", "dev-a");
  await page.fill('input[type="email"]', "admin@dev-a.talentflow-dev.local");
  await page.fill('input[type="password"]', "dev-password-2026");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25000 }),
    page.click('button[type="submit"]'),
  ]);
}
try { await login(); } catch { await login(); }
console.log("LOGIN OK");

// Wissel naar EN via de sidebar-switcher.
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.click('div[aria-label="Taal"] button:has-text("en")');
await page.waitForTimeout(800);

let failures = 0;
for (const [route, label, expectEn] of PAGES) {
  pageErrors.length = 0;
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 30000 });
  } catch {}
  await page.waitForTimeout(1500);
  let body = "";
  try { body = (await page.innerText("body")).replace(/\s+/g, " ").trim(); } catch {}
  await page.screenshot({ path: join(dir, `i18n-en-${label}.png`) });

  const rawKey = body.match(RAW_KEY_RE)?.[0] ?? null;
  const missingEn = expectEn.filter((s) => !body.includes(s));
  const nlHit = body.match(NL_MARKERS)?.[0] ?? null;
  const ok = !rawKey && missingEn.length === 0 && pageErrors.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${route}` +
      (rawKey ? `  rauwe sleutel: "${rawKey}"` : "") +
      (missingEn.length ? `  EN ontbreekt: ${missingEn.join(",")}` : "") +
      (pageErrors.length ? `  pageErr: ${pageErrors[0]}` : "") +
      (nlHit ? `  [NL-marker ter review: "${nlHit}"]` : "")
  );
}

// Sanity: terug naar NL en check dat dashboard weer NL toont.
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.click('div[aria-label="Taal"] button:has-text("nl")');
await page.waitForTimeout(800);
const nlBody = (await page.innerText("aside")).replace(/\s+/g, " ");
const backToNl = /Kandidaten/.test(nlBody) && /Vacatures/.test(nlBody);
console.log(`${backToNl ? "OK  " : "FAIL"} terugwissel naar NL`);
if (!backToNl) failures++;

await browser.close();
console.log(failures === 0 ? "\n✅ ALLE KERN-PAGINA'S OK IN EN (+ NL-terugwissel)" : `\n❌ ${failures} pagina('s) met problemen`);
process.exit(failures === 0 ? 0 : 1);
