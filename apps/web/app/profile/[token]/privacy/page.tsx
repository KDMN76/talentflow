/**
 * Privacy-policy — generieke NL AVG-tekst voor het kandidaat-self-service-portaal.
 *
 * Approach: niet-tenant-specifiek (we halen geen branding op). De tekst is een
 * "platform-baseline" zodat kandidaten weten welke rechten ze hebben en wat
 * TalentFlow doet met data, ongeacht welke recruiter de link verstuurde.
 *
 * NB: dit is een baseline-AVG-tekst; tenants kunnen straks via tenant-settings
 * een eigen privacy-policy uploaden. Voor MVP volstaat deze generieke versie.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy­beleid — Mijn gegevens",
  robots: { index: false, follow: false },
};

export default function PrivacyPage({ params }: { params: { token: string } }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href={`/profile/${params.token}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Terug naar Mijn gegevens
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            AVG-baseline
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Privacy­beleid kandidaat-portaal
          </h1>
        </div>
      </div>

      <div className="prose prose-sm max-w-none space-y-6 text-zinc-700 dark:prose-invert dark:text-zinc-300">
        <Section title="1. Wie is verantwoordelijk?">
          <p>
            Het recruitment-team dat je deze link heeft gestuurd is de{" "}
            <em>verwerkingsverantwoordelijke</em> voor jouw gegevens.
            TalentFlow B.V. fungeert als <em>verwerker</em> en biedt het
            platform waarmee je gegevens worden opgeslagen en verwerkt.
          </p>
          <p>
            Je vindt de contactgegevens van het recruitment-team (en hun
            Functionaris Gegevensbescherming, indien aangesteld) in de
            uitnodigingsmail die je hebt ontvangen, of onderaan dit portaal.
          </p>
        </Section>

        <Section title="2. Welke gegevens worden verwerkt?">
          <ul>
            <li>
              <strong>Identificatie & contact</strong>: naam, e-mailadres,
              telefoonnummer.
            </li>
            <li>
              <strong>Professioneel profiel</strong>: CV, werkervaring,
              opleiding, vaardigheden, talen, salarisindicatie.
            </li>
            <li>
              <strong>Sollicitatie-data</strong>: op welke vacatures je hebt
              gesolliciteerd, status, feedback, scorecards.
            </li>
            <li>
              <strong>Communicatie</strong>: alle e-mail-, WhatsApp- en SMS-
              berichten tussen jou en het recruitment-team.
            </li>
            <li>
              <strong>Toestemmingen & audit-trail</strong>: wanneer je welke
              toestemming hebt gegeven of ingetrokken (write-once, AVG art. 7).
            </li>
            <li>
              <strong>AI-output</strong>: matchscores, samenvattingen en
              parsing-resultaten gegenereerd door AI op basis van je CV (zie §6).
            </li>
          </ul>
        </Section>

        <Section title="3. Op welke grondslag?">
          <ul>
            <li>
              <strong>Toestemming</strong> (AVG art. 6 lid 1a) voor opslag van je
              CV en profiel buiten een lopende procedure.
            </li>
            <li>
              <strong>Uitvoering overeenkomst</strong> (art. 6 lid 1b) tijdens
              een actieve sollicitatie.
            </li>
            <li>
              <strong>Gerechtvaardigd belang</strong> (art. 6 lid 1f) voor
              fraudepreventie, beveiliging en geanonimiseerde rapportages.
            </li>
            <li>
              <strong>Wettelijke verplichting</strong> (art. 6 lid 1c) na
              plaatsing (bijv. financiële administratie).
            </li>
          </ul>
        </Section>

        <Section title="4. Hoe lang bewaren we je gegevens?">
          <p>
            Standaard <strong>24 maanden</strong> na je laatste activiteit (laatste
            sollicitatie of contact). Daarna verwijderen we je profiel automatisch.
            Je vindt je persoonlijke deletion-deadline in het portaal.
          </p>
          <p>
            Wettelijk verplichte data (bijv. financiële records bij plaatsing)
            blijven bewaard volgens de wettelijke termijn (meestal 7 jaar).
          </p>
        </Section>

        <Section title="5. Je rechten (AVG art. 15-21)">
          <p>Via dit portaal kun je direct:</p>
          <ul>
            <li>
              <strong>Inzien</strong> welke gegevens we hebben (art. 15).
            </li>
            <li>
              <strong>Corrigeren</strong> van onjuiste gegevens (art. 16).
            </li>
            <li>
              <strong>Verwijderen</strong> aanvragen (art. 17, "recht op
              vergetelheid"). Verzoek wordt binnen 30 dagen verwerkt.
            </li>
            <li>
              <strong>Toestemming intrekken</strong> (art. 7 lid 3).
            </li>
            <li>
              <strong>Sollicitatie terugtrekken</strong> per actieve procedure.
            </li>
          </ul>
          <p>
            Daarnaast heb je het recht op <em>dataportabiliteit</em> (art. 20),
            <em>bezwaar</em> (art. 21), en het recht een klacht in te dienen bij de
            <em> Autoriteit Persoonsgegevens</em> (
            <a
              href="https://autoriteitpersoonsgegevens.nl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline"
            >
              autoriteitpersoonsgegevens.nl
            </a>
            ).
          </p>
        </Section>

        <Section title="6. AI & geautomatiseerde besluitvorming">
          <p>
            We gebruiken AI (Claude door Anthropic, met OpenAI als fallback) voor:
          </p>
          <ul>
            <li>CV-parsing (extractie van velden uit je CV).</li>
            <li>
              Match-scores tussen jou en vacatures (transparant — de toelichting
              wordt gelogd in onze WORM-audit-trail conform AI Act).
            </li>
            <li>Samenvattingen en bias-checks van vacaturetekst.</li>
          </ul>
          <p>
            <strong>Belangrijk:</strong> AI maakt geen finale beslissingen over je
            sollicitatie. Een menselijke recruiter neemt elk inhoudelijk besluit
            (afwijzen, uitnodigen, plaatsen). Je hebt het recht op menselijke
            tussenkomst (AVG art. 22).
          </p>
        </Section>

        <Section title="7. Met wie delen we je gegevens?">
          <ul>
            <li>
              <strong>Hiring managers / klanten van het recruitment-bureau</strong>{" "}
              die de vacature vervullen — alleen na expliciete shortlisting door je
              recruiter.
            </li>
            <li>
              <strong>Sub-verwerkers</strong> van TalentFlow: hosting (Hetzner —
              EU), AI (Anthropic, OpenAI — verwerkersovereenkomst aanwezig), e-mail
              (Postmark/SendGrid), opslag (MinIO — EU).
            </li>
          </ul>
          <p>Geen verkoop van gegevens. Geen profiling voor advertenties.</p>
        </Section>

        <Section title="8. Beveiliging">
          <p>
            We hosten in de EU (Hetzner, Duitsland), gebruiken Row-Level Security
            (multi-tenant isolatie), TLS 1.3 voor alle verbindingen, encryption-
            at-rest, en append-only audit-logs (WORM) voor alle wijzigingen.
          </p>
        </Section>

        <Section title="9. Wijzigingen">
          <p>
            We werken dit beleid bij wanneer onze diensten of de wet veranderen.
            Materiële wijzigingen communiceren we per e-mail.
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
