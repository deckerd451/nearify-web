# Relationship ownership across Nearify and BUILDSPACE

Nearify owns event encounters, saves, relationship memory, follow-up, messaging
approval, and directional contact disclosure. BUILDSPACE owns collaboration
profiles, projects, organizations, opportunities, and professional context.

The full proposed contract, state map, legacy ingestion exception, duplication
inventory, and consolidation rollout live in one place:
[BUILDSPACE relationship ownership](https://github.com/deckerd451/innovation-engine/blob/main/docs/RELATIONSHIP_OWNERSHIP.md).
Review the companion BUILDSPACE change before relying on that link on main.

Important distinctions in this repository:

- `relationships.status = confirmed` means mutual saving, not messaging approval.
- `connectionState.CONNECTED` renders that mutual-save state; never use it to
  authorize messaging or reveal contact details.
- `web_can_message` and the connection-permission RPCs own messaging decisions.
- `contact_disclosures` and their RPCs own separately revocable contact sharing.
- A Nearify profile UUID is not a BUILDSPACE community UUID or auth user UUID.
- A one-sided QR save must not be exported as legacy `qr_confirmed` evidence
  that automatically creates an accepted BUILDSPACE connection.

No Nearify ranking, relationship, or permission behavior changes are required
for the first consolidation: the identical professional-context arithmetic is
shared inside BUILDSPACE, while event eligibility stays owned by each surface.
