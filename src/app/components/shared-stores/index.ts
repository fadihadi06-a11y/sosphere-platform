// ═══════════════════════════════════════════════════════════════
// SOSphere — Shared Stores public surface
// Import from "./shared-stores" anywhere in the app.
// ═══════════════════════════════════════════════════════════════

export {
  useContacts,
  useProfile,
  useMedical,
  isValidE164,
  normaliseE164,
  isValidBloodType,
  profileInitials,
  type UserProfile,
  type MedicalID,
  type ContactsActions,
  type ProfileActions,
  type MedicalActions,
  type AddContactInput,
} from "./civilian-store";

export { ContactEditSheet } from "./contact-edit-sheet";
export { AvatarEditSheet } from "./avatar-edit-sheet";

// Re-export commonly used contact types for convenience
export type { SafetyContact, ContactType, ContactPlan } from "../contact-tier-system";
