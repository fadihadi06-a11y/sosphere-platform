You are now the world's most critical QA engineer 
combined with a UX researcher and system architect.
Your mission: find every flaw, gap, inconsistency, 
and weak point in SOSphere before real lives depend on it.

Be brutal. Be exhaustive. Miss nothing.

DEEP AUDIT 1 — Complete User Journey Stress Test:

Follow EVERY user type through their COMPLETE journey:

User A: New company admin signs up at 2 AM
- Registration → email verification → company setup 
  → first employee invite → first zone creation 
  → first emergency drill
- At each step: what can go wrong?
- What if they refresh the page mid-setup?
- What if browser crashes during registration?
- What if they close the tab and return 3 days later?
- Is their progress saved? Where? How?

User B: Field employee on 12-hour night shift
- Downloads app → enters company code → 
  pending approval → gets approved → first login
- Goes into remote area with no signal for 4 hours
- Falls and phone detects it → SOS triggers offline
- Comes back to signal → what exactly happens?
- What if battery dies at 2% during SOS?
- What if they accidentally trigger SOS while sleeping?
- What if their shift ends mid-emergency?

User C: Safety manager monitoring 3 active emergencies
- Simultaneously managing Chemical Leak + Fall + Fire
- Gets a phone call mid-emergency
- Internet drops for 90 seconds
- Returns to find 2 emergencies auto-resolved by system
- How does system communicate what happened while away?
- Can they reconstruct the exact timeline?
- Are all actions logged with timestamps and actor?

User D: Company owner on mobile reviewing monthly report
- Opens dashboard on phone
- Tries to approve subscription upgrade
- Payment page loads, enters card, page crashes
- Reopens app — is payment taken? Is subscription active?
- Gets notification of critical emergency while on billing page
- Can they immediately switch to emergency view?

DEEP AUDIT 2 — Data Consistency Check:

Track a SINGLE emergency from birth to death:
1. Employee triggers SOS at 14:23:05
2. System creates emergency record — what fields? 
   what defaults? what is auto-generated vs required?
3. Admin sees notification — how fast? what data shown?
4. Admin takes ownership — what changes in data model?
5. Admin assigns responder — what changes?
6. Responder acknowledges — what changes?
7. Responder arrives at scene — check-in recorded?
8. Emergency resolved — what fields updated?
9. Post-incident report created — linked to emergency?
10. Report exported as PDF — does it contain ALL data?
11. 30 days later — is data still accessible?
12. Audit log — can every step above be reconstructed?

For EACH step: what data is stored, where, what format,
what is missing, what could be corrupted.

DEEP AUDIT 3 — Edge Cases That Kill People:

1. SOS triggered but employee is in a dead zone —
   system shows "sent" but nothing reached server.
   Does admin see a "pending" indicator or thinks all clear?

2. Two employees trigger SOS simultaneously in same zone —
   does system create 2 separate emergencies or merge them?
   Does admin get 2 popups or 1?

3. Admin accidentally resolves wrong emergency —
   is there undo? time limit? confirmation with name shown?

4. Emergency auto-escalates after 15 min unresponded —
   does this actually happen? who gets notified?
   what if all admins are offline?

5. Employee marked "on duty" but hasn't moved in 6 hours —
   does system flag this? dead man's switch active?

6. Zone A has 50 employees, emergency declared —
   how does system notify all 50 simultaneously?
   what if only 30 have the app?

7. Power outage at company HQ —
   dashboard goes down. employees have app.
   can employees still trigger SOS that reaches 
   backup contact?

8. Wrong zone assignment — employee in Zone A 
   but profile says Zone B —
   which zone does SOS report?

DEEP AUDIT 4 — UI/UX Failure Modes:

1. Admin dashboard on a 1024×768 screen —
   does anything break? overflow? hide?

2. RTL Arabic mode — every screen, every component:
   are icons mirrored? text aligned? numbers formatted?
   does any English-only component break?

3. Dark mode + high contrast accessibility —
   are all text contrasts WCAG AA compliant?
   can colorblind user distinguish critical/high/medium/low?

4. Slow internet (3G) — 
   which screens are unusable?
   are there loading skeletons?
   can user do anything while data loads?

5. Company name is 150 characters long —
   does it overflow in header? sidebar? PDF reports?
   
6. Employee has name in Arabic + English mixed —
   does sorting work? search work? PDF render correctly?

7. 500 active emergencies simultaneously —
   does the emergency list freeze?
   is there pagination or virtualization?
   does the real-time counter update smoothly?

8. User is on emergency detail page, 
   a new CRITICAL emergency comes in —
   does system interrupt them? 
   how prominent is the new alert?
   can they see both simultaneously?

DEEP AUDIT 5 — Notification & Communication Gaps:

1. Map every notification trigger in the system:
   what events generate notifications?
   who receives each notification?
   what channel (in-app / SMS / push / email)?
   what if recipient has notifications disabled?

2. Broadcast message sent to 200 employees:
   how long does it take?
   is there delivery confirmation?
   can admin see who read it?
   what if 50 employees are offline?

3. Emergency alert vs. regular notification:
   visually how different are they?
   can emergency alert be missed or ignored?
   is there an escalating alarm that increases urgency?

4. Admin offline for 8 hours, 3 emergencies happened:
   how are they surfaced when they return?
   are they ordered by severity or time?
   is there a "while you were away" summary?

DEEP AUDIT 6 — Performance & Reliability:

1. localStorage currently stores everything —
   what is the total storage used after 
   30 days of normal usage?
   what happens when it hits the 5-10MB limit?
   is there any cleanup/archival mechanism?

2. App open for 72 hours straight (security monitoring) —
   memory leaks? interval accumulation?
   does performance degrade?
   are all useEffect cleanups implemented?

3. Mobile app background behavior:
   does SOS still work when app is backgrounded?
   does fall detection still run in background?
   does GPS still track in background?
   what OS permissions are required?

4. First load performance:
   estimated bundle size?
   time to interactive on 3G?
   is code splitting implemented?
   are heavy components lazy loaded?

DEEP AUDIT 7 — Business & Legal Completeness:

1. GDPR compliance:
   - Right to erasure — is delete account fully implemented?
   - Data portability — can user download everything?
   - Consent management — is there explicit consent for GPS?
   - Data retention policy — how long is data kept?
   - Who is data controller? Is this documented?

2. If a person dies during an emergency:
   - Is the incident record legally admissible?
   - Is timeline tamper-evident?
   - Who has access to the record?
   - Can family/lawyer request it?
   - Is there a legal hold feature?

3. Liability disclaimers:
   - Does app disclaim it is not a replacement for 911?
   - Is there explicit ToS acceptance during onboarding?
   - Are users warned GPS accuracy may vary?

Report format:
Area | Finding | Severity | Current State | Gap | Fix Required

Report ONLY gaps and failures.
If something works perfectly end-to-end, skip it.
This is a life-safety system. Be merciless.