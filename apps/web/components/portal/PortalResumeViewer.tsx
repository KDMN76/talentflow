/**
 * PortalResumeViewer — inline PDF-viewer modal voor CV's.
 *
 * Bewuste keuze: <iframe src=...> in plaats van een externe lib zoals
 * react-pdf. Reden: zero bundle-cost, browser-native PDF-rendering werkt op
 * desktop én mobiel (iOS Safari ondersteunt PDF inline), en we hoeven geen
 * extra dependency te onderhouden.
 *
 * Download-knop wordt alleen getoond als `canDownload=true` (permission).
 */

"use client";

import { Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface PortalResumeViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeUrl: string | null;
  candidateName: string;
  canDownload: boolean;
}

export function PortalResumeViewer({
  open,
  onOpenChange,
  resumeUrl,
  candidateName,
  canDownload,
}: PortalResumeViewerProps) {
  const { t } = useTranslation("portalPublic");
  const { toast } = useToast();

  const handleDownload = () => {
    if (!canDownload) {
      toast({
        title: t("resume.noPermissionTitle"),
        description: t("resume.noPermissionBody"),
        variant: "destructive",
      });
      return;
    }
    if (!resumeUrl) return;
    // Forceer download via een tijdelijke <a> met `download` attribuut.
    const link = document.createElement("a");
    link.href = resumeUrl;
    link.download = `${candidateName.replace(/\s+/g, "_")}_CV.pdf`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[900px] max-w-4xl flex-col gap-3 p-4 sm:p-5">
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle className="text-base sm:text-lg">
            {t("resume.title", { name: candidateName })}
          </DialogTitle>
          <div className="flex items-center gap-2 pr-7">
            {resumeUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(resumeUrl, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                {t("resume.openTab")}
              </Button>
            )}
            {canDownload && resumeUrl && (
              <Button
                size="sm"
                onClick={handleDownload}
                className="border-0 text-white"
                style={{ backgroundColor: "var(--brand-primary)" }}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {t("resume.download")}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          {resumeUrl ? (
            <iframe
              src={`${resumeUrl}#toolbar=0&navpanes=0`}
              title={t("resume.iframeTitle", { name: candidateName })}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {t("resume.noCv")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
