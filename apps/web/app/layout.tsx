import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import PWARegister from "@/components/pwa/PWARegister";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { CustomDomainGate } from "@/components/layout/CustomDomainGate";
import { CAREER_SLUG_HEADER } from "@/lib/customDomain";
import { LOCALE_COOKIE, resolveInitialLocale } from "@/lib/i18n/cookie";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TalentFlow",
    template: "%s | TalentFlow",
  },
  description: "Modern recruitment platform for growing teams",
  manifest: "/manifest.json",
  applicationName: "TalentFlow",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TalentFlow",
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Actieve taal: cookie (eerdere keuze) → Accept-Language → NL. Server +
  // client lezen dezelfde waarde → `<html lang>` klopt en er is geen
  // hydration-mismatch. De user→tenant-voorkeur wordt client-side toegepast
  // zodra /users/me geladen is (useLanguageSync in de dashboard-layout).
  const requestHeaders = headers();
  const locale = resolveInitialLocale(
    cookies().get(LOCALE_COOKIE)?.value,
    requestHeaders.get("accept-language")
  );

  // White-label: de middleware zet deze header alleen op een custom-domein-
  // request (en heeft hem op app-hosts juist verwijderd → geen spoofing). Is
  // hij gezet, dan rendert de host-gate de career-page rechtstreeks i.p.v. de
  // app-tree, zodat de `(dashboard)`-auth-guard nooit op de client mount.
  const careerSlug = requestHeaders.get(CAREER_SLUG_HEADER) || null;

  return (
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="font-sans antialiased">
        <I18nProvider initialLocale={locale}>
          <Providers>
            <CustomDomainGate careerSlug={careerSlug}>
              {children}
            </CustomDomainGate>
          </Providers>
        </I18nProvider>
        <PWARegister />
      </body>
    </html>
  );
}
