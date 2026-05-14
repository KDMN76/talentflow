# PWA Icons

The web manifest (`/manifest.json`) references `icon-192.png` and
`icon-512.png` — these PNG files MUST exist before the PWA can be
installed.

## Generating PNGs from `icon.svg`

The source SVG (`icon.svg`) is the master asset. Generate both PNG
sizes from it before deploying.

### Option A — sharp (Node, recommended for CI)

```bash
npx sharp-cli -i apps/web/public/icons/icon.svg -o apps/web/public/icons/icon-192.png resize 192 192
npx sharp-cli -i apps/web/public/icons/icon.svg -o apps/web/public/icons/icon-512.png resize 512 512
```

### Option B — ImageMagick

```bash
magick convert -background none -resize 192x192 icon.svg icon-192.png
magick convert -background none -resize 512x512 icon.svg icon-512.png
```

### Option C — Inkscape

```bash
inkscape icon.svg --export-type=png --export-filename=icon-192.png -w 192 -h 192
inkscape icon.svg --export-type=png --export-filename=icon-512.png -w 512 -h 512
```

### Option D — online (one-off)

Upload `icon.svg` to https://realfavicongenerator.net/ or
https://cloudconvert.com/svg-to-png and download 192x192 + 512x512
versions; place them next to this README as `icon-192.png` and
`icon-512.png`.

## Maskable safe zone

The 512x512 icon has `purpose: "any maskable"`. The current SVG keeps
the central "TF" mark within the inner 80% to comply with the maskable
safe zone — no further padding required.
