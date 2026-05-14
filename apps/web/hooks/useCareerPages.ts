import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CareerPageTemplate =
  | "modern"
  | "classic"
  | "minimal"
  | "tech"
  | "creative"
  | "agency";

export const TEMPLATE_LABELS: Record<CareerPageTemplate, string> = {
  modern: "Modern",
  classic: "Klassiek",
  minimal: "Minimaal",
  tech: "Tech",
  creative: "Creatief",
  agency: "Agency",
};

export type CareerPageLanguage = "nl" | "en" | "de" | "fr" | "es";

export const LANGUAGE_LABELS: Record<CareerPageLanguage, string> = {
  nl: "Nederlands",
  en: "Engels",
  de: "Duits",
  fr: "Frans",
  es: "Spaans",
};

export const LANGUAGE_FLAGS: Record<CareerPageLanguage, string> = {
  nl: "🇳🇱",
  en: "🇬🇧",
  de: "🇩🇪",
  fr: "🇫🇷",
  es: "🇪🇸",
};

export interface CareerPageConfig {
  logo_url?: string;
  primary_color?: string;
  header_text?: string;
  intro_text?: string;
  font_family?: string;
}

export interface CareerPage {
  id: string;
  slug: string;
  custom_domain: string | null;
  active: boolean;
  config: CareerPageConfig;
  language: CareerPageLanguage;
  template: CareerPageTemplate;
  visit_count: number;
  application_count: number;
  created_at: string;
  blocks?: CareerPageBlock[];
  published_at?: string | null;
}

// ─── Block types (builder) ───────────────────────────────────────────────────

export type CareerPageBlockType =
  | "hero"
  | "features"
  | "jobs_list"
  | "about"
  | "testimonials"
  | "cta"
  | "footer"
  | "custom_html";

export interface HeroBlockConfig {
  headline: string;
  subheadline?: string;
  image_url?: string;
  cta_label?: string;
  cta_link?: string;
}

export interface FeatureItem {
  icon?: string;
  title: string;
  body: string;
}

export interface FeaturesBlockConfig {
  items: FeatureItem[];
}

export interface JobsListBlockConfig {
  layout: "cards" | "list";
  limit?: number;
  filter?: { department?: string; location?: string };
}

export interface AboutBlockConfig {
  title: string;
  body_html: string;
  image_url?: string;
}

export interface TestimonialItem {
  quote: string;
  author: string;
  role?: string;
}

export interface TestimonialsBlockConfig {
  items: TestimonialItem[];
}

export interface CtaBlockConfig {
  text: string;
  button_label: string;
  button_link: string;
}

export interface FooterLink {
  label: string;
  url: string;
}

export interface FooterBlockConfig {
  copyright: string;
  links: FooterLink[];
}

export interface CustomHtmlBlockConfig {
  html: string;
}

export type CareerPageBlockConfig =
  | HeroBlockConfig
  | FeaturesBlockConfig
  | JobsListBlockConfig
  | AboutBlockConfig
  | TestimonialsBlockConfig
  | CtaBlockConfig
  | FooterBlockConfig
  | CustomHtmlBlockConfig;

export interface CareerPageBlock<
  T extends CareerPageBlockConfig = CareerPageBlockConfig
> {
  id: string;
  type: CareerPageBlockType;
  config: T;
}

// ─── Application form types ──────────────────────────────────────────────────

export type ApplicationFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "dropdown"
  | "checkbox"
  | "file"
  | "video_response";

export interface ApplicationField {
  id: string;
  key: string;
  label: string;
  type: ApplicationFieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  help_text?: string;
}

export interface ApplicationForm {
  career_page_id: string;
  /** null = global form, otherwise per-job form */
  job_id: string | null;
  fields: ApplicationField[];
  updated_at?: string;
}

// ─── Career page application (received) ──────────────────────────────────────

export type CareerPageApplicationStatus =
  | "new"
  | "reviewed"
  | "rejected"
  | "shortlisted"
  | "hired";

export interface CareerPageApplication {
  id: string;
  career_page_id: string;
  job_id: string | null;
  job_title: string | null;
  candidate_name: string;
  candidate_email: string;
  candidate_phone?: string | null;
  status: CareerPageApplicationStatus;
  resume_filename?: string | null;
  cover_letter?: string | null;
  field_values?: Record<string, string | string[] | boolean>;
  submitted_at: string;
}

