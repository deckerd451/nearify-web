import SwiftUI

/// A presentable sheet that shows the event QR for in-venue or in-app sharing.
///
/// Present this from any event detail or organizer screen:
/// ```swift
/// .sheet(isPresented: $showQR) {
///     EventJoinShareView(eventId: event.id, eventName: event.name)
/// }
/// ```
///
/// If an existing organizer event screen already has a sheet or navigation
/// push slot, drop `EventQRView` there directly instead.
struct EventJoinShareView: View {

    let eventId: String
    let eventName: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                EventQRView(eventId: eventId, eventName: eventName)
                    .padding(.top, 24)
            }
            .navigationTitle("Event QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    EventJoinShareView(
        eventId: "550e8400-e29b-41d4-a716-446655440000",
        eventName: "CharlestonHacks Show & Tell"
    )
}
#endif
