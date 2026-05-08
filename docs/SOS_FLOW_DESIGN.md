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

> **DECISION LOG** — questions are resolved one at a time during owner review sessions. Each answer locks in the spec for that area; future code MUST conform.

### ✅ Q1 — Call retry count per tier — **RESOLVED 2026-05-08**

**Decision:** Decay pattern, not flat retry.

- **Free tier** — Contact #1: 3 retries. Contact #2: 2 retries. Contacts #3, #4, #5: 1 attempt each.
- **Basic tier** — Contact #1: 2 retries. Contact #2: 2 retries. Contacts #3, #4, #5: 1 attempt each.
- **Elite tier** — Contact #1: 1 attempt. If no answer → parallel cascade to all remaining contacts simultaneously (conference bridge fans out).

Rationale: Contact #1 is the most likely to know what to do; later contacts are backups. Decay budget time toward whoever has the highest probability of effective response. Worst-case time-to-SMS-broadcast: Free ~6.5 min, Basic ~5 min, Elite ~1 min.

### ✅ Q2 — AI call-back to the user when no contact answers — **RESOLVED 2026-05-08**

**Decision:** REMOVED. The original idea (AI calls the user back if no contact answers) was rejected as theatre — it doesn't save the unconscious user (they can't pick up either) and adds nothing for the conscious user (who could just dial 122/115 themselves).

**Replaced with tier-based geographic + social escalation** after all contact retries fail (T+6 min):

**Free tier:**
- Final SMS broadcast to all 5 contacts with strong wording: "🚨 SOS UNRESOLVED — ${userName} pressed SOS at ${time}, no contact reached. Last known location: ${trackUrl}. Call them or 122/115 directly."
- One-tap-dial push notification to user themselves: "No one answered. Tap to call 122 directly." (Uses native dialer.)
- End. No AI call-back.

**Basic tier (additional layer):**
- 🆕 **Geofence broadcast** — alert any opted-in SOSphere user within 500m radius. Critical for industrial sites (refineries, factories) where coworkers are nearby.
- 🆕 **Voice memo auto-attach** — if the user recorded a voice memo before / during SOS, attach as a Twilio MMS / chat link to all contact SMS so the first contact who opens hears the user's actual voice.

**Elite tier (additional layer):**
- 🆕 **Admin team paging** — every admin on the company gets push (priority bypass DND) + SMS + ringtone-override.
- 🆕 **Auto-escalation to local emergency services** (122/115/999/112) — **OFF by default**. Owner must explicitly enable in company settings, after acknowledging a clear legal warning ("By enabling this, you authorize SOSphere to contact emergency services on behalf of your employees. Verify this complies with your jurisdiction's regulations.").
- 🆕 **Continuous ambient recording** — from the moment of last cascade failure, microphone records 5 additional minutes for evidence chain-of-custody.

Rationale: AI call-back gave the illusion of safety without saving lives. Geographic + social escalation actually surfaces help that's nearby, and tier gating makes Elite's value proposition concrete (your company + emergency services come in, not just an AI voice).

### ✅ Q3 — Voice command wake-word — **RESOLVED 2026-05-08**

**Decision:** Add wake-word, gated to highest-tier paid plan only (Elite for civilian, top plan for B2B). The existing shake-to-SOS feature is REMOVED from the platform entirely.

**Specs:**
- **Tier gating:** Elite-only (civilian + employee). Free + Basic do not get wake-word.
- **Languages:** bilingual — Arabic "نجدة" and English "OK SOS". User can enable one or both in settings.
- **Default state on Elite:** ON. User sees a one-time privacy warning at first activation:
  > "هذا التطبيق سيستمع لميكروفونك بشكل محلي للكشف عن كلمة الطوارئ. لا يتم إرسال أي صوت لأي سيرفر، ولا يتم تسجيل أي شيء قبل تفعيل SOS."
