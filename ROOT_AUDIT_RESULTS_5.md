# SOSphere — Root Audit Results, Wave 5 (LINE-BY-LINE deep reads)

**Audit date:** 2026-05-22
**Trigger:** User refused pattern-scanning; demanded actual line-by-line read of every large/critical file.
**Method:** 6 dedicated subagents (B1-B6), each owning a batch of 4-8 files, with mandate to open and read EVERY line — not grep.

---

## Coverage — files actually line-read

| Batch | Files | LOC | New defects |
|---|---|---:|---:|
| **B1** | sos-emergency.tsx + company-dashboard.tsx + dashboard-pages.tsx + guided-response.tsx | ~13,000 | **53** |
| **B2** | ai-co-admin.tsx + mobile-app.tsx + shared-store.ts + sos-server-trigger.ts | ~8,800 | **91** |
| **B3** | dashboard-broadcast + investigation + settings + roles + workforce + shift-scheduling | ~6,000 | **70** |
| **B4** | emergency-contacts + manage-emergency + family-circle + buddy-system + safe-walk + checkin + emergency-packet + emergency-services | ~7,000 | **88** |
| **B5** | evidence-store + evidence-vault-service + hub-incident-reports + incident-history + incident-photo-report + landing-page + intelligent-guide | ~6,000 | **60** |
| **B6** | risk-map-live + safety-intelligence + voice-provider-twilio + medical-id + mission-control + mission-tracker-mobile + journey-management + multiplayer-drill | ~5,500 | **96** |
| **TOTAL** | **37 of the largest files** | **~46,000 lines** | **458 new defects** |

**Grand Total (Waves 1-5):** 53 + 450 + 333 + 247 + 458 = **1,541 distinct root-level defects**.

---

## Critical findings discovered ONLY via line-by-line read (invisible to pattern scans)

These are bugs that pattern scans **would have missed** because they involve logical correctness, state machines, undeclared identifiers, and code paths — not text patterns.

### Runtime crashes (referenced-but-undeclared identifiers)
| R# | File:line | Issue |
|---|---|---|
| **R-236** | `sos-emergency.tsx:3123, 3177` | `batteryLevelRef.current` referenced but **never declared** → ReferenceError when low-battery modal renders during active SOS |
| **R-237** | `sos-server-trigger.ts:1262, 1266` | `authSubscription` referenced but **never declared** → ReferenceError on `startSOSReplayWatcher` |
| **R-238** | `dashboard-shift-scheduling-page.tsx:142` | `useEffect` used but **not imported** → component crashes on first render |
| **R-239** | `buddy-system.tsx:110` | `useDashboardStore` used but **not imported** → build-time ReferenceError |
| **R-240** | `dashboard-settings-page.tsx:815` | `ownerName` referenced but **never declared** in scope |

### Life-safety lies (UI claims success without action)
| R# | File:line | Issue |
|---|---|---|
| **R-241** | `emergency-services.tsx:181-184` | **`handleDial` does NOT actually dial** — `setTimeout(setDialingNumber(null), 2000)` is the entire function. Worker taps "911" thinking they're calling; 2 seconds of "Connecting..." then dismissal. NO `tel:`, NO Capacitor call plugin. |
| **R-242** | `sos-emergency.tsx:2199-2200` | `handleImSafe` calls `doEnd()` directly, **bypassing duress-PIN check** that `handleEndSOS` enforces. A coercer forces the worker to tap "I'm Safe" → SOS ends without PIN. The exact threat duress PIN was designed to prevent. |
| **R-243** | `checkin-timer.tsx:387-404` | Auto-extend on missed warning **silently bypasses worker-down detection** by up to 50 minutes. A worker who falls unconscious after the warning has their SOS suppressed. |
| **R-244** | `safe-walk-mode.tsx:203-212` | Simulated random stops fire in **production** (not gated by NODE_ENV) — triggers false SOS escalations. |
| **R-245** | `safe-walk-mode.tsx:944, 968-984` | Stop-detection "Emergency contacts notified" message — `onSOSTrigger` **never invoked**. Pure UI without backend. |
| **R-246** | `mission-tracker-mobile.tsx:240-246` | Pre-flight check is **pure timeout theatre** — 500ms "GPS ok", 1000ms "Battery ok", 1500ms "Storage ok". Nothing checked. Mission starts with dead battery/GPS off thinking all verified. |
| **R-247** | `mission-tracker-mobile.tsx:159-167` | GPS error fallback writes `target.lat/lng` as actual position — admin sees worker "arrived at destination" when GPS is off. **GPS spoofing surface.** |
| **R-248** | `dashboard-pages.tsx:1304-1308` | "Calling 997 Emergency Services" toast fires; the actual call code is **commented out**. (Confirms R-215.) |
| **R-249** | `incident-photo-report.tsx:248-265` | `handleSubmit` is a 1.8-second `setTimeout`. Fire-and-forget `onSubmitReport`. "Report Sent!" shows regardless of server result. |
| **R-250** | `incident-photo-report.tsx:956-962` | `AdminBroadcastPanel.handleBroadcast` — same 1.5-second sleep + toast.success lie. |

