This is the most important audit you will ever do.
You are now a forensic safety engineer.
Your only question: "Does this save lives?"

For every answer, show the exact code path.
No assumptions. No "this should work."
Only what ACTUALLY happens in the code.

AUDIT 1 — First Screen to Last Screen:
Trace the COMPLETE path for each user type:

PATH A: Individual user, first time ever opening app
- Screen 1: What do they see?
- How many taps to reach SOS button?
- If they tap SOS on screen 1 accidentally — what happens?
- What is the MINIMUM setup before SOS works?
- If they skip all setup and go straight to SOS — 
  does it work? who gets notified?
- What is the very last screen they see after SOS ends?
- Is there a clear "what to do next" after SOS?

PATH B: Company admin, day 1, brand new account
- Screen 1: What do they see?
- How many steps before first employee is protected?
- What is the minimum viable setup?
- If an emergency happens during setup — 
  can they respond while setting up?
- What is the last thing admin does to close an emergency?
- Is the emergency truly "closed" or just hidden?

PATH C: Employee, receiving company invitation
- They get an SMS with a link/code
- They open the app for the first time
- How many steps before SOS button works?
- What happens if they press SOS before admin approves them?
- After approval — does anything change on their screen?
- What is the last screen in their journey?

AUDIT 2 — Permission and Role Conflicts:
Check every role in the system:

Roles: super_admin, company_admin, zone_admin, 
supervisor, safety_officer, responder, employee, viewer

For each pair of roles, check:
- Can role A see role B's data?
- Can role A perform role B's actions?
- Is there any screen accessible to role A 
  that should be role B only?
- Can an employee accidentally access admin features?
- Can a viewer accidentally trigger an emergency?
- Can two admins conflict (both resolve same emergency)?

AUDIT 3 — Feature Necessity Audit:
For each major feature, answer honestly:

1. Emergency Hub — necessary? saves lives? or just UI?
2. Safety Intelligence — necessary? saves lives? or just UI?
3. SAR Protocol — necessary? saves lives? or just UI?
4. Buddy System — necessary? saves lives? or just UI?
5. Journey Management — necessary? saves lives? or just UI?
6. Risk Register — necessary? saves lives? or just UI?
7. Compliance Reports — necessary? saves lives? or just UI?
8. Gamification — necessary? saves lives? or just UI?
9. Training Center — necessary? saves lives? or just UI?
10. WOW Demo — necessary? saves lives? or just UI?
11. Weather Alerts — necessary? saves lives? or just UI?
12. Audit Logs — necessary? saves lives? or just UI?
13. Batch Email Scheduler — necessary? saves lives? or just UI?
14. RRP Analytics — necessary? saves lives? or just UI?
15. Pre-Shift Checklist — necessary? saves lives? or just UI?

For each: Rate 1-10 on life-safety value.
Rate 1-10 on implementation completeness.
Should it be in v1.0 or a later version?

AUDIT 4 — First and Last Scenario:

FIRST SCENARIO (Day 1, first emergency ever):
Company just signed up yesterday.
Only 1 employee added.
Employee triggers SOS at 3 AM.
Admin is asleep.

Step by step — what EXACTLY happens?
Does the admin wake up? How?
Does the system escalate if admin doesn't respond?
Does the employee know help is coming?
Is this scenario handled end-to-end?

LAST SCENARIO (Company using it for 1 year):
500 emergencies in history.
50 employees.
Major incident: building collapse, 10 employees inside.
Multiple SOS triggered simultaneously.
Admin is on the dashboard.

Step by step — what EXACTLY happens?
Does the system handle 10 SOS correctly?
Does it prioritize automatically?
Is there a clear command and control?
After it's over — is the documentation complete?
Can it be used in court?

AUDIT 5 — The "Would You Trust It?" Test:
Answer YES or NO with one sentence explanation:

1. Would a paramedic trust the medical data sent?
2. Would a judge accept the incident report as evidence?
3. Would a safety inspector approve this system for ISO?
4. Would an employee in danger trust this app?
5. Would an admin under pressure use Guide Me?
6. Would a family member trust the SOS notification?
7. Would an insurance company accept this as proof?
8. Would you personally use this in a real emergency?

For each NO — what is the ONE fix needed?

Report format:
Finding | Evidence (file:line) | 
Life-Safety Impact | Fix Required | 
Can be fixed now or needs Supabase?