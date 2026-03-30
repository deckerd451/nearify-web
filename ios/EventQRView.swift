import SwiftUI

/// Displays a scannable event QR code for in-app or in-venue sharing.
///
/// The QR payload is `beacon://event/<eventId>`, which Nearify's ScanView
/// routes into EventJoinService.joinEvent(eventID:).
///
/// Usage:
/// ```swift
/// EventQRView(eventId: event.id, eventName: event.name)
/// ```
struct EventQRView: View {

    let eventId: String
    let eventName: String

    // MARK: - Derived state

    private var qrImage: UIImage? {
        QRService.generateEventQRCode(for: eventId)
    }

    private var payloadText: String {
        guard QRService.isValidEventId(eventId) else { return "—" }
        return "beacon://event/\(eventId.trimmingCharacters(in: .whitespacesAndNewlines))"
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 20) {
            Text("Scan to Join")
                .font(.title2.bold())
                .foregroundStyle(.primary)

            qrCodeBox

            Text(eventName.isEmpty ? "Event" : eventName)
                .font(.headline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.primary)
                .padding(.horizontal)

#if DEBUG
            Text(payloadText)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
#endif
        }
        .padding()
    }

    // MARK: - Subviews

    @ViewBuilder
    private var qrCodeBox: some View {
        if let image = qrImage {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 260, maxHeight: 260)
                .padding(16)
                .background(Color.white)
                .cornerRadius(12)
                .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 2)
        } else {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.systemGray5))
                .frame(width: 260, height: 260)
                .overlay(
                    VStack(spacing: 8) {
                        Image(systemName: "qrcode")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("QR unavailable")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                )
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Valid event") {
    EventQRView(
        eventId: "550e8400-e29b-41d4-a716-446655440000",
        eventName: "CharlestonHacks Show & Tell"
    )
}

#Preview("Empty eventId — fallback UI") {
    EventQRView(eventId: "", eventName: "Demo Event")
}
#endif
