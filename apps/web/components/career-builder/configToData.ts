/**
 * Builder-config → public-renderer-data adapter.
 *
 * Builder blocks store their settings under `config` with builder-friendly
 * field names (e.g. `cta_link`, `items`, `body_html`). The public renderers
 * however consume `data` with renderer-friendly field names (e.g.
 * `cta_href`, `features`, `body`). This module bridges the two so the
 * canvas-preview can reuse the public renderers verbatim.
 *
 * Keep this in sync with `apps/web/components/career-public/blocks/*`.
 */

import type {
  CareerPageBlock,
  HeroBlockConfig,
  FeaturesBlockConfig,
  JobsListBlockConfig,
  AboutBlockConfig,
  TestimonialsBlockConfig,
  CtaBlockConfig,
  FooterBlockConfig,
  CustomHtmlBlockConfig,
} from "@/hooks/useCareerPages";
import type { Block } from "@/components/career-public/types";

export function builderBlockToPublicBlock(b: CareerPageBlock): Block {
  switch (b.type) {
    case "hero": {
      const c = b.config as HeroBlockConfig;
      return {
        id: b.id,
        type: "hero",
        data: {
          headline: c.headline,
          subheadline: c.subheadline,
          background_image_url: c.image_url,
          cta_label: c.cta_label,
          cta_href: c.cta_link,
          alignment: "left",
        },
      };
    }
    case "features": {
      const c = b.config as FeaturesBlockConfig;
      return {
        id: b.id,
        type: "features",
        data: {
          features: (c.items ?? []).map((it) => ({
            icon: it.icon,
            title: it.title,
            body: it.body,
          })),
        },
      };
    }
    case "jobs_list": {
      const c = b.config as JobsListBlockConfig;
      return {
        id: b.id,
        type: "jobs_list",
        data: {
          // Public renderer supports "cards" | "table"; builder allows
          // "cards" | "list" — fall back to "cards" for "list" so preview
          // still renders sensibly.
          layout: c.layout === "list" ? "cards" : c.layout ?? "cards",
          limit: c.limit ?? undefined,
          filter_department: c.filter?.department,
        },
      };
    }
    case "about": {
      const c = b.config as AboutBlockConfig;
      return {
        id: b.id,
        type: "about",
        data: {
          heading: c.title,
          // Strip rudimentary HTML for the preview body — public block uses
          // whitespace-pre-line, not dangerouslySetInnerHTML.
          body: stripBasicHtml(c.body_html ?? ""),
          image_url: c.image_url,
        },
      };
    }
    case "testimonials": {
      const c = b.config as TestimonialsBlockConfig;
      return {
        id: b.id,
        type: "testimonials",
        data: {
          testimonials: (c.items ?? []).map((it) => ({
            quote: it.quote,
            author: it.author,
            role: it.role,
          })),
        },
      };
    }
    case "cta": {
      const c = b.config as CtaBlockConfig;
      return {
        id: b.id,
        type: "cta",
        data: {
          heading: c.text,
          cta_label: c.button_label,
          cta_href: c.button_link,
        },
      };
    }
    case "footer": {
      const c = b.config as FooterBlockConfig;
      return {
        id: b.id,
        type: "footer",
        data: {
          copyright: c.copyright,
          links: (c.links ?? []).map((l) => ({ label: l.label, href: l.url })),
          show_privacy_link: false,
        },
      };
    }
    case "custom_html": {
      const c = b.config as CustomHtmlBlockConfig;
      return {
        id: b.id,
        type: "custom_html",
        data: { html: c.html, contained: true },
      };
    }
    default:
      // Exhaustive in practice; cast through unknown to satisfy TS without
      // tying the builder type to the union order.
      return {
        id: b.id,
        type: b.type,
        data: b.config as unknown as Record<string, unknown>,
      };
  }
}

function stripBasicHtml(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
