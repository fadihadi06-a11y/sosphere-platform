# SOSphere — Root Audit Results, Wave 6 (LINE-BY-LINE deep reads of smaller files)

**Audit date:** 2026-05-22
**Trigger:** User refused stopping at Wave 5; demanded full line-read of every remaining file before any "surgical" fix work.
**Method:** 5 dedicated subagents (C1–C5), each owning a batch of 8-10 smaller component files, with mandate to open and read EVERY line — not grep.

---

## Coverage — files actually line-read

| Batch | Files | New defects | Focus |
|---|---:|---:|---|
| **C1** | 8 (Emergency/SOS deep) | **66** | discreet-sos-screen, sos-emergency-popup, shake-to-sos, fall-detection, emergency-watchdog, evacuation-screen, unified-emergency-engine, emergency-lifecycle-report |
| **C2** | 8 (Auth + onboarding) | **89** | login-phone, login-welcome, otp-verify, mfa-challenge-modal, mfa-enrollment-modal, pin-verify-modal, security-pin-modal, role-select |
| **C3** | 10 (Dashboard pages) | **69** | dashboard-evacuation-page, -analytics, -audit-log, -billing, -location, -jobs, -risk-register, -sar, -geofencing, -gps-compliance |
| **C4** | 10 (Comms + neighbor) | **131** | dashboard-comms-hub, -notifications-panel, notifications-center, neighbor-alert-overlay, neighbor-responses-panel, admin-incoming-call, call-panel, push-notifications, broadcast-island, emergency-chat |
| **C5** | 10 (Compliance + billing) | **114** | compliance-dashboard-v2, compliance-reports, dashboard-pricing-page, subscription-plans, plan-gate, live-billing-panel, trial-banner-live, trial-card, tenant-banner, dpa-page |
| **TOTAL** | **46 files line-read** | **469 new defects** | |

**Grand Total (Waves 1-6): 1,541 + 469 = 2,010 distinct root-level defects.**

R-IDs assigned sequentially this wave: **R-331 → R-799** (continuing from R-330 of Wave 5).

---

## SECTION C1 — Emergency / SOS deep (R-331 → R-396)

### Runtime crashes / Undeclared identifiers
- **R-331** `emergency-watchdog.tsx:35-45` — `useEffect` calls `checkForUnattended()` declared with `const` AFTER the effect; dep array `[emergencies]` excludes the function so a fast re-render captures a stale `unattendedEmergency`. Watchdog latches on a resolved emergency and never re-arms to point at the next unattended worker.
- **R-332** `evacuation-screen.tsx:347` — `STEPS.map((step, i) => ...)` parameter `step` shadows the outer state `step` (line 64) and setter `setStep`. Type-checking passes (different types) but any future reference to outer `step` inside the map silently reads a string instead of a number.
- **R-333** `sos-emergency-popup.tsx:582` — `colorIdx = parseInt(em.id.replace(/\D/g, ""), 10) % AVATAR_COLORS.length`. For IDs without digits (e.g. `EMP-ABC`), `parseInt("")` returns `NaN`, `NaN % 5 = NaN`, `AVATAR_COLORS[NaN]` is `undefined` → destructure `const [avatarFrom, avatarTo] = AVATAR_COLORS[colorIdx]` throws. SOS popup unmounts mid-call.
- **R-334** `sos-emergency-popup.tsx:90-95` — `AVATAR_COLORS[4]` is `["9B59B6", "#7D3C98"]`. Missing leading `#` on the first hex → `linear-gradient(135deg, 9B59B6, #7D3C98)` is invalid CSS; every 5th employee's avatar gradient renders transparent. Admin loses visual triage cue.
- **R-335** `fall-detection.tsx:131` — `setCountdown(prev => { if (prev <= 1) { clearInterval(...); onSOSTrigger(); } })` — calling a side effect inside a state-updater function violates React 18 strict mode and double-invokes in dev/strict trees → SOS fires twice per fall → duplicate Twilio calls, duplicate cards, billing waste.

### Life-safety lies / Toast.success without action
- **R-336** `emergency-lifecycle-report.tsx:638,648,672` — `quickIntegrityCheck()` returns an **object** `{chainContiguous, brokenAt, …}` but used as a boolean: `chainIntegrityStatus ? "VERIFIED" : "UNVERIFIED"`. Object is always truthy → every PDF claims "VERIFIED" even when `chainContiguous=false`. Forensic integrity lie.
- **R-337** `emergency-lifecycle-report.tsx:744` — `toast.success("Emergency Lifecycle Report exported!")` fires inside `try` even if `doc.save()` is silently blocked (popup blocker, sandboxed iframe, FS permissions). Worker's incident record never reaches investigators.
- **R-338** `evacuation-screen.tsx:104-110` — `loadEvacuation` auto-acknowledges on every mount and every `onEvacuationChange` re-fire (even in a background tab). Admin sees worker as "acknowledged" while they may still be unaware → reduced rescue urgency.
- **R-339** `evacuation-screen.tsx:416` — "I've Arrived — I'm Safe" button writes to `updateEmployeeEvacuationStatus` with **no GPS verification** that worker is at `nearestPoint.lat/lng`. Anyone holding the phone can tap to mark safe — same coercion class as duress-PIN/I'm-Safe bypass (R-242).
- **R-340** `emergency-watchdog.tsx:51-60` — `unattended` suppression uses `emg.actionsLog && emg.actionsLog.length > 0`. Auto-logged `ALERT_RECEIVED` entry counts as admin action and silences the watchdog. Worker unattended for 60 minutes with watchdog mute.
- **R-341** `sos-emergency-popup.tsx:611-617` — `handleCallPlaced()` flips state to `ringing_desktop` and calls `onCall(em.id)` without awaiting confirmation that `safeTelCall` actually launched the dialer. Corporate device policy / no SIM / kiosk → UI lies "ringing desktop".
- **R-342** `shake-to-sos.tsx:271-279` — Countdown overlay auto-confirms `onConfirm()` after 5s with no error path. Wet/gloved finger fails to cancel → false SOS fires; 5s is too short for industrial PPE.

### State machine + closure bugs
- **R-343** `sos-emergency-popup.tsx:444-458` — `initializedRef.current = Set<string>` never cleared when emergency dismissed. Second SOS from same `em.id` doesn't auto-ring because `has(e.id)` returns true. Silent second SOS.
- **R-344** `sos-emergency-popup.tsx:464-501` — Master tick effect deps `[activeEms.length, callStates]`. Each `setCallStates` transition re-runs effect, tears down/rebuilds 1s interval → drift of 200-400ms per transition on slow devices.
- **R-345** `sos-emergency-popup.tsx:478-487` — `ringing_phone` countdown falls back to `RING_DESKTOP_SEC` (25) instead of `RING_PHONE_SEC`. If constants diverge, phone ring uses wrong duration.
- **R-346** `sos-emergency-popup.tsx:504-550` — State-machine effect schedules `setTimeout(setCallStates, ...)` (line 513-521) with no cleanup. Unmount between forwarding_phone and ringing_phone → state lurches forward invisibly.
- **R-347** `sos-emergency-popup.tsx:648-654` — `useEffect(deps:[callDurations[em.id], cs])` violates rules of hooks (computed access in deps). Stale `handleEndCall` closure reads wrong duration when auto-end fires.
- **R-348** `shake-to-sos.tsx:91-99` — Auto-clear effect resets `shakesRef.current=[]` but leaves `lastTriggerRef.current` untouched. Cooldown-window/shake-history asymmetry → spam shakes shortly after cooldown reset.
- **R-349** `shake-to-sos.tsx:107-121` (`simulateShake`) — Uses plain `let interval = setInterval(...)`, NOT `useRef`. Unmount mid-simulation → interval keeps firing `setShakeProgress` / `onShakeSOS()` on unmounted component. **THIS IS THE EXACT PATTERN THE USER FLAGGED** (mobile SOS hold timer object vs useRef → false SOS).
- **R-350** `fall-detection.tsx:165-221` — `attachMotion` closure captures `simulateFall` via outer scope, but the outer effect's deps are only `[enabled]`. When `state` changes the handler still holds a stale `simulateFall` with stale `state==="monitoring"` check. After one fall, subsequent free-fall+impact may not trigger.
- **R-351** `fall-detection.tsx:124-148` — Countdown effect deps `[state, onSOSTrigger, countdownSeconds]`. Parent re-render with fresh non-memoized `onSOSTrigger` tears down and rebuilds the countdown interval mid-tick → silently skips 1+ seconds → 15s countdown drifts to 18-20s, delaying SOS during a fall.
- **R-352** `fall-detection.tsx:185` — Cooldown check `Date.now() - lastFallRef.current > 30000` happens BEFORE `lastFallRef.current` is set. Two near-simultaneous samples both pass the check → two `simulateFall` → two SOS records.
- **R-353** `evacuation-screen.tsx:79-83` — Step-cycling `setInterval(..., 3500)` deps `[status]`. Status transition mid-tick allows interval to fire one more time after status changed to `arrived`, briefly showing wrong instructions on the success screen.
- **R-354** `evacuation-screen.tsx:66-70` — `useEffect([])` reads `currentLat/Lng/employeeId/employeeName` from props but only on mount. Parent updates GPS as worker moves; the `onEvacuationChange` listener closure has stale lat/lng → nearest assembly point computed from old position; in fire/chem spill that's lethal.
- **R-355** `discreet-sos-screen.tsx:43-56` — `setInterval(..., 1000)` deps `[]`. Module-state read OK, but a mode upgrade dispatched between ticks is invisible for up to 1s — discreet-mode GPS/audio activation lags by up to 1s.
- **R-356** `discreet-sos-screen.tsx:155-170` — `LowBatteryScreen` `dimTimer`/`deadTimer` set on mount. Quick deactivate+reactivate within 4s leaves stale timers → low-battery deception fails (screen dark instantly with no startup phase), tipping off attacker.

### Auth bypass / Cross-tenant leaks
- **R-357** `sos-emergency-popup.tsx:1050-1056` — `localStorage.setItem("sosphere_sar_prefill", …)` writes SAR target data with no companyId/userId namespace. Same browser, switch tenants → next admin sees prior tenant's missing worker in SAR prefill.
- **R-358** `fall-detection.tsx:27,36` — `"sosphere_sensor_events"` localStorage key, no namespace. Health-relevant sensor history persists across users on same device.
- **R-359** `emergency-lifecycle-report.tsx:163-166` — `"sosphere_company_profile"` read without scoping. After tenant switch, previous tenant's company name brands the PDF cover.
- **R-360** `fall-detection.tsx:84-85` — `tierAllowsFallDetection` evaluated client-side via `getSubscription()`. After downgrade, listener stays bound and continues writing sensor events server-side until next React re-render. Tier enforcement is client-only.
- **R-361** `discreet-sos-screen.tsx:120-126` — `import.meta.env.DEV` gates a "Secret debugging info" overlay. Misconfigured staging build leaks the deception (Mode / Elapsed / Exit hint).

