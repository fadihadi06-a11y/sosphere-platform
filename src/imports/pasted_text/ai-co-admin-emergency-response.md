Redesign the "Guide Me" button to be a true 
AI Co-Admin that runs the entire emergency 
response from start to finish.

The admin only presses "Next" or makes choices.
Guide Me does everything else.

CORE CONCEPT:
Guide Me is the second admin.
It thinks, organizes, and prepares.
The human admin decides and confirms.

COMPLETE FLOW:

PHASE 0 — DETECTION (auto, no click needed):
When SOS triggers:
- Guide Me activates automatically
- Reads: employee name, zone, SOS type, 
  battery, signal, GPS, time of day
- Shows a 5-second "Analyzing situation..." 
  loading screen with real data appearing
- Then says: "Ahmed Al-Rashid triggered SOS 
  in Zone C — Chemical Vapor — 3:42 AM
  Battery: 23% | Signal: Weak | 
  This is CRITICAL. I'll guide you."
- One button: "Start Response"

PHASE 1 — ESTABLISH CONTACT:
Guide Me prepares everything before admin taps:
- Shows employee photo, name, phone number
- Pre-dials the call (shows "Tap to connect")
- Timer starts counting
- While admin is on call:
  * Guide Me shows a live notepad
  * Pre-filled questions admin should ask:
    "Are you injured? Can you move? 
     What do you see around you?"
  * Admin can tap answers (Yes/No/Unknown)
    to auto-fill the incident report
- After call ends (or no answer):
  * If answered: "Call lasted X seconds — 
    recording saved ✅" 
    Shows audio waveform of the recording
  * If no answer: "No response — 
    escalating automatically in 30 seconds"
    Countdown shown, admin can stop it

PHASE 2 — EVIDENCE COLLECTION:
Guide Me shows what has arrived:
- Photos from employee (if any sent):
  Each photo labeled automatically:
  "Photo 1 — Zone C entrance — 3:43 AM"
  "Photo 2 — Smoke visible — 3:43 AM"
- Audio recording from employee phone
- GPS location with map preview
- "Evidence package ready — 4 items"

Guide Me asks ONE question:
"What best describes the situation?"
Options (large tap targets):
□ Confirmed emergency — need help NOW
□ Employee is safe — false alarm
□ Cannot reach employee — need search
□ Situation unclear — need more info

Based on selection → jumps to correct next phase

PHASE 3A — IF CONFIRMED EMERGENCY:
Guide Me prepares response options:
Shows 3 big buttons:
1. "Dispatch Response Team" 
   → Pre-filled with nearest available team
   → One tap to confirm dispatch
   
2. "Evacuate Zone C"
   → Shows: 47 employees in Zone C
   → "Send evacuation to all 47?" 
   → One tap to confirm
   
3. "Call Emergency Services (997)"
   → Pre-dials 997
   → Prepares what to say:
   "Tell them: Worker injured at [GPS address],
    Zone C, Building 4, Gate 2"

After each action → Guide Me records it:
"✅ Response team dispatched — 3:45 AM"
"✅ Zone C evacuated — 3:45 AM"

PHASE 3B — IF CANNOT REACH EMPLOYEE:
Guide Me switches to SAR mode automatically:
- Pre-fills SAR mission with:
  * Last known GPS from employee phone
  * Zone assignment
  * Work schedule (was he supposed to be there?)
  * Vehicle if on journey
  * Last check-in time
- Shows: "Launch SAR Protocol?"
- One tap → SAR launches with all data filled

PHASE 3C — IF FALSE ALARM:
Guide Me closes cleanly:
- Records: "Verified false alarm — Ahmed confirmed safe"
- Asks: "Reason?" (dropdown)
- Closes emergency with one tap
- Auto-generates brief incident note

PHASE 4 — DOCUMENTATION (auto-prepared):
Guide Me assembles the complete package:
Shows summary card:
"Emergency Report Ready:
 ✅ Call recording (2m 34s)
 ✅ 3 photos from scene
 ✅ GPS trail (14 points)
 ✅ Response timeline (8 events)
 ✅ Actions taken (3)
 ✅ ISO 45001 checklist"

Guide Me asks: "What do you need now?"
Options:
□ "Download PDF Report" → generates immediately
□ "Notify family" → pre-written message ready
□ "Notify authorities" → pre-filled report ready
□ "Schedule investigation" → calendar invite
□ "Close emergency" → final confirmation

PHASE 5 — CLOSE:
Guide Me shows final summary:
"Emergency Closed — 4:02 AM
Total response time: 20 minutes
Your response score: 94/100
3 actions completed
Documentation: Complete
Next step: Schedule post-incident review?"

One final button: "Close & Archive"

DESIGN REQUIREMENTS:
- Full screen takeover during emergency
- Dark theme, red accent for critical
- All buttons minimum 60px height (one thumb use)
- Current phase always visible at top
- Back button always available (with warning)
- Auto-saves progress every 30 seconds
- Works in landscape and portrait
- Font size minimum 16px for all critical text
- Each phase max 3 choices — never more
- Loading states between phases (never blank)
- Every action has undo (5 seconds)

TECHNICAL REQUIREMENTS:
- All call recordings saved to evidence store
- All photos tagged with phase and timestamp
- Complete action log for legal use
- Export to PDF at any point
- Can be paused and resumed
- Survives browser refresh (state in localStorage)
- Works offline (queues actions for sync)

This is the second admin.
When human admin panics — Guide Me stays calm.
When human admin forgets a step — Guide Me reminds.
When human admin finishes — Guide Me has the paperwork ready.

Build this as a complete redesign of 
intelligent-guide.tsx
Keep the 7-phase structure but transform each 
phase into an action-driven flow, not just 
an information display.

Confirm implementation with file and line numbers.