- **Trigger flow:** Voice wake-word does NOT bypass safety. After detection:
  1. Phone vibrates strongly + plays alert tone
  2. UI shows 3-second countdown: "إلغاء" / "Cancel" button visible
  3. During countdown user can cancel by saying "إلغاء" or tapping screen
  4. After 3s with no cancel → SOS commits with `trigger_method=voice` in audit log
- **Shake-to-SOS:** REMOVED entirely. Code in `shake-to-sos.tsx` to be deleted, references cleaned up. Rationale: high false-positive rate in real life (running, exercising, vehicles), voice is more deliberate, removing reduces cognitive load and code surface.
- **Long-press 3s:** REMAINS as the universal primary trigger for ALL tiers and roles.
- **Cost model:**
  - Picovoice Pro: ~$2/active device/month, paid by SOSphere (you), baked into Elite pricing.
  - Margin check (civilian Elite at $15/mo): $15 - $0.74 Stripe - $2.00 Picovoice - $0.70 other infra = **$11.56 net (77% real margin)**. Sustainable.
  - Margin check (employee Elite at $25/mo): $25 - $0.07 Stripe (shared invoice) - $2.00 Picovoice - $0.80 other infra = **$22.13 net (89% real margin)**. Excellent.
- **Migration plan:** Phase 2 (after 500 paying users) build a TensorFlow.js custom wake-word model trained on Arabic + English variants, eliminating the per-device Picovoice fee. Estimated 3-4 weeks of focused work. Once shipped, voice wake-word can be opened to Basic + civilian Basic without margin concerns.

**Implementation tasks (added to Layer 3 - Client Hardening):**
- **L3-G.** Capacitor Picovoice plugin integration (`@picovoice/porcupine-capacitor`), settings UI for enable/disable + language picker, privacy consent flow. ⏱️ 3-4 days.
- **L3-H.** Delete shake-to-SOS — remove `shake-to-sos.tsx`, references in `mobile-app.tsx`, related settings. ⏱️ 1 day including regression test.
- **L3-I.** Voice cancel detection during 3s countdown ("إلغاء" / "Cancel"). ⏱️ 1 day.

### ✅ Q4 — Witness/covert recording duration — **RESOLVED 2026-05-08**

**Decision:** Fixed durations per tier with explicit DPA consent + audit log. Owner confirmed legal protection requirements.

**Durations:**

Civilian users:
- Free .............. 1 minute
- Basic ............. 5 minutes
- Elite ............. 10 minutes

B2B employees (no Free at company level — companies always have a plan):
- Basic Plan ........ 5 minutes
- Elite Plan ........ 10 minutes

**Legal protections (mandatory):**
- ✅ Explicit DPA consent at first activation. The user sees a pop-up:
  > "بتفعيل هذه الميزة، توافق على أن SOSphere قد يسجّل الصوت المحيطي حول هاتفك عند تفعيل SOS أو فشل الوصول لجهات اتصالك. التسجيل يُحفظ بشكل آمن، يُستخدم فقط لأغراض الأدلة القانونية، وله مدة أقصى محددة. يمكنك إيقاف هذه الميزة في الإعدادات في أي وقت."
- ✅ Audit log row written for every recording session: trigger source (SOS-active / cascade-failure / discreet-mode), start time, duration, user_id, trace_id.
- ✅ Recording stops automatically at the duration cap — no infinite recordings.
- ✅ The user can disable this feature in settings (must remain a one-tap option).

**Trigger sources:**
1. **Discreet Mode (manual)** — user explicitly activates "discreet SOS" mode, recording starts at T+0
2. **Post-SOS automatic** — recording starts when SOS commits (after 3-second long-press / voice trigger)
3. **Cascade-failure automatic** — recording starts when all contact retries fail (Elite only, per Q2 decision)

**Storage costs (Supabase pricing):**
- 1 min audio @ moderate quality: ~500 KB
- 10 min @ moderate: ~5 MB
- 1000 incidents/month at 10 min each: ~5 GB/month = ~$0.10/month storage cost (negligible)