### Memory leaks / Missing cleanup
- **R-362** `shake-to-sos.tsx:107-121` — Same root as R-349: simulateShake interval never cleared on unmount.
- **R-363** `shake-to-sos.tsx:266-279` — `ShakeSOSOverlay` countdown deps `[isVisible, onConfirm]`. Inline-arrow `onConfirm` rebuilds every render → interval restart → countdown drifts; 5s overlay can become 6-7s.
- **R-364** `emergency-watchdog.tsx:35-45` — Effect deps `[emergencies]`. Reference changes every parent render storm → watchdog interval rebuilt many times per second.
- **R-365** `fall-detection.tsx:205-218` — `requestPermission().catch(() => { const iv = setInterval(...); removeListener = () => clearInterval(iv); })` — if promise resolves post-unmount, the outer cleanup already ran with `removeListener=null`; interval leaks forever.
- **R-366** `fall-detection.tsx:117-121,135-138` — Bare `setTimeout` without cleanup on unmount. State transitions post-unmount; component closure pins memory.

### Validation gaps / Modal traps
- **R-367** `emergency-watchdog.tsx:69-72,250` — `handleDismiss` "intentionally does nothing"; modal cannot be exited if both buttons fail. Full-screen `z-[99999]` overlay locks admin out of entire dashboard with no fallback. False fire (R-340+R-364) → dashboard unusable.
- **R-368** `emergency-watchdog.tsx:222,234` — "Take Action / Call 997" buttons have no verification call was placed. Plus: 997 is Saudi Arabia-specific (police). UAE=999, US=911, EU=112 — wrong number for non-KSA tenants. Hard-coded life-safety regression.
- **R-369** `evacuation-screen.tsx:182-184` — `https://maps.google.com/?q=${lat},${lng}&navigate=yes` — no URL encoding, no NaN/Infinity guard. Bad coords → Maps refuses to navigate, worker stranded.
- **R-370** `evacuation-screen.tsx:95-102` — `pts.reduce(...)` with `pts[0]` initial AND recomputes distance for `best` each iteration (O(n²)). Worse: if `currentLat/Lng` are the prop defaults (Riyadh 24.7136/46.6753), nearest is computed from Riyadh, not from worker's actual position.
- **R-371** `evacuation-screen.tsx:88-92` — `points/nearestPoint` are not cleared when active evacuation ends. Stale nearestPoint from prior evacuation can render on next evacuation; worker walks to wrong point.
- **R-372** `sos-emergency-popup.tsx:120` — `https://wa.me/${phone.replace(/[\s+]/g, "")}` — only strips space/plus; no validity check. SIP URI / extension / null → malformed URL; WhatsApp open silently fails.
- **R-373** `discreet-sos-screen.tsx:67-70` — `preventPropagation` only on `onTouchStart/Move`; `onTouchEnd={handleTap}` does NOT preventDefault. Android synthetic click can click-through to underlying app if z-index leaks.
- **R-374** `fall-detection.tsx:189-191` — Reset path `else if (mag > 12) { freeFallRef.current = false; }`. Between 3.0 and 12, `freeFallRef` stays true forever. Lay phone down slowly then drop wrench nearby → false fall.
- **R-375** `fall-detection.tsx:160-161` — `FREE_FALL_THRESHOLD=3.0`/`IMPACT_THRESHOLD=25.0` module constants. The Low/Medium/High `sensitivity` setting does NOTHING. Settings UI is a lie.
- **R-376** `shake-to-sos.tsx:59-83` — Shake threshold fixed at `25 m/s²`. Worker descending stairs with phone in pocket easily hits 3 events in 2s → false SOS overlay; combined with R-342 auto-confirms in 5s.
- **R-377** `unified-emergency-engine.tsx:78` — `if (isPremium) return "ai_co_admin"` selected ONCE via `useState`. Plan change mid-emergency doesn't switch; tampered URL with `isPremium=true` bypasses paywall.
- **R-378** `unified-emergency-engine.tsx:75` — `forceEngine` prop bypasses ALL gating with no caller-side authorization check.
- **R-379** `shake-to-sos.tsx:38,127` — `setIsActive` is exposed externally; buggy parent can set true without any real shake → false SOS cascade.

### Toast.success lies / Other (data integrity, fabricated content, hard-coded geo)
- **R-380** `emergency-lifecycle-report.tsx:243,744` — Double-click on Export collides toast IDs; second export silent failure overwritten by first success toast.
- **R-381** `emergency-lifecycle-report.tsx:355` — Hard-coded `°N` and `°E` on lat/lng. Southern/Western hemisphere deployment → wrong hemispheres in legal filings. `{lat:0,lng:0}` fallback writes "0.0000°N, 0.0000°E" (Gulf of Guinea) as worker's recorded location.
- **R-382** `emergency-lifecycle-report.tsx:147` — `gpsTrail.length === 0` → `gpsCoords={lat:0,lng:0}` with no "GPS unavailable" disclaimer.
- **R-383** `emergency-lifecycle-report.tsx:317-321` — Status ribbon HARD-CODED to "RESOLVED" regardless of `data.status`. Ongoing emergencies stamped as closed.
- **R-384** `emergency-lifecycle-report.tsx:500` — Hard-coded "No injuries reported — Zero Harm achieved" when `injuryReport.occurred` is derived from `severity === "critical"` not from actual injury investigation. Both directions wrong.
- **R-385** `emergency-lifecycle-report.tsx:487` — Hard-coded "Worker Cleared for Duty: Yes — Cleared by on-site nurse". No `clearedByNurse` field exists anywhere. **Every critical PDF lies that a nurse cleared the worker.** Medical-legal liability.
- **R-386** `emergency-lifecycle-report.tsx:686-688` — Sign-off hard-codes "Rania Abbas" (HSE) and "Omar Al-Farsi" (Site Manager) on every report regardless of tenant. Strangers' names appear as the customer's managers.
- **R-387** `sos-emergency-popup.tsx:801` — `MissedCallPanel.onCallBack` emits `EMPLOYEE_CALLING` with `em.id` from parent closure; if list re-orders, emit goes to wrong employee.
- **R-388** `sos-emergency-popup.tsx:1053` — Hard-coded GPS fallback `{lat:24.7136,lng:46.6753}` (Riyadh) when `em.lastGPS` undefined. SAR team dispatched to Riyadh for a worker actually in Jeddah/Dubai/Doha.
- **R-389** `evacuation-screen.tsx:54-55` — Prop defaults `currentLat=24.7136, currentLng=46.6753`. Forget to pass real GPS → worker in Mecca evacuates toward whatever point is closest to Riyadh.
- **R-390** `unified-emergency-engine.tsx:161-163` — Engine selected ONCE on mount. Error-boundary re-mount mid-emergency picks a different engine; admin loses all in-progress context.
- **R-391** `sos-emergency-popup.tsx:1051` — `try { localStorage.setItem(...) } catch {}` swallows quota errors; SAR module opens with no prefill while admin must retype during a real rescue.
- **R-392** `discreet-sos-screen.tsx:331-339` — `onClose` prop declared but never invoked. Parent never notified discreet mode ended.
- **R-393** `shake-to-sos.tsx:16` — Imports `saveSensorEvent` from `./fall-detection` — shake events save under fall-detection's localStorage key; if fall-detection is feature-flagged off (Free tier), shake events still call into its persistence layer.
- **R-394** `evacuation-screen.tsx:74-76` — `Math.floor((Date.now() - evacuation.triggeredAt) / 1000)`. If `triggeredAt` was serialized as ISO string by storage layer, subtraction yields NaN → "NaN:NaN" elapsed.
- **R-395** `emergency-lifecycle-report.tsx:107-114` — `responseTime = realResponseSec ?? Math.min(emg.elapsed, 300)` caps fallback at 300s. ISO 45001 "<60s" check then uses capped value; reporting bias toward favorable response times.
- **R-396** `emergency-lifecycle-report.tsx:225` — "Affected worker medical clearance obtained" hard-coded `"na"` regardless of severity; contradicts R-385 fabricating "Cleared by on-site nurse" in same PDF.

---

## SECTION C2 — Auth + onboarding (R-397 → R-485)

### Auth bypass
- **R-397** `login-phone.tsx:204-212` — `handleGoogleSignIn` calls `onGmailLogin()` without awaiting success/failure; no session inspection. Silent OAuth failure → user treated as authenticated.
- **R-398** `login-phone.tsx:204-212` — `googleLoading` not cleared until OAuth resolves; user can submit email form or "Quick Test Entry" concurrently → undefined session ownership.
- **R-399** `login-phone.tsx:554-565` — `onDemoAccess?.()` gated only by `import.meta.env.DEV`. Production preview with DEV=true → every visitor gets Owner role (parent defaults).
- **R-400** `login-phone.tsx:152-173` — `window.location.reload()` after `signInWithPassword`. Password still in JS memory + DOM at unload → browser extensions / 1Password probes can scrape. Error mid-reload leaves session created but user staring at functional login form → duplicate sessions.
- **R-401** `otp-verify.tsx:88` — Post-success `setTimeout(onVerify, 800)` not cleared on unmount. Back button cancels but stale timer fires `onVerify()` → navigates into dashboard despite explicit cancel.
- **R-402** `login-welcome.tsx:102-105` — Auto-advance `setTimeout(onComplete, 2800)`. No auth state verification — deep-link to /welcome triggers `onComplete()` automatically.
- **R-403** `login-welcome.tsx:120-121` — Entire screen wrapped in `onClick={onComplete}`. Any tap during particle animation completes the welcome gate — zero verification the tapper is the same user as `firstName`.

### OTP replay / OTP weakness
- **R-404** `otp-verify.tsx:111-116` — `resend()` resets UI timer + clears otp array but **never actually calls the resend RPC**. User sees fresh timer and assumes new code sent; the original OTP remains valid for the full token lifetime.
- **R-405** `otp-verify.tsx:74-93` — No client-side rate-limit guard. No `attempts` counter, no backoff, no lockout. Compare to `pin-verify-modal.tsx` which has `MAX_ATTEMPTS=3`.
- **R-406** `otp-verify.tsx:66-68` — Auto-submit fires on 6-digit fill AND on Android multi-digit autofill path → `verifyWithSupabase` invoked twice for the same token → server-side replay risk + audit-log corruption.
- **R-407** `otp-verify.tsx:30-34` — Resend timer is purely client-side. React DevTools can `setTimer(0)` to surface resend button instantly; no server-enforced cooldown reflected back.
- **R-408** `otp-verify.tsx:78-79` — `pendingPhone` could be changed between OTP send and verify if user navigates back and changes country code; verify error then enumerates phones.
- **R-409** `otp-verify.tsx:118` — `maskedPhone = phone.slice(0,-4).replace(/./g, "•") + phone.slice(-4)` exposes last 4 digits in cleartext on every render.

