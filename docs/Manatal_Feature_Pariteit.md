# Manatal Feature-Parity Reference for TalentFlow

**Doel:** Volledige inventarisatie van Manatal's productcapaciteiten (mei 2026), zodat TalentFlow feature-pariteit kan bereiken op de vlakken die gebruikers daadwerkelijk waarderen.

**Bron:** manatal.com (pricing, features, blog), G2 (4.3/5), Capterra (4.6/5), Manatal support docs, developer documentation, en third-party reviews. Status van TalentFlow is gebaseerd op de huidige TalentFlow stack (Node/Express + Postgres + Next.js).

---

## 1. Pricing Tiers

Manatal hanteert vier niveaus, alle prijzen per gebruiker per maand:

- **Professional** — $15/user/maand jaarlijks ($19 maandelijks)
  - Tot 15 jobs per account, tot 10.000 kandidaten
  - Onbeperkte hiring managers
  - ATS, custom pipelines, resume parsing, basic search, career page, email integratie, AI recommendations, AI scoring, AI-gegenereerde job descriptions
  - LinkedIn organic sourcing, Gmail/Outlook sync
  - Chat + email support
- **Enterprise** — $35/user/maand jaarlijks ($39 maandelijks)
  - Onbeperkt jobs en kandidaten
  - Workflow automations, Zapier, MCP Server (LLM connectivity)
  - 24/5 chat + email support
- **Enterprise Plus** — $55/user/maand jaarlijks ($59 maandelijks)
  - User groups management, advanced report builder, SSO, Manatal Open API, candidate/employee portals, customizable user permissions, priority support, beta access
- **Custom** — op aanvraag — Dedicated account manager, telefoon support, custom features/integraties, custom compliance reporting

**TalentFlow gap?** Yes — TalentFlow heeft nog geen tier-structuur.

---

## 2. Core ATS Features

- Kandidatenprofielen — centraal record met data uit CV, social media, en handmatige enrichment
- Resume parsing — automatische extractie van velden uit PDF/DOCX
- Custom fields & mandatory fields — per stage/job te configureren
- Pipeline / Kanban — drag-and-drop board, list view, en bord view
- Application stages — custom stages per pipeline plus drop reasons
- Quick-screen — snelle ja/nee beoordeling binnen kanban
- Boolean search + AI Advanced Search — semantische zoek bovenop keywords
- Mass actions — bulk move, bulk email, bulk tag

**TalentFlow status:** UI compleet (kanban, kandidaten, pipeline). Backend resume parser werkt (PDF/DOCX → keyword skills). Boolean search ontbreekt nog.

---

## 3. AI Features

Manatal positioneert zich expliciet als "AI Recruitment Software":

- **AI Recommendation Engine** — semantische rangschikking met match-percentage en line-by-line uitleg
- **AI Candidate Scoring** — 0–100% fit-score met weegbare criteria
- **Job Completion Score** — 1–5 bar indicator
- **AI Job Description Generator** — schrijft volledige JD op basis van title + bullet points
- **AI Advanced Search** — natuurlijke taal queries
- **AI Summary** — samenvatting van CV vs job
- **AI Interviewer** (2025) — autonome video-interviewer
- **AI Notetaker** (2025) — joint Google Meet/Teams, transcribeert en vat samen
- **MCP Server** (2025–2026) — eerste ATS met Model Context Protocol

**TalentFlow status:** Geen. Voor pariteit minimaal: kandidaat-scoring, JD-generator, en semantische zoek (Postgres pgvector + embeddings via Claude/OpenAI). MCP server is een quick-win — Claude SDK + JSON-RPC.

---

## 4. CRM Features for Recruitment Agencies

- Client / Company management — bedrijven, contactpersonen, importeren via LinkedIn (People-Match Chrome extension)
- Sales / Deal pipeline — commercial pipeline van prospect tot signed
- Placements tracking — koppelt kandidaat aan job + client
- Revenue tracking & forecasting — koppelt fees aan placements, recruiters, clients
- Guest / Client portal — externe link met custom branding
- Notes & collaboration — interne notes per company/deal/placement

