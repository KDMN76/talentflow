// Verifieert de vrijdag-demo-fixes end-to-end in de browser:
//  V4: /crm toont echte data (ITProposal BV) zonder fout
//  V5: /hm rendert met echte cijfers (geen mock-namen als "Sophie van der Berg")
//  V2: onbekende route toont nette 404 (geen kale Next-default)
//  V9: vacature aanmaken via de UI slaagt
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "http://localhost:3000";
const dir = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1100 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e).slice(0, 120)));

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
let fail = 0;

// V4 — CRM
errs.length = 0;
await page.goto(`${BASE}/crm`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const crmBody = (await page.innerText("body")).replace(/\s+/g, " ");
const crmOk = /ITProposal BV/.test(crmBody) && errs.length === 0 && !/Er ging iets mis/.test(crmBody);
console.log(`${crmOk ? "OK  " : "FAIL"} V4 /crm — ITProposal BV zichtbaar: ${/ITProposal BV/.test(crmBody)}, errors: ${errs.length}`);
await page.screenshot({ path: join(dir, "vrijdag-crm.png") });
if (!crmOk) fail++;

// V5 — HM (geen mock-namen, geen crash)
errs.length = 0;
await page.goto(`${BASE}/hm`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const hmBody = (await page.innerText("body")).replace(/\s+/g, " ");
const mockLeak = /(Sophie van der Berg|Marco Janssen|Aisha el-Hamdaoui|Pieter de Wit)/.test(hmBody);
const hmOk = !mockLeak && errs.length === 0;
console.log(`${hmOk ? "OK  " : "FAIL"} V5 /hm — mock-namen zichtbaar: ${mockLeak}, errors: ${errs.length}`);
await page.screenshot({ path: join(dir, "vrijdag-hm.png") });
if (!hmOk) fail++;

// V2 — 404-pagina
await page.goto(`${BASE}/deze-pagina-bestaat-niet`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const nfBody = (await page.innerText("body")).replace(/\s+/g, " ");
const nfOk = /Pagina niet gevonden/.test(nfBody);
console.log(`${nfOk ? "OK  " : "FAIL"} V2 404-pagina — nette NL-tekst: ${nfOk}`);
if (!nfOk) fail++;

// V9 — vacature aanmaken via de UI
errs.length = 0;
await page.goto(`${BASE}/jobs/new`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const title = `Demo-check QA Engineer ${Math.floor(Math.random() * 10000)}`;
// JobForm: vul de verplichte velden (titel/afdeling/locatie/omschrijving/salaris)
await page.fill('input[name="title"]', title).catch(async () => {
  // fallback: eerste tekstinput
  await page.locator("form input[type='text']").first().fill(title);
});
const fillIf = async (sel, val) => { const l = page.locator(sel); if (await l.count()) await l.first().fill(val); };
await fillIf('input[name="department"]', "QA");
await fillIf('input[name="location"]', "Utrecht");
const ta = page.locator("form textarea").first();
if (await ta.count()) await ta.fill("Wij zoeken een QA Engineer die onze releases bewaakt. Je schrijft testplannen, automatiseert regressietests en werkt nauw samen met het dev-team om kwaliteit structureel te borgen.");
await fillIf('input[name="salary_min"]', "45000");
await fillIf('input[name="salary_max"]', "60000");
await page.locator('form button[type="submit"]').first().click();
await page.waitForTimeout(3500);
const afterUrl = page.url().replace(BASE, "");
const v9Body = (await page.innerText("body")).replace(/\s+/g, " ");
const created = !afterUrl.startsWith("/jobs/new") || /aangemaakt|Vacature aangemaakt/i.test(v9Body);
console.log(`${created ? "OK  " : "FAIL"} V9 vacature aanmaken — url na submit: ${afterUrl}, errors: ${errs.length}`);
await page.screenshot({ path: join(dir, "vrijdag-jobcreate.png") });
if (!created) fail++;

await browser.close();
console.log(fail === 0 ? "\n✅ ALLE VRIJDAG-CHECKS GROEN" : `\n❌ ${fail} check(s) gefaald`);
process.exit(fail === 0 ? 0 : 1);