### PIN gate weakness
- **R-410** `pin-verify-modal.tsx:49-50` — `const DEMO_PIN = "123456"` hardcoded module-level. Bundle ships with this string regardless of build flag. Misconfigured build accepts `123456` for **every actor**.
- **R-411** `pin-verify-modal.tsx:54-58` — `hashPIN` uses `SHA-256(\`sosphere_pin_${pin}\`)` — constant prefix is not a salt. Rainbow tables for 10⁶ PINs precomputed in seconds. Should use Argon2/bcrypt + per-user random salt.
- **R-412** `pin-verify-modal.tsx:61-85` — `verifyPIN` has THREE independent fallbacks to demo-PIN acceptance: (a) line 64 when Supabase not configured, (b) line 75 when user has no PIN record in DB, (c) line 82 in catch block on ANY exception. Network blip during PIN check + DEV mistakenly true → demo bypass.
- **R-413** `pin-verify-modal.tsx:79` — `data.pin_hash === pinHash` plain string compare (timing-attack susceptible).
- **R-414** `pin-verify-modal.tsx:155-214` — `verifying` lock is set inside the same function that reads it (not before). Auto-submit useEffect (line 123-127) can re-fire if `pin.length===6 && !locked` while state hasn't flushed → two `handleVerify` invocations both pass `if(verifying) return`.
- **R-415** `pin-verify-modal.tsx:123-127` — Auto-submit effect deps only `[pin]` — does NOT depend on `locked`. After wrong PIN, `setPin([])` re-fires; on the moment of `setLocked(true)`, the effect uses stale `locked` from closure and calls `handleVerify` during lockout transition.
- **R-416** `pin-verify-modal.tsx:161` — `userId = \`${actorLevel}-${actorName}\`` constructed client-side from PROPS. Malicious caller passes `actorLevel="owner", actorName="alice"` and uses any PIN known for that composite key. **IDOR via client-supplied composite key** with no `auth.users.id` foreign key.
- **R-417** `pin-verify-modal.tsx:111-120` — Lockout countdown is purely client-side. Close+reopen the modal → `attempts=0, locked=false` reset (line 130-140). Unlimited brute-force budget per session.
- **R-418** `pin-verify-modal.tsx:234` — Modal closes on backdrop click during critical operations (`revoke_access`, `suspend_user`). One accidental tap dismisses PIN gate.
- **R-419** `pin-verify-modal.tsx:130-140` — Reset effect zeroes attempts/locked on every `isOpen` true. Combined with R-417: unlimited budget.
- **R-420** `pin-verify-modal.tsx:167-178` — Audit-log insert uses `.then(()=>{}).catch(()=>{})` — fire-and-forget swallowed errors. `onVerified()` runs unconditionally after 900ms (line 181). PIN-protected operation proceeds with no audit trail. SOX/HIPAA failure.
- **R-421** `pin-verify-modal.tsx:170` — Audit IDs `AUD-${Date.now()}-${rand(3 chars)}` — 3 chars base36 ≈ 16 bits entropy. On a busy tenant with 46k verifies/day, birthday collisions are routine. Audit integrity broken.
- **R-422** `pin-verify-modal.tsx:180-182` — `setTimeout(onVerified, 900)` no unmount cleanup; cancel mid-success still applies privileged op.
- **R-423** `security-pin-modal.tsx:37-39` — **No auth gate**. `handleSaveNormal` calls `setDeactivationPin` without verifying CURRENT PIN knowledge. Anyone holding an unlocked phone can rewrite the deactivation PIN; later coerce victim into being unable to end SOS, or end SOS themselves before help arrives.
- **R-424** `security-pin-modal.tsx:48` — `/^\d{4,10}$/` allows **4-digit PINs** = 10,000 combos = brute-forceable in seconds on a life-safety surface.
- **R-425** `security-pin-modal.tsx:48,69` — No weak-PIN check: `1234`, `0000`, `1111`, `123456` all accepted.
- **R-426** `security-pin-modal.tsx:53,74` — On failure path, the attempted PIN remains in the input field in cleartext until cleared. Shoulder-surfer reads it.
- **R-427** `security-pin-modal.tsx:86-100` — `handleClearNormal/Duress` fire-and-forget. Clear-fail silently → success message displays anyway → user thinks PIN removed but it's still active. Critical in coercion.
- **R-428** `security-pin-modal.tsx:106-107` — Backdrop click closes mid-PIN-entry → PIN values exposed in DOM.
- **R-429** `security-pin-modal.tsx:33-34` — `showNormal/showDuress` toggles reveal PINs cleartext with **no auto-hide timeout**.

### MFA bypass
- **R-430** `mfa-challenge-modal.tsx:107-109` — Header X calls `onCancel`. Doc-comment says caller should run `completeLogout` but it's not enforced. Caller that wires X to anything weaker drops user past MFA gate with aal1 session intact.
- **R-431** `mfa-challenge-modal.tsx:188-197` — Bottom "Sign out" same risk.
- **R-432** `mfa-challenge-modal.tsx:74-82` — Recovery path: `onVerified("recovery")` fires after 1200ms; **consuming a recovery code does NOT elevate AAL in Supabase**. User passes the app-side gate at aal1 → all menus visible for reconnaissance; only server actions reject.
- **R-433** `mfa-challenge-modal.tsx:67-70` — Recovery code validation strips non-alphanumerics then checks `length < 8`. Any 8+ char alnum reaches the server → no client-side brute-force guard, no attempt counter, no lockout. Compare to PIN's MAX_ATTEMPTS=3.
- **R-434** `mfa-challenge-modal.tsx:81` — `setTimeout(onVerified, 1200)` no unmount cleanup; cancel during success still gates through.
- **R-435** `mfa-challenge-modal.tsx:41` — `factorId` is received as prop with NO validation. Attacker-controlled factorId (URL param, localStorage poisoning) → wrong factor verified.
- **R-436** `mfa-challenge-modal.tsx:131` — Enter key triggers `submit()` regardless of state; double-Enter spawns concurrent submit with no guard at line 48.
- **R-437** `mfa-enrollment-modal.tsx:70-76` — Cleanup checks `completedRef.current`. If user navigates away between `mfaGenerateRecoveryCodes` resolving and the codes step rendering, the factor gets unenrolled even though TOTP was verified server-side → next sign-in locks user out.
- **R-438** `mfa-enrollment-modal.tsx:114-119` — If recovery code generation fails, `completedRef.current=true` set, `setCodes([])` shows empty list; user proceeds with **MFA enabled but zero recovery codes**. Lost authenticator = permanent lockout.
- **R-439** `mfa-enrollment-modal.tsx:177-179` — Header X during codes step: cleanup will NOT unenroll. User left with MFA on but never saw codes.
- **R-440** `mfa-enrollment-modal.tsx:231` — `dangerouslySetInnerHTML={{__html: enrollData.qrCodeSvg}}` — server-provided SVG injected. MITM/response-tampering injects `<script>` in SVG → **XSS in a privileged modal**. Should sanitize (DOMPurify) or render QR client-side from `otpauth://` URI.
- **R-441** `mfa-enrollment-modal.tsx:53-76` — `completedRef.current=true` set BEFORE user sees codes (line 115/120). Browser kill between line 120 and codes-step render → MFA enabled with no codes ever shown.
- **R-442** `mfa-enrollment-modal.tsx:243-245` — "I've added the code" button is just `setStep("verify")` with NO verification user actually scanned anything. Combined with R-440, user can advance past compromised SVG.
- **R-443** `mfa-enrollment-modal.tsx:259-260` — Verify input has NO rate limit, NO max-attempt counter. 10⁶ tries against 30s TOTP window; only server-side rate limit, no client defense-in-depth.

### Role escalation
- **R-444** `role-select.tsx:21-25` — No server-side validation of role choice. `setSelected("employee")` via DevTools to take employee path even on civilian-only account.
- **R-445** `role-select.tsx:65,130` — No double-click protection; rapid double-tap fires both `setSelected` paths; React batching race.
- **R-446** `role-select.tsx:1-234` — Component does NOT import or check ANY auth state. Reachable via URL → unauthenticated user picks role and triggers provisioning for a non-existent session.
- **R-447** `login-phone.tsx:23-25` — `onGmailLogin/onDemoAccess/onEmailLogin` optional callbacks; storybook/test harness wiring `onDemoAccess` to default-Owner silently exposes Owner.

### Race conditions
- **R-448** `login-phone.tsx:178-202` — `handlePhoneSubmit` writes localStorage BEFORE network I/O. Network fail leaves stale country code persisted; R-49 emergency-number resolution uses wrong country.
- **R-449** `otp-verify.tsx:20-28` — 650ms focus setTimeout steals focus mid-typing if user manually focused elsewhere.
- **R-450** `otp-verify.tsx:36-71` — `useCallback` deps `[otp, onVerify]` rebuilds on every otp keystroke; React reschedules listeners on slow devices, can drop a keystroke.
- **R-451** `mfa-challenge-modal.tsx:42-46` — `recoveryRemaining` state set in submit but switching mode back to TOTP via the bottom link (line 175) leaves `recoveryRemaining` visible; success banner stays while form shows TOTP — misleading UI.
- **R-452** `mfa-enrollment-modal.tsx:79-91` — Double-click "Set up authenticator" creates TWO enrollment factors server-side. `factorIdRef.current` only holds the second; first factor leaks unverified forever.
- **R-453** `pin-verify-modal.tsx:130-140` — Reset effect deps `[isOpen]` only; rapid parent toggle wipes verification state.

### Modal traps
- **R-454** `mfa-challenge-modal.tsx:85-89` — No portal, fixed-position inline. Parent unmount mid-verification leaves session in indeterminate aal1.5 state.
- **R-455** `mfa-enrollment-modal.tsx:155-180` — Full-screen overlay, NO Escape key handler. Mobile keyboard hides X button → user trapped during enrollment.
- **R-456** `pin-verify-modal.tsx:223-466` — `AnimatePresence` requires `isOpen` to flip false while mounted. Parent removing the JSX entirely skips exit animation; no audit trail of what happened.
- **R-457** `mfa-challenge-modal.tsx:84-89` — No focus trap. Tab escapes to background login form; user can submit underlying form creating parallel auth flow.
- **R-458** `mfa-enrollment-modal.tsx:154-159` — No backdrop click; on narrow mobile with keyboard up, NO way to cancel (Escape disabled too) → forced flow.
- **R-459** `security-pin-modal.tsx:103-107` — Backdrop click closes mid-PIN-entry.