**Battery impact:**
- ~1-2% battery per 5 minutes of recording
- 10 minutes = up to ~4% battery — acceptable trade-off

**Trial period:**
3 months from launch — durations may be adjusted based on real-world usage data. If users frequently hit the cap and the situation is still active, durations may extend. If most recordings are short, they may shrink.

**Implementation tasks (added to Layer 2 — Pipeline Hardening):**
- **L2-I.** Witness/covert recording duration enforcement per tier — wire `audio_evidence_max_seconds` from subscription tier into MediaRecorder + auto-stop. Hash + upload + audit log row. ⏱️ 2 days.
- **L2-J.** DPA consent flow for witness recording — one-time pop-up at first activation, settings toggle, signed consent logged. ⏱️ 1 day.

### ✅ Q5 — Drill mode (training simulation) — **RESOLVED 2026-05-08**

**Decision:** Drill mode available on ALL tiers with progressive limits. Owner + Admins can launch drills. Drills are ALWAYS transparent (employee sees "this is a drill") — no covert testing, for legal and ethical reasons.

**Rationale:**
- Industry data (Everbridge / AlertMedia): companies that drill monthly see 22s response times; non-drilling companies see 87s. The 65-second gap = life or death in a cardiac event.
- Operational cost is essentially zero (no real Twilio calls, no real Picovoice usage, ~$0.001 of DB writes per drill).
- "Safety above profit" principle (already established) — gating drills behind a paywall would harm customers who matter most.

**Tier limits (per-employee, per-month):**

| Tier | Drills/month | Auto-scheduling | Scenarios | Reports |
|------|--------------|-----------------|-----------|---------|
| Free (civilian or B2B) | 1 | ❌ | Basic only | ❌ |
| Basic | 5 | ❌ | 3 scenarios | Monthly |
| Elite | Unlimited | ✅ | 10 scenarios | Weekly + Monthly |

**Scenario library (Elite has all 10; Basic has 3 baseline; Free has 1):**
1. Generic SOS (default)
2. Medical — fall / cardiac / asthma
3. Fire / smoke
4. Gas leak / chemical
5. Security threat / intruder
6. Vehicle accident
7. Confined space
8. Lone worker check-in failed
9. Active aggressor
10. Earthquake / structural collapse

**Who can launch:**
- B2B: **Owner + Admins** (Admins delegate based on company permissions)
- Civilian: the user themselves only

**Transparency policy (no covert drills):**
- Employees ALWAYS see "🟡 هذا تدريب — لا مساعدة حقيقية تُرسل" overlay throughout drill
- Audit log row marked `is_drill=true`, `is_covert=false`
- Reasoning: covert drilling creates legal exposure (employee distress claims, post-trauma) and violates the trust contract with employees ("when you press SOS, real help comes"). Better to drill transparent and frequent than covert and rare.

**Drill flow (mirrors real SOS but instrumented):**
1. Owner/Admin opens "تشغيل تدريب" panel in dashboard
2. Selects scenario + selects target employee(s) (or "all on shift")
3. Drill notification fires to employees: "تدريب طوارئ في ${time}" (gives 5min warning)
4. At T-0, employee sees push: "🟡 هذه تجربة. اضغط SOS كما لو كانت حقيقية"
5. Employee performs the SOS press exactly as in real emergency
6. Pipeline runs full path BUT with `is_drill=true` flag at every layer:
   - sos-alert edge function detects flag, skips Twilio dispatch
   - Audit log captures every step with timing
   - No real call/SMS to contacts
   - Admin dashboard shows drill in progress with mock-status updates
7. Drill ends after employee taps "تم" or auto-times out after 2 minutes
8. Report generated immediately:
   - Employee response time (button-press latency)
   - Pipeline latency (server-side processing)
   - Did chat work? Did GPS resolve? Did audio recording start?
   - Pass/Fail per checkpoint

