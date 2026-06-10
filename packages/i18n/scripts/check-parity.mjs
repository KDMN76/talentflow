// Controleert dat alle locales exact dezelfde sleutelstructuur hebben als NL
// (de bron-van-waarheid). Een sleutel die in een taal ontbreekt → exit 1.
// Gebruik: node packages/i18n/scripts/check-parity.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const SOURCE = "nl";

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );

const readNs = (locale, file) =>
  JSON.parse(readFileSync(join(localesDir, locale, file), "utf8"));

const locales = readdirSync(localesDir);
const nsFiles = readdirSync(join(localesDir, SOURCE)).filter((f) => f.endsWith(".json"));

let failed = false;
for (const locale of locales.filter((l) => l !== SOURCE)) {
  for (const file of nsFiles) {
    let target;
    try {
      target = readNs(locale, file);
    } catch {
      console.error(`✗ ${locale}/${file}: bestand ontbreekt of is geen geldige JSON`);
      failed = true;
      continue;
    }
    const srcKeys = new Set(flatten(readNs(SOURCE, file)));
    const tgtKeys = new Set(flatten(target));
    const missing = [...srcKeys].filter((k) => !tgtKeys.has(k));
    const extra = [...tgtKeys].filter((k) => !srcKeys.has(k));
    if (missing.length || extra.length) {
      failed = true;
      if (missing.length)
        console.error(`✗ ${locale}/${file}: ontbrekend (${missing.length}): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}`);
      if (extra.length)
        console.error(`✗ ${locale}/${file}: extra t.o.v. ${SOURCE} (${extra.length}): ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? " …" : ""}`);
    } else {
      console.log(`✓ ${locale}/${file} (${srcKeys.size} sleutels)`);
    }
  }
}

if (failed) {
  console.error("\nPariteit FAALT — vul de ontbrekende sleutels aan.");
  process.exit(1);
}
console.log("\nAlle locales in pariteit met NL ✅");
