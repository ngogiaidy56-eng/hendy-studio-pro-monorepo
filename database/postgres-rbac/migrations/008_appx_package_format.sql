-- Support the .appx artifact emitted by electron-builder for Microsoft Store submissions.
ALTER TABLE app_release_artifacts
  DROP CONSTRAINT IF EXISTS app_release_artifacts_package_format_check;
ALTER TABLE app_release_artifacts
  ADD CONSTRAINT app_release_artifacts_package_format_check
  CHECK (package_format IN ('exe','msi','appx','msix','msixbundle','appxbundle','dmg','pkg','appimage','deb','rpm','apk','aab','ipa','zip','pwa','other'));
