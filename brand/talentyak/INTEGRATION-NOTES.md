# Opus: integrate the TalentYak logo pack

You have access to my local codebase and to the ZIP or extracted folder whose path I provide. Implement this brand asset integration. Inspect the current repository and its instructions before changing anything.

The current company and product name is **TalentYak**, with domain **talentyak.com**. This pack uses the approved front-facing yak concept. Keep the capital T and Y. Earlier names Aafnai and Ghartira may appear in the repository; do not restore an old application or rename the repository as part of this task.

## 1. Import

1. Resolve the supplied local path and inspect the pack. If it is a ZIP, inspect the archive entries and extract safely into a temporary folder. Do not run any downloaded scripts; this pack contains no executable installer.
2. Identify the actual web-app root. If it is still a Next.js app inside `web/`, use `web/public/brand/talentyak/`; otherwise use the equivalent public-assets directory. Do not blindly assume the older directory layout.
3. Copy `website/` and `icons/` into that brand directory, preserving the subfolders. Keep high-resolution masters and documentation outside the deployed public folder unless the repository has a deliberate design-assets convention.
4. Reuse the provided artwork. Do not generate a new logo, change the mark, add gradients, or substitute emoji.

## 2. Website placements

- Create or update one reusable BrandLogo component [a shared UI element] so all pages use the same asset and spacing.
- In the homepage and public navigation, place the horizontal light logo on the left, linking to the homepage. Use its native 3:1 ratio, an appropriate fixed display width, and explicit image dimensions to prevent layout shift [content jumping while an image loads]. Start around 150–180 CSS pixels wide and adjust after inspecting the actual header.
- In dark green footers, use the dark horizontal version only where its opaque background fits the surface.
- On other backgrounds, prefer the genuinely transparent symbol plus a live-text TalentYak label using the existing approved brand typography. Render the symbol white on dark backgrounds with a CSS filter or mask. Avoid displaying an obvious rectangular background behind the logo.
- Use the small symbol in collapsed coach/customer/admin navigation when space is limited. Provide an accessible name [text screen readers can announce] even when the visible wordmark is hidden.
- Apply the same brand to existing sign-in and onboarding screens where a logo already belongs. Do not build unrelated pages just to add branding.
- A linked logo should have accessible name "TalentYak home". When adjacent visible text already says TalentYak, avoid duplicate screen-reader announcements from the symbol.
- Keep proper contrast, responsive spacing, keyboard focus, and click/tap target size. Do not turn the logo into a decorative watermark across the product.

## 3. Browser and app icons

- Inspect existing favicon and metadata configuration [browser information about the page]. Remove conflicting legacy icon references only after confirming they are superseded.
- Wire the supplied favicon.ico and Apple touch icon into the app's existing framework conventions.
- If a web manifest [the app installation settings file] exists, merge the supplied 192 and 512 PNG icons into it using the public asset paths. Set `purpose` to `any`. Do not label them `maskable` without creating and verifying a suitable padded export.
- The supplied `manifest-icons.json` is an icons fragment, not a complete manifest. Do not replace the app's existing start URL, scope, identity, display settings, shortcuts, or service-worker behavior with it.
- Installing icon assets alone does not make the app a complete PWA [an installable web app]. Report any remaining PWA work separately; do not claim offline functionality.
- For existing email templates, use the light horizontal PNG through an absolute public HTTPS URL once deployed. Do not put a laptop path into an email. Do not send test emails without existing authorization.

## 4. Check and finish

- Run only the relevant existing checks for the modified app, including its required build/type gates.
- Inspect the header on desktop and narrow mobile widths, a dark footer, sign-in, any affected dashboards, and favicon requests. Check there are no stretched logos, unwanted image backgrounds, missing files, duplicate legacy icons, clipped marks, or layout jumps.
- Verify that every referenced asset exists and that the manifest remains valid JSON. Inspect an installed app icon when local tooling permits; otherwise say this remains a device check.
- Do not change database, payment, auth, or scheduling logic for this task. Do not deploy, publish, or push beyond authorization already present in the session.
- Finish with a short, plain-English report: what changed, where I can see it, what checks passed, and what remains. Explain unavoidable technical terms in brackets. Do not overwhelm me with implementation details.
