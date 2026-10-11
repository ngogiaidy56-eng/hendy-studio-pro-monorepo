# Hendy Studio Pro — App Publishing & Store Operations Runbook

## Roles

- **Developer**: prepares source, tests, version and candidate artifacts.
- **Release manager** (`release:manage`): creates release records, uploads artifacts and controls release state.
- **Reviewer/QA**: verifies installation, upgrade, application permissions, checksum, privacy metadata and rollbacks.
- **Store account owner**: manages Apple Developer/App Store Connect, Google Play Console, Microsoft Partner Center and release keys.

## Candidate → published

1. Protect `main`; merge only after CI passes.
2. Create a version tag such as `v1.2.0` and run `.github/workflows/app-release.yml`.
3. Download artifacts and inspect `SHA256SUMS.txt`. Debug Android APK and iOS simulator validation text are test-only and cannot be submitted to stores; only the signed release APK/AAB and signed IPA are production candidates. Set `release_version` when running manually; a `vX.Y.Z` tag overrides it. Desktop package metadata, Android versionName/versionCode and iOS marketing/build versions are stamped for the CI run. A signed Android AAB is produced only when signing is enabled in protected GitHub Actions configuration.
4. On the Release Center, create a `draft`, enter product version/channel/notes, upload each artifact and compare the calculated SHA-256. The server rechecks size and hash before accepting an artifact as ready for downloads.
5. Verify at least one clean-install and upgrade path per supported platform; run malware/dependency checks, license review and privacy review. QA state must be recorded.
6. Complete platform-specific checklist and metadata. Google Play upload automation can upload to the **internal** track only when both `ANDROID_SIGNING_ENABLED=true` and `GOOGLE_PLAY_UPLOAD_ENABLED=true` are set and the operator chooses the workflow input. It is not a public release by default.
7. For Apple, generate an archive/IPA with the actual distribution certificate and provisioning profile, upload using Xcode/Transporter or App Store Connect API, then use TestFlight and submit for review. For Microsoft, produce the package format accepted by Partner Center, sign it, run certification and publish through Partner Center. Release Center records metadata/status, but does not grant vendor approval automatically.
8. After approving checklist, switch to `ready`; authorized release manager performs `published`. Confirm public catalog only includes the intended artifacts.
9. Monitor API/worker logs, queue latency, signed download failures, storage, errors and crash reports. If a bad binary is released, mark withdrawn, replace catalog links and publish fixed version.

## Protected CI variables and secrets

- Android: `ANDROID_SIGNING_ENABLED=true` variable and `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets.
- Google Play internal track: `GOOGLE_PLAY_UPLOAD_ENABLED=true` and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret; the workflow needs an explicit `publish_google_play_internal` input. Restrict the service account permissions.
- Microsoft Store AppX build: `MICROSOFT_STORE_PACKAGING_ENABLED=true`, and Partner Center `MICROSOFT_STORE_IDENTITY_NAME`, `MICROSOFT_STORE_PUBLISHER`, `MICROSOFT_STORE_CERTIFICATE_BASE64` and `MICROSOFT_STORE_CERTIFICATE_PASSWORD` secrets. The workflow only builds a signed AppX candidate; submit/certify the package through Partner Center.
- iOS App Store Connect/TestFlight upload: `IOS_STORE_UPLOAD_ENABLED=true`, `IOS_BUNDLE_ID` variable plus `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROFILE_BASE64`, `IOS_TEAM_ID`, `IOS_KEYCHAIN_PASSWORD`, `APP_STORE_CONNECT_API_KEY_BASE64`, `APP_STORE_CONNECT_API_KEY_ID`, and `APP_STORE_CONNECT_ISSUER_ID` secrets. Choose `upload_apple_testflight` manually. This uploads for processing/TestFlight; it does not auto-submit to public App Review.
- Public GitHub Release: first push a `vX.Y.Z` tag, run the workflow manually on that tag with `publish_github_release=true`, and set `PUBLIC_RELEASES_ENABLED=true`. The release job blocks publication unless both Windows Authenticode and macOS signing/notarization secrets are set, and excludes debug APK/iOS simulator validation artifacts.
- Windows desktop: Authenticode signing `WINDOWS_CSC_LINK` (base64-encoded PFX or secure URL) and `WINDOWS_CSC_KEY_PASSWORD`. Builds without these credentials may be unsigned; do not label as verified production installers.
- macOS desktop: signing/notarization `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Build without those values can remain unsigned; do not distribute as production-ready.
- iOS App Store: set an explicit app bundle ID, code signing team, Apple Developer distribution certificate/provisioning, App Store Connect API credentials, usage strings/permissions, privacy declarations and screenshot assets; extend the signing/upload job only after testing the signing process.
- Microsoft Store: Partner Center account, package identity/publisher, valid signing certificate and package format accepted by Partner Center.

Secrets must be environment-level or organization-level protected values, limited to trusted branches/environments. Never print keys, paste them into issues, or add them to `.env.example`.

## Store listing/legal gates

`apps/marketing-web/public/privacy.html`, `terms.html` and `support.html` are template pages with warnings. Replace placeholders, document real providers/retention/deletion/children's data practices, provide a functioning support contact, and obtain legal approval before linking them in store submissions. Use `store-assets/STORE_LISTING_VI.md` and `store-assets/RELEASE_CHECKLIST.md`. Screenshots and store graphics must accurately show the exact submitted app; the included SVGs are starting templates, not final store assets.

## Validation commands

```bash
node scripts/audit-source.mjs
node scripts/validate-system-config.mjs
node scripts/verify-render-blueprint.mjs
node scripts/store-release-preflight.mjs
node scripts/validate-release-artifact.mjs path/to/artifact
node scripts/package-release-metadata.mjs --version 1.2.0 --channel stable --output release-out/release-manifest.json path/to/artifact
```
