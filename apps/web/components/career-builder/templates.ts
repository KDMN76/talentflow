import type {
  CareerPageBlock,
  CareerPageBlockType,
  CareerPageBlockConfig,
  HeroBlockConfig,
  FeaturesBlockConfig,
  JobsListBlockConfig,
  AboutBlockConfig,
  TestimonialsBlockConfig,
  CtaBlockConfig,
  FooterBlockConfig,
  CustomHtmlBlockConfig,
} from "@/hooks/useCareerPages";

// ─── Block-type metadata ─────────────────────────────────────────────────────

export interface BlockTypeMeta {
  type: CareerPageBlockType;
  label: string;
  description: string;
  icon: string;
}

export const BLOCK_TYPES: BlockTypeMeta[] = [
  {
    type: "hero",
    label: "Hero",
    description: "Grote koptekst met call-to-action",
    icon: "Sparkles",
  },
  {
    type: "features",
    label: "Features",
    description: "Lijst met USP's of voordelen",
    icon: "LayoutGrid",
  },
  {
    type: "jobs_list",
    label: "Vacatures",
    description: "Lijst van openstaande vacatures",
    icon: "Briefcase",
  },
  {
    type: "about",
    label: "Over ons",
    description: "Tekst- en afbeeldingsblok",
    icon: "FileText",
  },
  {
    type: "testimonials",
    label: "Testimonials",
    description: "Quotes van medewerkers",
    icon: "Quote",
  },
  {
    type: "cta",
    label: "Call to Action",
    description: "Tekst met knop",
    icon: "MousePointerClick",
  },
  {
    type: "footer",
    label: "Footer",
    description: "Copyright en links",
    icon: "AlignEndHorizontal",
  },
  {
    type: "custom_html",
    label: "Custom HTML",
    description: "Eigen HTML-snippet",
    icon: "Code",
  },
];

export const BLOCK_TYPE_LABELS: Record<CareerPageBlockType, string> =
  Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b.label])) as Record<
    CareerPageBlockType,
    string
  >;

// ─── Default config per block-type ───────────────────────────────────────────

export function defaultConfigForType(
  type: CareerPageBlockType
): CareerPageBlockConfig {
  switch (type) {
    case "hero":
      return {
        headline: "Werk bij ons",
        subheadline: "Maak het verschil binnen ons team.",
        image_url: "",
        cta_label: "Bekijk vacatures",
        cta_link: "#jobs",
      } satisfies HeroBlockConfig;
    case "features":
      return {
        items: [
          { icon: "Sparkles", title: "Eerste voordeel", body: "Korte beschrijving." },
          { icon: "Heart", title: "Tweede voordeel", body: "Korte beschrijving." },
          { icon: "Trophy", title: "Derde voordeel", body: "Korte beschrijving." },
        ],
      } satisfies FeaturesBlockConfig;
    case "jobs_list":
      return { layout: "cards" } satisfies JobsListBlockConfig;
    case "about":
      return {
        title: "Over ons",
        body_html:
          "<p>We zijn een team van bevlogen mensen dat elke dag werkt aan iets moois.</p>",
        image_url: "",
      } satisfies AboutBlockConfig;
    case "testimonials":
      return {
        items: [
          {
            quote: "De beste plek waar ik ooit heb gewerkt.",
            author: "Anna Jansen",
            role: "Senior Engineer",
          },
        ],
      } satisfies TestimonialsBlockConfig;
    case "cta":
      return {
        text: "Klaar om mee te doen?",
        button_label: "Solliciteer nu",
        button_link: "#jobs",
      } satisfies CtaBlockConfig;
    case "footer":
      return {
        copyright: "© Bedrijfsnaam — Alle rechten voorbehouden",
        links: [
          { label: "Privacy", url: "#" },
          { label: "Voorwaarden", url: "#" },
        ],
      } satisfies FooterBlockConfig;
    case "custom_html":
      return {
        html: "<div style=\"text-align:center;padding:24px\">Eigen HTML…</div>",
      } satisfies CustomHtmlBlockConfig;
  }
}

// ─── ID generator ────────────────────────────────────────────────────────────

let _seq = 0;
export function newBlockId(type: CareerPageBlockType): string {
  _seq += 1;
  return `blk-${type}-${Date.now().toString(36)}-${_seq}`;
}

export function makeBlock(type: CareerPageBlockType): CareerPageBlock {
  return { id: newBlockId(type), type, config: defaultConfigForType(type) };
}

// ─── Templates ───────────────────────────────────────────────────────────────

export type BuilderTemplate = "modern" | "classic" | "agency" | "tech";

