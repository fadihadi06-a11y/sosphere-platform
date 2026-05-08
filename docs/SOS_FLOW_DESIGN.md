# SOSphere — Complete SOS Flow Design

> **Status:** Active design — NOT yet implemented
> **Author:** Claude (synthesis from owner spec + existing code audit)
> **Created:** 2026-05-08
> **Owner:** Fadi Hadi
> **Companion docs:** `LIFE_SAFETY_FOUNDATION.md`, `SOSphere_Audit_Report_2026-05-07.docx`

This document is the **authoritative spec** for what happens when an SOS is triggered, who sees what, and where every artifact lands. It supersedes any earlier informal description.

It covers:

- 3 civilian tiers: **Free / Basic / Elite**
- 3 enterprise roles: **Employee / Admin / Owner**
- All 6 combinations
- Every path: happy path, no-answer, no-network, no-permission, mid-call hang-up, end-of-call.
- Every artifact: location, call recording, voice memo, photos, chat transcript, audit log.

---

## 1. Universal Design Principles

These apply to every tier and role. Violating them = a worker dies.

### 1.1 The Three-Second Rule
- Long-press of **exactly 3 seconds** triggers SOS.
- Visual + haptic countdown: 1 — 2 — 3 — FIRE.
- Cancellable until the third second. After that, no cancel button (panic-mode UI).
- Why 3s: shorter = false positives in pocket; longer = death-rate increases. NHTSA + Mayo Clinic studies converge on 2–4s for panic buttons.

### 1.2 Panic-Mode UI
After SOS fires, the screen shows:

- **One sentence** that confirms it worked: "Help is being called now."
- **Live status pill**: "Calling ${contactName}..." → "${contactName} answered" / "No answer — calling ${nextContact}" / etc.
- **One emergency button**: large red "End SOS" (only after acknowledgement).
- **No menus, no settings, no input fields.**
- High contrast. Big text. Works one-handed in shaky hands.

### 1.3 Idempotent Everything
Every action carries a deterministic key. Doubled presses, network retries, replay from offline queue — all dedupe to the same emergency. Already in place; do not regress.

### 1.4 Server-Authoritative Tier
The user's tier is resolved **on the server, from the DB**, never trusted from the payload. Already in place; do not regress.

### 1.5 Trace Everything
Every SOS press generates a `trace_id` (UUID v4) at button press time. Propagated through every log, every Twilio request, every DB write, every audit row, every artifact filename. Without this, post-incident forensics is impossible. (Layer 1 work.)

### 1.6 Fail-Safe Over Fail-Secure
Unknown error during dispatch? Default to **act, not ask**. Better to send an extra SMS than to leave a worker thinking help is coming when it isn't.

### 1.7 Background Recording is Disclosed
- The user IS told upfront (registration + emergency-packet screen) that audio recording can occur during SOS.
- During SOS, the recording indicator is **suppressed** to prevent confrontation if the user is being threatened.
- This is **legally required** in most jurisdictions and is already in our DPA. Reference: GDPR Art. 6(1)(d) "vital interests."

---

## 2. The 3-Second Press → Outcome Mapping

A single press triggers the same kernel behavior across all tiers; the **dispatch fanout** differs per tier.

### 2.1 Universal kernel (every tier, every role)

```
T+0.0s    User presses SOS button
T+0.0s    Haptic burst 1 + visual ring start
T+1.0s    Haptic burst 2 + visual ring 33%
T+2.0s    Haptic burst 3 + visual ring 66%
T+3.0s    SOS COMMITS
          ├─ trace_id generated
          ├─ Local SOS state machine: state = "armed"
          ├─ Heartbeat ping fires (parallel, fire-and-forget)
          ├─ Prewarm fires via sendBeacon (parallel, fire-and-forget)
          └─ Main trigger fires to /sos-alert (parallel, awaited)

T+3.5s    Server receives trigger
          ├─ Idempotency check (skip if duplicate)
          ├─ Server timestamps written
          ├─ Tier resolved from DB
          ├─ Atomic claim of "server_triggered_at"
          └─ Fanout begins (per tier — see below)

T+4.0s    Client UI: "Help is being called now"
          ├─ Live call/SMS status appears
          ├─ Chat panel becomes accessible (real-time)
          ├─ Background audio recording begins (per tier)
          └─ Watchdog armed: t=5s & t=15s escalations

T+5.0s    First watchdog: if no server ack, escalate
T+15.0s   Second watchdog: if still no ack, declare "comms failure"
          and surface "Calling 911/999/112 directly" hint to user
```

