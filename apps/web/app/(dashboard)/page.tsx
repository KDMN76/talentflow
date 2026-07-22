import { redirect } from "next/navigation";

// Zonder force-dynamic prerendert Next deze redirect naar een statische 307
// met vaste Location — de container-hotfix van 2026-06-11 verdween bij elke
// rebuild (zie infra/DEPLOY_KDMN.md). Redirect moet per request evalueren.
export const dynamic = "force-dynamic";

export default function DashboardRoot() {
  redirect("/dashboard");
}
