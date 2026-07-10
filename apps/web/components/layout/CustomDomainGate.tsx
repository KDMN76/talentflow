"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Lazy: alleen ophalen wanneer we daadwerkelijk een white-label career-page
// renderen (custom domein). Op app-hosts wordt deze chunk nooit geladen, zodat
// de hoofd-app-bundle onaangetast blijft. ssr blijft AAN (default) zodat het
// custom domein server-side een volledige career-page (HTTP 200) levert.
const CareerPageView = dynamic(
  () =>
    import("@/app/careers/[slug]/CareerPageView").then((m) => m.CareerPageView),
  {
    loading: () => (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

/**
 * Host-gate voor white-label career-domeinen.
 *
 * De middleware zet op een custom-domein-request de header `x-tf-career-slug`
 * (en rewrite't naar /careers/<slug>). De root-layout leest die header server-
 * side en geeft de slug hier door. Is de slug gezet, dan renderen we de career-
 * page RECHTSTREEKS — en NIET `children` (de router-outlet).
 *
 * Dat is de kern van de fix: op een custom domein blijft de browser-URL "/",
 * en de Next client-router associeert "/" met de app-root — de `(dashboard)`
 * route-groep met auth-guard-layout. Die layout doet client-side een
 * `router.replace("/login")` én een `/users/me`-fetch via de app-brede
 * (credential-)`api`. Door hier `children` te NEGEREN wordt die `(dashboard)`-
 * tree nooit op de client gemonteerd → geen /users/me (dus geen CORS-fout),
 * geen redirect naar /login of /dashboard. Server én client renderen exact
 * dezelfde `CareerPageView` → geen hydration-mismatch.
 *
 * Zonder slug (app-host, of custom-host waarvan de resolve faalde) is dit een
 * pure pass-through: `children` wordt normaal gerenderd. De hoofd-app blijft
 * daardoor volledig onaangetast.
 */
export function CustomDomainGate({
  careerSlug,
  children,
}: {
  careerSlug: string | null;
  children: React.ReactNode;
}) {
  if (careerSlug) {
    return <CareerPageView slug={careerSlug} />;
  }
  return <>{children}</>;
}
