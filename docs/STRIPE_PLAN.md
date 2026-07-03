# Stripe Billing — implementatieplan

**Status: plan, nog niet bouwen.** Bouw start pas na akkoord van Kaan op de open
beslissingen in `docs/MONETISATIE_FASE1.md` §5 (provider, tiers, trial, self-service) en
na aanlevering van de items in §8 hieronder. Dit document vertaalt de provider-keuze
(Stripe, aanbevolen in MONETISATIE_FASE1.md) naar een concreet bouwplan.

**Scope:** SaaS-abonnementsfacturatie van KDMN → tenants (de klanten van TalentFlow).
Uitdrukkelijk **niet**: de facturatie die tenants zelf naar hún klanten sturen — die
bestaat al (zie §2).

---

## 1. Uitgangspunten

- **Model:** per-seat subscriptions per tenant (aanbeveling `docs/SAAS_PLAYBOOK.md` §1.1),
  3 tiers (Starter/Professional/Enterprise), maand- of jaarfacturatie, 14 dagen trial
  zonder creditcard.
- **Stripe-producten:** Stripe Billing (subscriptions + proratie), Stripe Checkout
  (betaalflow), Customer Portal (self-service wijzigen/opzeggen/facturen), Stripe Tax
  (EU-BTW incl. B2B reverse-charge).
- **Betaalmethoden NL:** iDEAL (eerste betaling/mandaat) + SEPA-incasso (recurring), zie §6.
- **Design-partner-uitzondering:** ITProposal (en evt. latere partners) draaien op een
  intern gratis plan zonder Stripe-subscription — plan-gating moet een tenant zonder
  Stripe-koppeling dus netjes ondersteunen.

## 2. Inventarisatie: wat ligt er al in `apps/api/src/modules/billing/`?

| Bestand | Regels | Wat het doet |
|---|---|---|
| `invoicing.service.ts` | 719 | Facturen genereren uit goedgekeurde timesheets; state machine draft→sent→paid/void; concurrency-safe per-tenant factuurnummers; PDF + storage-upload; koppeling naar accounting-sync en commissies |
| `invoicing.routes.ts` | 229 | HTTP-routes, gemount op `/api/invoices` (`src/index.ts:84`), JWT + tenant-middleware, zod-validatie |
| `invoicePdf.ts` | 306 | PDF-rendering van facturen |
| `timesheetsBridge.ts` | 177 | Brug naar de timesheets-module (goedgekeurde uren → factuurregels) |

**Oordeel: levend en in gebruik, maar een ándere feature.** Dit is de back-office van de
tenant zelf (detacheringsbureau factureert zijn opdrachtgevers vanuit timesheets) — een
verkoopargument van het product, geen SaaS-billing. **Niet hergebruiken en niet aanraken.**
Er staat nergens Stripe-code in de codebase (geverifieerd via grep; enige "stripe"-hits
zijn ESCO-skill-seeddata). SaaS-billing wordt een **nieuwe, losse module**
`apps/api/src/modules/subscriptions/` — naamgeving voorkomt ook verwarring met de
bestaande billing-module.

## 3. Stripe-objecten en hun mapping

| Stripe-object | Aantal | Mapping naar TalentFlow |
|---|---|---|
| **Product** | 3 | Starter / Professional / Enterprise |
| **Price** | 6 | per Product een maand- en jaarprijs, `recurring`, `per_unit` (licensed, niet metered), EUR. Price-IDs komen in env/config, niet hardcoded |
| **Customer** | 1 per tenant | aangemaakt bij eerste checkout; `metadata.tenant_id` = tenant-UUID (de kritieke koppelsleutel in webhooks); e-mail = factuur-e-mail van de tenant |
| **Subscription** | max 1 per tenant | `quantity` = aantal seats; wijzigt via seat-sync (§5) met automatische proratie; `metadata.tenant_id` idem |
| **Checkout Session** | per aankoop | `mode: subscription`, iDEAL/SEPA/kaart, Stripe Tax aan, `client_reference_id` = tenant-UUID |
| **Customer Portal-configuratie** | 1 | wijzigen plan/seats, opzeggen, facturen downloaden, betaalmethode beheren |
| **Webhook Endpoint** | 1 | `POST /api/webhooks/billing` (§4) |

**Seat-definitie (voorstel, AANNAME):** aantal actieve (niet-gedeactiveerde) users van de
tenant. Sync-strategie: bij elke user-activatie/deactivatie een debounced job die
`subscription.quantity` bijwerkt (Stripe prorateert zelf). Geen realtime-vereiste.

## 4. Webhooks

Endpoint: `POST /api/webhooks/billing` — **zonder** JWT/tenant-middleware (Stripe is de
caller), verificatie uitsluitend via `stripe.webhooks.constructEvent` met de
webhook-signing-secret. Elk event wordt eerst idempotent gelogd in `billing_events`
(UNIQUE op `(provider, provider_event_id)`), daarna verwerkt; replay/dubbele delivery is
dan een no-op.

