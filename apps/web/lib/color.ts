/**
 * Kleur-helpers voor tenant-branding (WCAG-contrast).
 *
 * Gebruikt door:
 *   - components/layout/BrandingTheme.tsx — kiest een leesbare voorgrondkleur
 *     (wit of donker) bij de tenant-accentkleur en zet beide als CSS-vars.
 *   - settings/branding — waarschuwt wanneer een gekozen kleur te weinig
 *     contrast heeft voor witte tekst (WCAG 1.4.11 non-text contrast, 3:1).
 */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** `#abc` of `#aabbcc` → [r, g, b] (0-255). Null bij ongeldige input. */
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!isHexColor(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance (0 = zwart, 1 = wit). */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG-contrastratio tussen twee hex-kleuren (1:1 t/m 21:1). */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  if (la === null || lb === null) return null;
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE = "#ffffff";
/** Donkere ink — matcht zinc-900 uit het bestaande thema. */
const DARK_INK = "#18181b";

/**
 * Kiest de best leesbare voorgrondkleur (wit of donker) op de gegeven
 * achtergrond. Fallback: wit (veilig voor de indigo-default).
 */
export function bestForegroundFor(backgroundHex: string): string {
  const vsWhite = contrastRatio(backgroundHex, WHITE);
  const vsDark = contrastRatio(backgroundHex, DARK_INK);
  if (vsWhite === null || vsDark === null) return WHITE;
  return vsWhite >= vsDark ? WHITE : DARK_INK;
}

/**
 * WCAG 1.4.11 (non-text contrast): UI-componenten moeten minimaal 3:1
 * contrast houden met hun omgeving. Gebruikt voor de contrast-waarschuwing
 * in de branding-instellingen (kleur als knop-/badge-achtergrond met witte
 * of donkere tekst erop).
 */
export function meetsUiContrast(backgroundHex: string): boolean {
  const fg = bestForegroundFor(backgroundHex);
  const ratio = contrastRatio(backgroundHex, fg);
  return ratio !== null && ratio >= 3;
}