**TalentFlow status:** UI staat, backend mock. Echte client/deal/placement entiteiten in datamodel ontbreken nog.

---

## 5. Career Page Builder

- No-code builder — claim "2-minute deployment"
- Custom domain (carrieres.bedrijf.nl) — Premium feature
- Eigen branding — logo, kleuren, favicon
- Custom application forms
- Multi-language incl. RTL
- Embed/API — WordPress, Wix, Squarespace
- SEO + tracking — GA4, GTM
- Auto-parse — applicaties direct in ATS
- Job-grouping logica

**TalentFlow status:** UI compleet (lijst, editor, publiek `/careers/[slug]`). Custom domain ontbreekt. Multi-language ontbreekt.

---

## 6. Job Board Posting

**Native Manatal integraties:**
- Organic / gratis: Indeed, LinkedIn Organic, Monster, ZipRecruiter, Talent.com, Google for Jobs
- Premium / paid: LinkedIn sponsored job slots, "My Own Contract" feature
- Workflow: één job → boards selectie → AI Smartfill → één-klik publiceren → source tracking

**TalentFlow status:** UI lijst (16 boards), geen echte integratie. Voor NL-markt prioriteit: Indeed.nl, LinkedIn, NationaleVacaturebank, Werk.nl, Tweakers (tech).

---

## 7. Email Integration

- Two-way sync met Gmail/Google Workspace en Outlook/Microsoft 365
- Email templates met merge fields
- Mass / batch emailing
- SMS messaging via Twilio
- Mailchimp integratie
- Tracking — open- en click-tracking
- Workflow-driven email — automatisch bij stage change

**TalentFlow status:** UI staat (Berichten module). Email worker is stub — Resend/SendGrid integratie nodig.

---

## 8. Reporting & Analytics

- Out-of-the-box dashboard met 20+ pre-built KPIs
- Standaard-metrics: Time-to-Hire, Time-to-Fill, Cost-per-Hire, Source-of-Hire, Quality-of-Hire, conversion rate per stage, drop-off reasons, recruiter productivity
- Diversity metrics
- Campaign tracking
- Advanced report builder — alleen Enterprise Plus
- Team performance reports

**Bekende klacht in reviews:** rapportage is "surface-level"; veel power users exporteren naar Excel. Custom reports staan achter duurste tier.

**TalentFlow status:** UI Analytics-module met 3 dashboards (Overzicht/Recruiters/Trends). Backend stub.

---

## 9. Integrations

- Job boards: Indeed, LinkedIn, Monster, ZipRecruiter, Talent.com, Google for Jobs
- Email/Calendar: Gmail/Google Workspace, Outlook/Microsoft 365
- Marketing: Mailchimp
- Assessment: Codility, Alpharun, Xobin, Hireflix, Screenify, Quil
- E-signature: Adobe Sign
- HRIS / payroll: BambooHR, HiBob, SAP SuccessFactors via Open API
- Communication: Slack en Microsoft Teams
- AI / LLM: ChatGPT, Claude, Gemini via MCP
- Developer: Zapier (3.000+ apps), Open API
- Browser extension: People-Match Chrome extension

**TalentFlow status:** Geen echte integraties. Quick win: Zapier-webhook dekt 80% van use cases.

---

## 10. API

- Manatal Open API — REST, alleen Enterprise Plus tier
- V3 actieve versie (V1/V2 phased out per februari 2025)
- Endpoints: candidates, jobs, clients, departments, placements, users, custom fields, attachments, activities
- Webhooks beschikbaar
- Rate limits: "fair usage cap"
- Authentication: API key per account
- Geen officiële SDKs

**TalentFlow status:** UI voor API-keys + webhooks. Backend routers bestaan. Differentiator: open API vanaf alle plannen (vs. Manatal duurste tier only).

---

## 11. Mobile App

