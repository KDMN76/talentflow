# Monetisatie — Fase 1 beslisdocument

Voorbereiding op het betaalbaar maken van TalentFlow als SaaS. Er wordt in dit
document **nog geen code gebouwd** — het doel is dat Kaan één hoofdkeuze maakt
(betaalprovider) en de prijs-tiers vaststelt, waarna het bouwwerk klaarligt.

> Bronnen: Mollie-research (docs/-workflow, juni 2026, Mollie API-docs +
> mollie.com/pricing), prijs-analyse op de echte Manatal-factuur van ITProposal,
> en Stripe-productkennis. **Exacte Stripe-tarieven indicatief — verifieer
> actueel op stripe.com/pricing vóór contractering.**

---

## 1. Samenvatting & aanbeveling

**Aanbeveling: Stripe (Stripe Billing + Checkout + Customer Portal + Stripe Tax).**

Drie doorslaggevende redenen voor een **seat-based** B2B-SaaS met self-service:

1. **Seats & proratie zitten ingebouwd.** Stripe Billing kent `quantity`
   (= seats) als first-class begrip en rekent up-/downgrades midden in een
   periode automatisch proratisch af. Mollie kent géén seat-concept en géén
   proratie — daar reken je elk seat-totaal zelf uit en zet je het bedrag
   handmatig via een `PATCH`. Voor een product dat per recruiter-seat verkoopt
   en waar seats voortdurend wijzigen, is dat het verschil tussen "config" en
   "een eigen billing-engine bouwen".
2. **Hosted self-service portaal.** Stripe Customer Portal levert kant-en-klaar
   het abonnement-wijzigen/opzeggen/factuur-downloaden-scherm. Mollie heeft dat
   niet — self-service signup/beheer zou je volledig zelf bouwen.
3. **BTW-afhandeling.** Stripe Tax berekent automatisch EU-BTW incl. OSS en
   B2B reverse-charge (met VAT-ID-validatie). Bij Mollie is BTW volledig je
   eigen verantwoordelijkheid.

**Belangrijke nuance — geen van beide is Merchant of Record.** Bij zowel Stripe
als Mollie blijf jij (KDMN) de verkoper die BTW moet registreren en afdragen.
Wil je dat volledig uitbesteden, dan is een MoR als **Paddle** of
**Lemon Squeezy** het alternatief (zij worden de verkoper en dragen BTW af),
tegen een hogere fee (~5% all-in) en minder controle. Voor één NL-entiteit die
aan EU-bedrijven verkoopt is Stripe + Stripe Tax doorgaans de betere balans;
overweeg Paddle alleen als je de BTW-administratie écht niet wilt voeren.

**Wanneer tóch Mollie?** Als monetisatie voorlopig "vast bedrag per maand, seats
handmatig aanpassen, geen self-service" is, dan is Mollie's goedkope SEPA-incasso
(~€0,35/klant/maand, geen percentage) aantrekkelijk en simpel. Zodra je
self-service signup, trials en automatische seat-proratie wilt — en dat is de
fase-1-ambitie — wint Stripe overtuigend.

### Aanbevolen prijs-tiers (jaarprijs per seat/maand)

| Tier | Jaar €/seat/mnd | Maand €/seat/mnd | 16 seats/jaar | Kern |
|---|---|---|---|---|
| **Starter** | €19 | €23 | €3.648 | ATS, kandidaten/vacatures, career page, e-mail, AVG-dashboard, API (read) |
| **Professional** ⭐ | €29 | €35 | €5.568 | + AI-matching & sourcing, agency-CRM, interviews, white-label portaal, WhatsApp, SSO, API (read+write) |
| **Enterprise** | €39 | €47 | €7.488 | + SCIM, AI-Act-compliance, pay-equity, forecasting, SLA, custom webhooks |

Referentie: ITProposal betaalt Manatal nu ~€625/mnd (16 seats × $39 + $50 add-on)
≈ **€7.500/jaar**. Op **Professional** betaalt diezelfde klant **€5.568/jaar**
(~26% goedkoper) én krijgt SSO/API/white-label die bij Manatal pas op het
duurste niveau ($55–59/seat) zitten. **Professional is de te verkopen sweet spot.**

---

## 2. Stripe vs Mollie — vergelijking