### State machine + closure bugs
| R# | File:line | Issue |
|---|---|---|
| **R-251** | `dashboard-broadcast.tsx:913-925` | `setInterval` 3s polling **never pauses on tab-hidden**, accumulates escalationCount forever |
| **R-252** | `intelligent-guide.tsx:598-600` | `addLog` `useCallback` deps `[elapsed]` → recreated every second → auto-execute timers cancel each other → multi-action phases never complete |
| **R-253** | `intelligent-guide.tsx:649-692` | Auto-execute effect's `phaseActions` dep re-triggers entire phase on every action update → N-1 actions stuck `executing: true` forever |
| **R-254** | `intelligent-guide.tsx:580-581` | Comment admits "intentional partial deps" — stale `responseScore`/`completedPhases` on phase advance → duplicate IRE writes |
| **R-255** | `evidence-store.ts:217-222` | `saveVault` clobbers vault on every write — **race condition** (no lock). Compare to vault-service which fixed this. |
| **R-256** | `dashboard-incident-investigation.tsx:711-727` | `storage` event listener only fires for **other tabs** — same-tab investigations never appear until refresh |
| **R-257** | `checkin-timer.tsx (cancel during trigger race)` | `cancelTimer` clears state but `setTimeout(() => onSOSTrigger(), 1500)` was already queued → SOS fires after cancellation |
| **R-258** | `risk-map-live.tsx:255-288` | Marker effect deps `[selectedWorker, onSelectWorker]` but reads `getLiveWorkerPositions()` — newly added employees never appear |
| **R-259** | `risk-map-live.tsx:255-288` | Markers never removed when employees disappear → memory leak + ghost markers |
| **R-260** | `voice-provider-twilio.ts:173, 274` | `_device?.destroy()` and `_activeCall?.disconnect()` **commented out** → Twilio billing meter never stopped |

### Authentication / authorization bypass
| R# | File:line | Issue |
|---|---|---|
| **R-261** | `dashboard-roles-page.tsx:227-230` | `actorLevel` hardcodes `currentActor` as `members.find(m => m.isOwner) || members[0]` — **anyone loading the page is treated as Owner**. Complete auth bypass for role management. |
| **R-262** | `dashboard-roles-page.tsx:301-315` | `handleApprovePending` — no PIN gate. Main Admin can elevate user to `company_admin` (full perms) without 2FA. |
| **R-263** | `dashboard-roles-page.tsx:317-321` | `handleRejectPending` — no PIN. Anyone can mass-reject pending users → lockout. |
| **R-264** | `dashboard-roles-page.tsx:622-628` | Member delete button — no PIN, no confirmation. One-click removal of any non-owner. |
| **R-265** | `dashboard-settings-page.tsx:78-123` | `saveAllSettings` keys Supabase row only on `companyName` (or "default") — **cross-tenant write**. Two companies named "Acme" overwrite each other. |
| **R-266** | `dashboard-roles-page.tsx:232-242` | `requirePIN` opens modal asynchronously; user can change `editingPerms` between PIN-request and PIN-verify → **permission escalation** with the new (modified) perms. |
| **R-267** | `intelligent-guide.tsx:1518-1737` | PDF download button — no tier gate. Any user (free/basic/elite) downloads full IRE PDF with admin tier badge. |
| **R-268** | `dashboard-incident-investigation.tsx:482-493` | Field Evidence linking has no PIN/2FA — bypasses chain-of-custody. |

