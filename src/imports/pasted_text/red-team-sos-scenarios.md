You are now a RED TEAM tester.
Your job is to BREAK SOSphere.
Not find UI bugs — find moments where 
a real person could die because the system failed.

Test as 4 different people simultaneously:

PERSON 1 — Ahmed (Employee in danger)
PERSON 2 — Sarah (Company Admin)  
PERSON 3 — Omar (Safety Manager, second admin)
PERSON 4 — Fatima (Ahmed's wife, emergency contact)

Run these 10 brutal scenarios:

═══════════════════════════════════════
SCENARIO 1 — "The 3 AM Test"
═══════════════════════════════════════
Ahmed triggers SOS at 3:07 AM.
Sarah (admin) is asleep. Phone on silent.
Omar is in a different timezone (London).
Fatima is asleep.

Trace EXACTLY:
- What happens on Ahmed's screen second by second?
- What reaches Sarah? When? How?
- What reaches Omar? When? How?
- What reaches Fatima? When? How?
- At what minute does Ahmed realize nobody is coming?
- Does the system ever tell Ahmed "call 911 yourself"?
- If Ahmed's phone dies at minute 8 — 
  what is the last data saved?

Rate: Does Ahmed survive? YES/NO + Why

═══════════════════════════════════════
SCENARIO 2 — "The New Employee Trap"
═══════════════════════════════════════
Khalid joined the company TODAY.
Admin approved him 2 hours ago.
He has the app but never completed setup.
He falls from a ladder at 2 PM.

Trace EXACTLY:
- Can Khalid press SOS before completing setup?
- What data does the system have about him?
  (no blood type, no emergency contacts, no zone)
- Who gets notified?
- What does the admin see?
- Is the response different from a fully setup employee?

Rate: Does Khalid get help? YES/NO + Why

═══════════════════════════════════════
SCENARIO 3 — "The Simultaneous Collapse"
═══════════════════════════════════════
Building collapse. 8 employees trigger SOS 
within 90 seconds of each other.
Admin Sarah opens dashboard and sees 8 popups.

Trace EXACTLY:
- What does Sarah's screen look like?
- Can she see all 8 at once?
- Does AI Co-Admin open for all 8 or just 1?
- How does she prioritize?
- Does the system auto-prioritize for her?
- If she spends 3 minutes on Employee 1,
  what happens to Employees 2-8?
- Does anyone escalate automatically?
- At minute 5 — what is the status of each employee?

Rate: Do all 8 survive? How many? + Why

═══════════════════════════════════════
SCENARIO 4 — "The False Alarm Cry Wolf"
═══════════════════════════════════════
Mohammed triggers SOS 3 times in one week.
All false alarms (accidental).
4th time is a REAL emergency.

Trace EXACTLY:
- Does the system remember previous false alarms?
- Does the admin respond differently to the 4th SOS?
- Is there any "cry wolf" warning shown?
- Does the system reduce alert priority automatically?
- If admin ignores the 4th because "it's probably false"
  and Mohammed dies — what is the legal liability trail?

Rate: Does Mohammed survive? YES/NO + Why

═══════════════════════════════════════
SCENARIO 5 — "The Evidence Destruction Test"
═══════════════════════════════════════
Major incident. Admin resolves emergency.
Company lawyer says "delete the evidence."
Admin tries to delete incident from history.

Trace EXACTLY:
- Can admin delete an incident record?
- Can admin edit the timeline after the fact?
- Can admin change who was notified?
- Can admin alter GPS coordinates?
- If admin refreshes browser — is data still there?
- Is ANY of this data truly tamper-proof?
- What would a judge see if they subpoenaed this data?

Rate: Is evidence court-ready? YES/NO + Why

═══════════════════════════════════════
SCENARIO 6 — "The Language Barrier"
═══════════════════════════════════════
Worker speaks only Urdu. No English, no Arabic.
His supervisor speaks only Arabic.
Emergency services in this city speak only English.

Trace EXACTLY:
- Is the SOS button labeled in Urdu?
- Can the worker understand the confirmation screen?
- What language does the emergency notification arrive in?
- What language is the incident report in?
- Can the system handle a 3-language emergency?

Rate: Does the language barrier cost lives? YES/NO

═══════════════════════════════════════
SCENARIO 7 — "The Admin Panic Attack"
═══════════════════════════════════════
Sarah (admin) is a new hire, 3 days on the job.
She has never used the system in a real emergency.
Critical SOS arrives. She panics.
She clicks the wrong buttons. She closes Guide Me.
She calls her boss instead of responding.
5 minutes pass.

Trace EXACTLY:
- Does Guide Me auto-reopen if closed?
- Is there a "I made a mistake, undo" option?
- Does the system escalate when admin is 
  active but not responding to the emergency?
- Is there a "HELP — I don't know what to do" button?
- What happens after 5 minutes of admin inaction?

Rate: Does Guide Me save the day? YES/NO + Why

═══════════════════════════════════════
SCENARIO 8 — "The GPS Lie"
═══════════════════════════════════════
Ahmed triggers SOS in a basement.
GPS shows him 500m away from his real location.
Responders go to wrong location.

Trace EXACTLY:
- Does the system show GPS accuracy rating?
- Does it warn "GPS may be inaccurate indoors"?
- Is there a manual location override for Ahmed?
- Can Ahmed describe his location in text?
- Can Ahmed take a photo of a door/sign for location?
- What happens when responders arrive at wrong location?

Rate: Does GPS failure cost lives? YES/NO + Why

═══════════════════════════════════════
SCENARIO 9 — "The Subscription Cliff"
═══════════════════════════════════════
Company's credit card expires.
Subscription payment fails.
Grace period ends tomorrow at midnight.
At 11:58 PM — critical SOS triggers.

Trace EXACTLY:
- Can employee still trigger SOS?
- Does admin see the emergency?
- Is any feature blocked during grace period?
- What if company account is fully suspended?
- Does the employee know their company's subscription 
  status affects their safety?
- Is there a "emergency override" during suspension?

Rate: Does billing kill someone? YES/NO + Why

═══════════════════════════════════════
SCENARIO 10 — "The Ultimate Stress Test"
═══════════════════════════════════════
All of the above happen simultaneously:
- 3 AM (admin asleep)
- 8 SOS at once
- GPS inaccurate
- Admin is new and panicking
- Company subscription expired yesterday
- One employee speaks only Urdu

Trace EXACTLY what the system does.
What works? What fails? What kills?

Rate: Overall life-safety score 1-10

═══════════════════════════════════════
REPORT FORMAT:
═══════════════════════════════════════
For each scenario:

WHAT WORKS ✅ (with file:line)
WHAT FAILS ❌ (with file:line)  
WHAT KILLS 💀 (with file:line)
FIX REQUIRED (can fix now / needs Supabase)
SURVIVAL RATING: X/10

Then give me:
TOP 5 FIXES that would save the most lives
WHAT SHOULD BE REMOVED (adds complexity, saves nobody)
FINAL VERDICT: Ready for v1.0? YES/NO/CONDITIONAL