# Store screenshots and visual assets checklist

The SVG logo and feature graphic in this folder are starting assets, not a complete store listing. Capture real screenshots from the exact release candidate; do not submit the marketing-site mock editor or invented feature states as if they were the running product.

## Required capture groups

1. Product overview: the real Studio project dashboard at the supported production URL.
2. Timeline editing: imported sample media with visible video, subtitle and audio tracks.
3. Subtitle workflow: original transcript, translated Vietnamese line and editable timecodes.
4. Render queue: a real job state and final output preview/download.
5. Release center: supported platform downloads and version notes, without admin-only information.
6. Optional platform-specific native screen: only when a signed build has been tested on that platform.

## Before exporting

- Hide personal email addresses, authentication tokens, private media and user identifiers.
- Use licensed sample media and confirm that all visible content can be displayed publicly.
- Ensure screenshot text matches the actual localized product. Do not show fake metrics, unsupported feature badges, or a store approval that has not occurred.
- Follow the current pixel dimensions, aspect ratios and file-size limits in the selected store's developer console. These limits vary by product, device class and listing slot, so check the store console immediately before upload.
- Export lossless PNG where supported; keep original captures and their SHA-256 in the release evidence folder.

## Identity and listing data

- Final app name, developer/organization name, bundle/package identifier, version, support contact and release date.
- Accurate short and long descriptions in `STORE_LISTING_VI.md`.
- Final privacy policy, terms and support pages; remove every bracketed placeholder.
- Real privacy/data-safety answers based on the native client, website, backend, analytics and AI providers—not assumptions based on the wrapper only.
- Category, age rating, permissions, export/encryption disclosures, subscription/payment terms and territories/pricing.

## Evidence files recommended for each release

Store screenshots, logo and feature assets, final listing text, a signed artifact, build provenance, artifact SHA-256 manifest, QA results, platform-specific review notes, submission ID and final listing URL. Keep this folder separate from user-uploaded project media.
