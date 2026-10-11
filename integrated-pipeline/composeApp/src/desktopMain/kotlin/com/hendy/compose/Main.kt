package com.hendy.compose

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import java.awt.Desktop
import java.net.URI

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "Hendy Studio Pro") {
        HendyStudioApp(onOpenStudio = {
            runCatching { if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(URI("https://hendystudio.com")) }
        })
    }
}