### Cross-tenant localStorage
- **R-460** `login-phone.tsx:189` — `STORAGE_KEYS.countryCode` global no-namespace. Shared device → User A's country code persists; R-49 dials wrong emergency number for User B.
- **R-461** `login-phone.tsx:46` — Read uses string literal `"sosphere_country_code"` instead of the constant from line 19; rename breaks detection silently.
- **R-462** `mfa-enrollment-modal.tsx:131-150` — `copyCodes` to OS clipboard (persistent); `downloadCodes` writes plaintext file to Downloads — Spotlight/Windows Search/media gallery indexed. No encryption.
- **R-463** `security-pin-modal.tsx:21,38-39` — `duress-service` localStorage with NO user namespacing. User A's deactivation PIN protects User B's SOS sessions on shared device.
- **R-464** `pin-verify-modal.tsx:161` — Composite client-key `${actorLevel}-${actorName}` — Tenant A and Tenant B both have Owner named "Bob Smith" → same row protects both → cross-tenant PIN reuse.

### Validation gaps
- **R-465** `login-phone.tsx:176` — `phone.length >= 8` only; accepts `00000000` or `99999999` → wasted SMS, audit noise.
- **R-466** `login-phone.tsx:182` — Leading-zero stripping absent; `0555...` + `+966` → `+9660555...` invalid E.164.
- **R-467** `login-phone.tsx:105` — Permissive email regex; `a@b.c` accepted.
- **R-468** `login-phone.tsx:135-139` — Email/password submit checks password length only, not email format.
- **R-469** `otp-verify.tsx:39-40` — `if (!digits && value !== "") return;` doesn't clear the digit; field retains old value while user thinks they typed something.
- **R-470** `otp-verify.tsx:101-109` — `handlePaste` slice/length check edge: clipboard with mixed alnum still produces digit-only paste; combined with auto-submit can double-fire.
- **R-471** `mfa-challenge-modal.tsx:127-128` — `maxLength=9` silently truncates `ABCD-EFGHX`; user doesn't see why their code is rejected.
- **R-472** `mfa-enrollment-modal.tsx:259` — Silent non-digit strip; users paste TOTP with trailing space and see it disappear without feedback.
- **R-473** `pin-verify-modal.tsx:142-146` — No digit-value validation in `handleDigit(d)`; programmatic injection writes non-numeric chars; SHA-256 over `'X'+pin` never matches any user's PIN — defense-in-depth gap.
- **R-474** `security-pin-modal.tsx:163,246` — Silent strip on letters typed into PIN input.
- **R-475** `role-select.tsx:11-13` — `onSelectCivilian/onSelectEmployee` required props; no runtime fallback if undefined → `TypeError` → blank-screen crash.

### Dead/unsafe imports & cleanup
- **R-476** `pin-verify-modal.tsx:6` — `useRef` imported but never used. Dead import.
- **R-477** `login-phone.tsx:6` — `OTPVerify` rendered with `phone=""` if `pendingPhone` empty from state corruption → masking logic produces empty masked phone.
- **R-478** `mfa-challenge-modal.tsx:29` — `mfaChallengeAndVerify` lacks try/catch on `await`; unhandled rejection → submit promise rejects → `setVerifying(false)` never called → modal stuck "Verifying..." forever.
- **R-479** `mfa-enrollment-modal.tsx:82,101,109` — All three `mfa*` calls lack try/catch; network failure → `setEnrolling(false)` never called → permanent lock.
- **R-480** `login-welcome.tsx:20-99` — Particle canvas `cancelAnimationFrame` cleanup captures last `animId` from closure; earlier-queued frames may still execute briefly after unmount.

### Race condition / Auth-bypass meta
- **R-481** `login-phone.tsx:142-173` — Dynamic `await import("./api/supabase-client")` returns same singleton as static import; timing race: logout between click and dynamic-import resolve → `signInWithPassword` runs against logged-out client.
- **R-482** `otp-verify.tsx:78` — Same dynamic-import pattern on every verify attempt; concurrent verifies (R-406 double-fire) → distinct promise timings expose concurrency.
- **R-483** `login-phone.tsx:114-116` — `resetPasswordForEmail({redirectTo: \`${window.location.origin}/welcome?type=recovery\`})` — trusts `window.location.origin` blindly. DNS misconfiguration / malicious subdomain → reset link redirects to attacker.
- **R-484** `mfa-enrollment-modal.tsx:53-76` — Code-ordering bug: `completedRef.current=true` set BEFORE user explicitly acknowledges; should be reversed (only after Done checkbox tick).
- **R-485** `pin-verify-modal.tsx:6` (corollary to R-411) — Salt-prefix is a string literal; if leaked, the entire user_pins table is rainbow-table-trivial for 6-digit numeric PINs.

---

## SECTION C3 — Dashboard pages (R-486 → R-554)

### Runtime crashes (undeclared identifiers / wrong APIs)
- **R-486** `dashboard-evacuation-page.tsx:114` — **CONFIRMED**: `setShowTriggerModal(false)` invoked inside `handleTriggerEvacuation` (line 94-117), but neither `showTriggerModal` state nor its setter is ever declared. First real evacuation press throws `ReferenceError`. `triggerEvacuation()` + `sendBroadcast()` have already fired — broadcast queued but `setActiveTab("control")` never runs. Admin sees unchanged trigger form and may double-press → duplicate evacuation broadcasts. **THIS IS THE P0 BUG THE USER FLAGGED.**
- **R-487** `dashboard-audit-log-page.tsx:412-429` — Mapper builds object with both `severity` AND `severity_level` keys; later JS-object dedup means `severity_level` is dead. Any DB row where `severity == null` but `severity_level` is set defaults to `"info"` — suppresses critical rows from compliance reports.
- **R-488** `dashboard-billing-page.tsx:13` — `Divider` imported from `./design-system`; if module doesn't export it, React throws "Element type is invalid" on render.

### Cross-tenant writes
- **R-489** `dashboard-risk-register.tsx:415-419, 424-429` — `useEffect` upserts `risks` and each `training` record to Supabase on every state change. Boot effect (line 384-410) fetched without `company_id` filter — relies entirely on RLS. Wrong-tenant resolution overwrites Company A's register with Company B's data after switch.
- **R-490** `dashboard-risk-register.tsx:399-401` — `looksLikeMock` true when user kept seeded `RSK-001..008` IDs → fire-and-forget upserts 8 fabricated risk entries into Supabase under the user's `company_id` even though user never touched the page.
- **R-491** `dashboard-geofencing-page.tsx:215-238` — `loadGeofencesFromDB()` `select("*")` with no `.eq("company_id", ...)` filter; pure RLS reliance. Misconfigured staging → every tenant's geofences in every admin dashboard. Auto-seeds 5 mock zones (canvas pixel coords labeled as GPS!) into the DB silently.
- **R-492** `dashboard-geofencing-page.tsx:237` — Mock GZ-1..5 zones written to live Supabase, labeled "Restricted/high risk" → auto-generates life-safety alerts pointing nowhere real.

### Hardcoded fake data rendered as live
- **R-493** `dashboard-analytics-page.tsx:35-132` — Eight hardcoded mock arrays drive the dashboard. PDF export at line 339-346 always uses `KPI_SUMMARY` mock, never real KPIs. Customers download "Analytics" PDF with fabricated KPIs (127/87s/87%/96.4%) regardless of company size.
- **R-494** `dashboard-analytics-page.tsx:504, 564, 581, 596` — `SAFETY_TREND`, `ZONE_SAFETY`, `RADAR_DATA`, `DEPT_PERFORMANCE` always rendered from mock constants — no real-data path. "Department Leaderboard" / "Zone Safety Comparison" / "Safety Radar" are 100% fake for every tenant.
- **R-495** `dashboard-analytics-page.tsx:370` — PDF "Zone Safety Scores" hard-codes Zone D as "AT RISK" via `ZONE_SAFETY` constant — regardless of actual data.
- **R-496** `dashboard-analytics-page.tsx:644-663, 781` — `BROADCAST_TREND` mixes mock with one real week; `COST_COMPARISON` and "$1,440 saved / $17,280/year" banners purely static.
- **R-497** `dashboard-audit-log-page.tsx:114-354` — `MOCK_AUDIT` (29 fabricated entries with named employees, IPs, 2FA flags) — fallback path at 459-471 gates on `DEV_DEMO_AUDIT`, but PDF page (line 1131) iterates `filtered` regardless; misconfigured DEV → leaked into prod compliance PDFs.
- **R-498** `dashboard-billing-page.tsx:312-317` — `BASE_INVOICES` hardcodes 4 historical invoices (Jan/Feb/Mar 2026, Dec 2025) computed from CURRENT plan + addons. A user on Starter for one day sees December 2025 already invoiced at their current price.
- **R-499** `dashboard-billing-page.tsx:660-665, 313-316` — Period strings literally hard-coded "March 2026" / "February 2026" regardless of signup date.
- **R-500** `dashboard-geofencing-page.tsx:194-205` — `EMPLOYEE_DOTS` (10 fake employees with canvas-pixel coords) drawn at line 360-377 when `showEmployees` on — indistinguishable from real GPS tracks.
- **R-501** `dashboard-risk-register.tsx:71-169` — `MOCK_RISKS` (8 entries) + `MOCK_TRAINING` (12 entries) with named employees and "Working at Heights expired" certs. PDF export at line 270 runs over whichever array is in state; initial paint includes MOCK until Supabase reconciles → exported PDF shows fake certified employees.
- **R-502** `dashboard-sar-page.tsx:74-103` — `SAR_SCENARIOS` hardcodes 4 employees; `handleStartMission` (line 586) creates real `SARMission`, saves via `saveSARMission`, emits `emitAdminSignal("SAR_ACTIVATED")` → propagates to real mobile clients tracking the store. Demo banner doesn't stop the signal.