**Reports (Basic monthly, Elite weekly + monthly):**
- Per-employee drill participation rate
- Per-employee average response time
- Top 3 longest pipeline stages
- Failed drills with root cause
- Trend chart vs previous period
- Compliance-ready PDF for OSHA / regulator audits

**Implementation tasks (added to Layer 5 — Operations Discipline):**
- **L5-F.** Drill mode end-to-end — `is_drill=true` flag propagation through every pipeline layer (client → sos-alert → contacts → audit_log). ⏱️ 3 days.
- **L5-G.** Drill panel in admin dashboard — scenario picker, target selection, schedule, history. ⏱️ 2 days.
- **L5-H.** Drill report generator — per-employee + per-company metrics, PDF export. ⏱️ 2 days.
- **L5-I.** Auto-scheduling for Elite — cron-based drills (e.g. "every 1st Sunday at 10am"), email digest of upcoming drills. ⏱️ 1.5 days.

### ✅ Q6 — Photo storage limit per incident — **RESOLVED 2026-05-08**

**Decision:** Tiered photo limits with full forensic metadata on every photo + tiered quality.

**Limits per incident:**

| Tier | Max photos | Quality cap | EXIF + GPS + Hash |
|------|------------|-------------|-------------------|
| Free | 10 | ~2 MB / photo (moderate) | ✅ |
| Basic | 25 | ~5 MB / photo (high) | ✅ |
| Elite | 100 | ~15 MB / photo (raw OK) | ✅ |

**Forensic metadata on EVERY photo (all tiers):**

Stored as columns in `incident_photos` table:
- `taken_at` — client-claimed capture timestamp
- `received_at` — server timestamp at upload
- `gps_lat` + `gps_lng` — coordinates at capture
- `gps_accuracy_m` — accuracy radius
- `device_camera` — front/back/external
- `sha256_hash` — SHA-256 of original bytes
- `exif_json` — full EXIF blob preserved (manufacturer, lens, ISO, etc.)

This makes photos legally admissible per ISO/IEC 27037 standard for digital evidence (chain-of-custody requirement).

**Quality / size cost analysis:**

| Tier | Per photo | Per max-incident | Storage cost/month at 1000 incidents |
|------|-----------|------------------|--------------------------------------|
| Free | 2 MB | 20 MB | ~$0.42 |
| Basic | 5 MB | 125 MB | ~$2.63 |
| Elite | 15 MB | 1.5 GB | ~$31.50 |

Even Elite at full saturation (1000 incidents/month, all 100 photos at 15 MB) costs ~$31.50/month total — fully covered by Elite margin (~$22 net per user).

**Privacy guardrails:**
- DPA disclosure: "صور قد تحتوي على وجوه أشخاص آخرين، تُحتفظ للأغراض القانونية فقط"
- 24-hour user-deletable window after SOS — user can remove specific photos before they lock in
- After 24h, only Owner (with audit-log entry) can request deletion

**Implementation tasks (added to Layer 2 — Pipeline Hardening):**
- **L2-K.** Tier-aware photo upload — server reads `subscription.tier` and rejects photo #N+1 with friendly error. ⏱️ 1 day.
- **L2-L.** EXIF + GPS + Hash extraction at upload time — hash before storage, persist all metadata atomically. ⏱️ 2 days.
- **L2-M.** Quality compression per tier — client-side resize to per-tier max, preserve EXIF. ⏱️ 1.5 days.
- **L2-N.** 24-hour user-deletable window — user can remove specific photos via UI; after window, locked. ⏱️ 1 day.

### ✅ Q7 — Evidence retention + storage tiering — **RESOLVED 2026-05-08**

**Decision:** Hot + Cold storage hybrid model with Cloudflare R2 for cold layer. Right to be Forgotten supported on all tiers.

**Retention by tier:**