export interface PublicCareerPageJob {
  id: string;
  title: string;
  department: string;
  location: string;
  description: string;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
}

export interface PublicCareerPageData {
  career_page: CareerPage;
  jobs: PublicCareerPageJob[];
  company_name: string;
}

export interface CreateCareerPageData {
  slug: string;
  template: CareerPageTemplate;
  language: CareerPageLanguage;
  primary_color?: string;
  custom_domain?: string | null;
}

export interface SubmitApplicationData {
  job_id: string;
  name: string;
  email: string;
  phone?: string;
  cover_letter?: string;
  resume_filename?: string;
}

// ─── Mock data ───────────────────────────────────────────────────────────────

const KDMN_BLOCKS: CareerPageBlock[] = [
  {
    id: "blk-kdmn-1",
    type: "hero",
    config: {
      headline: "Werk mee aan de toekomst van mobiliteit",
      subheadline:
        "Bij KDMN bouwen we slimme planning en financiële tools voor monteurs.",
      image_url: "",
      cta_label: "Bekijk vacatures",
      cta_link: "#jobs",
    } satisfies HeroBlockConfig,
  },
  {
    id: "blk-kdmn-2",
    type: "features",
    config: {
      items: [
        { icon: "Sparkles", title: "Snelgroeiend", body: "Nieuwe markten, nieuwe kansen." },
        { icon: "Heart", title: "Mensgericht", body: "Korte lijnen, geen politiek." },
        { icon: "Trophy", title: "Eigenaarschap", body: "Jij bouwt mee — niet alleen uitvoeren." },
      ],
    } satisfies FeaturesBlockConfig,
  },
  {
    id: "blk-kdmn-3",
    type: "jobs_list",
    config: { layout: "cards" } satisfies JobsListBlockConfig,
  },
  {
    id: "blk-kdmn-4",
    type: "cta",
    config: {
      text: "Geen passende vacature? Stuur een open sollicitatie.",
      button_label: "Open sollicitatie",
      button_link: "mailto:werken@kdmn.nl",
    } satisfies CtaBlockConfig,
  },
  {
    id: "blk-kdmn-5",
    type: "footer",
    config: {
      copyright: "© KDMN — Alle rechten voorbehouden",
      links: [
        { label: "Over ons", url: "https://kdmn.nl/over" },
        { label: "Privacy", url: "https://kdmn.nl/privacy" },
      ],
    } satisfies FooterBlockConfig,
  },
];

const TECHLABS_BLOCKS: CareerPageBlock[] = [
  {
    id: "blk-tl-1",
    type: "hero",
    config: {
      headline: "Build the next generation of dev tools",
      subheadline: "Small team. Big leverage. Ship product that matters.",
      cta_label: "See open roles",
      cta_link: "#jobs",
    } satisfies HeroBlockConfig,
  },
  {
    id: "blk-tl-2",
    type: "features",
    config: {
      items: [
        { icon: "Code", title: "Modern stack", body: "Go, TypeScript, Postgres, Kubernetes." },
        { icon: "Globe", title: "Remote-first", body: "Work from anywhere in the EU." },
        { icon: "Zap", title: "Async by default", body: "Deep work, fewer meetings." },
        { icon: "Star", title: "Real ownership", body: "Your code, your decisions." },
      ],
    } satisfies FeaturesBlockConfig,
  },
  {
    id: "blk-tl-3",
    type: "jobs_list",
    config: { layout: "list" } satisfies JobsListBlockConfig,
  },
  {
    id: "blk-tl-4",
    type: "cta",
    config: {
      text: "Want to chat first?",
      button_label: "Email the founder",
      button_link: "mailto:hi@techlabs.io",
    } satisfies CtaBlockConfig,
  },
  {
    id: "blk-tl-5",
    type: "footer",
    config: {
      copyright: "© TechLabs",
      links: [{ label: "Blog", url: "https://techlabs.io/blog" }],
    } satisfies FooterBlockConfig,
  },
];