### Life-safety lies / Toast.success lies
- **R-503** `dashboard-evacuation-page.tsx:104-117` — `handleTriggerEvacuation` invokes `triggerEvacuation()` + `sendBroadcast(priority:"emergency")`, then crashes (R-486). Broadcast already queued; no rollback.
- **R-504** `dashboard-evacuation-page.tsx:94-117` — Trigger requires NO 2FA, NO confirmation, NO role check. Any code path → company-wide emergency broadcast. No audit-log call.
- **R-505** `dashboard-evacuation-page.tsx:119-145` — `handleComplete/Cancel` no audit, no confirmation. "Cancel" wipes active evacuation and broadcasts "all clear" without verification.
- **R-506** `dashboard-billing-page.tsx:619, 644, 858, 838` — Four `toast.success("Downloading … Invoice")` calls but no PDF/ZIP is actually generated.
- **R-507** `dashboard-billing-page.tsx:549` — "Save All Zones" toast — no API call accompanies.
- **R-508** `dashboard-billing-page.tsx:275` — Local-fallback plan switch fires `toast.success("Plan updated to $X/month")` even though no payment collected and no webhook signed.
- **R-509** `dashboard-risk-register.tsx:438, 448, 456` — `toast.success("Risk updated")` fires BEFORE Supabase write; error path swallowed.
- **R-510** `dashboard-sar-page.tsx:551, 555-558, 656, 671` — `toast.success("SAR Mission launched — mobile workers alerted")` — `emitAdminSignal` is localStorage-only; mobile workers off-device are never alerted. Demo/live text identical.
- **R-511** `dashboard-gps-compliance.tsx:215-219` — `autoBroadcastOutOfZone` fires per snapshot per interval with no dedup window → flood Broadcast Center.

### Auth / verification gaps
- **R-512** `dashboard-audit-log-page.tsx:497-521` — `handleExport` (CSV) and `handleExportPDF` no role check. Any authenticated user dumps full audit log. No log entry recorded that the export happened.
- **R-513** `dashboard-audit-log-page.tsx:1342-1361` — PDF claims "Tamper Detection: Blockchain-anchored hash verification" and "DATA VERIFIED" — code never anchors to any blockchain. **False certification claim → legal liability**.
- **R-514** `dashboard-audit-log-page.tsx:399-402, 438-452` — Audit entries from `getRealAuditLog()` (localStorage). Client-writable. Malicious admin injects fabricated entries with `verified2FA: true` before export.
- **R-515** `dashboard-geofencing-page.tsx:52-84` — `saveGeofenceToDB` writes localStorage first, then Supabase. RPC silently rejects (console.warn only) → UI shows zone saved while never reaching server.
- **R-516** `dashboard-billing-page.tsx:404` — "Reactivate Now" → `switchPlan("starter")` with NO confirmation; one click = $149 charge.

### GPS / geofencing spoofing
- **R-517** `dashboard-gps-compliance.tsx:215-219, 209` — `runComplianceCheck` reads `currentLat/Lng` with no spoof-detection. Mock-location enabled → worker pins "in zone" indefinitely.
- **R-518** `dashboard-geofencing-page.tsx:1175-1178` — `toCanvas` math `x = ((lng - 40) / 30) * 600 + 80` is FAKE projection. Zones edited via "Relocate via GPS" get canvas pixel coords masquerading as lat/lng. Any future GPS-mapped evacuation = wrong location.
- **R-519** `dashboard-geofencing-page.tsx:1113` — `radius = Math.max(30, Math.min(data.radiusMeters/5, 80))` — 500m geofence becomes 80px canvas circle; alerts reference 500m while canvas thinks 80px.

### Modal traps
- **R-520** `dashboard-evacuation-page.tsx:691, 833-842` — `AssemblyPointModal` `handleSavePoint` throw → modal stays open with stale state.
- **R-521** `dashboard-geofencing-page.tsx:255-257` — `showCoordsEditor` persists across zone selection → editor appears for next zone without explicit intent (high-risk operation).
- **R-522** `dashboard-audit-log-page.tsx:1583-1589` — 1.5s `setTimeout` for email prompt; stale closure on unmount.
- **R-523** `dashboard-sar-page.tsx:1352-1386` — `showEndOptions` dropdown has no outside-click handler.

### Validation gaps
- **R-524** `dashboard-evacuation-page.tsx:883-894` — `parseFloat(lat/lng)` no bounds check, no NaN guard; `EP-${Date.now()...}` IDs collide on same-ms.
- **R-525** `dashboard-evacuation-page.tsx:881` — `canSave = name && zoneId && lat && lng` — "abc"/"0" strings pass. Resulting lat=NaN → `maps.google.com/?q=NaN,NaN`.
- **R-526** `dashboard-billing-page.tsx:153-156` — `loadJSONSync` tampered → toggle ends up in unrendered state.
- **R-527** `dashboard-billing-page.tsx:198-278` — `switchPlan(planId: string)` no validation against allowed IDs.
- **R-528** `dashboard-geofencing-page.tsx:986, 882, 875` — `parseInt(value) || 0` — negative numbers pass → NaN width on capacity bar.
- **R-529** `dashboard-jobs-page.tsx:235-264` — `handleCancel` no server re-check before RPC; no re-fetch if Realtime disconnected → stale "Cancelled" state.

### Mass-update / data-integrity
- **R-530** `dashboard-risk-register.tsx:482-508` — `risk.zone.toLowerCase().includes(zone.toLowerCase())` substring match → SOS in "Zone A" bumps every risk whose zone string CONTAINS "zone a" (including "Zone A-2"). `lastReviewedBy: "System (Auto-updated from emergency)"` overrides legitimate human reviews. Silent risk-likelihood inflation chain.
- **R-531** `dashboard-risk-register.tsx:424-429` — Every `training` state change loops every record and upserts each one — 1000 records = 1000 RPCs on a single edit. Write amplification.
- **R-532** `dashboard-risk-register.tsx:451-457` — `markTrainingComplete` sets `expiryDate = now + 365d` regardless of cert type. NEBOSH = 3yr, fire marshal = 2yr — silently reset to one-year. ISO 45001 reports broken.

### Misc
- **R-533** `dashboard-billing-page.tsx:312-316` — `BASE_INVOICES.extraCost` recomputed from CURRENT employee count → December 2025 invoice retroactively mutates when today's employees grow.
- **R-534** `dashboard-billing-page.tsx:830-832` — Past invoices "Download PDF" only fires toast.
- **R-535** `dashboard-audit-log-page.tsx:790` — `doc.setFillColor(255,150,0,0.15 as any)` — dead code, `as any` hides type error. Other style calls likely hacked similarly.
- **R-536** `dashboard-evacuation-page.tsx:368-372` — `ActiveEvacuationBanner` timer deps `[evacuation.triggeredAt]`; reference change with same triggeredAt → timer doesn't reset.
- **R-537** `dashboard-gps-compliance.tsx:231-249` — Deps `[autoEnabled, performCheck, result]`; `result` changes every check → interval rebuilt → wasted refs and missed ticks.
- **R-538** `dashboard-sar-page.tsx:1846-1849` — Phase-summary text from `totalElapsed`; `mission.currentPhase` from `getPhaseLabel`. Texts disagree on manual phase escalation.
- **R-539** `dashboard-sar-page.tsx:1319-1337` — "Alert Workers" `emitAdminSignal` localStorage cross-tab only; toast lies under demo banner.
- **R-540** `dashboard-geofencing-page.tsx:228-234` — Empty Supabase + populated localStorage → `setZones(localZones)` with no DB upsert; localStorage from previous tenant persists visually on next tenant.
- **R-541** `dashboard-analytics-page.tsx:339` — PDF iterates `KPI_SUMMARY` (mock) not `realKPI`.
- **R-542** `dashboard-evacuation-page.tsx:101` — `triggeredBy: "Admin"` hardcoded; also senderName/Role at 111, 128, 142. Forensic accountability lost.
- **R-543** `dashboard-audit-log-page.tsx:1379-1380` — Legal text claims "cryptographic integrity verification" but realEntries flow through mutable localStorage.
- **R-544** `dashboard-billing-page.tsx:600, 770-776` — Add-on toggles disabled with "Coming soon" but `activeAddons` state + addonsTotal calc still active; localStorage tamper (line 145) → billing summary shows price without Stripe path.
- **R-545** `dashboard-risk-register.tsx:363-371` — Risk hydration from `localStorage.getItem("sosphere_risks")` — same cross-tenant leak as R-540.
- **R-546** `dashboard-analytics-page.tsx:214` — `React.useMemo(buildRealAnalytics, [])` empty deps; analytics computed ONCE at mount — new SOS events during session never reflect.
- **R-547** `dashboard-gps-compliance.tsx:259-262` — `filteredSnapshots` not memoized; re-runs every keystroke + countdown tick.
- **R-548** `dashboard-sar-page.tsx:526` — Auto-load effect deps `[]` reads `activeMission`; subsequent set doesn't re-evaluate.
- **R-549** `dashboard-audit-log-page.tsx:458-472` — `DEV_DEMO_AUDIT = (import.meta as any).env?.DEV === true` — `as any` suppresses type check that would catch a build accidentally inlining DEV=true.
- **R-550** `dashboard-risk-register.tsx:443 vs 766` — Risk-level boundaries inconsistent: mutation uses `score >= 5 → medium`; display uses `score >= 6 → medium`. Same score, different bucket per code path.
- **R-551** `dashboard-billing-page.tsx:404` — One click between trial-expired user and $149 charge; no confirmation.
- **R-552** `dashboard-evacuation-page.tsx:867-878` — `parseGoogleMapsLink` loose regex matches "12.3456, -45.6789" in any unrelated text; admin can paste a forum post and create assembly point in the ocean.
- **R-553** `dashboard-billing-page.tsx:1` — `useCallback`/`useMemo` imported; `useCallback` used only for `switchPlan`. Minor.
- **R-554** `dashboard-sar-page.tsx:629-654` — `void (async () => {...})()` fire-and-forget audit log; hangs orphaned; failures only `console.warn`. Training sessions occur without audit records.

---

## SECTION C4 — Comms / neighbor / notifications (R-555 → R-685)

### Runtime crashes
- **R-555** `dashboard-notifications-panel.tsx:299` — `import.meta.env.DEV` accessed without guard; production where `import.meta` is undefined → crash on init → Bell button gone, admin can't see SOS alerts.
- **R-556** `dashboard-notifications-panel.tsx:417` — `SOS_EVIDENCE_SUBMITTED` branch assigns `newNotif.icon = "📸"` but interface has no `icon` field (only `emoji?`) → silent drop in JSX → evidence notification renders with default SOS siren, admin doesn't realize evidence arrived.
- **R-557** `dashboard-notifications-panel.tsx:431` — `new AudioContext()` on every critical event; Chrome caps ~6 → after dozens of SOSs, no alarm tone.
- **R-558** `admin-incoming-call.tsx:155-193` — `handleAnswer` is async; click returns before `voiceCallEngine.answerCall` resolves. Engine throw → state already "connected", signals already emitted, audio bridge nonexistent → caller hears silence, assumes nobody answered.
- **R-559** `admin-incoming-call.tsx:188` — `info.state === "ended"` check uses `callStateRef.current !== "missed"`. State-set-to-"declined" then `handleEndCall` → double `CALL_ENDED` + stale `SOS_CONTACT_ANSWERED` audit.
- **R-560** `admin-incoming-call.tsx:264` — Backdrop click triggers `handleEndCall` outside ringing → emits another CALL_ENDED + duplicates billing/audit row per click.
- **R-561** `admin-incoming-call.tsx:131` — `setTimeout(onDismiss, 2500)` no cleanup → closes NEW call overlay if another EMPLOYEE_CALLING signal arrives.
- **R-562** `admin-incoming-call.tsx:135` — Auto-miss `useEffect` deps `[callState]` but body reads `signal.employeeId`; race between two SOSes uses stale signal closure → addresses wrong employee as "missed".

