/**
 * Features block — 3-column responsive grid of value-props.
 */

import type { BlockRendererProps } from "../BlockRenderer";

interface Feature {
  icon?: string;
  title: string;
  body?: string;
}

interface FeaturesData {
  heading?: string;
  features?: Feature[];
}

export function PublicFeaturesBlock({ block, locale }: BlockRendererProps) {
  const data = (block.data as FeaturesData) ?? {};
  const features = data.features ?? [];
  if (features.length === 0) return null;

  return (
    <section className="py-16 md:py-20" data-block="features" data-block-id={block.id}>
      <div className="max-w-5xl mx-auto px-6">
        {data.heading ? (
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 mb-12 text-center">
            {data.heading}
          </h2>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f, i) => (
            <div
              key={i}
              className="text-center md:text-left"
              lang={locale}
            >
              {f.icon ? (
                <div
                  className="inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl mb-4"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--brand-primary) 12%, white)",
                    color: "var(--brand-primary)",
                  }}
                  aria-hidden
                >
                  {f.icon}
                </div>
              ) : null}
              <h3 className="text-lg font-semibold text-zinc-900">{f.title}</h3>
              {f.body ? (
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                  {f.body}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