const MOCK_CAREER_PAGES: CareerPage[] = [
  {
    id: "cp-1",
    slug: "kdmn",
    custom_domain: "werken.kdmn.nl",
    active: true,
    config: {
      primary_color: "#6366f1",
      header_text: "Werk mee aan de toekomst van mobiliteit",
      intro_text:
        "Bij KDMN bouwen we aan slimme planning en financiële tools die monteurs en planners écht verder helpen. Wij zoeken collega's die verschil willen maken.",
      font_family: "Inter",
      logo_url: "",
    },
    language: "nl",
    template: "modern",
    visit_count: 1842,
    application_count: 47,
    created_at: "2025-09-12T10:00:00Z",
    blocks: KDMN_BLOCKS,
    published_at: "2025-09-15T10:00:00Z",
  },
  {
    id: "cp-2",
    slug: "techlabs",
    custom_domain: null,
    active: true,
    config: {
      primary_color: "#0ea5e9",
      header_text: "Build the next generation of dev tools",
      intro_text:
        "We are TechLabs — a small team building infrastructure that other developers love. Join us in shipping product that matters.",
      font_family: "Inter",
      logo_url: "",
    },
    language: "en",
    template: "tech",
    visit_count: 612,
    application_count: 14,
    created_at: "2025-11-04T14:00:00Z",
    blocks: TECHLABS_BLOCKS,
    published_at: "2025-11-04T14:00:00Z",
  },
];

// ─── Mock applications + forms ───────────────────────────────────────────────

const DEFAULT_FIELDS: ApplicationField[] = [
  { id: "fld-name", key: "name", label: "Volledige naam", type: "text", required: true },
  { id: "fld-email", key: "email", label: "E-mailadres", type: "email", required: true },
  { id: "fld-phone", key: "phone", label: "Telefoonnummer", type: "phone", required: false },
  {
    id: "fld-cv",
    key: "resume",
    label: "CV (PDF, max 5 MB)",
    type: "file",
    required: true,
  },
  {
    id: "fld-motivation",
    key: "cover_letter",
    label: "Motivatie",
    type: "textarea",
    required: false,
    placeholder: "Vertel kort waarom je bij ons wilt werken",
  },
];

const mockApplicationForms: ApplicationForm[] = [
  { career_page_id: "cp-1", job_id: null, fields: DEFAULT_FIELDS },
  { career_page_id: "cp-2", job_id: null, fields: DEFAULT_FIELDS },
];

const mockCareerPageApplications: CareerPageApplication[] = [
  {
    id: "cpa-1",
    career_page_id: "cp-1",
    job_id: "job-pub-1",
    job_title: "Senior Full-Stack Developer",
    candidate_name: "Lisa van der Berg",
    candidate_email: "lisa.vdberg@example.com",
    candidate_phone: "+31 6 1234 5678",
    status: "shortlisted",
    resume_filename: "lisa-vdberg-cv.pdf",
    cover_letter:
      "Ik werk al 6 jaar als full-stack developer en zoek een omgeving met directe impact.",
    submitted_at: "2026-05-04T11:24:00Z",
  },
  {
    id: "cpa-2",
    career_page_id: "cp-1",
    job_id: "job-pub-1",
    job_title: "Senior Full-Stack Developer",
    candidate_name: "Mark Jansen",
    candidate_email: "mark.jansen@example.com",
    candidate_phone: "+31 6 8765 4321",
    status: "new",
    resume_filename: "mark-jansen.pdf",
    submitted_at: "2026-05-05T08:12:00Z",
  },
  {
    id: "cpa-3",
    career_page_id: "cp-1",
    job_id: "job-pub-2",
    job_title: "Recruitment Consultant",
    candidate_name: "Sofia El-Amrani",
    candidate_email: "sofia.el@example.com",
    status: "reviewed",
    resume_filename: "sofia-el.pdf",
    submitted_at: "2026-05-03T16:48:00Z",
  },
  {
    id: "cpa-4",
    career_page_id: "cp-1",
    job_id: "job-pub-3",
    job_title: "Product Designer",
    candidate_name: "Thomas de Vries",
    candidate_email: "tdv@example.com",
    candidate_phone: "+31 6 5544 3322",
    status: "rejected",
    resume_filename: "thomas-de-vries.pdf",
    submitted_at: "2026-05-01T09:30:00Z",
  },
  {
    id: "cpa-5",
    career_page_id: "cp-1",
    job_id: "job-pub-1",
    job_title: "Senior Full-Stack Developer",
    candidate_name: "Aïsha Bakker",
    candidate_email: "aisha.b@example.com",
    candidate_phone: "+31 6 1122 3344",
    status: "new",
    resume_filename: "aisha-bakker.pdf",
    submitted_at: "2026-05-06T13:05:00Z",
  },
  {
    id: "cpa-6",
    career_page_id: "cp-1",
    job_id: null,
    job_title: null,
    candidate_name: "Pieter Hofstra",
    candidate_email: "pieter@hofstra.dev",
    status: "new",
    cover_letter:
      "Open sollicitatie — ik ben benieuwd of er ruimte is voor een DevOps engineer.",
    submitted_at: "2026-05-06T09:18:00Z",
  },
  {
    id: "cpa-7",
    career_page_id: "cp-1",
    job_id: "job-pub-2",
    job_title: "Recruitment Consultant",
    candidate_name: "Yara Pieters",
    candidate_email: "yara@example.com",
    candidate_phone: "+31 6 9988 7766",
    status: "shortlisted",
    resume_filename: "yara-pieters.pdf",
    submitted_at: "2026-04-28T14:55:00Z",
  },
  {
    id: "cpa-8",
    career_page_id: "cp-1",
    job_id: "job-pub-3",
    job_title: "Product Designer",
    candidate_name: "Daan Mulder",
    candidate_email: "daan@example.com",
    status: "hired",
    resume_filename: "daan-mulder.pdf",
    submitted_at: "2026-04-15T10:00:00Z",
  },
  {
    id: "cpa-9",
    career_page_id: "cp-2",
    job_id: "job-pub-4",
    job_title: "Platform Engineer",
    candidate_name: "Erik Lindqvist",
    candidate_email: "erik@example.com",
    status: "reviewed",
    resume_filename: "erik-lindqvist.pdf",
    submitted_at: "2026-05-02T17:22:00Z",
  },
  {
    id: "cpa-10",
    career_page_id: "cp-2",
    job_id: "job-pub-4",
    job_title: "Platform Engineer",
    candidate_name: "Maja Kowalska",
    candidate_email: "maja@example.com",
    candidate_phone: "+48 555 111 222",
    status: "new",
    resume_filename: "maja-kowalska.pdf",
    submitted_at: "2026-05-06T11:40:00Z",
  },
];