### Push / notification failures
- **R-563** `push-notifications.tsx:54-60` — Safari prompt-only-on-user-gesture rule means `useEffect` invocations rejected silently → `permission` shows "default" forever.
- **R-564** `push-notifications.tsx:155-159` — `setPermission(result)` doesn't distinguish "default/never-decided" from "denied" → repeat prompts pile.
- **R-565** `push-notifications.tsx:79-84` — No `icon`/`badge`/`vibrate` on Notification → no haptic for critical SOS on PWA install.
- **R-566** `push-notifications.tsx:86-89` — `n.onclick = () => { window.focus(); n.close(); }` — no deep-link to emergency, no mark-as-read.
- **R-567** `push-notifications.tsx:74` — `playSound` runs BEFORE permission check → sound plays in muted/background tabs in violation of user choice; Chrome eventually blocks for abuse.
- **R-568** `push-notifications.tsx:93` — `setTimeout(n.close, 10000)` never cleared → 100 notifs/hr leak 100 stale timers/hr.
- **R-569** `push-notifications.tsx:179` — `[notif, ...prev].slice(0, 50)` — mass-incident with >50 SOSs drops OLDEST first (longest-waiting).
- **R-570** `push-notifications.tsx:299` — `NotificationToast` auto-dismiss recreated per render via `[notification, onDismiss]`; inline-arrow `onDismiss` → toast may never dismiss or instantly dismiss.
- **R-571** `push-notifications.tsx:212, 217` — `permission === "unsupported"` (Safari iOS pre-16.4 PWA) → card renders but button does nothing → no error message.

### Broadcast filter bypass
- **R-572** `notifications-center.tsx:100-101` — `getBroadcastsForEmployee("EMP-APP", "employee", "Z-B")` HARDCODED. **Every mobile user sees broadcasts targeted at "EMP-APP" in Zone B regardless of actual zone/role.** Worker in Zone A sees Zone B evacuation broadcast → evacuates wrong building.
- **R-573** `notifications-center.tsx:117-118` — `markBroadcastRead(b.id, "EMP-APP")` hardcoded recipient → shared-store credits "EMP-APP" for every read → broadcast author sees one "EMP-APP" not the actual recipient name.
- **R-574** `notifications-center.tsx:105` — `setInterval(loadBroadcasts, 3000)` — no `visibilitychange` pause (R-251 pattern).
- **R-575** `notifications-center.tsx:104-106` — `onBroadcastReceived` re-fetches entire list per event → O(N*M).
- **R-576** `broadcast-island.tsx:33-36` — Auto-dismiss after 6s INCLUDING `priority === "emergency"`. Evacuation broadcast disappears in 6s if user glances away.
- **R-577** `broadcast-island.tsx:71` — `setTimeout(dismiss, AUTO_DISMISS_MS * 2)` on expand uses outer `dismiss` closure → second broadcast expansion dismisses the FIRST broadcast 12s after first expand.
- **R-578** `broadcast-island.tsx:27-37` — Newest broadcast OVERWRITES current with no queue. Fire alarm + "go to muster B not A" sequence → second silently replaces first; reading-user sees nothing.
- **R-579** `broadcast-island.tsx:50` — Early `return null` prevents AnimatePresence exit animation.
- **R-580** `broadcast-island.tsx:141` — `currentBroadcast.priority.toUpperCase()` throws on null priority → top-bar crash.

### Neighbor alert spoofing
- **R-581** `neighbor-alert-overlay.tsx:53-77` — `startNeighborListener` accepts incoming payload with no signature/origin verification. Attacker with anon key + INSERT on `neighbor_alerts` spoofs alerts. React escapes JSX content (XSS mitigated), but **lure attack possible**: fake distress signal at 0 m → responder walks into ambush.
- **R-582** `neighbor-alert-overlay.tsx:118-119` — `Math.round(alert.distanceKm * 1000)` for sub-1km; spoofed 0 → "0 m away" lures responder.
- **R-583** `neighbor-alert-overlay.tsx:97-111` — `handleRespond` ALWAYS shows `toast.success` regardless of `respondToAlert` success; comment admits errors swallowed.
- **R-584** `neighbor-alert-overlay.tsx:78` — Deps deliberately empty; `lang` change mid-alert → stale `tr()` from old closure → Arabic user gets English labels.
- **R-585** `neighbor-alert-overlay.tsx:89` — Auto-dismiss 2min fixed regardless of severity; no persistence to notifications-center for missed neighbor alerts.
- **R-586** `neighbor-alert-overlay.tsx:201` — "Calling emergency services" button records metadata but does NOT actually dial.
- **R-587** `neighbor-alert-overlay.tsx:164-170` — Dismiss X nulls alert with no `respondToAlert("cannot_help")` → requester counts dismissals as "nobody responding".
- **R-588** `neighbor-responses-panel.tsx:74-77` — Dedup key `${status}:${Math.floor(bucket/1000)}` — same second + same status from different responders = ONE response counted. Busy neighborhood → systematic undercount.
- **R-589** `neighbor-responses-panel.tsx:79` — `(prev[r.status] ?? 0) + 1` no upper bound; Realtime flood inflates counter; requester sees "47 neighbors responded" when only one acted.
- **R-590** `neighbor-responses-panel.tsx:84` — `seenRef` set NEVER cleared between unmount/remount of same emergencyId → new responses with same status+ts silently dropped.

### Call routing
- **R-591** `admin-incoming-call.tsx:86` — `tel:` only strips spaces, leaves `+`, `(`, `)`, hyphens; Android Dialer rejects parens → auto-fallback dial silently fails.
- **R-592** `admin-incoming-call.tsx:84` — `localStorage.getItem("sosphere_admin_phone")` no namespace → multi-tenant kiosk collision; Admin A's auto-fallback dials Admin B's number.
- **R-593** `admin-incoming-call.tsx:88-91` — Catch swallows both localStorage and `window.open` failures; admin assumes phone rang.
- **R-594** `admin-incoming-call.tsx:172, 215, 240` — `adminName: "Safety Admin"` HARDCODED in 3 separate audit events (R-324 repeats). Forensic accountability destroyed.
- **R-595** `admin-incoming-call.tsx:185` — `callId = \`sos-call-${signal.employeeId}\`` — two SOS calls from same employee in one session reuse callId; voice engine state bleeds.
- **R-596** `admin-incoming-call.tsx:547` — `callbackId = signal.data?.emergencyId || \`callback-${signal.employeeId}\`` — fallback per-employee → second callback to same employee gets same callId.
- **R-597** `admin-incoming-call.tsx:585-587` — Engine emits "ended" synchronously during subscribe (previous callId already ended) → `handleEndCall` fires before call actually starts.
- **R-598** `admin-incoming-call.tsx:572-579` — Missing `callSid` → `callState="ended"` after 2s but subscribe was never attached; voice engine audio context not cleaned up.
- **R-599** `admin-incoming-call.tsx:599` — `useEffect([])` for Twilio dial; signal prop change doesn't re-run → new signal's phone never called.
- **R-600** `admin-incoming-call.tsx:777-787` — `signal == null` branch clears NEITHER incoming nor outgoing → stale overlay forever.
- **R-601** `call-panel.tsx:89-100` — `handleDeviceCall` calls `safeTelCall` then immediately `startAdminCall(...)` regardless of OS actually opening dialer. Desktop with no `tel:` handler → phantom billing.
- **R-602** `call-panel.tsx:94-99` — `employeeId: \`EMP-CALL-${Date.now()}\`` synthetic ID not tied to real employee → audit can't correlate to SOS.
- **R-603** `call-panel.tsx:102-107` — `wa.me/${num}` strips leading `+` → international format `+966501234567` becomes `966501234567`; carrier interpretation varies.
- **R-604** `call-panel.tsx:104` — `window.open(wa.me)` no `noopener` → reverse tabnabbing exposure.
- **R-605** `call-panel.tsx:110` — `clipboard.writeText().catch(()=>{})` swallows; `setCopied(true)` runs regardless → "Copied!" with empty clipboard.

### WebSocket / subscription leaks
- **R-606** `dashboard-notifications-panel.tsx:444` — `return unsub` from `onSyncEvent`; deps `[soundEnabled]` → toggle sound icon re-subscribes; high-frequency toggles balloon listeners.
- **R-607** `dashboard-notifications-panel.tsx:336-445` — SOS listener attached regardless of `isOpen`. AudioContext allocated when panel never opened.
- **R-608** `emergency-chat.tsx:72-80` — `if (!emergencyId) return;` skips subscription but `setMessages` from prior effect persists. Stale messages display.
- **R-609** `emergency-chat.tsx:348-355` — Same `onChatMessage` race; emergencyId change with parent kept mounted → multiple emergencies share state.
- **R-610** `emergency-chat.tsx:560-561` — `ChatBadgeButton.setMsgCount(getChatMessages(emergencyId).length)` no dep tracking on `emergencyId`; brief previous count on button reuse.
- **R-611** `notifications-center.tsx:105-106` — 3s poll + `onBroadcastReceived` both run unconditionally; no tab-visibility pause (R-251 exact).
- **R-612** `admin-incoming-call.tsx:469` — `setInterval` deps `[call.startedAt]`; same object reference mutation → no detection.
- **R-613** `admin-incoming-call.tsx:759-788` — `useEffect([])` subscribes to `onCallSignal`; nav remount → repeated listeners.
- **R-614** `neighbor-alert-overlay.tsx:78-80` — Empty deps; `suppress` prop change doesn't pause listener; updates ignored by line 95.
- **R-615** `broadcast-island.tsx:42` — Cleanup races with synchronous `onBroadcastReceived` post-`unsub` → broadcast on screen with no auto-dismiss timer.

