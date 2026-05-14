/**
 * Testimonials block — responsive grid (1/2/3 cols).
 *
 * Carousels need JS — for SSR purity we render a static grid which is
 * superior for SEO anyway. If a richer carousel is requested later, swap
 * for a thin client component.
 */

import type { BlockRendererProps } from "../BlockRenderer";

interface Testimonial {
  quote: string;
  author?: string;
  role?: string;
  avatar_url?: string;
}

interface TestimonialsData {
  heading?: string;
  testimonials?: Testimonial[];
}

export function PublicTestimonialsBlock({ block }: BlockRendererProps) {
  const data = (block.data as TestimonialsData) ?? {};
  const items = data.testimonials ?? [];
  if (items.length === 0) return null;

  return (
    <section
      className="py-16 md:py-20 bg-zinc-50/60"
      data-block="testimonials"
      data-block-id={block.id}
    >
      <div className="max-w-5xl mx-auto px-6">
        {data.heading ? (
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 mb-10 text-center">
            {data.heading}
          </h2>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((t, i) => (
            <figure
              key={i}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <blockquote className="text-zinc-700 leading-relaxed">
                <span
                  className="block text-3xl leading-none mb-2"
                  style={{ color: "var(--brand-primary)" }}
                  aria-hidden
                >
                  “
                </span>
                {t.quote}
              </blockquote>
              {t.author || t.role ? (
                <figcaption className="mt-5 flex items-center gap-3">
                  {t.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : null}
                  <div className="min-w-0">
                    {t.author ? (
                      <p className="font-semibold text-zinc-900 text-sm">
                        {t.author}
                      </p>
                    ) : null}
                    {t.role ? (
                      <p className="text-xs text-zinc-500">{t.role}</p>
                    ) : null}
                  </div>
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
