import UIKit
import CoreImage

/// Generates and parses Nearify QR codes.
///
/// Supports two payload schemes:
///   - `beacon://event/<event-id>`   — scanned by Nearify in-app scanner → EventJoinService
///   - `beacon://profile/<community-id>` — scanned by Nearify in-app scanner → profile flow
final class QRService {

    // MARK: - Payload schemes

    private enum Scheme {
        static let event   = "beacon://event/"
        static let profile = "beacon://profile/"
    }

    // MARK: - Validation

    /// Returns `true` when `eventId` is non-empty after whitespace trimming.
    static func isValidEventId(_ eventId: String) -> Bool {
        !eventId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Event QR generation (new)

    /// Generates a QR code image whose payload is `beacon://event/<eventId>`.
    ///
    /// - Parameter eventId: The event UUID or identifier.
    /// - Returns: A `UIImage` of the QR code, or `nil` if `eventId` is invalid.
    static func generateEventQRCode(for eventId: String) -> UIImage? {
        let trimmed = eventId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidEventId(trimmed) else {
#if DEBUG
            print("[QRService] generateEventQRCode: invalid/empty eventId '\(eventId)'")
#endif
            return nil
        }
        let payload = Scheme.event + trimmed
#if DEBUG
        print("[QRService] generateEventQRCode: payload='\(payload)'")
#endif
        return generateQRCode(from: payload)
    }

    // MARK: - Profile QR generation (existing — unchanged)

    /// Generates a QR code image whose payload is `beacon://profile/<communityId>`.
    ///
    /// - Parameter communityId: The community or profile UUID.
    /// - Returns: A `UIImage` of the QR code, or `nil` if generation fails.
    static func generateProfileQRCode(for communityId: String) -> UIImage? {
        let payload = Scheme.profile + communityId
#if DEBUG
        print("[QRService] generateProfileQRCode: payload='\(payload)'")
#endif
        return generateQRCode(from: payload)
    }

    // MARK: - Parsing (existing — unchanged)

    enum QRPayload: Equatable {
        case event(id: String)
        case profile(communityId: String)
        case rawProfileUUID(uuid: String)
        case unknown(raw: String)
    }

    /// Parses a raw QR string into a typed `QRPayload`.
    static func parse(_ raw: String) -> QRPayload {
        if raw.hasPrefix(Scheme.event) {
            return .event(id: String(raw.dropFirst(Scheme.event.count)))
        } else if raw.hasPrefix(Scheme.profile) {
            return .profile(communityId: String(raw.dropFirst(Scheme.profile.count)))
        } else if UUID(uuidString: raw) != nil {
            return .rawProfileUUID(uuid: raw)
        }
        return .unknown(raw: raw)
    }

    // MARK: - Core Image QR generation (shared)

    private static func generateQRCode(from string: String) -> UIImage? {
        guard
            let data = string.data(using: .utf8),
            let filter = CIFilter(name: "CIQRCodeGenerator")
        else { return nil }

        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")

        guard let ciImage = filter.outputImage else { return nil }

        // Scale up so the QR renders crisply at display size.
        let scale: CGFloat = 10
        let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}
