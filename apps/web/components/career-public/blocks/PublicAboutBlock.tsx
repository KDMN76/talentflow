/**
 * About block — text + optional image, two-column on md+.
 */

import type { BlockRendererProps } from "../BlockRenderer";

interface AboutData {
  heading?: string;
  body?: string;
  image_url?: string;
  image_alt?: string;
  image_position?: "left" | "right";
}

export function PublicAboutBlock({ block }: BlockRendererProps) {
  const data = (block.data as AboutData) ?? {};
  const imageRight = (data.image_position ?? "right") === "right";

  return (
    <section
      className="py-16 md:py-24"
      data-block="about"
      data-block-id={block.id}
    >
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div className={imageRight ? "md:order-1" : "md:order-2"}>
          {data.heading ? (
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 mb-5">
              {data.heading}
            </h2>
          ) : null}
          {data.body ? (
            <div className="prose prose-zinc max-w-none text-zinc-600 leading-relaxed whitespace-pre-line">
              {data.body}
            </div>
          ) : null}
        </div>
        {data.image_url ? (
          <div className={imageRight ? "md:order-2" : "md:order-1"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.image_url}
              alt={data.image_alt ?? ""}
              className="rounded-2xl shadow-lg w-full h-auto object-cover"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
