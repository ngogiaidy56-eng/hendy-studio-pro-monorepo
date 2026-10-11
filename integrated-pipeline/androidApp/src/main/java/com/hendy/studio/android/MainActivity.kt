package com.hendy.studio.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat

private const val FALLBACK_STUDIO_URL = "https://hendy-studio-web.onrender.com"
private val BRAND_BACKGROUND = Color(0xFF17171A)

class MainActivity : ComponentActivity() {
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = android.graphics.Color.rgb(23, 23, 26)
        window.navigationBarColor = android.graphics.Color.rgb(23, 23, 26)
        val studioUrl = BuildConfig.STUDIO_WEB_URL.ifBlank { FALLBACK_STUDIO_URL }
        val trustedHost = Uri.parse(studioUrl).host.orEmpty()
        setContent {
            MaterialTheme {
                var webView by remember { mutableStateOf<WebView?>(null) }
                var loading by remember { mutableStateOf(true) }
                BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }
                Box(Modifier.fillMaxSize().background(BRAND_BACKGROUND), contentAlignment = Alignment.Center) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            WebView(context).apply {
                                webView = this
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.cacheMode = WebSettings.LOAD_DEFAULT
                                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                                settings.allowFileAccess = false
                                settings.allowContentAccess = false
                                settings.javaScriptCanOpenWindowsAutomatically = false
                                settings.setSupportMultipleWindows(false)
                                webChromeClient = object : WebChromeClient() {
                                    override fun onShowFileChooser(
                                        webView: WebView?,
                                        filePathCallback: ValueCallback<Array<Uri>>?,
                                        fileChooserParams: FileChooserParams?,
                                    ): Boolean {
                                        fileChooserCallback?.onReceiveValue(null)
                                        fileChooserCallback = filePathCallback ?: return false
                                        return try {
                                            val intent = fileChooserParams?.createIntent()
                                                ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                                                    addCategory(Intent.CATEGORY_OPENABLE)
                                                    type = "*/*"
                                                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                                }
                                            filePicker.launch(intent)
                                            true
                                        } catch (_: Exception) {
                                            fileChooserCallback?.onReceiveValue(null)
                                            fileChooserCallback = null
                                            false
                                        }
                                    }
                                }
                                webViewClient = object : WebViewClient() {
                                    override fun onPageFinished(view: WebView?, url: String?) {
                                        loading = false
                                    }
                                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                        val uri = request?.url ?: return true
                                        if (uri.scheme == "https" && uri.host == trustedHost) return false
                                        if (uri.scheme == "https") {
                                            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                                        }
                                        return true
                                    }
                                }
                                loadUrl(studioUrl)
                            }
                        },
                        update = { webView = it },
                    )
                    if (loading) CircularProgressIndicator(color = Color(0xFF8DB2FF))
                }
            }
        }
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        super.onDestroy()
    }
}
