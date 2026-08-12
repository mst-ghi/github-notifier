#!/usr/bin/env bash
# Regenerates every icon size from logo.jpg. Needs ImageMagick.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/logo.jpg"
OUT="$ROOT/build"

if ! command -v magick >/dev/null 2>&1; then
  echo "error: ImageMagick is required (sudo apt install imagemagick)" >&2
  exit 1
fi
if [[ ! -f "$SRC" ]]; then
  echo "error: $SRC not found" >&2
  exit 1
fi

mkdir -p "$OUT/icons"

# Drop the white background, trim the margin, then re-pad to a square so every
# generated size keeps the same optical weight.
magick "$SRC" \
  -fuzz 8% -transparent white \
  -trim +repage \
  -resize 460x460 \
  -background none -gravity center -extent 512x512 \
  "$OUT/icon-master.png"

for size in 16 24 32 48 64 128 256 512; do
  magick "$OUT/icon-master.png" -resize "${size}x${size}" "$OUT/icons/${size}x${size}.png"
done

magick "$OUT/icon-master.png" -resize 512x512 "$OUT/icon.png"
magick "$OUT/icon-master.png" -resize 22x22 "$OUT/tray.png"
magick "$OUT/icon-master.png" -resize 44x44 "$OUT/tray@2x.png"
cp "$OUT/icons/256x256.png" "$ROOT/src/renderer/assets/logo.png"

echo "Icons written to $OUT/icons and src/renderer/assets/logo.png"