- Progressive Web App (PWA) — geen native iOS/Android apps
- Werkt op desktop, telefoon, tablet via responsive web
- Push notificaties via web push
- Volledige feature-set: kandidaten, pipeline, mailen, notes

**TalentFlow status:** Hiring Manager module is mobile-first UI. PWA-manifest ontbreekt.

---

## 12. Workflow Automation

Beschikbaar vanaf Enterprise tier.

**Triggers:**
- "Applied To The Job"
- "Move To" (stage)
- "Drop From"

**Actions:**
- Email versturen met template
- Kandidaat-status updaten / tag toevoegen
- Notificatie naar recruiter
- Webhook firen

**Scopes:** Global (pipeline-niveau) en Job (per vacature)

**TalentFlow status:** UI staat met 4 templates. Backend workflow worker is real, engine ontbreekt grotendeels.

---

## 13. Compliance

- GDPR, CCPA, PDPA support — data-export, modificatie, permanent delete
- SOC 2 Type II gecertificeerd
- Data encryptie at rest en in transit
- Consent management — opt-in tracking op career-page
- Data retention — configureerbaar
- Access control & permissions — granulair (Enterprise Plus)
- SSO — SAML, alleen Enterprise Plus

**TalentFlow status:** RLS is real. GDPR features (consent, retention, data-export) ontbreken nog. SOC 2 niet relevant voor stage.

---

## 14. Customer Reviews — Wat Gebruikers Liefhebben

**Top 5 dingen die gebruikers waarderen** (G2 4.3/5, Capterra 4.6/5):

1. **Snelle setup en lage learning curve** — "up and running within a day"
2. **Prijs/kwaliteit** — significant goedkoper dan Bullhorn, Recruit CRM, Loxo
3. **AI candidate scoring & enrichment** — automatische verrijking scheelt uren handmatig sourcen
4. **Flexibele database / custom fields** — eigen velden, eigen pipelines, eigen formulieren zonder code
5. **Drag-and-drop kanban** — intuïtieve UI voor stage-management

**Top 3 klachten:**

1. **Beperkte rapportage** — surface-level, custom reports achter duurste tier
2. **Boolean search beperkingen** — kan Boolean en AI Advanced niet combineren
3. **Customer support traag via email**

**Lessons voor TalentFlow:** Investeer vroeg in setup-snelheid (seed data), houd UI clean, en bouw rapportage-flexibiliteit niet achter een paywall.

---

## 15. Recente Product Updates 2025–2026

- **AI Interviewer** (Q2 2025) — autonome async video-interviewer
- **AI Notetaker** (Q3 2025) — auto-join Google Meet/Teams
- **AI Recommendation Engine v2** (2025) — semantic ranking met explanations
- **AI Advanced Search** (2025) — natural language search
- **My Own Contract** (2025) — centrale job-posting met eigen contracten
- **Advanced Career Page** (2025) — custom subdomeinen
- **MCP Server** (eind 2025/2026) — eerste ATS met Model Context Protocol
- **Premium Guest Portal** (2025) — fully branded client collaboration
- **5 nieuwe assessment integraties** (2025)
- **API V3 migratie** (februari 2025)

**Trend:** Manatal pusht hard op generatieve AI als kerncategorie en op LLM-interoperabiliteit (MCP). Voor TalentFlow betekent dit: AI moet géén afterthought zijn.

---

## Samenvattende Prioriteringstabel

