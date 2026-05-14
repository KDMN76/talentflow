import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rapport · TalentFlow",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function EmbedReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">{children}</div>
  );
}