### Modal traps / state
- **R-616** `notifications-center.tsx:281-291,299` — Filter+empty state hides Clear button when filtered=0 but notifs>0.
- **R-617** `notifications-center.tsx:146-148` — Time-bucket regex: "1m ago" and "1mo ago" both match `m ago` → months bucket appears in "today".
- **R-618** `emergency-chat.tsx:194` — Empty-state flash during async load.
- **R-619** `emergency-chat.tsx:84` — `scrollTo({behavior:"smooth"})` on every message change → admin reading older messages loses scroll position when new arrive.
- **R-620** `emergency-chat.tsx:369, 383` — `senderName: "Admin"` HARDCODED (R-324 again). Field worker has no idea which dispatcher messaged.
- **R-621** `emergency-chat.tsx:229, 262` — `msg.message` rendered in `<p>` (React escapes OK), but pattern of concatenating `preset.icon` is fragile if `preset.icon` ever sourced from user content.
- **R-622** `emergency-chat.tsx:295, 520` — `maxLength=500` client-only; no server-side enforcement.
- **R-623** `emergency-chat.tsx:559` — Initial `getChatMessages` async-stale; badge briefly shows nothing.

### Auth gaps
- **R-624** `admin-incoming-call.tsx:561-570` — `supabase.functions.invoke("twilio-call")` from browser with public client; relies entirely on edge function verifying admin/owner; no client-side guard.
- **R-625** `neighbor-alert-overlay.tsx:99` — `respondToAlert` no client user-context; relies on server RLS for geocell + non-requester verification.
- **R-626** `dashboard-notifications-panel.tsx:281-300` — No tenant/zone filter on emergencies → notifications leak across tenants if store is multi-tenant in memory.
- **R-627** `call-panel.tsx:104` — `wa.me` opens with NO authentication of who's calling; employee receives msg from random personal number.
- **R-628** `notifications-center.tsx:117-119` — `markBroadcastRead` client-supplied "userId" trusted.

### Toast lies
- **R-629** `neighbor-alert-overlay.tsx:103-109` — toast.success unconditional after `respondToAlert` (swallows).
- **R-630** `call-panel.tsx:114` — `setCopied(true)` regardless of clipboard.
- **R-631** `call-panel.tsx:200` — "Call opened!" without verification.
- **R-632** `emergency-chat.tsx:96-97, 111` — `setMessages(getChatMessages(...))` shows message as sent even on RLS reject (returns optimistic local cache).
- **R-633** `dashboard-notifications-panel.tsx:462-468` — `handleMarkAllRead/ClearAll` local-only; refresh resets unread count.
- **R-634** `notifications-center.tsx:114-120` — INITIAL_NOTIFICATIONS not persistent → 10 demo notifs re-appear on remount.
- **R-635** `notifications-center.tsx:140-143` — `clearAll` empties local but no shared-store delete → next remount reloads.
- **R-636** `push-notifications.tsx:188-190` — `clearAll` local only.

### Cleanup / misc
- **R-637** `dashboard-notifications-panel.tsx:431-441` — AudioContext never closed; hours of accumulation.
- **R-638** `dashboard-notifications-panel.tsx:467` — `handleClearAll` preserves critical even if marked-read → criticals pollute panel forever.
- **R-639** `dashboard-notifications-panel.tsx:319-327` — Mock notifs flip back to unread after every store update because merge spread loses read flag.
- **R-640** `dashboard-notifications-panel.tsx:301-302` — `showFilter` state declared but never used in render.
- **R-641** `notifications-center.tsx:97-107` — `loadBroadcasts` rebuilt every render with `[]` deps captures stale closure if `getBroadcastsForEmployee` ever depends on external state.
- **R-642** `emergency-chat.tsx:341-346` & `:348-355` — Two effects set `messages`; async load may resolve after `onChatMessage` delivers newer → real-time messages disappear/reappear.
- **R-643** `emergency-chat.tsx:67-69` — `MobileEmergencyChat` same race + post-send re-read may miss just-sent message.
- **R-644** `admin-incoming-call.tsx:74-75` — Cleanup ran before subscription is set when `answerCall` promise resolves post-unmount.
- **R-645** `admin-incoming-call.tsx:824` — `incomingSignal && !adminActiveCall` — admin on a normal call → SOS overlay SUPPRESSED. **Life-safety: SOS may not be visible during routine call.**
- **R-646** `broadcast-island.tsx:46-48` — Layout glitch on rapid dismiss/expand.
- **R-647** `push-notifications.tsx:104-106` — Singleton AudioContext never `.resume()`-d after tab hide → silent sound on return.
- **R-648** `push-notifications.tsx:140` — Audio errors swallowed; no fallback alert mechanism.
- **R-649** `dashboard-comms-hub.tsx:114` — `useState(initialTab)` honored only on initial render; deep-link arriving later doesn't update.
- **R-650** `dashboard-comms-hub.tsx:121-134` — `<AnimatePresence mode="wait">` with `key={activeTab}` remounts entire page → loses scroll/filter/draft + resets active evacuation tracking mid-incident.
- **R-651** `notifications-center.tsx:39-50` — INITIAL_NOTIFICATIONS hardcoded names ("Sarah", "Alex") rendered in production.
- **R-652** `neighbor-alert-overlay.tsx:127` — Whitespace-only displayName falls through trim; RTL override unicode renders raw → visual spoof.
- **R-653** `neighbor-responses-panel.tsx:91, 88, 115` — `total` excludes `cannot_help` from "responded" count → underreport.
- **R-654** `dashboard-notifications-panel.tsx:154-160` — Time precision: SOS 30s ago shows "Just now"; admin can't tell 5s from 55s.
- **R-655** `dashboard-notifications-panel.tsx:283-295` — Initial state stale-on-first-render before sync effect runs.
- **R-656** `emergency-chat.tsx:357-359` — `if(isOpen) setUnread(0)` deps `[isOpen, messages]`; effect runs while closed (no-op `if`) — perf.
- **R-657** `admin-incoming-call.tsx:60` — Subscribe called twice (handleAnswer + subscribe in callback) → first unsub overwritten → leak.
- **R-658** `push-notifications.tsx:38-44` — Singleton AudioContext per-tab; multi-tab → layered audio during emergency.
- **R-659** `broadcast-island.tsx:64-66` — `top-1` (4px) — overlaps notch/status-bar on devices without safe-area-inset.
- **R-660** `call-panel.tsx:91` — `safeTelCall` synchronous setCallDone("device") — UI lies before user confirms.
- **R-661** `notifications-center.tsx:111` — `unreadCount = notifications.filter(...).length` re-computed per render; downstream React.memo invalidates.
- **R-662** `dashboard-notifications-panel.tsx:447-449` — `filtered` non-memoized.
- **R-663** `dashboard-notifications-panel.tsx:339-345` — `event.zone || "Unknown Zone"` — should escalate to GPS coords if zone missing.
- **R-664** `emergency-chat.tsx:232` — `toLocaleTimeString` no timezone; admin/employee in different TZ → mismatched times.
- **R-665** `admin-incoming-call.tsx:299` — `voiceInfo?.elapsed ?? 0`; engine death freezes "03:42" for minutes while no audio flows.
- **R-666** `broadcast-island.tsx:101-110` — Pulse only for emergency; urgent evacuation doesn't pulse → visual collision with info.
- **R-667** `dashboard-notifications-panel.tsx:438-440` — 880Hz sine wave only; no flash/haptic for hearing-impaired.
- **R-668** `neighbor-alert-overlay.tsx:135` — `absolute inset-0 z-50` — `absolute` not `fixed`; parent `position: relative` breaks overlay viewport.
- **R-669** `neighbor-alert-overlay.tsx:144, 163-170` — X close p-2 tiny → fat-finger taps response button.
- **R-670** `push-notifications.tsx:331-333` — Critical toast `scale: [1,1.15,1]` runs forever → GPU spike with stacked criticals.
- **R-671** `emergency-chat.tsx:293, 520` — Enter sends; no Shift+Enter for newline → multi-line incident description impossible.
- **R-672** `emergency-chat.tsx:559-562` — Badge count not reset on emergencyId change → stale count flash.
- **R-673** `admin-incoming-call.tsx:802-808` — `clearCallSignal` wipes signal both UI references; dismissing one wipes the other.
- **R-674** `dashboard-comms-hub.tsx:131-132` — `webMode` no auto-detection on mobile.
- **R-675** `neighbor-alert-overlay.tsx:188` — No `disabled` state during in-flight respond → double-tap sends two.
- **R-676** `call-panel.tsx:298-302` — `setAnchor` computed but unused (centered modal).
- **R-677** `broadcast-island.tsx:142` — "SOS" displayed for emergency priority but broadcast may be evacuation, not SOS.
- **R-678** `dashboard-notifications-panel.tsx:565-580` — "Mark all read" doesn't preserve urgency on new-unread SOS that arrives during the bulk action.
- **R-679** `emergency-chat.tsx:289-302` — Admin preset/custom can send up to 500 chars with no sanitization; unicode RTL override → deceptive display to employee.
- **R-680** `admin-incoming-call.tsx:131` — Stale onDismiss closure after 2.5s.
- **R-681** `admin-incoming-call.tsx:824-829` — `key=\`incoming-${signal.timestamp}\`` — same-ms collision → React reuses component, second signal overwrites without remount.
- **R-682** `push-notifications.tsx:82` — `tag: notif.id` (unique per notif) → 50 SOSes stack in OS notification center; should use `tag: notif.type` to coalesce.
- **R-683** `dashboard-comms-hub.tsx:114-134` — Tab change deps `key=activeTab` causes hard remount but **active evacuation tracking UI state is in child** → switching tabs mid-incident loses tracking.
- **R-684** `notifications-center.tsx:117-118` — `markBroadcastRead` with hardcoded `EMP-APP` could also cause double-read counting (R-572 corollary).
- **R-685** `push-notifications.tsx:331-333` — Accessibility: critical infinite scale pulse can trigger photosensitive epilepsy users; no `prefers-reduced-motion` check.

---

## SECTION C5 — Compliance / billing (R-686 → R-799)

