import SwiftUI

@main
struct AndrewsBrainPhoneApp: App {
    var body: some Scene { WindowGroup { PhoneDashboardView() } }
}

struct PhoneDashboardView: View {
    @State private var pairing = PairingKeychain.load()
    @State private var setup = false
    @State private var error: String?
    @State private var revision = UUID()
    var body: some View {
        NavigationStack {
            Group {
                if let pairing {
                    BrainWebView(url: pairing.baseURL, pairing: pairing, onError: { error = $0 }).id(revision)
                        .safeAreaInset(edge: .bottom) {
                            if let error { VStack(alignment: .leading, spacing: 8) { Text(error).font(.callout); Button("Try again") { self.error = nil; revision = UUID() } }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.ultraThinMaterial) }
                        }
                } else { PairingSetupView { value in pairing = value; revision = UUID() } }
            }
            .background(Color(red: 0.02, green: 0.035, blue: 0.10))
            .navigationTitle("Ai Task Manager")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if pairing != nil {
                    ToolbarItem(placement: .topBarLeading) { Button { revision = UUID(); error = nil } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Reload workspace") }
                    ToolbarItem(placement: .topBarTrailing) { Button { setup = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Connection settings") }
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $setup) {
            NavigationStack {
                Form {
                    if let pairing { Section("Connected Mac") { Text(pairing.url).font(.callout.monospaced()); Text("The pairing is stored in this iPhone's Keychain. The Mac certificate must match the saved fingerprint.").font(.caption).foregroundStyle(.secondary) } }
                    Section { Button("Forget this Mac", role: .destructive) { PairingKeychain.remove(); pairing = nil; error = nil; setup = false } }
                }.navigationTitle("Connection").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { setup = false } } }
            }.preferredColorScheme(.dark)
        }
    }
}

struct PairingSetupView: View {
    let onPaired: (Pairing) -> Void
    @State private var text = ""
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Image(systemName: "brain.head.profile").font(.system(size: 56)).foregroundStyle(.cyan).padding(.top, 24)
                Text("Your agents,\non your iPhone.").font(.largeTitle.bold())
                Text("On your Mac, open Ai Task Manager → Phone access → Enable phone access. Copy its pairing code here. Keep both devices on the same network.").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 10) {
                    HStack { Text("PAIRING CODE").font(.caption.weight(.semibold)).foregroundStyle(.secondary); Spacer(); PasteButton(payloadType: String.self) { values in if let value = values.first { text = value } }.buttonBorderShape(.capsule) }
                    TextEditor(text: $text).font(.system(.caption, design: .monospaced)).frame(height: 160).scrollContentBackground(.hidden).padding(10).background(.white.opacity(0.06)).clipShape(RoundedRectangle(cornerRadius: 12)).accessibilityLabel("Pairing JSON")
                }
                if let error { Text(error).font(.callout).foregroundStyle(.orange) }
                Button {
                    do { let pairing = try Pairing.parse(text); try PairingKeychain.save(pairing); error = nil; onPaired(pairing) }
                    catch { self.error = error.localizedDescription }
                } label: { HStack { Text("Connect to my Mac"); Spacer(); Image(systemName: "arrow.right") }.padding(.vertical, 7).frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.cyan).foregroundStyle(.black).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Label("Stored securely on this iPhone. Your Mac must stay online.", systemImage: "lock.shield").font(.caption).foregroundStyle(.secondary)
            }.padding(24)
        }
    }
}
