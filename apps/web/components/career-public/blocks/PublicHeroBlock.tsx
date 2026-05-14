/**
 * Hero block — full-bleed background, headline, optional subheadline + CTA.
 *
 * Server Component. Branded via CSS vars set in the layout's <style>.
 */

import type { BlockRendererProps } from "../BlockRenderer";
import { t } from "../i18n";
import { getBrandName } from "../utils";

interface HeroData {
  headline?: string;
  subheadline?: string;
  background_image_url?: string;
  cta_label?: string;
  cta_href?: string;
  alignment?: "left" | "center";
}

export function PublicHeroBlock({ block, branding, locale }: BlockRendererProps) {
  const data = (block.data as HeroData) ?? {};
  const headline =
    data.headline ||
    (locale === "en"
      ? `Build your career at ${getBrandName(branding)}`
      : `Werk mee bij ${getBrandName(branding)}`);
  const subheadline =
    data.subheadline ||
    (locale === "en"
      ? "Discover roles that fit your ambition and apply in one click."
      : "Ontdek rollen die bij jouw ambitie passen en solliciteer in één klik.");
  const ctaLabel = data.cta_label || t(locale, "view_jobs");
  const ctaHref = data.cta_href || "#vacatures";
  const alignCenter = (data.alignment ?? "left") === "center";

  const bgStyle: React.CSSProperties = data.background_image_url
    ? {
        backgroundImage: `linear-gradient(rgba(15,23,42,0.55), rgba(15,23,42,0.65)), url('${data.background_image_url.replace(
          /'/g,
          ""
        )}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: "#fff",
      }
    : {
        background:
          "linear-gradient(135deg, var(--brand-primary), color-mix(in srgb, var(--brand-primary) 70%, black 30%))",
        color: "#fff",
      };

  return (
    <section
      className="relative overflow-hidden"
      style={bgStyle}
      data-block="hero"
      data-block-id={block.id}
    >
      <div
        className={`relative max-w-5xl mx-auto px-6 py-20 md:py-32 ${
          alignCenter ? "text-center" : ""
        }`}
      >
        {branding.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logo_url}
            alt={`${getBrandName(branding)} logo`}
            className={`mb-8 h-12 w-auto rounded ${
              alignCenter ? "mx-auto" : ""
            }`}
          />
        ) : null}

        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          {headline}
        </h1>

        <p
          className={`mt-6 text-lg md:text-xl leading-relaxed text-white/90 ${
            alignCenter ? "mx-auto max-w-2xl" : "max-w-2xl"
          }`}
        >
          {subheadline}
        </p>

        <div className={`mt-10 ${alignCenter ? "" : ""}`}>
          <a
            href={ctaHref}
            className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-zinc-900 shadow-lg transition-transform hover:scale-105"
          >
            {ctaLabel}
            <svg
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638l-3.32-3.31a.75.75 0 111.062-1.06l4.6 4.6a.75.75 0 010 1.06l-4.6 4.6a.75.75 0 11-1.062-1.06l3.32-3.31H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