| Criterium | **Stripe** | **Mollie** |
|---|---|---|
| Recurring subscriptions | ✅ Volwaardige billing-engine | ✅ Subscriptions API (bedrag + interval) |
| Seats / quantity | ✅ Native `quantity` | ❌ Geen seat-concept (zelf bedrag rekenen) |
| Automatische proratie | ✅ Ingebouwd | ❌ Zelf berekenen + `PATCH amount` |
| Usage/metered billing | ✅ | ❌ |
| Gratis trials | ✅ Native trial-period | ⚠️ Zelf regelen (startDate/eerste charge) |
| Hosted self-service portaal | ✅ Customer Portal | ❌ Zelf bouwen |
| Hosted checkout | ✅ Stripe Checkout | ✅ Hosted payment pages |
| BTW (EU OSS + B2B reverse-charge) | ✅ Stripe Tax (calc + rapport) | ❌ Volledig zelf |
| Merchant of Record | ❌ (jij blijft verkoper) | ❌ (jij blijft verkoper) |
| iDEAL | ✅ (one-off → SEPA-mandaat) | ✅ Native, sterk |
| SEPA Direct Debit (recurring) | ✅ | ✅ |
| Dunning / retries | ✅ Smart Retries + e-mails | ✅ Tot 5 retries, dan cancel |
| Fees (indicatief, EU 2025) | EEA-kaart ~1,5% + €0,25; iDEAL ~€0,29; SEPA ~0,8% (cap €5); **Billing +0,5%** recurring; **Stripe Tax ~0,5%**/transactie | iDEAL €0,32; **SEPA €0,35 vast**; EEA-kaart 1,8% + €0,25; zakelijke kaart 2,9% + €0,25; **geen maandkosten, geen Billing-opslag** |
| Ontwikkelgemak seat-SaaS | ✅ Hoog (alles aanwezig) | ⚠️ Veel zelf bouwen |
| NL/EU-fit betaalmethoden | ✅ Goed | ✅ Uitstekend (lokaal sterkst) |

**Eerlijke trade-off (geen valse balans):** Mollie is **goedkoper per transactie**
(geen 0,5% Billing-opslag, SEPA €0,35 vast i.p.v. een percentage) en lokaal de
sterkste betaalmethode-dekking. Maar dat voordeel verdamp je meteen door de
**ontwikkel- en onderhoudskost** van een zelfgebouwde billing-laag (seats,
proratie, trials, portaal, BTW). Bij ~5–10 betalende tenants weegt
engineering-tijd zwaarder dan een paar tiende procent transactiefee. **Voor
fase-1 (self-service, seats, trials) wint Stripe; Mollie wint alleen als
monetisatie bewust simpel en handmatig blijft.**

---

## 3. Prijs-tiers — detail

Anker = de **echte** Manatal-factuur (niet de oude €1.000-aanname): 16 seats ×
$39 + $50 add-on ≈ €625/mnd ≈ €7.500/jr. Manatal geeft SSO + open API +
priority support pas op Enterprise Plus ($55–59/seat). TalentFlow bundelt die
juist standaard → **goedkoper op prijs, ruimer op features.**

- **Starter — €19/seat (€23 maand).** ATS-pipeline, kandidaten/vacatures, career
  page, e-mail (Resend), basis-rapportage, AVG-dashboard, API (read). Caps: bv.
  10 actieve vacatures, geen AI-sourcing/matching. *Instaptier; bewust beperkt
  zodat Professional niet gekannibaliseerd wordt.*
- **Professional — €29/seat (€35 maand). ⭐ hoofdtier.** Alles uit Starter +
  AI-matching, sourcing-agent, agency-CRM + plaatsingen, interviews
  (kits/scorecards/agenda-sync), white-label klantportaal, WhatsApp, volledige
  analytics/funnel, API (read+write), SSO. *Prijst ónder Manatal Enterprise (€39)
  maar levert de Enterprise-Plus-features.*
- **Enterprise — €39/seat (€47 maand).** Alles uit Professional + SCIM,
  AI-Act-transparantie, pay-equity, audit-export, forecasting, dedicated
  support/SLA, custom integraties/webhooks, sandbox. *Exact op Manatal's
  effectieve €39, maar add-ons vervallen + EU-native compliance erbij.*

**Jaar vs maand:** ~20% korting bij jaarlijks vooruit (spiegelt Manatal,
vermijdt verwarring). **Trial:** 14 dagen op Professional-niveau, **geen
creditcard vooraf** (NL/BE-bureaus zijn kaart-afkerig); daarna plan kiezen of
terugval naar Starter-caps (data blijft, geen harde lock-out). **Design-partners**
(ITProposal) blijven gratis in ruil voor testimonial/case study.

**Marge-eerlijkheid:** variabele kost ~€80–110/mnd per actieve tenant (infra +
AI-API); de **dominante** kost is onderhoud/support (~€280/mnd menselijke tijd
per klant, zie docs/TCO_ROI.md). Bij 1–2 klanten eet support de marge op; vanaf
~5–10 tenants amortiseert dat zich tot een structurele 60–70% brutomarge. **De
go-to-market moet dus op volume mikken, niet op één losse deal.**

---

## 4. Provider-agnostisch billing-schema (voorstel)

Houd provider-identifiers neutraal (`provider`, `provider_customer_id`,
`provider_subscription_id`) zodat een latere switch Stripe↔Mollie geen
schema-migratie vergt. `billing_plans` is **globale** referentiedata (de eigen
productcatalogus, geen tenant-data — zoals `esco_skills`); `subscriptions` en
`billing_events` zijn tenant-data met RLS.

