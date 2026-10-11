# Hendy Studio Pro — Unified Monorepo

This repository contains the initial source package for Hendy Studio Pro, generated from the requested unified architecture.

## Package contents

- Separate React/Vite Admin Web and Studio Web apps
- Express API gateway and render queue foundation
- PostgreSQL RBAC and audit-log migration
- MongoDB project validation examples
- Redis/BullMQ + FFmpeg worker foundation
- Cloudflare Worker starter
- Docker Compose, Kubernetes/Nginx templates, and CI workflows
- Architecture and deployment documentation

## Getting started

1. Download `hendy-studio-pro-monorepo.zip` from this repository's source archive.
2. Extract it and copy `.env.example` to `.env`.
3. Set strong, unique secrets and service credentials in `.env`.
4. Run `docker compose up --build` from the extracted project directory.

The repository package is a starter implementation, not a claim that third-party AI, payment, observability, or native mobile services are configured for production. Review `DEPLOYMENT.md` before deploying.
