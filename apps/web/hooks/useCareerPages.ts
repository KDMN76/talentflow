"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, publicApi } from "@/lib/api";

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
  custom_domain_verified_at?: string | null;
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

export interface VerifyCustomDomainResult {
  verified: boolean;
  custom_domain: string;
  verified_at: string | null;
  target_ip: string;
  resolved_ips: string[];
  reason?: string;
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
  /** monthly / annual / hourly — nodig om de band correct te tonen (EU 2023/970). */
  salary_frequency: string | null;
  /** Criteria waarmee de beloning bepaald wordt (EU 2023/970 art. 5). */
  compensation_criteria: string | null;
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

// ─── Hooks: Admin ────────────────────────────────────────────────────────────

export function useCareerPages() {
  return useQuery({
    queryKey: ["career-pages"],
    queryFn: async () => {
      const { data } = await api.get<{ data: CareerPage[] }>("/career-pages");
      return data.data;
    },
  });
}

export function useCareerPage(id: string) {
  return useQuery({
    queryKey: ["career-pages", id],
    queryFn: async () => {
      const { data } = await api.get<CareerPage>(`/career-pages/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCareerPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCareerPageData): Promise<CareerPage> => {
      const { data } = await api.post<CareerPage>("/career-pages", payload);
      return data;
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
      const { data } = await api.patch<CareerPage>(`/career-pages/${id}`, updates);
      return data;
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
      await api.delete(`/career-pages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
    },
  });
}

// ─── Hooks: Custom domain (white-label serving) ──────────────────────────────

/** Koppel/wis een eigen domein. `domain === null` of "" wist de koppeling. */
export function useSetCustomDomain(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (domain: string | null): Promise<CareerPage> => {
      const { data } = await api.put<CareerPage>(
        `/career-pages/${id}/custom-domain`,
        { domain }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages"] });
      queryClient.invalidateQueries({ queryKey: ["career-pages", id] });
    },
  });
}

/** Verifieer dat het gekoppelde domein via DNS naar TalentFlow wijst. */
export function useVerifyCustomDomain(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<VerifyCustomDomainResult> => {
      const { data } = await api.post<VerifyCustomDomainResult>(
        `/career-pages/${id}/custom-domain/verify`
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["career-pages", id] });
    },
  });
}

// ─── Hooks: Public ───────────────────────────────────────────────────────────

export function usePublicCareerPage(slug: string) {
  return useQuery({
    queryKey: ["career-pages", "public", slug],
    queryFn: async (): Promise<PublicCareerPageData> => {
      // publicApi (geen credentials) zodat dit óók vanaf een white-label
      // custom domein werkt (cross-origin, reflected-origin CORS).
      const { data } = await publicApi.get<PublicCareerPageData>(
        `/career-pages/public/${slug}`
      );
      return data;
    },
    enabled: !!slug,
  });
}

// ─── Hooks: Builder (blocks, publish, applications, forms) ───────────────────

export function useUpdateCareerPageBlocks(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blocks: CareerPageBlock[]): Promise<CareerPageBlock[]> => {
      const { data } = await api.patch<{ blocks: CareerPageBlock[] }>(
        `/career-pages/${id}/blocks`,
        { blocks }
      );
      return data.blocks;
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
      const { data } = await api.post<CareerPage>(`/career-pages/${id}/publish`);
      return data;
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
      const { data } = await api.post<CareerPage>(`/career-pages/${id}/unpublish`);
      return data;
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
      const { data } = await api.get<{ data: CareerPageApplication[] }>(
        `/career-pages/${id}/applications`
      );
      return data.data;
    },
    enabled: !!id,
  });
}

export function useApplicationForm(careerPageId: string, jobId: string | null) {
  const key = jobId ?? "global";
  return useQuery({
    queryKey: ["career-pages", careerPageId, "forms", key],
    queryFn: async (): Promise<ApplicationForm> => {
      const path = jobId
        ? `/career-pages/${careerPageId}/forms/${jobId}`
        : `/career-pages/${careerPageId}/forms/global`;
      const { data } = await api.get<ApplicationForm>(path);
      return data;
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
      const path = jobId
        ? `/career-pages/${careerPageId}/forms/${jobId}`
        : `/career-pages/${careerPageId}/forms/global`;
      const { data } = await api.patch<ApplicationForm>(path, { fields });
      return data;
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
      // publicApi: sollicitatie-apply is publiek en moet cross-origin werken
      // vanaf een custom domein (geen sessie-cookie nodig).
      const { data } = await publicApi.post<{ id: string }>(
        `/career-pages/public/${slug}/apply`,
        payload
      );
      return data;
    },
  });
}