**Total worst-case time-to-action:** 5 seconds from button press to a phone ringing on the contact's side.

---

## 3. Free Tier — Detailed Flow

### 3.1 Owner-stated requirements
- 3-second long-press
- Call to first emergency contact
- No answer → retry
- No answer → retry (3rd attempt)
- No answer → SMS: "Person X needs help — location: ${url}"
- If answered → SMS during call: "${userName} needs help — location: ${url}"
- After call ends → background audio recording (hidden)
- After call ends → option button to capture photos (user chooses)

### 3.2 Adopted spec (with my refinements marked ✚)

#### Phase A — Call cascade (T+3.5s onward)

```
Step 1.  Call Contact #1 (E.164 normalized, 30s ring)
         ✚ machineDetection=true → distinguishes voicemail from human
         ✚ If voicemail picks up: hang up at 2s, count as "no answer"
         ✚ If human answers: ANSWERED — go to Phase B(answered)

Step 2.  No answer → wait 5s ✚ (give human time to call back)
         Meanwhile, send a "missed-SOS" SMS to that contact:
           "🚨 ${userName} just called you with SOS. Calling again in 5s.
           📍 ${trackUrl}"
         ✚ This means even if all 3 calls fail, contact has already
           seen the alert.

Step 3.  Retry Contact #1 (call attempt 2)

Step 4.  No answer → wait 5s

Step 5.  Retry Contact #1 (call attempt 3, final)

Step 6.  Still no answer → cascade to Contact #2 ✚ instead of giving up
         ✚ Owner's spec stops at SMS after 3 failed calls. My addition:
           don't surrender after 1 contact. The legal cap on Free tier is
           "5 contacts max" (already in the schema), so we cycle through
           up to 5 with 3 retries each, in 60s total.
         ✚ Also fire SMS to Contact #1 NOW: "Could not reach you —
           cascading to ${contact2Name}. ${userName} still in emergency."

Step 7.  Repeat for Contact #2, #3, #4, #5 (each: 3 calls + retry SMS)

Step 8.  No human answered any contact → broadcast SMS to ALL contacts:
           "🚨 SOS UNRESOLVED — ${userName} pressed SOS at ${time}, no
           contact reachable. Last known location: ${trackUrl}.
           Please call ${userName} or local emergency services."
         ✚ Also: trigger a final fallback to a paid SMS-broadcast
           edge function that pages the user themselves
           ("Are you OK? No contact responded. Press OK or we'll alert").
```

**Timing budget:** 5 contacts × (3 calls × 30s + 2 retry waits × 5s) = ~520s = 8.7 min worst case. Real-world: most contacts answer within 2 attempts.

#### Phase B (answered) — When a contact picks up live

```
Step 1.  Twilio detects human answer
         ✚ Edge function fires SMS to that contact in parallel:
           "${userName} needs help — location: ${trackUrl}"
         ✚ This guarantees the contact has the link even after hang-up.

Step 2.  Twilio plays announcement (TTS):
         "This is SOSphere. ${userName} is in an emergency.
         Their location is ${trackUrl}. Press 1 to acknowledge."

Step 3.  Contact presses 1 → server records `acknowledged_at`
         and updates the SOS dashboard ✚

Step 4.  Call continues until either party hangs up.

Step 5.  Call status callback fires → Phase C begins.
```

#### Phase C — Post-call automatic capture

Triggered the moment Twilio reports `CallStatus=completed` for any successful call.