export const MOCK_DEFAULT_APPLICATION_FIELDS = DEFAULT_FIELDS;

const MOCK_PUBLIC_DATA: Record<string, PublicCareerPageData> = {
  kdmn: {
    career_page: MOCK_CAREER_PAGES[0],
    company_name: "KDMN",
    jobs: [
      {
        id: "job-pub-1",
        title: "Senior Full-Stack Developer",
        department: "Engineering",
        location: "Den Haag",
        description:
          "Bouw mee aan ons recruitmentplatform. Je werkt met Node.js, PostgreSQL en Next.js. We zoeken iemand die productief is, ownership neemt en kwaliteit niet als compromis ziet.",
        employment_type: "fulltime",
        salary_min: 65000,
        salary_max: 90000,
      },
      {
        id: "job-pub-2",
        title: "Recruitment Consultant",
        department: "Sales",
        location: "Den Haag / Hybride",
        description:
          "Help klanten het juiste talent vinden. Je werkt met een moderne ATS, hebt directe lijntjes naar finance en planning, en draait commercieel mee.",
        employment_type: "fulltime",
        salary_min: 45000,
        salary_max: 60000,
      },
      {
        id: "job-pub-3",
        title: "Product Designer",
        department: "Product",
        location: "Remote (EU)",
        description:
          "Ontwerp interfaces die recruiters dagelijks plezier geven om te gebruiken. Geen vrijblijvende mockups — je ontwerpen worden geshipped.",
        employment_type: "fulltime",
        salary_min: 55000,
        salary_max: 75000,
      },
    ],
  },
  techlabs: {
    career_page: MOCK_CAREER_PAGES[1],
    company_name: "TechLabs",
    jobs: [
      {
        id: "job-pub-4",
        title: "Platform Engineer",
        department: "Infrastructure",
        location: "Remote",
        description:
          "Own our deploy pipelines, observability stack and developer experience. Kubernetes, Terraform, lots of Go.",
        employment_type: "fulltime",
        salary_min: 70000,
        salary_max: 95000,
      },
    ],
  },
};

let mockCareerPages = [...MOCK_CAREER_PAGES];

// ─── Hooks: Admin ────────────────────────────────────────────────────────────

