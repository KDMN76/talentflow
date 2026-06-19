import { redirect } from "next/navigation";

// Forceer dynamische rendering. Zonder dit probeert Next deze redirect-only
// server component statisch te prerenderen; in de standalone build van Next
// 14.2.3 crasht dat render-pad met "Cannot read properties of undefined
// (reading 'clientModules')" — de client-reference-manifest van `/page` wordt
// daar niet ingeladen, waardoor `/` een HTTP 500 gaf (incident 2026-06-11, en
// opnieuw nadat de container-hotfix bij een rebuild verdween). Dynamisch
// renderen omzeilt het kapotte prerender-pad. Deze regel maakt de hotfix
// permanent (rebuild-bestendig).
export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect("/dashboard");
}
