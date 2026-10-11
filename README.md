# Hendy Studio Pro — Unified Monorepo

Repository target for the Hendy Studio Pro unified architecture.

## Current status

This repository has been created and initialized. The full generated project directory has **not yet been imported into this GitHub repository**; the repository currently contains this README only.

## Source package

The complete source package is available separately in the conversation as:
- `hendy-studio-pro-monorepo.zip`
- `hendy-studio-pro-monorepo.tar.gz`
- `HENDY_STUDIO_PRO_SOURCE.txt`

## Import the source package

1. Download and extract the ZIP package locally.
2. Clone this repository and copy the contents of the extracted `hendy-wed-server` folder into the repository root.
3. Review `.env.example` and keep real credentials out of Git.
4. Commit and push the project files:

```bash
git add .
git commit -m "feat: add Hendy Studio Pro unified monorepo"
git push origin main
```

## Architecture included in the source package

- Independent React/Vite Admin Web and Studio Web apps
- Express API gateway and render-queue foundation
- PostgreSQL RBAC/audit migration and MongoDB project validation
- Redis/BullMQ and FFmpeg worker foundation
- Cloudflare Worker starter
- Docker Compose, Kubernetes/Nginx templates, and CI workflows

Review `DEPLOYMENT.md` and replace development credentials before deployment. Third-party AI, payments, observability and native mobile release integrations still require service credentials and production validation.
