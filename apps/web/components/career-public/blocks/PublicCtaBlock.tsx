/**
 * CTA block — single banner with headline + button. Branded background.
 */

import type { BlockRendererProps } from "../BlockRenderer";
import { t } from "../i18n";

interface CtaData {
  heading?: string;
  body?: string;
  cta_label?: string;
  cta_href?: string;
}

export function PublicCtaBlock({ block, locale }: BlockRendererProps) {
  const data = (block.data as CtaData) ?? {};
  return (
    <section className="py-16 md:py-20" data-block="cta" data-block-id={block.id}>
      <div className="max-w-5xl mx-auto px-6">
        <div
          className="rounded-3xl px-8 py-12 md:px-16 md:py-16 text-center text-white relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, var(--brand-primary), color-mix(in srgb, var(--brand-primary) 60%, black 40%))",
          }}
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            {data.heading ||
              (locale === "en" ? "Ready to apply?" : "Klaar om te solliciteren?")}
          </h2>
          {data.body ? (
            <p className="mt-4 max-w-xl mx-auto text-white/90 leading-relaxed">
              {data.body}
            </p>
          ) : null}
          <a
            href={data.cta_href || "#vacatures"}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-zinc-900 shadow-lg transition-transform hover:scale-105"
          >
            {data.cta_label || t(locale, "view_jobs")}
          </a>
        </div>
      </div>
    </section>
  );
}
