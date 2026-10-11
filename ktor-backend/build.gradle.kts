plugins {
    kotlin("jvm") version "2.1.10"
    kotlin("plugin.serialization") version "2.1.10"
    application
}
application { mainClass.set("com.hendy.core.ApplicationKt") }
dependencies {
    implementation("io.ktor:ktor-server-core-jvm:3.1.0")
    implementation("io.ktor:ktor-server-netty-jvm:3.1.0")
    implementation("io.ktor:ktor-server-content-negotiation-jvm:3.1.0")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm:3.1.0")
    implementation("ch.qos.logback:logback-classic:1.5.16")
    testImplementation(kotlin("test"))
}
kotlin { jvmToolchain(21) }
