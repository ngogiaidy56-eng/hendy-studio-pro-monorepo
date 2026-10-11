# Release & App Store operations checklist

## Build & supply chain
- [ ] Build from a protected tag on a green CI run.
- [ ] Confirm `versionName`/SemVer, monotonically increasing mobile build number, package/bundle ID and supported OS.
- [ ] Verify generated installer/bundle format using `scripts/validate-release-artifact.mjs`.
- [ ] Generate SHA-256 manifest; compare after upload and verify it from the release API.
- [ ] Scan dependencies/licenses, run malware/dependency checks and keep SBOM if needed.
- [ ] Sign executables with platform certificates; macOS notarization/Gatekeeper; Android release AAB signed with protected keystore; iOS archive/IPA signed with provisioning profile. Never store signing secrets in git.
- [ ] Test clean install, upgrade, uninstall, update/rollback, file access and network failure.

## Store metadata
- [ ] App name, platform icon assets, screenshots, feature graphic, localized descriptions and category. See `store-assets/STORE_SCREENSHOTS_GUIDE.md`.
- [ ] Privacy URL and support URL are public, stable, and not placeholders.
- [ ] Data safety/privacy nutrition disclosures match SDK and server behavior.
- [ ] Age/content rating, export/encryption declarations, permissions, subscriptions/pricing and legal terms checked.
- [ ] Google Play: test tracks and policy checks complete; iOS: App Store Connect/TestFlight review flow completed; Microsoft: Partner Center package, certificate and listing verified.
- [ ] Capture store submission IDs, track, version, reviewer feedback, state, and final listing URL in Release Center.

## Publication & rollback
- [ ] Release starts at `draft`; upload artifact; checksum verified; QA complete.
- [ ] Metadata approved; separate store submission done in the vendor account.
- [ ] Publish direct-download version only after manual release-gate approval.
- [ ] Verify download authorization, URL expiry, range/large-file behavior and install on clean devices.
- [ ] Monitor errors, crash rates, queue latency and storage; document rollback/version-withdraw process.

## External store note
Release Center records submission metadata and release gates; it does not bypass vendor certification, app signing, developer enrollment, or store review. Automatic upload jobs are separately gated by protected CI variables and credentials.