### Cross-tenant localStorage leaks (no companyId/userId namespace)
| R# | File:line | Issue |
|---|---|---|
| **R-269** | `evidence-store.ts:119` | `sosphere_evidence_vault` — single key across all tenants |
| **R-270** | `medical-id.tsx:13` | `sosphere_medical_id` — PHI cross-leak between users on same device |
| **R-271** | `manage-emergency-contacts.tsx:36` | `sosphere_emergency_contacts` — same key across users |
| **R-272** | `checkin-timer.tsx:17-19` | Three checkin keys global; user B inherits user A's running timer → SOS fires for user B |
| **R-273** | `dashboard-shift-scheduling-page.tsx:144` | `sosphere_shifts` — no namespace |
| **R-274** | `dashboard-incident-investigation.tsx:615-640` | `sosphere_investigations` — no namespace |
| **R-275** | `safety-intelligence.tsx:365-366` | `sosphere_audit_log` + `sosphere_risks` — no namespace |
| **R-276** | `journey-management.tsx:118, 172` | `sosphere_journeys` — no namespace |

### Forensic integrity broken
| R# | File:line | Issue |
|---|---|---|
| **R-277** | `evidence-store.ts:128-143` | `getPublicUrl()` — every uploaded photo of injured worker, chemical spill, etc. is **publicly readable** by anyone with URL. No signed URLs, no expiry, no access check. |
| **R-278** | `evidence-vault-service.ts:223-234` | Integrity hash **excludes `gpsTrail` mutations** after creation — `getLiveTrail()` returns array by reference, vault's gpsTrail mutates by reference, hash becomes non-reproducible |
| **R-279** | `evidence-vault-service.ts:251-254` | `maskPhone` masks `+`, `(`, `)`, spaces — same contact captured with different formatting hashes differently |
| **R-280** | `evidence-vault-service.ts:381-396` | `generateShareUrl` token isn't registered server-side — anyone who knows `vault_id` can guess link format |
| **R-281** | `evidence-store.ts:723-834` | `seedMockEvidence` injects 3 fake critical incidents ("Mohammed Ali / scaffolding", etc.) per-browser-install → fake forensic evidence appears in every company's compliance PDFs |
| **R-282** | `hub-incident-reports.tsx:77-80, 96-98` | Unsplash CDN URLs as photoUrls in MOCK_REPORTS — render as "Evidence" in investigator drawer |
| **R-283** | `intelligent-guide.tsx:1527` | `safe()` strips non-ASCII → Arabic employee names render as blanks in court-usable PDF |
| **R-284** | `intelligent-guide.tsx:1528-1574` | PDF verification hash uses `Date.now()` — Monday's PDF and Tuesday's regen of same incident have DIFFERENT hashes |