| Feature category | Manatal | TalentFlow | Priority |
|---|---|---|---|
| Pricing tiers | 4 tiers | n.v.t. (intern) | Low |
| Core ATS (kandidaten, parsing, kanban, stages) | Volledig | UI ✅ Backend 🟡 | **P0** |
| Resume parsing | Automatisch (PDF/DOCX) | Worker ✅ | **P0** ✅ |
| Boolean + semantische search | Beide | Geen | **P0** |
| AI candidate scoring + recommendations | Geavanceerd | Geen | **P1** |
| AI job description generator | Aanwezig | Geen | **P1** |
| AI Interviewer | Aanwezig | Geen | P3 |
| AI Notetaker | Aanwezig | Geen | P2 |
| MCP Server | Eerste in markt | Geen | P2 — quick win via Claude SDK |
| Recruitment CRM (clients/deals/placements) | Volledig | UI ✅ | **P1** |
| Career page builder + custom domain | No-code | UI ✅ | **P0** |
| Job board posting | 7+ boards | UI ✅ | **P1** (NL-boards) |
| Email integratie (Gmail/Outlook 2-way) | Volledig | Stub ❌ | **P0** |
| Mass email + SMS | Aanwezig | Stub ❌ | P2 |
| Reporting & analytics (20+ KPIs) | Standaard | UI ✅ Backend ❌ | **P1** |
| Custom report builder | Enterprise Plus | Geen | P2 |
| Integrations (LinkedIn, Slack, Calendar, Zapier) | 40+ | Geen | P1 |
| Open API | Enterprise Plus | UI ✅ | P1 (open vanaf dag 1) |
| Webhooks | Aanwezig | UI ✅ | P1 |
| Mobile (PWA) | PWA | UI ✅ | P2 (manifest toevoegen) |
| Workflow automation | Enterprise tier | UI ✅ Engine 🟡 | **P1** |
| GDPR + consent + retention | Volledig | RLS ✅ | **P0** (NL wettelijk) |
| SSO | Enterprise Plus | Geen | P3 |
| Browser extension | LinkedIn People-Match | Geen | P2 |

---

## Strategische conclusie

TalentFlow kan de ≈€620/maand Manatal-licentie (werkelijke factuur, zie TCO_ROI.md) alleen verantwoord vervangen als de **P0**-categorieën volledig zitten:
- Kandidaten-DB + parsing + kanban (✅ grotendeels)
- Career page (✅ grotendeels)
- Email sync (❌ moet gebouwd)
- GDPR (❌ moet gebouwd)
- Boolean + semantische search (❌ moet gebouwd)

De **P1**-laag (AI scoring, CRM-data, automation, basis-rapportage, NL-job boards, Open API) is wat de oplossing daadwerkelijk *prettig* maakt en differentieert van een Excel-werkstroom.

**P2/P3** zijn polish die in een tweede release kunnen.

**Kritieke leerpunt uit reviews:** Manatal's grootste gebruikersliefde komt uit *snelle setup* en *flexibele custom fields* — niet uit een rijke feature-list. Een minimaal TalentFlow met excellente UX en seed-data kan al productie-rijp zijn.

---

**Sources:**
- [Manatal Pricing](https://www.manatal.com/pricing)
- [Manatal Features Hub](https://www.manatal.com/features)
- [Manatal AI Features](https://www.manatal.com/features/manatal-ai)
- [Manatal AI Recommendations](https://www.manatal.com/features/ai-recommendations)
- [Manatal Recruitment CRM](https://www.manatal.com/features/recruitment-crm)
- [Manatal Career Page](https://www.manatal.com/features/career-page)
- [Manatal Reports & Analytics](https://www.manatal.com/features/reports-and-analytics)
- [Manatal Compliance](https://www.manatal.com/features/compliance)
- [Manatal Integrations](https://www.manatal.com/integrations)
- [Manatal Workflow Automation Docs](https://support.manatal.com/docs/automations)
- [Manatal Open API Docs](https://support.manatal.com/docs/manatal-api)
- [Manatal Developer Portal](https://developers.manatal.com/)
- [Manatal 2025 Wrapped](https://www.manatal.com/blog/manatal-2025-wrapped)
- [Manatal Reviews on G2](https://www.g2.com/products/manatal/reviews)
- [Manatal Reviews on Capterra](https://www.capterra.com/p/181145/Manatal/reviews/)
- [Manatal Review 2026 — Skima](https://skima.ai/blog/product-deep-dives/manatal-review)
- [Manatal Pricing 2026 — Augtal](https://augtal.com/blog/manatal-pricing-2026-plans-features-alternatives/)