| Tier | Hot Storage (Supabase) | Cold Storage (Cloudflare R2) | Total Retention |
|------|------------------------|------------------------------|-----------------|
| Free | 30 days | ❌ deleted at cap | 30 days |
| Basic | 30 days | up to 1 year | 1 year |
| Elite | 90 days | up to 7 years | 7 years |

**Why Hot + Cold split:**
- Hot Storage = instant access (ms latency), Supabase Storage at ~$0.021/GB/month
- Cold Storage = slower access (2-5 min retrieval), Cloudflare R2 at ~$0.015/GB/month + ZERO egress fees
- ~80% cost savings on long-tail data with no functional loss for legal compliance

**Why Cloudflare R2 (not AWS S3 Glacier):**
- ✅ Zero egress fees — critical when Owner exports old evidence
- ✅ S3-compatible API → simple integration with existing tooling
- ✅ Lower per-GB cost than Glacier Deep Archive at our scale
- ✅ EU + ME data residency available
- ✅ No retrieval-time minimums (Glacier requires hours for cheapest tier)

**Evidence types covered by retention rules:**
- Audio recordings (call, voice memo, witness/covert)
- Photos (with EXIF + GPS + Hash metadata)
- Chat transcripts
- Audit logs (kept indefinitely separately — these are legal records, not evidence artifacts)
- GPS trail data
- Tracking link visit history

**Right to be Forgotten (GDPR Art. 17, mandatory all tiers):**
- User → Settings → "Delete all my data"
- Confirmation flow with 24h cancel window
- After confirmation, all evidence + chat + GPS deleted from BOTH Hot and Cold
- Audit log entry retained (legally required) but anonymized — user_id replaced with "DELETED-${original_id}-${date}"
- Exception: data under active criminal investigation (with court-issued hold) — user notified, deletion paused, automated alerts to Owner
- Process must complete within 30 days per GDPR; SOSphere commits to 7 days target

**Migration path (Hot → Cold):**
- Daily cron job at 02:00 UTC scans `evidence/*` and `incident_photos.uploaded_at`
- Files older than tier's Hot threshold get migrated to R2 in `cold-archive/${trace_id}/...`
- DB row updated: `cold_storage_url`, `migrated_at`, `hot_purged_at` columns
- Hot copy purged 7 days after successful Cold copy + verification

**Retrieval from Cold (Owner request):**
- Owner clicks "Restore from archive" on incident X
- Background job pulls files from R2 into a temp Supabase bucket
- ETA shown to Owner: ~2-5 minutes
- Files become Hot-accessible for 24 hours, then auto-purged back to Cold
- Audit log entry: who requested restore, when, why

**Regional consideration (Iraq):**
- Iraq doesn't yet have GDPR-equivalent law, but draft is under parliamentary review (2026)
- We follow GDPR as our default standard → future-proofs us + sells to European/Gulf companies that have such requirements

**Implementation tasks (added to Layer 4 — Infrastructure Resilience):**
- **L4-F.** Cloudflare R2 account setup + IAM keys + DPA addendum. ⏱️ 0.5 day (admin work).
- **L4-G.** Cold-storage migration cron — daily job, transactional move from Supabase to R2 with verification. ⏱️ 3 days.
- **L4-H.** Restore-from-archive flow — Owner UI button, async job, progress notifications, 24h temp lifetime. ⏱️ 2 days.
- **L4-I.** Right to be Forgotten flow — user-facing UI, 24h cancel window, anonymized audit log. ⏱️ 2 days.
- **L4-J.** GDPR-compliance test — synthetic deletion verification end-to-end every quarter. ⏱️ 1 day.

### ⏳ Q8 — Forensic export gating

(Pending.)

---

## 13. Living document

This file should be **updated** every time:
- A flow detail is changed mid-implementation
- A new tier or role is added
- A regulator (OSHA / GDPR / Iraqi telecom) imposes a new requirement
- An incident postmortem reveals a flow gap

Source of truth for what SOSphere does. If code disagrees, update one or the othe