### Hardcoded fake data rendered as live
| R# | File:line | Issue |
|---|---|---|
| **R-285** | `dashboard-pages.tsx:1334-1340` | `MEDICAL_DATA` HARDCODED for **every** employee detail view (A+, Penicillin/Latex allergic, diabetic) → medic acts on fictional data |
| **R-286** | `dashboard-pages.tsx:1341-1345` | `CONTACTS` HARDCODED for every employee (Mona Al-Khalil, Samir, Dr Tariq, fake +966 numbers) → admin calls junk numbers in real emergency |
| **R-287** | `dashboard-pages.tsx:1927-2017` | `RICH_EMERGENCIES` seeds 7 hardcoded fake critical emergencies (chemical spills, fire alarms) on fresh install — no delete |
| **R-288** | `dashboard-pages.tsx:3105-3110` | `IncidentHistoryPage` shows hardcoded mock INC-2026-031 etc. ALWAYS — fresh empty install shows fake critical fall/fire/SOS |
| **R-289** | `dashboard-workforce-page.tsx:123-130` | `baseEmployees` randomizes `lastCheckin`/`nextDue` **on every render** → "Due Soon" status flips chaotically |
| **R-290** | `dashboard-workforce-page.tsx:145` | `if (minutesTilDue <= 10 && minutesTilDue > 0)` — overdue workers (`< 0`) fall to "OK" status. **Critical false-negative.** |
| **R-291** | `family-circle.tsx:39-46` | `loadRealMembers` returns hardcoded `online: false, safetyStatus: "unknown", battery: 0` — stats grid always shows 0/N |
| **R-292** | `family-circle.tsx:125-128` | `handleCheckAll` does nothing — pure animation + "Safety check sent to N members" toast |
| **R-293** | `safe-walk-mode.tsx:140` | `setDistanceWalked(d => d + Math.random() * 3 + 1)` — fake meters rendered as real GPS distance |
| **R-294** | `safety-intelligence.tsx:639` | "47" AI Interventions hardcoded — same for all KPI tiles |
| **R-295** | `risk-map-live.tsx:66-85` | `generateWeather(seed)` purely synthetic `Math.sin` — "Heat Stress Warning" fires randomly |
| **R-296** | `mission-control.tsx:487-494, 496-507` | EMPLOYEES_LIST + LOCATIONS hardcoded — created missions assigned to fabricated workers |
| **R-297** | `journey-management.tsx:158-159` | If Supabase returns empty, `upsertJourneyBatch(MOCK_JOURNEYS)` **writes fake "Ahmed Khalil" journeys to authoritative customer database** |

### Cleanup / memory leak
| R# | File:line | Issue |
|---|---|---|
| **R-298** | `mission-tracker-mobile.tsx:142-197` | GPS `watchPosition` started but `_watchId` is **never stored where cleanup can read it** → GPS watch fires forever after mission ends. Hard battery leak. |
| **R-299** | `incident-photo-report.tsx:128-221` | `audioPlayerRef` + `MediaRecorder` never cleaned up on unmount — microphone stream stays open |
| **R-300** | `sos-emergency.tsx:2224, 2229` | `setTimeout(setState, 3000)` no cleanup on the life-safety screen |
| **R-301** | `hub-incident-reports.tsx:699-707` | 5s `setInterval` polling `getAllEvidence()` — parses 100 base64 photos every tick, no visibility gate |
| **R-302** | `multiplayer-drill.tsx:252-260` | Game timer cleanup only fires on `phase` change effect re-run — non-playing phase leaves prior interval running |

### Validation gaps
| R# | File:line | Issue |
|---|---|---|
| **R-303** | `emergency-contacts.tsx:761` | Phone validation accepts dial code alone (`+966`) when local number stripped to empty by regex |
| **R-304** | `sos-emergency.tsx:1356-1371` | `handleQuickSetupSave` validates `quickName.trim() && quickPhone.trim()` but no phone format check — `directCall("1")` from raw "1" garbage |
| **R-305** | `emergency-packet.tsx:37-40` | `readReal` JSON-parses arbitrary localStorage with no schema validation — `medications` as string crashes render |
| **R-306** | `incident-photo-report.tsx:247-265` | Worker can submit with 0 photos, no audio, no comment, no incident type — content-free report reaches admin |
| **R-307** | `mission-control.tsx:515-519` | `startTime` allows past date — mission created with `scheduledStart < Date.now()`, never triggers |
| **R-308** | `medical-id.tsx:500-506` | Notes textarea has no `maxLength` — 50MB paste hits storage quota |