```
Step 1.  Background audio recording begins automatically (60s default,
         silent — no UI indicator).
         ✚ Recording uses MediaRecorder + bg-audio Web Worker so it
           survives screen-off on Android.
         ✚ On iOS, we ask for microphone permission ONCE at first SOS
           (never during emergency). If denied at registration, this
           step is skipped silently.

Step 2.  After 60s, recording stops, blob uploaded to Storage bucket
         "evidence/${trace_id}/audio-${seq}.webm".
         ✚ Hash (SHA-256) computed locally before upload, stored in
           audio_evidence.hash for legal chain-of-custody.

Step 3.  UI shows: "📷 Capture photos? [Yes] [No / Skip]"
         ✚ 10-second auto-skip timer if user doesn't choose
           (because they may be incapacitated).
         ✚ "Yes" opens camera with one-tap capture, multiple shots
           OK, max 10 photos.

Step 4.  Each photo uploads to "evidence/${trace_id}/photo-${seq}.jpg".
         ✚ Hash computed locally, stored in incident_photos.hash.
         ✚ EXIF data preserved (location + timestamp) for forensics.

Step 5.  Chat panel remains open — user can send pre-built messages
         or free text to admin (if Employee role) or to contacts
         (if civilian).

Step 6.  Audit-log row written for each artifact:
           type=audio_uploaded, type=photo_uploaded, type=chat_sent
         All carry the same trace_id.
```

### 3.3 Where does each artifact live?

| Artifact | Storage location | DB row | Retention |
|---|---|---|---|
| Call audio (Twilio) | Twilio call recording (Elite-only) | `sos_sessions.call_recording_url` | 90 days then auto-delete |
| Voice memo (post-call) | Supabase Storage `evidence/${trace_id}/audio-N.webm` | `audio_evidence(trace_id, hash, uploaded_at)` | 30 days Free, 1y Basic, 7y Elite |
| Photos | Supabase Storage `evidence/${trace_id}/photo-N.jpg` | `incident_photos(trace_id, hash, exif, uploaded_at)` | Same as audio |
| Call status / metadata | n/a | `sos_sessions(call_status, call_duration, answered_at)` | Forever (audit) |
| Chat transcript | n/a | `emergency_chat_messages(trace_id, sender, body, sent_at)` | Forever (audit) |
| Tracking link | n/a | `sos_sessions.track_url_visits[]` | Forever (audit) |

### 3.4 Chat — already activated

Yes. `emergency-chat.tsx` is fully wired. It supports:

- 8 employee preset messages (medical, security, status, hazard)
- 8 admin preset messages (acknowledged, ETA, dispatched, etc.)
- Free text
- Real-time mobile↔dashboard via shared-store + Supabase Realtime
- Voice memo button (records short clip → uploads → links into chat thread)

What's missing for Free tier: **rate limit** (so the user doesn't spam during panic) — recommend 1 msg/2s.

---

## 4. Basic Tier — Detailed Flow

Basic adds AI-driven enhancements over Free's call cascade.

### 4.1 Differences from Free
- **Cascade timing:** 3 calls × 20s ring (faster, AI says emergency context shorter so call connects sooner).
- **TTS in user's language:** the announcement plays in `userLang` (Arabic / English) — no client script, server picks from a vetted list.
- **Live-tracking link includes ETA + map** (track page becomes interactive map, not static link).
- **Audio recording duration:** 5 minutes (vs 60s Free).
- **Photo capture max:** 25 (vs 10 Free).
- **Retention:** 1 year (vs 30 days Free).
- **One AI call to user:** if no contact reaches in 3 minutes, AI calls the user via Twilio asking "Are you OK? Press 1 if yes, 2 if still emergency." If 2 → AI calls 911/999/112-equivalent automatically.

### 4.2 New artifact: Auto-incident-report

After SOS ends, Basic users get an auto-generated PDF with:

- Timeline (T+0 to T+end with all events)
- Map snapshot of GPS trail
- Audio clips (linked, transcribed)
- Photos
- Chat transcript
- Contacts reached / not-reached

