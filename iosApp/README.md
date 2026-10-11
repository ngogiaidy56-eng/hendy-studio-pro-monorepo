# Hendy Studio Pro iOS client

The iOS shell uses SwiftUI + WKWebView to load the HTTPS Studio app. In-app navigation is restricted to the known Studio hostnames; other HTTPS links open in the system browser. No backend credentials are embedded in the app.

## Generate an Xcode project (macOS)

Install XcodeGen and run from the repository root:

```bash
brew install xcodegen
cd integrated-pipeline
xcodegen generate --spec project.yml
xcodebuild -project HendyStudioPro.xcodeproj -scheme HendyStudioPro -destination 'generic/platform=iOS Simulator' build
```

Store distribution still requires the final bundle identifier, app icon, Apple Developer team, distribution signing and provisioning, privacy disclosures, screenshots, App Store Connect metadata and Apple review. No `.ipa` is claimed as prebuilt in this source bundle.
