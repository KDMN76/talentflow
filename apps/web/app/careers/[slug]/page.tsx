"use client";

import { useParams } from "next/navigation";
import { CareerPageView } from "./CareerPageView";

// Directe route: /careers/<slug> op een app-host. De slug komt uit de URL-
// params. De white-label variant (custom domein → browser-URL "/") rendert
// dezelfde CareerPageView via de host-gate in de root-layout, maar dan met de
// slug uit de door de middleware gezette header.
export default function PublicCareerPage() {
  const params = useParams<{ slug: string }>();
  return <CareerPageView slug={params?.slug ?? ""} />;
}