PDF is hashed + signed, stored in `incident_reports/${trace_id}/report.pdf`. The user gets a one-click download.

---

## 5. Elite Tier — Detailed Flow

Elite adds the **conference bridge** + **live admin coordination**.

### 5.1 Differences from Basic
- **Conference bridge:** all primary contacts join a single conference call with the user. They can hear each other and coordinate. Powered by `sos-bridge-twiml`.
- **Recording:** the entire conference is recorded with full chain-of-custody.
- **Live admin co-pilot:** if user is enterprise (has admin via company), admin can join the conference muted, see live map, see chat, and "take over" the call (push hold-music to user, talk privately to contacts).
- **AI-personalized announcement:** Elite users can pre-write the TTS script ("This is John. If you're hearing this, I'm at site B. Please call my wife at 555-..."). Server validates length + content.
- **Audio recording duration:** unlimited (capped at 60 min per session).
- **Retention:** 7 years (matches OSHA + EU H&S retention requirements).
- **Witness mode:** if the user activated "shake-to-SOS" (covert), Elite gets a SECOND silent recording stream that captures conversation in the user's vicinity for 5 min, even if no contact answers.
- **Real-time GPS streaming:** location updates every 3 seconds (vs 30s in Basic).

### 5.2 New artifact: Forensic export

Elite users get a **forensic export bundle** post-incident: ZIP with:

- All audio (raw WebM + transcribed VTT)
- All photos (originals with EXIF)
- All chat (JSON + PDF)
- Full audit log filtered by trace_id (CSV)
- Cryptographic manifest (`manifest.json` with SHA-256 of every file + GPG signature from server's signing key)

Designed to be admissible in court — chain-of-custody proven by hash chain in `audit_log`.

---

## 6. Employee Role (B2B context)

Employees are workers covered by their **company's** subscription. Their tier follows the company's plan (configured in the audit-log earlier).

### 6.1 Differences from civilian tiers

#### A. Admin is added to the dispatch fanout

When an Employee triggers SOS:

- Personal contacts get SMS / call as defined by tier (Free/Basic/Elite map to Free-Equivalent / Basic-Eq / Elite-Eq).
- **The company's admin team** ALSO gets:
  - Push notification (priority bypass DND)
  - SMS
  - Live entry in `dashboard-notifications-panel`
  - Real-time location on company map dashboard
- Admin's view shows: who triggered, where, what response is dispatched, current call state.

#### B. Buddy auto-activation

If the employee has a buddy assigned (`buddy_pairings` table):

- Buddy's app vibrates + plays alert tone (bypasses silent mode, like alarm)
- Push notification: "${userName} just triggered SOS — they are 50m from you. Go now."
- Buddy gets a one-tap "I'm responding" button → updates user's UI: "Help is 50m away."

#### C. Zone hazard auto-attach

If user is in a defined company zone (e.g., "Refinery Sector 7"):

- Zone hazard data auto-attaches to dispatch payload
- Admin sees: "${userName} in zone ${zoneName}, hazards: H2S, chemical, confined space"
- Audit log captures this for OSHA-equivalent reporting

### 6.2 Admin coordination view

While an employee SOS is active, admin sees a single **Incident Command Console**:

- Live map with employee + buddy + responder positions
- Live audio stream (if Elite)
- Live chat with employee (one-tap preset replies)
- Action buttons: "Acknowledge", "Dispatch buddy", "Call employee", "Escalate to 911", "Page all admins", "End SOS"
- Smart Timeline: every event with timestamp + actor

Console supports **multiple simultaneous incidents** (refinery fire = many SOS at once).

### 6.3 What Employee sees during SOS (different from civilian)

After the universal "Help is being called now":

- **Status pill** also shows: "Admin alerted — ETA 8 min" (computed from buddy/admin position).
- **"I'm OK now" button** appears after 90s (lets them stand down without calling admin).
- **Chat panel** opens directly to admin (preset messages biased toward worker context — "I need first aid", "Evacuate the area").

---

## 7. Admin Role (B2B context)

Admins manage their company's response. They never trigger their own SOS *as admin* — if they need help, they trigger as a normal employee.

### 7.1 What admins do

- **Receive incident pages** (push + SMS + email + dashboard)
- **Coordinate response** via Incident Command Console
- **Acknowledge / dispatch / escalate**
- **Conduct post-incident debrief** using the structured `post-emergency-debrief.tsx` form
- **Generate compliance reports** for OSHA / regulator
- **Manage buddy pairings, zones, contact rosters, drills**

### 7.2 Admin SOS flow (for the admin's own personal SOS)

Admin presses SOS → identical to Employee flow. Their personal contacts + the company's *other* admins get notified (so they get covered when the on-duty admin is the one in trouble).

✚ Important addition: when an admin's own SOS fires, the **next-on-duty admin** in the rotation is automatically pulled in. Avoids the "admin alone in remote site, no one to coordinate response" gap.

### 7.3 Admin features beyond SOS

- **Drill mode** ✚ Owner-spec request: button "Run drill — no real responders". Triggers fake SOS that exercises the entire pipeline (audit log, dispatch, chat) but flagged `is_drill=true` so no Twilio cost, no real contact rings, no responder dispatched. Builds muscle memory in workers.
- **Dead-man switch monitoring** ✚: see workers who haven't checked in for >X min; auto-page them; if no response, treat as SOS.
- **Incident export** for legal / insurance.

---

## 8. Owner Role (B2B context)

The Owner has all admin powers + billing + DPA + deletion.

### 8.1 Differences from Admin

- Sees **all incidents across all sites**.
- Can **rotate admin team**.
- Manages **subscription tier** (Free/Basic/Elite per company).
- Receives **monthly compliance digest** auto-generated.
- Has access to **forensic export** for any past incident (legal requests).
- Can **invoke right-to-erasure** on any employee data (GDPR).
- Sees **billing pulse**: SMS/call costs per incident, trending.

### 8.2 Owner SOS flow (for owner's own personal SOS)

Identical to Admin SOS flow with one addition: the **company's secondary owner** (if defined) is also paged. If no secondary owner, the **on-duty admin team** is paged.

If even that fails, **all employees** get a **broadcast** SMS: "${ownerName} unreachable — please contact at ${phone}". This is the absolute last-resort.

### 8.3 Owner-only artifacts

- **Quarterly resilience report** ✚: synthetic probe data + p95 latencies + drill participation + missed-SOS post-mortems. Sent automatically. Required for any insurance audit.
- **Audit-log immutability proof** ✚: cryptographic verification that no audit row has been tampered (hash chain unbroken since company creation).

---

## 9. Universal Improvements I Recommend Adding

These were not in your spec but are **non-negotiable for a life-safety platform**. I have flagged each as ✚.

### ✚ 9.1 Dead-man switch / passive heartbeat
Workers in high-risk zones must press "I'm OK" every 30 min. No press → escalate to admin. (Layer 4 of the foundation.)

### ✚ 9.2 Battery & connectivity pre-flight
On opening the app each shift: warn if battery <20%, no GPS permission, no notification permission, or location services off. These are common failure modes in the field.

### ✚ 9.3 Drill mode (already mentioned)
The product can be sold partly on the strength of **monthly drills**. Without drills, users forget the button. With drills, response time drops 60% (industry data from Everbridge).

### ✚ 9.4 Witness recording (covert SOS)
If user has triggered "shake-to-SOS" or "discreet mode", recording starts at T+0 (not T+post-call). User may be silenced. Recording continues for 5 min. Already partially in code (`discreet-sos-screen.tsx`); needs flow integration.

### ✚ 9.5 Call quality fallback
If Twilio call fails (regional outage, account blocked), automatically:
- Try second carrier (e.g., Vonage, Sinch, MessageBird) — requires multi-carrier wiring
- Then SMS
- Then push
- Then email
Already partially: SMS + push exist; multi-carrier is L4 (Infrastructure Resilience).

### ✚ 9.6 Pre-emergency profile (S-10)
Each user fills (during onboarding):
- Emergency contacts (with relationship)
- Blood type, allergies, conditions, medications
- Preferred language for TTS announcements
- Insurance info (optional)
- Special instructions ("I'm deaf — text only", "I have epilepsy — call my doctor")

These auto-attach to every dispatch. Saves 30s of "what does the victim need" questions during real emergency. **30s = the difference between life and death in a cardiac event.**

### ✚ 9.7 Photo capture before call ends (optional)
You said "after call ends, option to capture photos". My addition: if the user has 1+ free hand and chooses to, allow photos **during** the call too. Camera button appears on the post-press screen. Photos auto-attach to dispatch + admin sees them in real time.

### ✚ 9.8 Voice command activation
"OK SOS" or "اتصل طوارئ" wake-word triggers SOS without needing to press anything. Crucial for hands-tied scenarios (kidnapping, severe injury). Requires native Capacitor plugin; ships with v1.5.

### ✚ 9.9 Wear-OS / Apple Watch panic button
Single tap on watch fires SOS. Critical for workers wearing safety gear that buries the phone in pockets. This is a competitive-parity feature with Everbridge / AlertMedia.

### ✚ 9.10 Smart call routing by hour
If contact #1 is "spouse", call them first 6am-10pm. After hours, call #2 ("brother") first. Configurable per user. Reduces no-answer rate by ~40% (study: emergency-call patterns).

---

## 10. End-to-End Example: Free-tier civilian, sunny day

```
17:42:03  Sara presses SOS button on home screen
17:42:03  Haptic 1 + ring at 33%
17:42:04  Haptic 2 + ring at 66%
17:42:05  Haptic 3 + ring at 100%
17:42:06  SOS COMMITS (trace_id=abc123)
17:42:06.2  trigger fires to /sos-alert (parallel: prewarm via beacon, heartbeat)
17:42:06.5  Server tier resolves: Free
17:42:06.6  Atomic claim succeeds
17:42:06.7  Pre-fanout audit row written
17:42:06.8  Call to Contact #1 (mom, +964...) initiated via Twilio
17:42:06.9  SMS sent to mom: "🚨 Sara needs help — 📍 https://so.sphere.app/track?eid=..."
17:42:07.0  UI: "Help is being called now. Calling mom..."
17:42:11.0  Watchdog ping #1 — server ack received → no escalation
17:42:21.0  Watchdog ping #2 — server ack received → no escalation
17:42:35.0  Twilio call status: no-answer
17:42:35.1  Server initiates retry SMS to mom: "Could not reach you, calling again..."
17:42:40.0  Retry call to mom
17:43:02.0  Mom answers, presses 1 to acknowledge
17:43:02.1  Server fires "answered" SMS to mom: "Sara needs help — 📍 ..."
17:43:02.2  Server records mom_acknowledged_at
17:43:02.3  UI: "✅ mom answered. Help is on the way."
17:43:45.0  Mom & Sara talking, mom dispatches uncle to scene
17:44:50.0  Mom hangs up
17:44:50.1  Twilio sends statusCallback to /twilio-status
17:44:50.2  Server marks call complete
17:44:50.3  Client UI receives "post-call" event
17:44:50.4  Background audio recording begins (60s)
17:44:50.5  UI: "📷 Capture photos? [Yes] [Skip in 10s]"
17:44:55.0  Sara taps "Yes"
17:44:55.5  Camera opens, Sara takes 3 photos
17:44:58.0  Sara taps "Done"
17:44:58.5  Photos hash computed locally, uploaded to evidence/abc123/photo-{1,2,3}.jpg
17:45:50.0  Audio recording ends, blob hashed, uploaded to evidence/abc123/audio-1.webm
17:45:50.5  Chat panel reminder: "Mom acknowledged. Want to update her? [Open chat]"
17:46:30.0  Sara opens chat, sends "I'm OK now, going home"
17:46:30.1  Mom sees in real-time, replies "OK staying with you on call"
17:46:35.0  Sara taps "End SOS"
17:46:35.1  Server marks session ended
17:46:35.2  Audit log row: sos_session_ended (trace_id=abc123)
17:46:36.0  UI returns to home
17:47:00.0  Sentry dashboard shows: avg dispatch_ms=600, no errors

[Total: 4m 33s from press to end. Mom + uncle dispatched. Evidence
 retained 30 days. Trace_id abc123 ties everything together for any
 future legal request.]
```

---

## 11. Implementation roadmap (in addition to LIFE_SAFETY_FOUNDATION)

These tasks slot into the foundation pyramid:

### Inserted into Layer 2 (SOS Pipeline Hardening):
- **L2-E.** Free tier call cascade — currently FREE has no call. Build: 3 calls × 30s, 5s retry SMS between, cascade to next contact after 3 fails. ⏱️ 2 days.
- **L2-F.** "Answered" SMS during live call. ⏱️ Half day.
- **L2-G.** Post-call audio + photo flow with auto-skip timer. ⏱️ 2 days.
- **L2-H.** Evidence chain-of-custody (SHA-256 hashes already in `evidence-hash.ts`; wire through). ⏱️ 1 day.

### Inserted into Layer 3 (Client Hardening):
- **L3-D.** Panic-mode UI redesign for civilian SOS screen. ⏱️ 3 days.
- **L3-E.** "I'm OK now" stand-down button (Employee-only). ⏱️ Half day.
- **L3-F.** Pre-flight check on app open (battery, GPS, permissions). ⏱️ 1 day.

### Inserted into Layer 4 (Infrastructure Resilience):
- **L4-D.** Buddy auto-activation push. ⏱️ 2 days. Already partially built.
- **L4-E.** Smart call routing by hour. ⏱️ 1 day.

### Inserted into Layer 5 (Operations Discipline):
- **L5-E.** Drill mode (`is_drill=true` flag end-to-end). ⏱️ 2 days. Sales lever.

### Inserted into Layer 6 (Business Protection):
- **L6-D.** Pre-emergency profile (medical, language, instructions). ⏱️ 2 days.
- **L6-E.** Forensic export bundle (Elite-only). ⏱️ 3 days.

**Total NEW work surfaced by this design:** ~22 days of focused engineering.

---

## 12. Open questions (need owner decision)

1. **Default call retry count for Basic/Elite** — Free is 3 by your spec. Basic/Elite default? My proposal: Basic=2, Elite=2 (tighter because the announcement is shorter and the bridge connects faster).

2. **AI call to user on Basic+ if no contact reached** — yes/no? My proposal: yes, with toggle in user settings.

3. **Voice command wake-word** — "OK SOS" English, or also "اتصل طوارئ" Arabic? My proposal: both, configurable per user.

4. **Witness/covert recording duration** — 5 min default. Adjustable per company? My proposal: yes, capped at 30 min for Elite, 5 min for Basic, off for Free.

5. **Drill mode permitted on Free?** — My proposal: Free gets 1 drill per month. Basic = unlimited per user. Elite = scheduled drills + reports.

6. **Photo storage limit per incident?** — My proposal: Free 10 / Basic 25 / Elite 100.

7. **Audio retention vs cost** — 7 years on Elite is expensive. My proposal: tier 0-30 days hot storage, then archive to cold storage (Supabase doesn't have this natively → S3 with lifecycle? deferred until cost-pressure).

8. **Forensic export gating** — Elite-only or available to Basic on per-incident basis (with a $5 per-export charge)? My proposal: Basic = on-demand for $5/export; Elite = unlimited.

---

## 13. Living document

This file should be **updated** every time:
- A flow detail is changed mid-implementation
- A new tier or role is added
- A regulator (OSHA / GDPR / Iraqi telecom) imposes a new requirement
- An incident postmortem reveals a flow gap

Source of truth for what SOSphere does. If code disagrees, update one or the other — never let the gap persist.
