ULTIMATE OWNER JOURNEY STRESS TEST
You are testing the complete owner experience
from first visit to fully operational system.
Be merciless. Find every gap.

═══════════════════════════════════════
SCENARIO 1 — "The Perfect Registration"
═══════════════════════════════════════
Owner visits www.sosphere.com for first time.
He is a safety manager at Aramco, 500 employees.
He has never used safety software before.

Test EXACTLY:
Step 1 — Landing page:
- What does he see first?
- Is value proposition clear in 5 seconds?
- Can he start registration without reading anything?
- Is there a "Book Demo" option?
- Is pricing visible before signing up?

Step 2 — Phone registration:
- Does phone field accept: +966501234567?
- Does it accept: 0501234567 (local format)?
- Does it accept: 501234567 (without 0)?
- What happens if wrong number entered?
- OTP: how many digits? how long valid?
- If OTP expires — can he request new one?
- If he enters OTP wrong 5 times — locked out?
- After OTP — is session saved if browser crashes?

Step 3 — Business email:
- Is gmail/yahoo rejected correctly?
- What about: safety@aramco.com.sa?
- What about: s@a.c (too short)?
- What about: safety@aramco (no TLD)?
- Does it actually SEND verification email?
- What if email server is slow (10 min delay)?

Step 4 — Company setup:
- Name: "شركة أرامكو للسلامة" (Arabic) — works?
- Name: "Aramco & Partners" (special char) — works?
- Name: 1 character — blocked?
- Name: 200 characters — overflow anywhere?
- Industry: is "Oil & Gas" an option?
- Employee count: can he enter 50,000?
- Country: is Saudi Arabia first in list?

Rate each step: WORKS/BROKEN/MISSING
Overall: X/10

═══════════════════════════════════════
SCENARIO 2 — "The Zone Setup Nightmare"
═══════════════════════════════════════
Same owner. Company has complex layout:
- Main facility: 3km × 2km
- 15 distinct work zones
- Some zones overlap
- Some zones are inside buildings (GPS unreliable)
- One zone is underwater (diving team)
- One zone is 50km away (remote site)

Test EXACTLY:
- Can he create 15 zones?
- How does he define zone boundaries?
  Text only? Map? GPS coordinates?
- Can he set different alert distances per zone?
  (Factory: 50m, Remote site: 500m)
- Overlapping zones: if employee is in both,
  which zone does system assign?
- Indoor zone: GPS shows wrong location.
  How does system handle indoor workers?
- Underwater zone: no GPS, no signal.
  How does system protect diving team?
- Remote site 50km away: same admin covers both?
  Can he assign a different admin per site?
- Evacuation routes: can he define different
  evacuation paths per zone?
- Assembly points: multiple per zone possible?

Rate: WORKS/BROKEN/MISSING per capability
Overall: X/10

═══════════════════════════════════════
SCENARIO 3 — "The CSV Import From Hell"
═══════════════════════════════════════
Owner tries to import 487 employees via CSV.
His HR system exports in Arabic.
Some employees have special characters in names.
Some have duplicate phone numbers (family members).
Some have missing fields.
Some have wrong zone names (Zone 1 vs Zone A).

Test EXACTLY:
- Does the system accept Arabic CSV?
- Does it handle UTF-8 encoding correctly?
- Row 1: "محمد بن عبدالله" — imports correctly?
- Row 47: duplicate phone +966501234567 — 
  blocked or imported?
- Row 89: missing email — blocked or warning?
- Row 156: zone "Zone 1" but system has "Zone A" —
  error or auto-map?
- Row 200: phone "05XXXXXXXX" (masked) — 
  blocked or accepted?
- After import: what does owner see?
  Success count? Error count? Which rows failed?
- Can he download error report?
- Can he fix and re-import just the failed rows?
- What is maximum file size accepted?
- What if import takes 5 minutes — does browser timeout?

Rate: X/10

═══════════════════════════════════════
SCENARIO 4 — "The Invitation Chaos"
═══════════════════════════════════════
After CSV import, system sends 487 invitations.

Test EXACTLY:
- How are invitations sent? SMS? Email? Both?
- What does the invitation message say exactly?
  (Show exact text in Arabic and English)
- Does it contain:
  □ Download app link (iOS + Android)?
  □ Company join code?
  □ Expiry date of invitation?
  □ Admin name?
  □ Zone assignment?
- What if employee's phone number is wrong?
  Does admin get notified?
- What if 200 employees ignore the invitation?
  Is there a bulk resend option?
- Employee receives SMS but has no smartphone —
  can he use web version?
- Employee receives invitation at 2 AM —
  does it respect quiet hours?
- Invitation link clicked after 7 days (expired) —
  what happens?
- Two employees share same device —
  can both have accounts?

Rate: X/10

═══════════════════════════════════════
SCENARIO 5 — "The Employee First Day"
═══════════════════════════════════════
Ahmed receives invitation. Opens app first time.

Test EXACTLY:
Step 1 — Download and open:
- App Store link works?
- After download, does invite link 
  auto-fill company code?
- Or must he manually enter 6-digit code?

Step 2 — Identity verification:
- Must he use same phone number as invitation?
- What if he changed his number?
- Can he use email instead?

