/**
 * Footer block — links + copyright.
 *
 * Note: a global footer is also rendered by the layout (`CareerPageFooter`).
 * The Footer block is for tenants who want extra footer content as part
 * of their composed page (e.g. social-media row, legal columns).
 */

import Link from "next/link";
import type { BlockRendererProps } from "../BlockRenderer";
import { t } from "../i18n";
import { getBrandName } from "../utils";

interface FooterLink {
  label: string;
  href: string;
}

interface FooterData {
  links?: FooterLink[];
  show_privacy_link?: boolean;
  copyright?: string;
}

export function PublicFooterBlock({
  block,
  branding,
  locale,
  slug,
}: BlockRendererProps) {
  const data = (block.data as FooterData) ?? {};
  const links = data.links ?? [];
  const showPrivacy = data.show_privacy_link !== false;
  const year = new Date().getFullYear();

  return (
    <footer
      className="border-t border-zinc-200 bg-zinc-50/60"
      data-block="footer"
      data-block-id={block.id}
    >
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row gap-6 md:items-center md:justify-between">
        <p className="text-xs text-zinc-500">
          {data.copyright ||
            t(locale, "footer_copyright", {
              year,
              brand: getBrandName(branding),
            })}
        </p>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {links.map((l, i) => (
            <a
              key={i}
              href={l.href}
              className="text-zinc-500 hover:text-zinc-900"
            >
              {l.label}
            </a>
          ))}
          {showPrivacy ? (
            <Link
              href={`/careers/${encodeURIComponent(slug)}/privacy`}
              className="text-zinc-500 hover:text-zinc-900"
            >
              {t(locale, "privacy_policy")}
            </Link>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