| Event | Actie in TalentFlow |
|---|---|
| `checkout.session.completed` | tenant koppelen: `provider_customer_id` + `provider_subscription_id` opslaan; subscription-row op `active` (of `trialing`) |
| `invoice.paid` | `current_period_end` bijwerken; status naar `active`; eventuele `past_due`-vlag wissen |
| `invoice.payment_failed` | status naar `past_due`; melding aan tenant-admin (mail) + interne notificatie aan Kaan; Stripe Smart Retries doet de incasso-herpogingen |
| `customer.subscription.updated` | plan/seats/interval/`cancel_at` spiegelen naar de subscription-row (bron van waarheid voor gating) |
| `customer.subscription.deleted` | status naar `canceled`; tenant naar read-only (§7); data blijft staan conform SAAS_PLAYBOOK §4 |
| `customer.subscription.trial_will_end` *(optioneel)* | reminder-mail 3 dagen voor einde trial |

Onbekende/overige events: wel loggen in `billing_events`, niet verwerken (forward-compatible).

## 5. Waar het landt in de codebase

Datamodel: het provider-agnostische schema uit `docs/MONETISATIE_FASE1.md` §4
(`billing_plans` globaal; `subscriptions` en `billing_events` met RLS; webhook-writes via
de bestaande `auth_context`-uitzondering). **Correctie op dat document:** migratienummer
038 is inmiddels bezet (laatste is `042_tenant_email_settings.sql`) → dit wordt
**`043_billing.sql`**, idempotent in de stijl van de bestaande migraties.

```
apps/api/src/modules/subscriptions/
  subscriptions.service.ts     # CRUD + seat-sync (afgeleid uit actieve users)
  subscriptions.controller.ts  # GET /api/subscriptions/me, POST /api/subscriptions/checkout,
                               # POST /api/subscriptions/portal (portal-session-link)
  subscriptions.router.ts
  providers/stripe.adapter.ts  # alle Stripe-SDK-calls achter één interface
  webhooks.controller.ts       # POST /api/webhooks/billing (signature-check + idempotentie)
  planGating.ts                # requireFeature('ai_sourcing') / withinLimit('max_active_jobs')
```

Aanvullend te raken bestanden (klein): `src/index.ts` (routers mounten; webhook-route
vóór de JSON-bodyparser of met raw-body — Stripe-signature vereist de raw payload),
`infra/.env.prod.example` (nieuwe env-vars), frontend: een eenvoudige
abonnement-pagina in settings (huidige plan, seats, knop naar Checkout/Portal).

**Plan-gating** (`planGating.ts`) leest het actieve plan + limits van de tenant (uit
`subscriptions` ↔ `billing_plans`, gecachet per request) en dwingt per route features en
limieten af. Tenants zonder subscription-row (design partners, bestaande tenant `kdmn`)
krijgen een intern plan met alles aan — expliciet zo configureren, niet als bijeffect.

## 6. iDEAL + SEPA voor NL-klanten

- **Eerste betaling via iDEAL in Checkout:** iDEAL is one-off; Stripe zet de betaling om
  in een **SEPA-mandaat** voor de vervolgtermijnen (`payment_method_types` /
  automatische methode-selectie in Checkout regelt dit). Kaart blijft als alternatief aan.
- **Recurring via SEPA-incasso:** let op de eigenschappen — incasso kan tot ~14 dagen na
  afschrijving nog falen/gestorneerd worden, dus `invoice.paid` is de waarheid, niet de
  checkout; dunning via Stripe Smart Retries + automatische betaalherinnering-mails.
- **Fees (indicatief, verifiëren):** SEPA ~0,8% met cap ~€5 — voor facturen van €200–400
  is de cap gunstig t.o.v. kaart; iDEAL vast laag tarief; Billing-opslag +0,5%, Stripe Tax
  ~0,5% (zie de fee-tabel in MONETISATIE_FASE1.md §2).
- **Trial zonder creditcard (playbook §1.4):** de trial loopt buiten Stripe om (tenant
  aangemaakt, subscription-row `trialing` zonder provider-koppeling); Checkout volgt pas
  bij conversie. Dat vermijdt betaalgegevens-vooraf én de `trial_period_days`-complexiteit.

## 7. Feature-gating bij wanbetaling: read-only, geen lockout

Principe: **wanbetaling raakt schrijfrechten, nooit data.** Een bureau mag nooit zijn
kandidatendatabase als gijzelaar ervaren — dat is ook de AVG-lijn uit de
verwerkersovereenkomst (export blijft altijd mogelijk).

