// ═══════════════════════════════════════════════════════════════
// SOSphere — Pre-Shift Checklist Templates (shared source of truth)
// ─────────────────────────────────────────────────────────────
// These templates are used by BOTH the worker's mobile completion screen and
// the admin dashboard, so a submission's item ids (C1, H3, …) always resolve
// to the same item text/category on both sides. They are app-defined for now
// (not yet owner-editable) — that's an honest v1 scope: the CHECKLISTS are
// real and consistent; per-company template editing comes later.
// ═══════════════════════════════════════════════════════════════

export type ChecklistCategory =
  | "ppe" | "equipment" | "environment" | "communication" | "medical";

export interface ChecklistItem {
  id: string;
  text: string;
  category: ChecklistCategory;
  required: boolean;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  zone?: string;
  role?: string;
  items: ChecklistItem[];
  isDefault: boolean;
}

// Plain (icon-free) category metadata so this module stays UI-agnostic.
// Each consumer maps these to its own icon set.
export const CATEGORY_META: Record<ChecklistCategory, { label: string; color: string }> = {
  ppe:           { label: "PPE & Gear",    color: "#00C8E0" },
  equipment:     { label: "Equipment",     color: "#FF9500" },
  environment:   { label: "Environment",   color: "#00C853" },
  communication: { label: "Communication", color: "#8B5CF6" },
  medical:       { label: "Medical",       color: "#FF2D55" },
};

export const DEFAULT_CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    id: "TPL-001", name: "General Field Safety", isDefault: true,
    items: [
      { id: "C1",  text: "Wearing hard hat / safety helmet",       category: "ppe",           required: true },
      { id: "C2",  text: "High-visibility vest is on",             category: "ppe",           required: true },
      { id: "C3",  text: "Steel-toe boots are worn",               category: "ppe",           required: true },
      { id: "C4",  text: "Safety glasses / goggles ready",         category: "ppe",           required: false },
      { id: "C5",  text: "Radio / phone is charged and working",   category: "communication", required: true },
      { id: "C6",  text: "Buddy pair confirmed for the shift",     category: "communication", required: false },
      { id: "C7",  text: "Fire extinguisher location noted",       category: "environment",   required: true },
      { id: "C8",  text: "Evacuation route reviewed",              category: "environment",   required: true },
      { id: "C9",  text: "Equipment pre-use inspection done",      category: "equipment",     required: true },
      { id: "C10", text: "First aid kit location known",           category: "medical",       required: true },
      { id: "C11", text: "No open wounds or untreated injuries",   category: "medical",       required: false },
      { id: "C12", text: "Weather conditions are safe to work",    category: "environment",   required: true },
    ],
  },
  {
    id: "TPL-002", name: "High-Risk Zone Safety", zone: "Zone D", isDefault: false,
    items: [
      { id: "H1", text: "Gas detector is calibrated and active",  category: "equipment",     required: true },
      { id: "H2", text: "Respiratory protection (mask/respirator)",category: "ppe",           required: true },
      { id: "H3", text: "Chemical-resistant gloves worn",          category: "ppe",           required: true },
      { id: "H4", text: "Spill containment equipment verified",    category: "equipment",     required: true },
      { id: "H5", text: "Emergency shower location confirmed",     category: "environment",   required: true },
      { id: "H6", text: "Supervisor briefing completed",           category: "communication", required: true },
      { id: "H7", text: "SOS app is active and connected",         category: "communication", required: true },
      { id: "H8", text: "Fall protection harness inspected",       category: "ppe",           required: true },
    ],
  },
];

export function getChecklistTemplateById(id: string): ChecklistTemplate | undefined {
  return DEFAULT_CHECKLIST_TEMPLATES.find(t => t.id === id);
}

/** Required item ids for a template — used to decide isComplete honestly. */
export function requiredItemIds(tpl: ChecklistTemplate): string[] {
  return tpl.items.filter(i => i.required).map(i => i.id);
}
