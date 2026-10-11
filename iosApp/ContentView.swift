import SwiftUI
import WebKit
import UIKit

private let studioFallback = URL(string: "https://hendy-studio-web.onrender.com")!

struct ContentView: View {
    var body: some View {
        StudioWebView(url: Bundle.main.object(forInfoDictionaryKey: "HendyStudioURL") as? String)
            .ignoresSafeArea(edges: [.bottom])
            .background(Color(red: 0.09, green: 0.09, blue: 0.10))
            .preferredColorScheme(.dark)
    }
}

private struct StudioWebView: UIViewRepresentable {
    let url: String?

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1)
        view.isOpaque = false
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        let target = URL(string: url ?? "") ?? studioFallback
        view.load(URLRequest(url: target, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let studioHosts: Set<String> = ["hendy-studio-web.onrender.com", "hendystudio.com", "www.hendystudio.com"]

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", studioHosts.contains(url.host ?? "") {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
                if url.scheme == "https" { UIApplication.shared.open(url) }
            }
        }
    }
}
