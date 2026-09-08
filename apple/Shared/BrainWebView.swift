import SwiftUI
import WebKit
import CryptoKit
import Security
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct BrainWebView {
    let url: URL
    var pairing: Pairing? = nil
    var onError: (String?) -> Void = { _ in }
    var onWorkspaceAction: (String) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(url: url, pairing: pairing, onError: onError, onWorkspaceAction: onWorkspaceAction) }
    func makeWebView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = pairing == nil ? .default() : .nonPersistent()
        #if os(macOS)
        configuration.userContentController.add(context.coordinator, name: "workspaceActions")
        configuration.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('mac-shell')", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        #endif
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        #if os(macOS)
        webView.setValue(false, forKey: "drawsBackground")
        #else
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.02, green: 0.035, blue: 0.10, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        #endif
        if let cookie = pairing?.cookie {
            configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                DispatchQueue.main.async { webView.load(URLRequest(url: url)) }
            }
        } else { webView.load(URLRequest(url: url)) }
        return webView
    }
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
        private var downloads: [ObjectIdentifier: URL] = [:]
        private var blocked = false
        let url: URL
        let pairing: Pairing?
        let onError: (String?) -> Void
        let onWorkspaceAction: (String) -> Void
        init(url: URL, pairing: Pairing?, onError: @escaping (String?) -> Void, onWorkspaceAction: @escaping (String) -> Void) {
            self.url = url; self.pairing = pairing; self.onError = onError; self.onWorkspaceAction = onWorkspaceAction
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let source = message.frameInfo.request.url,
                  source.scheme == url.scheme, source.host == url.host, source.port == url.port,
                  let action = message.body as? String, ["phone", "updates"].contains(action) else { return }
            onWorkspaceAction(action)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if !blocked { onError(nil) } }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }
        private func report(_ error: Error) {
            if blocked || (error as NSError).code == NSURLErrorCancelled { return }
            onError(pairing == nil ? "The workspace is not responding. Try Reload." : "Cannot connect to your Mac. Keep Phone access enabled and both devices on the same network. If the Mac was re-paired, import its new pairing code.")
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
            if target.scheme == url.scheme && target.host == url.host && target.port == url.port {
                decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow); return
            }
            // Task previews stay in their sandboxed subframe. They never replace
            // the workspace or receive access to its native message handler.
            let localPreview = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(target.host ?? "")
            if pairing == nil, navigationAction.targetFrame?.isMainFrame == false,
               target.user == nil, target.password == nil,
               target.scheme == "https" || (target.scheme == "http" && localPreview) {
                decisionHandler(.allow); return
            }
            // Other websites open in the system browser and never receive the pairing cookie.
            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                openExternal(target)
            }
            decisionHandler(.cancel)
        }
        #if os(macOS)
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.png, .jpeg, .webP, .gif, .heic, .heif]
            panel.allowsMultipleSelection = parameters.allowsMultipleSelection
            panel.canChooseDirectories = false
            panel.canChooseFiles = true
            panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
        }
        #endif
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            #if os(macOS)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = suggestedFilename
            panel.begin { result in completionHandler(result == .OK ? panel.url : nil) }
            #else
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(suggestedFilename)
            do { try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true) }
            catch { completionHandler(nil); return }
            downloads[ObjectIdentifier(download)] = destination
            completionHandler(destination)
            #endif
        }
        func downloadDidFinish(_ download: WKDownload) {
            #if os(iOS)
            guard let destination = downloads.removeValue(forKey: ObjectIdentifier(download)),
                  let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  var controller = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
            while let presented = controller.presentedViewController { controller = presented }
            let sheet = UIActivityViewController(activityItems: [destination], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = controller.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
            sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: destination.deletingLastPathComponent()) }
            controller.present(sheet, animated: true)
            #endif
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let destination = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: destination.deletingLastPathComponent()) }
            if (error as NSError).code != NSURLErrorCancelled { onError("The file download failed. Try Download again from Outputs.") }
        }
        func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { authenticate(challenge, completionHandler: completionHandler) }
        private func openExternal(_ target: URL) {
            if ["https", "http"].contains(target.scheme ?? "") {
                #if os(macOS)
                NSWorkspace.shared.open(target)
                #else
                UIApplication.shared.open(target)
                #endif
            }
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let target = navigationAction.request.url else { return nil }
            if target.scheme == url.scheme && target.host == url.host && target.port == url.port { webView.load(URLRequest(url: target)) }
            else { openExternal(target) }
            return nil
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            // A stopped preview server or an app's own error page is not a
            // disconnected Task Manager workspace.
            if !navigationResponse.isForMainFrame { decisionHandler(.allow); return }
            if let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
                blocked = true
                onError(response.statusCode == 401 && pairing != nil ? "This pairing was revoked or expired. Forget this Mac in Connection settings and paste its new pairing code." : "The workspace returned an error. Try Reload, or check that your Mac is running.")
                decisionHandler(.cancel); return
            }
            if let response = navigationResponse.response as? HTTPURLResponse, response.value(forHTTPHeaderField: "Content-Disposition")?.hasPrefix("attachment") == true { decisionHandler(.download) }
            else { decisionHandler(.allow) }
        }
        func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            authenticate(challenge, completionHandler: completionHandler)
        }
        private func authenticate(_ challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            guard let pairing else { completionHandler(.performDefaultHandling, nil); return }
            guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
                  challenge.protectionSpace.host == url.host,
                  let trust = challenge.protectionSpace.serverTrust,
                  let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
                  let certificate = certificates.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
            let data = SecCertificateCopyData(certificate) as Data
            guard pairing.matchesCertificate(data) else {
                blocked = true
                onError("This Mac's certificate does not match your saved pairing. Connection blocked. Import a new pairing code directly from the Mac if you intentionally changed its setup.")
                completionHandler(.cancelAuthenticationChallenge, nil); return
            }
            completionHandler(.useCredential, URLCredential(trust: trust))
        }
    }
}

#if os(macOS)
extension BrainWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(context: context) }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
extension BrainWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(context: context) }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif
