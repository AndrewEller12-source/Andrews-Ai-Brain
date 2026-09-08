import Foundation
import Security
import CryptoKit

struct Pairing: Codable, Equatable {
    let url: String
    let token: String
    let fingerprint: String

    var baseURL: URL { URL(string: url)! }
    var formattedJSON: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? String(data: encoder.encode(self), encoding: .utf8)) ?? ""
    }
    func matchesCertificate(_ certificate: Data) -> Bool {
        SHA256.hash(data: certificate).map { String(format: "%02x", $0) }.joined() == fingerprint
    }
    var cookie: HTTPCookie? {
        guard let host = baseURL.host else { return nil }
        return HTTPCookie(properties: [.domain: host, .path: "/", .name: "brain_pair", .value: token, .secure: "TRUE", HTTPCookiePropertyKey("HttpOnly"): "TRUE"])
    }
    static func parse(_ text: String) throws -> Pairing {
        guard let data = text.data(using: .utf8), let value = try? JSONDecoder().decode(Pairing.self, from: data),
              let endpoint = URL(string: value.url), endpoint.scheme == "https", let host = endpoint.host, !host.isEmpty,
              endpoint.user == nil, endpoint.password == nil, endpoint.query == nil, endpoint.fragment == nil,
              endpoint.path.isEmpty || endpoint.path == "/",
              value.token.range(of: "^[A-Za-z0-9_-]{43,128}$", options: .regularExpression) != nil,
              value.fingerprint.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
            throw PairingError.invalid
        }
        return Pairing(url: value.url, token: value.token, fingerprint: value.fingerprint.lowercased())
    }
}

enum PairingError: LocalizedError {
    case invalid, storage(OSStatus)
    var errorDescription: String? {
        switch self {
        case .invalid: return "Paste the complete pairing JSON from Phone access on your Mac. It must include the HTTPS address, token, and certificate fingerprint."
        case .storage: return "The pairing could not be saved securely. Please try again."
        }
    }
}

enum PairingKeychain {
    private static let service = "ai.rewster.taskmanager.pairing"
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "paired-mac"]
    }
    static func load() -> Pairing? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let text = String(data: data, encoding: .utf8) else { return nil }
        return try? Pairing.parse(text)
    }
    static func save(_ pairing: Pairing) throws {
        let data = try JSONEncoder().encode(pairing)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0] = $1 }
            let inserted = SecItemAdd(item as CFDictionary, nil)
            guard inserted == errSecSuccess else { throw PairingError.storage(inserted) }
        } else if status != errSecSuccess { throw PairingError.storage(status) }
    }
    static func remove() { SecItemDelete(query as CFDictionary) }
}
