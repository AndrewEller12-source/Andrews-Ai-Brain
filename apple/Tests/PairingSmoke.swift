import Foundation
import CryptoKit

@main
struct PairingSmoke {
    static func main() throws {
        let certificate = Data("test certificate DER bytes".utf8)
        let digest = SHA256.hash(data: certificate).map { String(format: "%02x", $0) }.joined()
        let token = String(repeating: "a", count: 43)
        func payload(url: String = "https://192.168.1.10:4781", token: String = token, fingerprint: String = digest) throws -> String {
            String(data: try JSONSerialization.data(withJSONObject: ["url": url, "token": token, "fingerprint": fingerprint]), encoding: .utf8)!
        }
        let pairing = try Pairing.parse(payload())
        precondition(pairing.baseURL.scheme == "https")
        precondition(pairing.matchesCertificate(certificate))
        precondition(!pairing.matchesCertificate(Data("different certificate".utf8)))
        precondition(pairing.cookie?.name == "brain_pair")
        precondition(pairing.cookie?.value == token)
        precondition(pairing.cookie?.isSecure == true)
        precondition(pairing.cookie?.isHTTPOnly == true)
        precondition(pairing.cookie?.domain == "192.168.1.10")
        precondition(pairing.cookie?.path == "/")
        for text in [try payload(url: "http://192.168.1.10:4781"), try payload(url: "https://attacker@example.com:4781"), try payload(url: "https://192.168.1.10/path"), try payload(url: "https://192.168.1.10?token=bad"), try payload(token: "short"), try payload(token: String(repeating: "a", count: 129)), try payload(fingerprint: "bad")] {
            do { _ = try Pairing.parse(text); preconditionFailure("Invalid pairing accepted") } catch PairingError.invalid { }
        }
        print("Pairing smoke passed: HTTPS and field validation, matching certificate, mismatched pin rejection, Secure HttpOnly host-scoped cookie.")
    }
}