| Fase | Trigger | Gedrag |
|---|---|---|
| 1. Herinnering | `invoice.payment_failed` (1e) | banner voor tenant-admins ("betaling mislukt, werk betaalmethode bij"), mail; functioneel niets beperkt; Smart Retries lopen |
| 2. Read-only | na afloop dunning (Stripe markeert subscription `past_due`/`unpaid`; AANNAME ~14 dagen) | alle GET blijft werken; schrijf-endpoints geven 402 met duidelijke melding; uitgezonderd blijven: billing-endpoints (betalen/Portal), data-export, user-login |
| 3. Opgezegd | `customer.subscription.deleted` | read-only blijft; na 30 dagen start het offboarding-proces uit `docs/SAAS_PLAYBOOK.md` §4.2 (export-window, daarna verwijdering) |

Implementatie: één middleware-check in `planGating.ts` op subscription-status
(`past_due`/`canceled` → alleen whitelisted routes schrijfbaar). Bewust géén aparte
"suspended"-datastructuur.

## 8. Wat Kaan moet aanleveren (blokkerend vóór de bouw)

1. **Stripe-account** op de KDMN-entiteit: KvK-gegevens, bankrekening (uitbetaling),
   identiteitsverificatie doorlopen. BTW-nummer invoeren en **Stripe Tax activeren**.
2. **API-keys:** test- én live-mode secret keys (naar VPS-env, nooit in de repo).
3. **Webhook-signing-secret** voor het endpoint `https://talentflow.kdmn.nl/api/webhooks/billing`
   (per mode een eigen secret; de test-variant komt uit Stripe CLI).
4. **Producten + prijzen aanmaken** in Stripe (3 producten, 6 prices conform §3) en de
   **price-IDs** aanleveren. (Kan ook scripted; handmatig in het dashboard is prima voor 6 stuks.)
5. **Customer Portal configureren** (welke wijzigingen klanten zelf mogen doen).
6. **Beslissingen bevestigen:** definitieve tierprijzen, jaarkorting, trial-vorm,
   self-service signup ja/nee (MONETISATIE_FASE1.md §5) en het wanbetaling-tijdpad (§7).
7. **Factuurgegevens-afzender:** bedrijfsnaam, adres, BTW-nummer zoals ze op
   Stripe-facturen moeten verschijnen.

## 9. Fasering, uren en complexiteit

| Fase | Inhoud | Uren | Complexity |
|---|---|---|---|
| 0 | Stripe-account inrichten (§8; grotendeels Kaan, begeleid) | 2–3 | low |
| 1 | Migratie `043_billing.sql` + subscriptions-module-skelet + `stripe.adapter.ts` + seed van `billing_plans` | 6–8 | medium |
| 2 | Webhook-endpoint incl. signature-verificatie, raw-body-route, idempotente verwerking van de 5 events + tests | 4–6 | medium |
| 3 | Plan-gating-laag + read-only-wanbetaling (middleware + 402-afhandeling in frontend) | 4–6 | medium |
| 4 | Checkout-flow + Customer Portal-link + seat-sync + abonnement-pagina in settings | 4–6 | medium |
| 5 | End-to-end testen (Stripe CLI webhook-forwarding, test-clocks voor renewals/dunning, iDEAL/SEPA-testbetalingen) + deploy + smoke-test | 3–5 | medium |
| | **Totaal** | **23–34** | **medium** |

Zonder self-service (Kaan zet plannen handmatig, alleen webhooks + gating): ~12–16 uur.
Consistent met de ruwe schatting in MONETISATIE_FASE1.md (16–24 uur); het verschil zit in
expliciet ingeplande test-/dunning-scenario's en de frontend-pagina.

## 10. Risico's en aandachtspunten

- **Raw body vs bodyparser:** Stripe-signature-verificatie faalt op geparsed JSON; de
  webhook-route moet vóór/naast `express.json()` gemonteerd worden. Klassieke valkuil.
- **Idempotentie is niet optioneel:** Stripe levert events dubbel en out-of-order;
  `billing_events` + status-spiegeling vanuit `customer.subscription.updated` (in plaats
  van zelf state bijhouden) vangt dit af.
- **RLS en webhooks:** de webhook-handler heeft geen tenant-context; schrijven verloopt
  via de bestaande `auth_context`-route zoals in het schema-voorstel — meenemen in de
  RLS-audit-scripts (`apps/api/scripts/rls-*.cjs`).
- **SEPA-storneringen:** een "betaald" abonnement kan tot ~2 weken later alsnog falen;
  nooit onomkeerbare acties koppelen aan de eerste betaalbevestiging.
- **Design-partner-tenants** mogen nooit per ongeluk gegate of gefactureerd worden —
  expliciete plan-rij, met test.
- **Stripe-tarieven zijn indicatief** (bron: MONETISATIE_FASE1.md, juni 2026) — actuele
  fees verifiëren op stripe.com/pricing vóór de definitieve prijsstelling.

---

**Gerelateerde documenten:** `docs/MONETISATIE_FASE1.md` (provider-keuze, tiers,
datamodel), `docs/SAAS_PLAYBOOK.md` (pricing, churn/exit, wanbetaling-beleid),
`docs/VERWERKERSOVEREENKOMST_TEMPLATE.md` (export-/verwijderplichten die §7 begrenzen).