### Modal traps + no-exit emergencies
| R# | File:line | Issue |
|---|---|---|
| **R-309** | `emergency-services.tsx:467-501` | "Calling" overlay covers screen for 2s with no Cancel — user trapped during fake call |
| **R-310** | `manage-emergency-contacts.tsx:137-152` | Sheet `maxHeight: 85vh` (not dvh) — Save button hidden behind iOS keyboard |
| **R-311** | `mission-control.tsx:561` | Modal backdrop closes without confirming unsaved form |
| **R-312** | `intelligent-guide.tsx:863-866` | X button calls `onClose()` directly — accidentally closes IRE in-flight, score lost |
| **R-313** | `multiplayer-drill.tsx:405-424` | No exit button during `countdown` phase — locked 3 seconds |

### Toast.success lies (action no-op or no server confirmation)
Beyond the life-safety lies above:
- **R-314** `dashboard-pages.tsx:2566-2567` — Broadcast/Escalate buttons toast-only
- **R-315** `family-circle.tsx:130-133` — `handleCopyInvite` doesn't actually copy to clipboard
- **R-316** `family-circle.tsx:387-405` — Call/Message/Request Check-in buttons no `onClick`
- **R-317** `buddy-system.tsx:280` — `handleLocateBuddy` logs only, no GPS lookup; toast claims "GPS shown on map"
- **R-318** `buddy-system.tsx:257-261` — `handleCallBuddy` no `tel:` invocation
- **R-319** `buddy-system.tsx:471` — Auto-Assign button is toast-only
- **R-320** `safety-intelligence.tsx:495-513` — `handleSendAlert/Locate/Contact` toast.success lies
- **R-321** `journey-management.tsx:386, 392` — Call Driver / Track Live buttons toast-only
- **R-322** `emergency-packet.tsx:142-145, 783-806` — Copy + Share Sheet buttons no real action
- **R-323** `dashboard-broadcast.tsx:1115` — `onCancel` wired but UI button doesn't call it
- **R-324** `dashboard-broadcast.tsx:108-109, 601-602` — Hardcoded `senderName: "Admin"` regardless of actual admin
- **R-325** `dashboard-settings-page.tsx:154-165` — All `renderRow` handlers fire toast without opening editors
- **R-326** `dashboard-roles-page.tsx:1399-1400` — "Create Role" button just calls `onBack()`, no save
- **R-327** `dashboard-roles-page.tsx:21` — `saveUserPermissions`, `sendInvitation`, `getPendingInvitations` imported but never called — entire role/invite infrastructure is dead code
- **R-328** `evidence-services.tsx:181-184` — already R-241
- **R-329** `medical-id.tsx:540-565` — Share clipboard write may fail silently; toast claims success
- **R-330** `landing-page.tsx:139` — "Sign In" navigates to `/dashboard` with no auth check

---

## Files still requiring line-read (Wave 6 candidates)

~100 smaller component files (typically 100-800 lines) were pattern-scanned in Wave 4 but not yet line-read in Wave 5. Examples:

- `admin-incoming-call.tsx`, `admin-hints.tsx`, `batch-email-scheduler.tsx`, `broadcast-island.tsx`, `call-panel.tsx`, `certification-system.tsx`, `command-center.tsx`, `company-join.tsx`, `company-register.tsx`, `compliance-dashboard-v2.tsx`, `compliance-reports.tsx`, `consent-screens.tsx`, `country-picker.tsx`, `csv-field-guide.tsx`, `dashboard-analytics-page.tsx`, `dashboard-audit-log-page.tsx`, `dashboard-billing-page.tsx`, `dashboard-comms-hub.tsx`, `dashboard-employee-detail.tsx`, `dashboard-evacuation-page.tsx`, `dashboard-geofencing-page.tsx`, `dashboard-gps-compliance.tsx`, `dashboard-i18n.tsx`, `dashboard-jobs-page.tsx`, `dashboard-leaderboard-page.tsx`, `dashboard-location-page.tsx`, `dashboard-notifications-panel.tsx`, `dashboard-offline-page.tsx`, `dashboard-pipeline-health-page.tsx`, `dashboard-pricing-page.tsx`, `dashboard-risk-register.tsx`, `dashboard-sar-page.tsx`, `dashboard-web-page.tsx`, `dashboard.tsx`, `deep-link-handlers.tsx`, `design-system.tsx`, `diagnostic-stress-test-v2.tsx`, `discreet-sos-screen.tsx`, `dpa-page.tsx`, `dpa-settings-section.tsx`, `emergency-chat.tsx`, `emergency-lifecycle-report.tsx`, `emergency-playbook.tsx`, `emergency-response-record.tsx`, `emergency-watchdog.tsx`, `employee-invite-manager.tsx`, `employee-quick-setup.tsx`, `employee-welcome.tsx`, `employees-unified-page.tsx`, `enterprise-import-wizard.tsx`, `error-boundary.tsx`, `evacuation-screen.tsx`, `evidence-pipeline-panel.tsx`, `fall-detection.tsx`, `global-quick-actions.tsx`, `global-search.tsx`, `hazard-banner.tsx`, `individual-home.tsx`, `individual-pdf-report.tsx`, `individual-register.tsx`, `live-billing-panel.tsx`, `login-phone.tsx`, `login-welcome.tsx`, `map-screen.tsx`, `medical-alert-banner.tsx`, `mfa-challenge-modal.tsx`, `mfa-enrollment-modal.tsx`, `monitoring-mode-banner.tsx`, `native-safe-area-v2.tsx`, `neighbor-alert-overlay.tsx`, `neighbor-responses-panel.tsx`, `not-found-page.tsx`, `notification-permission-banner.tsx`, `notifications-center.tsx`, `offline-sync.tsx`, `onboarding-select.tsx`, `otp-verify.tsx`, `pdf-email-modal.tsx`, `pdf-password-modal.tsx`, `pending-approval.tsx`, `pin-verify-modal.tsx`, `plan-gate.tsx`, `post-emergency-debrief.tsx`, `pre-shift-checklist.tsx`, `privacy-page.tsx`, `profile-settings.tsx`, `push-notifications.tsx`, `recording-consent-modal.tsx`, `role-select.tsx`, `route-layout.tsx`, `rrp-analytics-page.tsx`, `safety-gamification.tsx`, `security-pin-modal.tsx`, `settings-screens.tsx`, `shake-to-sos.tsx`, `shift-handover-modal.tsx`, `sos-emergency-popup.tsx`, `subscription-plans.tsx`, `tenant-banner.tsx`, `terms-page.tsx`, `training-center.tsx`, `trial-banner-live.tsx`, `trial-card.tsx`, `unified-emergency-engine.tsx`, `use-session-timeout.tsx`, `view-transitions.tsx`, `weather-alerts.tsx`, `welcome-activation.tsx`, `welcome-onboarding.tsx`, `wow-demo.tsx`

Plus all `ui/*.tsx` shadcn components (~50 files), some `.ts` files not in B2.

---

## Phase Plan (revised, post-Wave-5)

The 102-ticket Phase 0 STOP-SHIP list now expands to include R-236 → R-330 (95 more). Total Phase 0: **~200 critical tickets**.

Total remediation backlog: **1,541 defects** across 32 dimensions + line-by-line of 37 largest files.

Critical-path estimate (revised):
- **Phase 0 STOP-SHIP**: 6-7 weeks (1 eng) / **3 weeks (3 engs)**
- **All phases**: ~20 weeks / **~9 weeks with 3 engs**

---

## Files

- `ROOT_AUDIT_RESULTS.md` — Wave 1 (A-F, 53 defects)
- `ROOT_AUDIT_RESULTS_2.md` — Wave 2 (G-Q, 450 defects)
- `ROOT_AUDIT_RESULTS_3.md` — Wave 3 (R-Z, 333 defects)
- `ROOT_AUDIT_RESULTS_4.md` — Wave 4 file-by-file inventory (247 defects)
- `ROOT_AUDIT_RESULTS_5.md` — Wave 5 line-by-line of largest 37 files (458 defects) — this file
- `POST_LAUNCH_AUDIT.md` — master ticket plan

**Total known static defects: 1,541** across 32+ audit dimensions + the 37 largest/most critical files line-read.
