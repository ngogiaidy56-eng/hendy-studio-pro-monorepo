# Ktor Core Service starter

This isolated JVM module provides the Ktor service boundary (`/healthz`, `/internal/capabilities`) for Kotlin domain workers and shared KMP business logic. It is intentionally not wired into the public API by default: first define a service-to-service authentication contract (mTLS or signed workload identity), then add domain routes and mount it on a private network. Never expose `/internal/*` publicly.
