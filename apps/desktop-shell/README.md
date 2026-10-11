# Hendy Studio Pro Desktop Shell

This is a hardened Electron wrapper for the HTTPS-hosted Studio web application. It is a **thin online client**, not a local/offline FFmpeg editor. The default host is `https://hendy-studio-web.onrender.com`; set `HENDY_STUDIO_URL` when running locally if you use a different Studio origin.

## Build packages

Run from the repository root after installing dependencies:

```bash
bun run --filter @hendy/desktop-shell dist:win
bun run --filter @hendy/desktop-shell dist:mac
bun run --filter @hendy/desktop-shell dist:linux
```

Windows emits NSIS `.exe` and `.msi`; macOS emits `.dmg`/`.pkg`; Linux emits `.AppImage`/`.deb`. Artifacts go under `dist/native/desktop`.

## Security and store readiness

- `nodeIntegration` is disabled, context isolation and sandbox are enabled, and unknown navigation is denied/opened externally.
- The shell exposes no filesystem or privileged IPC API to remote content.
- Releases produced without a code-signing identity are **unsigned development artifacts**. Before public Windows distribution, configure Authenticode signing; for macOS, configure Apple Developer signing and notarization.
- The web shell currently requires network access and a functioning deployed Studio/API account. It is not an offline-first native editor.
- This packaging target is not by itself a Mac App Store-compliant, sandboxed app. Store submission must be validated separately.