export function useCareerPages() {
  return useQuery({
    queryKey: ["career-pages"],
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: CareerPage[] }>("/career-pages");
        return data.data;
      } catch {
        return [...mockCareerPages];
      }
    },
  });
}

export function useCareerPage(id: string) {
  return useQuery({
    queryKey: ["career-pages", id],
    queryFn: async () => {
      try {
        const { data } = await api.get<CareerPage>(`/career-pages/${id}`);
        return data;
      } catch {
        const page = mockCareerPages.find((p) => p.id === id);
        if (!page) throw new Error("Career page niet gevonden");
        return page;
      }
    },
    enabled: !!id,
  });
}

export function useCreateCareerPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCareerPageData): Promise<CareerPage> => {
      try {
        const { data } = await api.post<CareerPage>("/career-pages", payload);
        return data;
      } catch {
        const newPage: CareerPage = {
          id: `cp-${Date.now()}`,
          slug: payload.slug,
          custom_domain: payload.custom_domain ?? null,
          active: true,
          config: {
            primary_color: payload.primary_color ?? "#6366f1",
            header_text: "Werk bij ons",
            intro_text: "Maak het verschil binnen ons team.",
            font_family: "Inter",
          },
          language: payload.language,
          template: payload.template,
          visit_count: 0,
          application_count: 0,
          created_at: new Date().toISOString(),
        };
        mockCareerPages.unshift(newPage);
        return newPage;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
    },
  });
}

export function useUpdateCareerPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<CareerPage> & { id: string }): Promise<CareerPage> => {
      try {
        const { data } = await api.patch<CareerPage>(`/career-pages/${id}`, updates);
        return data;
      } catch {
        const idx = mockCareerPages.findIndex((p) => p.id === id);
        if (idx !== -1) {
          mockCareerPages[idx] = {
            ...mockCareerPages[idx],
            ...updates,
            config: { ...mockCareerPages[idx].config, ...(updates.config ?? {}) },
          };
          // Keep mock public data in sync for slug-based lookup
          const slug = mockCareerPages[idx].slug;
          if (MOCK_PUBLIC_DATA[slug]) {
            MOCK_PUBLIC_DATA[slug].career_page = mockCareerPages[idx];
          }
          return mockCareerPages[idx];
        }
        throw new Error("Career page niet gevonden");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
      queryClient.invalidateQueries({ queryKey: ["career-pages", variables.id] });
    },
  });
}

export function useDeleteCareerPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await api.delete(`/career-pages/${id}`);
      } catch {
        mockCareerPages = mockCareerPages.filter((p) => p.id !== id);
        queryClient.setQueryData<CareerPage[]>(["career-pages"], (old) =>
          old ? old.filter((p) => p.id !== id) : []
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
    },
  });
}

// ─── Hooks: Public ───────────────────────────────────────────────────────────

export function usePublicCareerPage(slug: string) {
  return useQuery({
    queryKey: ["career-pages", "public", slug],
    queryFn: async (): Promise<PublicCareerPageData> => {
      try {
        const { data } = await api.get<PublicCareerPageData>(
          `/career-pages/public/${slug}`
        );
        return data;
      } catch {
        const data = MOCK_PUBLIC_DATA[slug];
        if (!data) {
          // Fallback: try to find page by slug in mockCareerPages
          const page = mockCareerPages.find((p) => p.slug === slug);
          if (!page) throw new Error("Career page niet gevonden");
          return {
            career_page: page,
            company_name: page.slug.toUpperCase(),
            jobs: [],
          };
        }
        return data;
      }
    },
    enabled: !!slug,
  });
}

// ─── Hooks: Builder (blocks, publish, applications, forms) ───────────────────

export function useUpdateCareerPageBlocks(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blocks: CareerPageBlock[]): Promise<CareerPageBlock[]> => {
      try {
        const { data } = await api.patch<{ blocks: CareerPageBlock[] }>(
          `/career-pages/${id}/blocks`,
          { blocks }
        );
        return data.blocks;
      } catch {
        const idx = mockCareerPages.findIndex((p) => p.id === id);
        if (idx !== -1) {
          mockCareerPages[idx] = { ...mockCareerPages[idx], blocks };
        }
        return blocks;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages", id] });
    },
  });
}

