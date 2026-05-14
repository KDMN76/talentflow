import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import PWARegister from "@/components/pwa/PWARegister";

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
  return (
    <html lang="nl" suppressHydrationWarning className={inter.variable}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
        <PWARegister />
      </body>
    </html>
  );
}
