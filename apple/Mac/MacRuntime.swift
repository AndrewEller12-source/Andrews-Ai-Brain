import Foundation
import Combine

@MainActor
final class MacRuntime: ObservableObject {
    @Published var ready = false
    @Published var updateStatus: String?
    @Published var upgradeWaiting = false
    @Published var error: String?
    @Published var pairing: Pairing?
    @Published var phoneStarting = false
    @Published var phoneRunning = false
    @Published var phoneError: String?
    let dashboardURL = URL(string: "http://127.0.0.1:4780")!
    private var starting = false
    private var launcher: Process?
    private var phone: Process?
    private var phoneBuffer = ""
    private var runtimeURL: URL? { Bundle.main.url(forResource: "Runtime", withExtension: nil) }

    private func makeProcess(script: String, arguments: [String] = []) throws -> Process {
        guard let root = runtimeURL else { throw RuntimeError.missing }
        let node = root.appendingPathComponent("runtime/bin/node")
        let program = root.appendingPathComponent("scripts/\(script)")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: program.path) else { throw RuntimeError.missing }
        let process = Process()
        process.executableURL = node; process.arguments = [program.path] + arguments; process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment["REWSTER_NO_OPEN"] = "1"
        environment["PATH"] = root.appendingPathComponent("runtime/bin").path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = environment
        return process
    }
    func start() async {
        guard !starting, !ready else { return }
        starting = true; error = nil
        defer { starting = false }
        if await healthy() { ready = true; return }
        do {
            while let count = await pendingOlderWork(), count > 0 {
                upgradeWaiting = true
                error = "Your update is ready. There are \(count) unfinished requests in the current workspace. Finish or stop them there; this app will switch over automatically while this window stays open."
                try await Task.sleep(for: .seconds(2))
            }
            upgradeWaiting = false; error = nil
            let process = try makeProcess(script: "launch.mjs")
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            launcher = process; try process.run()
            for _ in 0..<60 {
                if await healthy() { ready = true; return }
                try await Task.sleep(for: .milliseconds(500))
            }
            error = "The workspace did not start. Check the local server log, then try again."
        } catch { self.error = error.localizedDescription }
    }
    private func healthy() async -> Bool {
        var request = URLRequest(url: dashboardURL.appendingPathComponent("api/health")); request.timeoutInterval = 1
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            let installed = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.7.0"
            let version = value["version"] as? String ?? "0"
            return value["app"] as? String == "rewster-command" && version.compare(installed, options: .numeric) != .orderedAscending
        } catch { return false }
    }
    private func pendingOlderWork() async -> Int? {
        do {
            var request = URLRequest(url: dashboardURL.appendingPathComponent("api/health")); request.timeoutInterval = 2
            let (healthData, _) = try await URLSession.shared.data(for: request)
            guard let health = try JSONSerialization.jsonObject(with: healthData) as? [String: Any], health["app"] as? String == "rewster-command" else { return nil }
            let installed = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.7.0"
            if (health["version"] as? String ?? "0").compare(installed, options: .numeric) != .orderedAscending { return nil }
            request.url = dashboardURL.appendingPathComponent("api/state")
            let (data, _) = try await URLSession.shared.data(for: request)
            guard let state = try JSONSerialization.jsonObject(with: data) as? [String: Any], let jobs = state["jobs"] as? [[String: Any]] else { return nil }
            return jobs.filter { ["queued", "routing", "ready", "starting", "running", "review"].contains($0["status"] as? String ?? "") }.count
        } catch { return nil }
    }
    func enablePhoneAccess(rotate: Bool = false) {
        guard phone == nil, ready else { return }
        phoneStarting = true; phoneError = nil; phoneBuffer = ""
        do {
            let process = try makeProcess(script: "phone-bridge.mjs", arguments: rotate ? ["--rotate"] : [])
            let output = Pipe(); process.standardOutput = output; process.standardError = FileHandle.nullDevice
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor in self?.receivePhoneOutput(text) }
            }
            process.terminationHandler = { [weak self] ended in
                output.fileHandleForReading.readabilityHandler = nil
                Task { @MainActor in
                    guard let self, self.phone === ended else { return }
                    self.phone = nil; self.phoneStarting = false; self.phoneRunning = false; self.pairing = nil
                    self.phoneError = "Phone access stopped. Enable it again when your Mac is connected to the network."
                }
            }
            phone = process; try process.run()
        } catch { phone = nil; phoneStarting = false; phoneError = error.localizedDescription }
    }
    private func receivePhoneOutput(_ text: String) {
        guard phone != nil else { return }
        phoneBuffer += text
        if phoneBuffer.count > 65536 { phoneBuffer = String(phoneBuffer.suffix(65536)) }
        while let end = phoneBuffer.firstIndex(of: "\n") {
            let line = String(phoneBuffer[..<end]); phoneBuffer.removeSubrange(...end)
            if let value = try? Pairing.parse(line) { pairing = value; phoneStarting = false; phoneRunning = true; phoneError = nil }
        }
    }
    func revokePairing() async {
        let previous = phone
        disablePhoneAccess()
        for _ in 0..<30 {
            if previous?.isRunning != true { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        enablePhoneAccess(rotate: true)
    }
    func disablePhoneAccess() {
        let process = phone; phone = nil; process?.terminationHandler = nil
        if process?.isRunning == true { process?.terminate() }
        pairing = nil; phoneStarting = false; phoneRunning = false; phoneBuffer = ""
    }
}
private enum RuntimeError: LocalizedError {
    case missing
    var errorDescription: String? { "The bundled runtime is missing. Use the complete Mac app build, or stage apple/Runtime before building in Xcode." }
}
