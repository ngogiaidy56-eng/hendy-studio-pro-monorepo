# Security policy

- Do not commit `.env`, cloud credentials, bot tokens, signing keys, or real production configuration. Only `.env.example` belongs in source control.
- Keep the repository Private until source, deployment configuration and secret handling have been reviewed.
- Use TLS, exact HTTPS CORS origins, short-lived signed storage URLs, dedicated cloud IAM credentials and private DB/Redis/Mongo network paths in production.
- Set `TRUST_PROXY_HOPS` only when the number of trusted reverse proxies is known; do not enable proxy trust for arbitrary client networks.
- The default authentication and AI rate limits use process memory. Configure a shared Redis-backed rate-limit store before horizontal scaling.
- Run migrations and backups with a least-privilege database account. Store backups outside the application host and regularly test restore procedures.
- Report suspected vulnerabilities privately to the repository owner. Include reproduction steps and avoid publishing exploitable details before a fix is available.

This is a security checklist, not a certification. Before production release, run dependency auditing, secret scanning, penetration testing and a staging restore/render exercise.
