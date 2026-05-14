/**
 * Custom-HTML block — renders sanitised tenant-controlled HTML.
 *
 * Sanitisation runs both on save (builder) and here (defence in depth).
 * We strip <script>, <iframe>, <style>, on*-handlers and javascript:
 * URLs. See `utils.sanitizeHtml` for the full list.
 */

import type { BlockRendererProps } from "../BlockRenderer";
import { sanitizeHtml } from "../utils";

interface CustomHtmlData {
  html?: string;
  /** Optional max-width container; defaults to true. */
  contained?: boolean;
}

export function PublicCustomHtmlBlock({ block }: BlockRendererProps) {
  const data = (block.data as CustomHtmlData) ?? {};
  if (!data.html) return null;
  const safe = sanitizeHtml(data.html);
  const contained = data.contained !== false;

  return (
    <section
      className="py-12"
      data-block="custom_html"
      data-block-id={block.id}
    >
      <div
        className={contained ? "max-w-5xl mx-auto px-6" : ""}
        // The sanitised HTML is what we trust to render here. Without
        // dangerouslySetInnerHTML we'd lose the entire purpose of this
        // block. The sanitiser strips active code; tenant-supplied HTML
        // is also reviewed in the builder.
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </section>
  );
}