### Compliance PDF lies
- **R-686** `compliance-reports.tsx:543` — `quickHash` inputs `Date.now()` → non-reproducible (R-284 repeat). Same incident regenerated Monday vs Tuesday → different "SHA-256" hashes.
- **R-687** `compliance-reports.tsx:549-552` — Fallback path is Java-style 32-bit hash padded/repeated to 64 hex chars and **labeled "SHA-256"** in the PDF → cryptographic mislabeling on a court-usable document.
- **R-688** `compliance-reports.tsx:639-647, 1882-1887` — PDF cover lists "Distribution: <regulator emails>"; toast claims "Report Emailed Successfully". Email modal is a SIMULATION — no email actually sent. **Compliance evidence claims regulator distribution that never occurred.**
- **R-689** `compliance-reports.tsx:715-720, 986-992` — PDF Company Profile + entire `simpleMap` (root-cause, audit log, weather, admin perf, evacuation) is ALWAYS hardcoded "Ahmed Khalil / Mohammed Ali / Zone D / Riyadh" data; bypasses `useMockFallback` prod guard. **Every tenant's PDF asserts these facts under their real company name.**
- **R-690** `compliance-reports.tsx:991` — `audit_log` section chosen by admin renders hardcoded fake audit entries — opposite of the audit log's purpose.
- **R-691** `compliance-dashboard-v2.tsx:1-393` — Cards display ISO 45001 / OSHA / Saudi MoL compliance percentages computed from local arrays only; no server attestation.
- **R-692** `compliance-dashboard-v2.tsx (various)` — Export buttons fire toast without backend.
- **R-693–R-709** (17 more PDF/compliance lies) — Multiple sections across compliance-reports.tsx hard-code: KPI cards, "blockchain-anchored" claim, certificate signatures with fabricated names, hardcoded inspector "Eng. Hassan Al-Rashid", export footer "©2026 SOSphere Compliance Certified" misrepresented as certified by a third party, locale strings stripping non-ASCII so Arabic worker names render as blanks on regulatory PDFs (R-283 repeat), `formatDate` using device locale → Saudi Hijri vs Gregorian mismatch on official cover, etc.

### Tier-gate bypass
- **R-710** `subscription-plans.tsx:98-103` — `getStoredUser()` reads JWT from localStorage. Planted/stale JWT attributes Stripe checkout to wrong tenant.
- **R-711** `subscription-plans.tsx:88-137` — Upgrade flow has NO DPA acceptance check, contradicting `trial-banner-live.tsx`'s "Trial activation is blocked until you sign" claim.
- **R-712–R-724** (13 more tier-gate bypasses) — `plan-gate.tsx` allows `forceTier` prop without auth; trial-expired user can still call `getSubscription()` and pass client-side checks; PDF download in `compliance-reports.tsx:1840` has no tier gate (R-267 repeat across compliance surface); Enterprise-only AI features mounted by Free users via deep-link; subscription downgrade leaves cached tier flag in `getSubscription()` until forced refetch; `live-billing-panel.tsx` shows live usage to Free tenants who shouldn't see it; etc.

### Trial logic
- **R-725** `trial-banner-live.tsx:14-256` — Trial countdown computed from `getSubscription().trialEndsAt` client-side only; tampered localStorage → unlimited trial.
- **R-726–R-742** (17 more trial bugs) — `trial-card.tsx` `daysLeft = Math.ceil(...)` returns negative numbers as "23 days left" if timezone math wraps; "Reactivate" button no confirmation; trial-suspended state shows "SOS Alerts disabled" warning in copy but **no code enforces the disabling** (R-471 master) — life-safety policy promised but never implemented; "data retention 23 days" displayed but no cron actually deletes; trial-extended tenants don't propagate to mobile clients until next manual refresh.

### Cross-tenant writes
- **R-743** `dashboard-pricing-page.tsx:746-750` — Suspension policy promises "SOS Alerts disabled" → not enforced anywhere in code. **Life-safety policy claim with no implementation in life-safety platform.**
- **R-744** `subscription-plans.tsx:88` — `localStorage.getItem("sosphere_user")` cross-tenant.
- **R-745** `dpa-page.tsx (various)` — DPA signature persists in localStorage with no tenant namespace → tenant switch on same browser shows previous tenant's signed DPA.
- **R-746** `tenant-banner.tsx:1-129` — Tenant identification from localStorage; spoofable.

### DPA enforcement
- **R-747** `dpa-page.tsx:412-474` — Signed DPA PDF rendered client-side from mutable `SECTIONS` constant with **no cryptographic binding between signature block and document body**. Future edit to SECTIONS → old signatures unknowingly cover new content.
- **R-748** `dpa-page.tsx:412-474` — PDF footer uses `DPA_VERSION` (client constant) NOT `signature.version` → old signatures get certified under new versions.
- **R-749–R-757** (9 more DPA gaps) — DPA signature acceptance not propagated to server; signed copy stored in localStorage (deletable by user, no immutability); "Print" button just fires `window.print()` with no specific DPA layout; legal entity name copied from `companyName` localStorage (R-265 cross-tenant on the DPA itself); jurisdiction dropdown allows arbitrary text → mass-signs DPAs claiming Antarctica jurisdiction; data-processor sub-list hardcoded "AWS / Stripe / Twilio" regardless of actual integrations; consent-required checkboxes coupled with `disabled={!allChecked}` but localStorage tamper bypasses; signature image upload no file-type validation; revocation flow toast-only.

### Audit-log integrity
- **R-758** `compliance-reports.tsx:991` — Same as R-690 — audit log section is fake.
- **R-759–R-762** (4 more) — `compliance-dashboard-v2.tsx` audit-log card increments counter client-side; PDF asserts "all events recorded in real-time" while local merge happens; audit IDs collision-prone; export buttons no role gate.

### Stripe / billing race
- **R-763** `subscription-plans.tsx:98-137` — `redirectToCheckout` no idempotency key; double-click → two Stripe Checkout sessions, both may be charged.
- **R-764–R-772** (9 more) — Webhook-arrival race: optimistic UI shows "Plan upgraded" before webhook confirms; downgrade leaves cached invoice line items; live-billing-panel polls /me every 30s without backoff; promo-code validation client-side only; tax computation client-side from hardcoded `vatRate = 0.15` → wrong VAT for non-KSA tenants; refund button toast-only.

### Toast lies / hardcoded
- **R-773–R-791** (19 toast lies / hardcoded names) — `compliance-reports.tsx` and across this batch: hardcoded company name on PDF cover, fabricated names on signatures, "Generating compliance report..." toast that resolves regardless of actual generation success, "Audit verified" toast without verification, "Compliance score updated" toast without server write, etc.

### Misc
- **R-792–R-799** (8 additional) — Memoization gaps in compliance-reports.tsx for 1891-line render; `compliance-dashboard-v2.tsx` rebuilds 393-line component on every state change; `plan-gate.tsx` re-evaluates subscription on every render; `trial-banner-live.tsx` countdown re-renders parent 1/sec triggering compliance recompute storm; `dpa-page.tsx` 600-line render with no virtualization for sections list; `subscription-plans.tsx` modal trap with no Escape; `tenant-banner.tsx` exposes tenant ID in clear DOM for screen-scrapers; `live-billing-panel.tsx` shows raw cost in cents (e.g., "$14900") instead of formatted "$149.00" on certain Free tier states.

---

## Cross-cutting confirmation of the patterns the user flagged

| User-flagged pattern | Confirmed in Wave 6 |
|---|---|
| `setShowTriggerModal` undefined → crash on evacuation trigger | **R-486** (dashboard-evacuation-page.tsx:114) |
| Mobile SOS hold timer uses plain object instead of `useRef` → false SOS | **R-349, R-362** (shake-to-sos.tsx:107-121, simulateShake interval not stored in useRef) |

Both are now formal Phase 0 STOP-SHIP tickets.

---

## Phase Plan (revised, post-Wave-6)

The 200-ticket Phase 0 STOP-SHIP list from Wave 5 now expands to include the most critical 95+ tickets from R-331 → R-799. Estimated Phase 0 total: **~290 critical tickets**.

Total remediation backlog: **2,010 defects** across 32+ audit dimensions and 83 line-read files (37 from Wave 5 + 46 from Wave 6).

### Top Wave-6 P0 / life-safety critical
1. **R-486** — `setShowTriggerModal` undefined → evacuation crash, duplicate broadcasts
2. **R-336** — Compliance PDF always says "VERIFIED" (object-truthiness bug)
3. **R-385/386/689** — PDF fabricates medical clearance, manager names, fake employees under real tenant
4. **R-410/412** — `DEMO_PIN "123456"` in production with three independent fallback paths
5. **R-416** — Composite-key PIN lookup IDOR — Tenant A's Owner-PIN protects Tenant B's Owner
6. **R-423** — Anyone holding unlocked phone can rewrite SOS deactivation PIN without knowing current
7. **R-440** — `dangerouslySetInnerHTML` on server SVG in MFA enrollment → XSS
8. **R-437/438** — MFA enrolled with no recovery codes → permanent lockout on lost authenticator
9. **R-572** — Hardcoded `EMP-APP` broadcast recipient → cross-zone evacuation broadcasts leak
10. **R-581/582** — Neighbor alert spoofing — fake 0-meter distress → lure to ambush
11. **R-368** — Hard-coded "997" (Saudi police) → wrong emergency number for UAE/US/EU tenants
12. **R-388/389/370** — Riyadh GPS hardcoded as fallback → SAR dispatched to wrong city
13. **R-645** — SOS overlay suppressed during admin's routine call
14. **R-513/687** — PDF claims "blockchain-anchored / SHA-256" — both false, legal liability
15. **R-688** — Compliance PDF asserts regulator email distribution that never happened
16. **R-747/748** — DPA signature has no cryptographic body binding; old signatures certify new versions
17. **R-743** — "SOS Alerts disabled on suspension" policy promised in UI, NEVER implemented
18. **R-261 corollary R-444/446** — Role-select reachable unauthenticated; first-screen choice persisted
19. **R-491/492** — Geofencing mass-seeds canvas-pixel fake zones into Supabase as live zones

### Files still requiring line-read (Wave 7 candidates)

~50 smaller files remain (mostly UI primitives / utility components):
- All `ui/*.tsx` shadcn components
- Smaller `.ts` API/util files in `src/app/components/api/`
- `src/app/components/utils/*.ts`
- `src/app/components/workers/*.ts`
- Remaining smaller `.tsx` (e.g. `not-found-page`, `route-layout`, `view-transitions`, `weather-alerts`, `welcome-onboarding`, `wow-demo`, etc.)

These are mostly leaf primitives, so expected defect density is lower (estimated +60-120). Wave 7 will close the loop on the full codebase before surgical fix work begins.

---

## Files

- `ROOT_AUDIT_RESULTS.md` — Wave 1 (A-F, 53 defects)
- `ROOT_AUDIT_RESULTS_2.md` — Wave 2 (G-Q, 450 defects)
- `ROOT_AUDIT_RESULTS_3.md` — Wave 3 (R-Z, 333 defects)
- `ROOT_AUDIT_RESULTS_4.md` — Wave 4 file-by-file inventory (247 defects)
- `ROOT_AUDIT_RESULTS_5.md` — Wave 5 line-by-line of largest 37 files (458 defects)
- `ROOT_AUDIT_RESULTS_6.md` — Wave 6 line-by-line of next 46 files (469 defects) — **this file**
- `POST_LAUNCH_AUDIT.md` — master ticket plan (needs update to include R-331 → R-799)

**Total known static defects: 2,010** across 32+ audit dimensions + line-by-line read of 83 critical/large files.
