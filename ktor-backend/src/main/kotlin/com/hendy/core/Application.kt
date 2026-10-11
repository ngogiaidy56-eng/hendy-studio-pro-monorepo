package com.hendy.core

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.callloging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant

@Serializable
data class HealthResponse(val status: String, val service: String, val time: String)

@Serializable
data class CapabilityResponse(
    val service: String,
    val version: String,
    val features: List<String>,
    val note: String,
)

fun main() {
    val port = System.getenv("KTOR_PORT")?.toIntOrNull()?.takeIf { it in 1..65535 } ?: 8090
    embeddedServer(Netty, host = "0.0.0.0", port = port) { module() }.start(wait = true)
}

fun Application.module() {
    install(CallLogging)
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true; explicitNulls = false })
    }
    routing {
        get("/healthz") {
            call.respond(HealthResponse("ok", "hendy-ktor-core", Instant.now().toString()))
        }
        get("/v1/capabilities") {
            call.respond(
                CapabilityResponse(
                    service = "hendy-ktor-core",
                    version = "1.0.0",
                    features = listOf("health", "json-api-baseline"),
                    note = "Identity and RBAC remain authoritative in the Express/PostgreSQL API until an internal service contract is configured.",
                ),
            )
        }
        get("/v1/internal/admin") {
            call.respond(HttpStatusCode.NotImplemented, mapOf("error" to "Internal admin integration is not configured"))
        }
    }
}