Step 3 — App onboarding:
- Does he see: WHO is his admin? (name + photo?)
- Does he see: WHICH zone is he assigned?
- Does he see: WHICH shift?
- Is this information correct (from CSV import)?
- Is admin automatically his first emergency contact?
- Can he change his zone himself?
- Can he change his shift himself?

Step 4 — First SOS test:
- Is there a "Test Mode" so he can 
  test SOS without alarming admin?
- If no test mode — does admin get 
  confused by test SOS?

Rate each step: WORKS/BROKEN/MISSING
Overall: X/10

═══════════════════════════════════════
SCENARIO 6 — "The Smart Pricing Trap"
═══════════════════════════════════════
Owner has 487 employees.
System recommends Guardian plan ($249/mo).
He wants to negotiate.
He tries to manipulate the system.

Test EXACTLY:
- He enters 50 employees during registration
  but actually has 487 — what happens?
  Is there any verification?
- He upgrades to Guardian, adds 487 employees,
  then downgrades to Shield (50 max) —
  what happens to the other 437 employees?
  Are they deactivated? Deleted? Warned?
- He adds 201 employees on Guardian plan
  (limit is 200) — what stops him?
  Error? Warning? Automatic upgrade prompt?
- He cancels subscription but keeps employees
  in system — what can they still do?
  Can they still trigger SOS?
- Trial expires. He doesn't pay.
  Employee triggers SOS at day 15.
  Does SOS still work?
- Annual plan: he pays for year, 
  cancels at month 3 — refund?
  Pro-rated? No refund?

Rate: X/10

═══════════════════════════════════════
SCENARIO 7 — "The Evacuation Drill"
═══════════════════════════════════════
Owner wants to run a company-wide evacuation drill.
487 employees. 15 zones. 3 PM on a Tuesday.

Test EXACTLY:
- Is there a "Drill Mode" to prevent
  real panic during a test?
- How does he trigger evacuation for all zones?
  One button? Zone by zone?
- What do employees see on their phones?
  Same as real evacuation? Or "DRILL" badge?
- Employee in Zone C doesn't have app open —
  does he get notified?
- Employee marks "Acknowledged" —
  admin sees real-time count?
- Employee reaches assembly point —
  can he "check in" at assembly point?
- After drill: automatic report?
  Who responded? How fast? Who was missing?
- Drill data vs real emergency data —
  are they kept separate?
- Can owner schedule recurring drills?
  Monthly? Quarterly?

Rate: X/10

═══════════════════════════════════════
SCENARIO 8 — "The Regulatory Inspection"
═══════════════════════════════════════
Saudi HRSD inspector arrives unannounced.
Asks to see safety system records for past 6 months.

He asks for:
1. Proof all employees completed safety onboarding
2. List of all SOS events + resolutions
3. Average response times
4. Evacuation drill records
5. Employee training completion rates
6. Zone compliance reports
7. Any near-miss reports

Test EXACTLY:
- Can owner export all of this in one package?
- Is data from 6 months ago still accessible?
- Are reports in Arabic (for Saudi inspector)?
- Response times — are they accurate or estimated?
- Is there a "Compliance Dashboard" view?
- Can owner give inspector read-only access?
  Without sharing admin credentials?
- If inspector finds a gap — can owner 
  add retroactive documentation?
  (Should this be BLOCKED for integrity?)

Rate: X/10

═══════════════════════════════════════
SCENARIO 9 — "The System Under Attack"
═══════════════════════════════════════
A disgruntled employee who was fired
still has the app installed.
He knows the company code.
He tries to:

1. Log back in with old credentials
2. Trigger SOS to waste admin time
3. Join the company again with new account
4. Access his old incident reports
5. Send fake evacuation order to all employees
6. Change zone assignments for other employees
7. Export employee contact list

Test EXACTLY what the system does for each attempt.
Can he succeed? What stops him?
What does admin see?

Rate: X/10

═══════════════════════════════════════
SCENARIO 10 — "The Scale Test"
═══════════════════════════════════════
SOSphere has grown. Now serving:
- 500 companies
- 50,000 employees
- 10 SOS events per day average
- Peak: 100 simultaneous SOS (major incident)

Test EXACTLY:
- Does localStorage still work at this scale?
  (Obviously no — but what breaks first?)
- Which feature degrades first under load?
- What is the theoretical max before system crashes?
- Is there any pagination on emergency lists?
- If one company has a massive incident,
  does it affect other companies' performance?
- What is the data size after 1 year of use?
  (Estimate MB of localStorage per company)

Rate readiness for scale: X/10

═══════════════════════════════════════
REPORT FORMAT:
═══════════════════════════════════════
For each scenario:
✅ WORKS (file:line)
❌ BROKEN (file:line)
💀 DANGEROUS (file:line)
⚠️ MISSING
🔧 FIX: now/Supabase/impossible

Overall score: X/10
Top gaps per scenario
One fix that would improve it most

FINAL SUMMARY:
- Total score across all 10 scenarios
- Top 5 gaps to fix before Supabase
- What would make owner say "WOW" 
  instead of "this is broken"
- Honest answer: ready for first real customer?