import SwiftUI
import AppKit
import Sparkle

@main
struct TaskManagerMacApp: App {
    @StateObject private var runtime = MacRuntime()
    @NSApplicationDelegateAdaptor(UpdateTerminationDelegate.self) private var terminationDelegate
    private let updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: UpdateGate.shared, userDriverDelegate: nil)
    var body: some Scene {
        WindowGroup("Ai Task Manager") {
            MacDashboardView(runtime: runtime, updater: updater)
                .frame(minWidth: 900, minHeight: 620)
                .task { UpdateGate.shared.runtime = runtime; await runtime.start() }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in runtime.disablePhoneAccess() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1400, height: 920)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .appInfo) { Button("Check for Updates…") { updater.checkForUpdates(nil) } }
            CommandMenu("Workspace") {
                Button("Refresh workspace") { NotificationCenter.default.post(name: .init("WorkspaceRefresh"), object: nil) }.keyboardShortcut("r", modifiers: .command)
                Button("Connect phone…") { NotificationCenter.default.post(name: .init("WorkspacePhone"), object: nil) }
            }
        }
    }
}

struct MacDashboardView: View {
    @ObservedObject var runtime: MacRuntime
    let updater: SPUStandardUpdaterController
    @State private var showPhone = false
    @State private var webError: String?
    @State private var revision = UUID()
    var body: some View {
        ZStack {
            Color(red: 0.02, green: 0.035, blue: 0.10).ignoresSafeArea()
            if runtime.ready {
                BrainWebView(url: runtime.dashboardURL, onError: { webError = $0 }, onWorkspaceAction: { action in if action == "phone" { showPhone = true } else if action == "updates" { updater.checkForUpdates(nil) } }).id(revision)
            } else {
                VStack(spacing: 18) {
                    Image(systemName: "brain.head.profile").font(.system(size: 52)).foregroundStyle(.cyan)
                    Text("Ai Task Manager").font(.largeTitle.weight(.semibold))
                    if let error = runtime.error { Text(error).multilineTextAlignment(.center).frame(maxWidth: 480); if runtime.upgradeWaiting { ProgressView(); Button("Open current workspace") { NSWorkspace.shared.open(runtime.dashboardURL) } }
                    else { Button("Try again") { Task { await runtime.start() } } } }
                    else { ProgressView(); Text("Starting your workspace…").foregroundStyle(.secondary) }
                }.padding(32)
            }
        }
        .preferredColorScheme(.dark)
        .onReceive(NotificationCenter.default.publisher(for: .init("WorkspaceRefresh"))) { _ in revision = UUID(); webError = nil }
        .onReceive(NotificationCenter.default.publisher(for: .init("WorkspacePhone"))) { _ in showPhone = true }
        .safeAreaInset(edge: .bottom) {
            if let updateStatus = runtime.updateStatus { HStack { ProgressView().controlSize(.small); Text(updateStatus) }.padding(8).background(.ultraThinMaterial) }
            if let webError { HStack { Image(systemName: "wifi.exclamationmark"); Text(webError); Spacer(); Button("Dismiss") { self.webError = nil } }.padding(12).background(.ultraThinMaterial) }
        }
        .sheet(isPresented: $showPhone) { PhoneAccessView(runtime: runtime) }
    }
}

struct PhoneAccessView: View {
    @ObservedObject var runtime: MacRuntime
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Image(systemName: "iphone.and.arrow.forward").foregroundStyle(.cyan); Text("Connect your iPhone").font(.title2.bold()); Spacer(); Button("Done") { dismiss() } }
            Text("Open Ai Task Manager on your iPhone, then paste this Mac's pairing code. Keep both devices on the same network.").foregroundStyle(.secondary)
            if let pairing = runtime.pairing {
                Label(pairing.url, systemImage: "network").font(.callout.monospaced())
                Text("Pairing code").font(.headline)
                ScrollView { Text(pairing.formattedJSON).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(12) }.frame(height: 155).background(.black.opacity(0.25)).clipShape(RoundedRectangle(cornerRadius: 10))
                Text("This code grants access to your workspace. Share it only with your own phone.").font(.caption).foregroundStyle(.secondary)
                HStack { Button(copied ? "Copied" : "Copy pairing code") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(pairing.formattedJSON, forType: .string); copied = true }.buttonStyle(.borderedProminent); Spacer(); Button("Disable phone access", role: .destructive) { runtime.disablePhoneAccess(); copied = false } }
            } else {
                if runtime.phoneStarting { ProgressView("Enabling phone access…") }
                else { Button("Enable phone access") { runtime.enablePhoneAccess() }.buttonStyle(.borderedProminent).disabled(!runtime.ready) }
                if let error = runtime.phoneError { Text(error).foregroundStyle(.orange).font(.callout) }
            }
            if runtime.pairing != nil { Button("Revoke old pairing and create a new code", role: .destructive) { Task { await runtime.revokePairing(); copied = false } }.font(.caption) }
            Text("Phone access stops when this Mac app quits. Dashboard workers keep running locally.").font(.caption).foregroundStyle(.secondary)
        }.padding(26).frame(width: 570).preferredColorScheme(.dark)
    }
}


@MainActor
final class UpdateGate: NSObject, SPUUpdaterDelegate {
    static let shared = UpdateGate()
    weak var runtime: MacRuntime?
    var waiting = false
    var prepared = false
    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        guard !waiting else { return true }
        waiting = true
        Task { @MainActor in
            runtime?.updateStatus = "Update downloaded. Waiting for active requests to finish before installing…"
            while !prepared {
                do {
                    var request = URLRequest(url: URL(string: "http://127.0.0.1:4780/api/update/prepare")!)
                    request.httpMethod = "POST"; request.timeoutInterval = 5
                    request.setValue("1", forHTTPHeaderField: "X-Rewster-Request")
                    request.setValue("http://127.0.0.1:4780", forHTTPHeaderField: "Origin")
                    let (data, response) = try await URLSession.shared.data(for: request)
                    if (response as? HTTPURLResponse)?.statusCode == 200,
                       let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ready"] as? Bool == true {
                        prepared = true
                        try? await Task.sleep(for: .seconds(1))
                        runtime?.disablePhoneAccess()
                        installHandler(); return
                    }
                } catch { runtime?.updateStatus = "Update is waiting for the workspace connection. Your tasks will not be interrupted." }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        return true
    }
}
@MainActor
final class UpdateTerminationDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Normal quit leaves workers alone. An update must release the old runtime before replacing it.
        UpdateGate.shared.waiting && !UpdateGate.shared.prepared ? .terminateCancel : .terminateNow
    }
}