export interface TemplatePreset {
  id: BuilderTemplate;
  label: string;
  description: string;
  build: () => CareerPageBlock[];
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "modern",
    label: "Modern",
    description: "Hero, features, vacatures, CTA en footer",
    build: () => [
      makeBlockWith("hero", {
        headline: "Werk bij een team met ambitie",
        subheadline:
          "We bouwen producten die mensen écht gebruiken — en we zoeken collega's die dat met ons willen doen.",
        image_url: "",
        cta_label: "Bekijk onze vacatures",
        cta_link: "#jobs",
      }),
      makeBlockWith("features", {
        items: [
          { icon: "Sparkles", title: "Snel groeiend", body: "Volop ruimte om te leren en te leiden." },
          { icon: "Heart", title: "Mensen eerst", body: "Geen ego's, geen politiek." },
          { icon: "Trophy", title: "Echte impact", body: "Jouw werk komt in handen van duizenden gebruikers." },
        ],
      }),
      makeBlockWith("jobs_list", { layout: "cards" }),
      makeBlockWith("cta", {
        text: "Geen passende rol? We horen het graag.",
        button_label: "Open sollicitatie",
        button_link: "mailto:hr@bedrijf.nl",
      }),
      makeBlockWith("footer", {
        copyright: "© Bedrijf — Alle rechten voorbehouden",
        links: [
          { label: "Over ons", url: "#" },
          { label: "Privacy", url: "#" },
        ],
      }),
    ],
  },
  {
    id: "classic",
    label: "Klassiek",
    description: "Hero, over ons, vacatures en footer",
    build: () => [
      makeBlockWith("hero", {
        headline: "Bouw mee aan ons verhaal",
        subheadline: "Sinds onze oprichting werken we aan kwaliteit, ambacht en vertrouwen.",
        cta_label: "Onze vacatures",
        cta_link: "#jobs",
      }),
      makeBlockWith("about", {
        title: "Over ons",
        body_html:
          "<p>We bestaan al meer dan 25 jaar, maar voelen ons nog steeds als startup. Ons geheim: een team dat blijft, klanten die terugkomen, en producten waar we trots op zijn.</p>",
        image_url: "",
      }),
      makeBlockWith("jobs_list", { layout: "list" }),
      makeBlockWith("footer", {
        copyright: "© Bedrijf — Sinds 1999",
        links: [
          { label: "Contact", url: "#" },
          { label: "Privacy", url: "#" },
        ],
      }),
    ],
  },
  {
    id: "agency",
    label: "Agency",
    description: "Hero, vacatures, testimonials, CTA en footer",
    build: () => [
      makeBlockWith("hero", {
        headline: "Werk met de beste opdrachtgevers van Nederland",
        subheadline:
          "Wij verbinden talent met de meest interessante bedrijven. Word onderdeel van ons recruiterteam.",
        cta_label: "Open vacatures",
        cta_link: "#jobs",
      }),
      makeBlockWith("jobs_list", { layout: "cards" }),
      makeBlockWith("testimonials", {
        items: [
          {
            quote:
              "In 8 maanden van junior naar lead. Hier krijg je écht ruimte om te groeien.",
            author: "Mark de Boer",
            role: "Senior Recruiter",
          },
          {
            quote: "Beste werkplek van mijn carrière. Period.",
            author: "Sara El Hamdi",
            role: "Account Manager",
          },
        ],
      }),
      makeBlockWith("cta", {
        text: "Klaar voor de volgende stap?",
        button_label: "Solliciteer direct",
        button_link: "#jobs",
      }),
      makeBlockWith("footer", {
        copyright: "© Recruitment Agency",
        links: [{ label: "Privacy", url: "#" }],
      }),
    ],
  },
  {
    id: "tech",
    label: "Tech",
    description: "Hero, 4 features, vacatures, CTA en footer",
    build: () => [
      makeBlockWith("hero", {
        headline: "Build the future with us",
        subheadline: "We're a small, focused engineering team shipping product that matters.",
        cta_label: "See open roles",
        cta_link: "#jobs",
      }),
      makeBlockWith("features", {
        items: [
          { icon: "Code", title: "Modern stack", body: "TypeScript, Go, Postgres, K8s." },
          { icon: "Globe", title: "Remote-first", body: "Work from anywhere in the EU." },
          { icon: "Zap", title: "Async by default", body: "Deep work over meetings." },
          { icon: "Star", title: "Real ownership", body: "Your code, your call." },
        ],
      }),
      makeBlockWith("jobs_list", { layout: "list" }),
      makeBlockWith("cta", {
        text: "Want to chat first?",
        button_label: "Email the founder",
        button_link: "mailto:hi@example.com",
      }),
      makeBlockWith("footer", {
        copyright: "© Tech Co",
        links: [{ label: "Blog", url: "#" }],
      }),
    ],
  },
];

function makeBlockWith<T extends CareerPageBlockConfig>(
  type: CareerPageBlockType,
  config: T
): CareerPageBlock {
  return { id: newBlockId(type), type, config };
}
