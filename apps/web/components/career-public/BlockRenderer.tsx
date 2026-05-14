/**
 * Block dispatcher — Server Component.
 *
 * Maps a `Block.type` to its corresponding public renderer. Unknown
 * types render nothing so old SSR can survive new builder additions
 * without crashing the page.
 */

import type { Block, Locale, PublicBranding, PublicJob } from "./types";

import { PublicHeroBlock } from "./blocks/PublicHeroBlock";
import { PublicFeaturesBlock } from "./blocks/PublicFeaturesBlock";
import { PublicJobsListBlock } from "./blocks/PublicJobsListBlock";
import { PublicAboutBlock } from "./blocks/PublicAboutBlock";
import { PublicTestimonialsBlock } from "./blocks/PublicTestimonialsBlock";
import { PublicCtaBlock } from "./blocks/PublicCtaBlock";
import { PublicFooterBlock } from "./blocks/PublicFooterBlock";
import { PublicCustomHtmlBlock } from "./blocks/PublicCustomHtmlBlock";

export interface BlockRendererProps {
  block: Block;
  jobs: PublicJob[];
  branding: PublicBranding;
  locale: Locale;
  slug: string;
  careerPageId: string;
}

export function BlockRenderer(props: BlockRendererProps) {
  const { block } = props;
  switch (block.type) {
    case "hero":
      return <PublicHeroBlock {...props} />;
    case "features":
      return <PublicFeaturesBlock {...props} />;
    case "jobs_list":
      return <PublicJobsListBlock {...props} />;
    case "about":
      return <PublicAboutBlock {...props} />;
    case "testimonials":
      return <PublicTestimonialsBlock {...props} />;
    case "cta":
      return <PublicCtaBlock {...props} />;
    case "footer":
      return <PublicFooterBlock {...props} />;
    case "custom_html":
      return <PublicCustomHtmlBlock {...props} />;
    default:
      return null;
  }
}