export function usePublishCareerPage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CareerPage> => {
      try {
        const { data } = await api.post<CareerPage>(`/career-pages/${id}/publish`);
        return data;
      } catch {
        const idx = mockCareerPages.findIndex((p) => p.id === id);
        if (idx !== -1) {
          mockCareerPages[idx] = {
            ...mockCareerPages[idx],
            active: true,
            published_at: new Date().toISOString(),
          };
          return mockCareerPages[idx];
        }
        throw new Error("Career page niet gevonden");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
      queryClient.invalidateQueries({ queryKey: ["career-pages", id] });
    },
  });
}

export function useUnpublishCareerPage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CareerPage> => {
      try {
        const { data } = await api.post<CareerPage>(`/career-pages/${id}/unpublish`);
        return data;
      } catch {
        const idx = mockCareerPages.findIndex((p) => p.id === id);
        if (idx !== -1) {
          mockCareerPages[idx] = {
            ...mockCareerPages[idx],
            active: false,
            published_at: null,
          };
          return mockCareerPages[idx];
        }
        throw new Error("Career page niet gevonden");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
      queryClient.invalidateQueries({ queryKey: ["career-pages", id] });
    },
  });
}

export function useCareerPageApplications(id: string) {
  return useQuery({
    queryKey: ["career-pages", id, "applications"],
    queryFn: async (): Promise<CareerPageApplication[]> => {
      try {
        const { data } = await api.get<{ data: CareerPageApplication[] }>(
          `/career-pages/${id}/applications`
        );
        return data.data;
      } catch {
        return mockCareerPageApplications.filter((a) => a.career_page_id === id);
      }
    },
    enabled: !!id,
  });
}

export function useApplicationForm(careerPageId: string, jobId: string | null) {
  const key = jobId ?? "global";
  return useQuery({
    queryKey: ["career-pages", careerPageId, "forms", key],
    queryFn: async (): Promise<ApplicationForm> => {
      try {
        const path = jobId
          ? `/career-pages/${careerPageId}/forms/${jobId}`
          : `/career-pages/${careerPageId}/forms/global`;
        const { data } = await api.get<ApplicationForm>(path);
        return data;
      } catch {
        const found = mockApplicationForms.find(
          (f) => f.career_page_id === careerPageId && f.job_id === jobId
        );
        if (found) return found;
        // Fall back to global form, or default fields
        const globalForm = mockApplicationForms.find(
          (f) => f.career_page_id === careerPageId && f.job_id === null
        );
        return (
          globalForm ?? {
            career_page_id: careerPageId,
            job_id: jobId,
            fields: DEFAULT_FIELDS,
          }
        );
      }
    },
    enabled: !!careerPageId,
  });
}

export function useUpdateApplicationForm(
  careerPageId: string,
  jobId: string | null
) {
  const queryClient = useQueryClient();
  const key = jobId ?? "global";
  return useMutation({
    mutationFn: async (fields: ApplicationField[]): Promise<ApplicationForm> => {
      try {
        const path = jobId
          ? `/career-pages/${careerPageId}/forms/${jobId}`
          : `/career-pages/${careerPageId}/forms/global`;
        const { data } = await api.patch<ApplicationForm>(path, { fields });
        return data;
      } catch {
        const idx = mockApplicationForms.findIndex(
          (f) => f.career_page_id === careerPageId && f.job_id === jobId
        );
        const updated: ApplicationForm = {
          career_page_id: careerPageId,
          job_id: jobId,
          fields,
          updated_at: new Date().toISOString(),
        };
        if (idx !== -1) {
          mockApplicationForms[idx] = updated;
        } else {
          mockApplicationForms.push(updated);
        }
        return updated;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["career-pages", careerPageId, "forms", key],
      });
    },
  });
}

export function useSubmitApplication(slug: string) {
  return useMutation({
    mutationFn: async (payload: SubmitApplicationData): Promise<{ id: string }> => {
      try {
        const { data } = await api.post<{ id: string }>(
          `/career-pages/public/${slug}/apply`,
          payload
        );
        return data;
      } catch {
        // Mock: pretend success and bump counters
        const page = mockCareerPages.find((p) => p.slug === slug);
        if (page) page.application_count += 1;
        if (MOCK_PUBLIC_DATA[slug]) {
          MOCK_PUBLIC_DATA[slug].career_page.application_count += 1;
        }
        return { id: `app-${Date.now()}` };
      }
    },
  });
}