```sql
-- VOORSTEL — nog niet aangemaakt. Wordt migratie 038_billing.sql ná de
-- provider-keuze. Idempotent, in de stijl van de bestaande migraties.

-- Globale plan-catalogus (geen tenant_id; geen RLS, net als esco_skills).
CREATE TABLE IF NOT EXISTS billing_plans (
  id            TEXT PRIMARY KEY,                 -- 'starter' | 'professional' | 'enterprise'
  name          TEXT NOT NULL,
  price_monthly_cents INT NOT NULL,               -- per seat
  price_yearly_cents  INT NOT NULL,               -- per seat (jaarprijs/mnd ×12 of effectief)
  currency      TEXT NOT NULL DEFAULT 'EUR',
  features      JSONB NOT NULL DEFAULT '{}',      -- {ai_sourcing:true, sso:true, scim:false, ...}
  limits        JSONB NOT NULL DEFAULT '{}',      -- {max_active_jobs:10, ...}
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eén actief abonnement per tenant (tenant-data → RLS).
CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id       TEXT NOT NULL REFERENCES billing_plans(id),
  status        TEXT NOT NULL DEFAULT 'trialing',  -- trialing|active|past_due|canceled|paused
  seats         INT NOT NULL DEFAULT 1,
  billing_interval TEXT NOT NULL DEFAULT 'month',  -- month|year
  provider      TEXT,                              -- 'stripe' | 'mollie'
  provider_customer_id     TEXT,
  provider_subscription_id TEXT,
  trial_end     TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)                               -- één abonnement per tenant
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='subscriptions' AND policyname='tenant_isolation_subscriptions') THEN
    CREATE POLICY tenant_isolation_subscriptions ON subscriptions
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;

-- Webhook-/event-log (idempotente verwerking; provider event-id uniek).
CREATE TABLE IF NOT EXISTS billing_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- nullable: nog niet gematchte events
  provider      TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)             -- idempotentie: elk event 1×
);
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='billing_events' AND policyname='tenant_isolation_billing_events') THEN
    -- Reads tenant-scoped; de webhook-handler schrijft via auth_context (geen
    -- tenant-context op het moment van binnenkomst) net als de auth-lookups.
    CREATE POLICY tenant_isolation_billing_events ON billing_events
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
             OR nullif(current_setting('app.auth_context', true), '') = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
             OR nullif(current_setting('app.auth_context', true), '') = 'on');
  END IF;
END $$;
```

### Module-structuur

```
apps/api/src/modules/subscriptions/
  subscriptions.service.ts     # CRUD + seat-sync (afgeleid uit actieve users)
  subscriptions.controller.ts  # GET /api/subscriptions/me, POST checkout-session
  subscriptions.router.ts
  providers/
    stripe.adapter.ts          # of mollie.adapter.ts — achter één interface
  webhooks.controller.ts       # POST /api/webhooks/billing (idempotent via billing_events)
  planGating.ts                # requireFeature('ai_sourcing') / withinLimit('max_active_jobs')
```

**Plan-gating** = middleware/helper die het actieve plan van de tenant leest en
per route een feature/limiet afdwingt (bv. `requireFeature('sso')` op de
SSO-routes; `withinLimit('max_active_jobs')` bij job-create). Dit is de enige
échte nieuwe applicatielaag; alle tier-modules (sourcing, matching, interviews,
crm, compliance, portal, scim) bestáán al als code.

---

## 5. Open beslissingen voor Kaan (vóór de bouw start)

1. **Provider:** Stripe (aanbevolen) of Mollie? Of toch een MoR (Paddle) om
   BTW volledig uit te besteden?
2. **Definitieve tier-prijzen:** akkoord met €19 / €29 / €39 (jaar) en de
   feature-verdeling per tier?
3. **Trial:** 14 dagen op Professional zonder creditcard — akkoord?
4. **Jaarkorting:** ~20% jaarlijks-vooruit — akkoord?
5. **Self-service signup in scope voor fase 1?** Oftewel: mogen nieuwe tenants
   zichzelf aanmelden + betalen (Stripe Checkout), of blijft onboarding
   voorlopig handmatig (jij maakt de tenant + zet het plan)?
6. **Design-partner-uitzondering:** ITProposal (en evt. andere partners) blijven
   op een gratis/intern plan — bevestigen zodat plan-gating daar rekening mee houdt.

Zodra 1–6 beslist zijn, is de bouw: migratie 038 (bovenstaand schema) →
provider-adapter → webhook-handler → plan-gating-laag → (optioneel) Checkout-
signupflow. Schatting: **medium complexity, ~16–24 uur werk** voor Stripe incl.
self-service; ~8–12 uur voor een handmatig "plan zetten"-model zonder signup.
