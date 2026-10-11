# Hendy Studio Pro Android client

This native Android shell hosts the deployed Hendy Studio workspace inside a hardened WebView. It disables file/content access, mixed content and automatic popups, restricts in-app navigation to the configured HTTPS Studio host and sends other HTTPS links to the system browser. It contains no API keys.

## Build debug APK

```bash
gradle -p integrated-pipeline/androidApp assembleDebug
```

## Build a signed release AAB

Provide `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` as protected CI variables/secrets, then run:

```bash
gradle -p integrated-pipeline/androidApp bundleRelease -PversionCode=2 -PversionName=1.2.0
```

The application ID and version must be stable and must match the Play Console listing. Only a signed release bundle is eligible for Google Play upload; a debug APK is for testing only. Validate data safety, privacy policy, target API, signing, Play testing requirements and device compatibility before submitting.
