# TalentYak logo pack

Approved direction: 01 — The Yak. Brand spelling: **TalentYak**.

## Start here

Download and unzip this pack on the laptop that has your codebase. Give Opus the actual local path to the ZIP or extracted folder, and ask it to follow `integration/OPUS-INSTRUCTIONS.md`.

The download path shown in ChatGPT is not a path Opus can automatically access on your laptop.

## Which image goes where?

| Place | File | Size |
| --- | --- | --- |
| Website header, top left, on white | `website/talentyak-horizontal-light-600.png` | 600 × 200 |
| Larger light-background placement | `website/talentyak-horizontal-light.png` | 1200 × 400 |
| Dark green header or footer | `website/talentyak-horizontal-dark-600.png` | 600 × 200 |
| Larger dark-background placement | `website/talentyak-horizontal-dark.png` | 1200 × 400 |
| Compact navigation, custom background, small brand accent | `website/talentyak-symbol-transparent.png` | 512 × 512 |
| App / PWA icon | `icons/icon-192.png`, `icons/icon-512.png` | 192 / 512 square |
| High-resolution app or profile image | `icons/icon-1024.png` | 1024 square |
| iPhone home-screen icon | `icons/apple-touch-icon.png` | 180 square |
| Browser tab | `icons/favicon.ico` | Contains 16 / 32 / 48 |
| Browser icon PNG alternatives | `icons/favicon-16.png`, `favicon-32.png`, `favicon-48.png` | 16 / 32 / 48 square |

`source/` contains the four high-resolution PNG masters. These are raster images [made of pixels], not editable vector files. There are no SVG files in this pack.

## Appearance

- Use the horizontal logo in the top-left website navigation and link it to the homepage. Start at 150–180 CSS pixels wide; preserve its 3:1 ratio.
- Use the standalone symbol at roughly 28–40 CSS pixels in compact navigation. Keep it separate from account avatars and status indicators.
- Keep enough empty space around the logo. Do not stretch, rotate, add shadows, recolor individual parts, or repeatedly use it as decoration.
- The intended brand palette is forest green `#124F43` and white `#FFFFFF`. Generated masters have small color variations, so the supplied transparent symbol is better on arbitrary backgrounds.
- Only the standalone symbol has genuine transparency. The horizontal light and dark versions have opaque white and green backgrounds respectively. Do not treat them as transparent images or place them over photographs.
- For seamless branding on any surface, use the transparent symbol and a live-text TalentYak label in the existing bold brand font. On dark backgrounds the symbol can be rendered white with a CSS filter or mask [a silhouette filled with a chosen color].
- App icons have square corners so the device can apply its own shape. They are standard icons; the pack does not claim a tested maskable icon [an icon guaranteed to survive every device crop].

## What was checked

The PNG dimensions, actual transparency of the symbol, icon exports, visible TalentYak spelling, and ZIP integrity were checked. Website and app exports were visually inspected. Integration into your actual app has not been tested here.

Artwork was produced with built-in image generation using the selected concept as reference. Export sizes were created mechanically from the supplied masters. See `source/GENERATION-PROMPTS.md` for the prompts.
