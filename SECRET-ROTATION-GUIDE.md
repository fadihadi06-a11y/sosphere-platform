# SOSphere Secret Rotation Guide

**Document Status**: ISO 27001 §A.14.2.5 — Access Control to Source Code
**Last Updated**: 2026-04-08

This guide provides step-by-step procedures for rotating sensitive API keys and secrets used by the SOSphere safety platform. Secret rotation is a critical security practice that limits the exposure window if a key is compromised.

---

## Table of Contents

1. [Rotation Schedule](#rotation-schedule)
2. [Supabase Keys](#supabase-keys)
3. [Firebase Credentials](#firebase-credentials)
4. [Sentry DSN](#sentry-dsn)
5. [Twilio Credentials](#twilio-credentials)
6. [Emergency Rotation (Breach Response)](#emergency-rotation-breach-response)
7. [Verification Steps](#verification-steps)
8. [Checklists](#checklists)

---

## Rotation Schedule

| Secret Type | Recommended Interval | Trigger |
|---|---|---|
| **Supabase Anon Key** | Quarterly (every 90 days) | Routine maintenance or suspicious activity |
| **Firebase API Key** | Quarterly (every 90 days) | Routine maintenance or suspicious activity |
| **Sentry DSN** | Quarterly (every 90 days) | Routine maintenance or suspicious activity |
| **Twilio Auth Token** | Quarterly (every 90 days) | Routine maintenance or suspicious activity |
| **All Secrets** | IMMEDIATELY | Suspected breach, unauthorized access, or key exposed in logs |

**Rotation Windows**: Perform scheduled rotations during low-traffic periods (e.g., late evening UTC) to minimize user impact if verification issues arise.

---

## Supabase Keys

### Understanding Supabase Keys

Supabase provides two primary API keys:
- **Anon Key** (`VITE_SUPABASE_ANON_KEY`): Public key used by client-side code; enforces Row-Level Security (RLS)
- **Service Role Key**: Private key for admin operations; bypasses RLS (never expose client-side)

The SOSphere platform only uses the Anon Key in client code. The Service Role Key is stored server-side only.

### Rotation Procedure: Supabase Anon Key

#### Step 1: Generate New Key in Supabase Dashboard

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your SOSphere project
3. Navigate to **Settings** → **API** (left sidebar)
4. Under **Project API Keys**, locate the "Anon Key" row
5. Click the **Copy** button to copy the current key (for backup)
6. Click the **Regenerate** button next to "Anon Key"
7. Confirm the regeneration (this will rotate the key immediately)
8. Copy the new key displayed in the dashboard

**Note**: Regenerating the Anon Key will invalidate the previous key after a grace period (typically 24-48 hours). All clients using the old key will be disconnected.

#### Step 2: Update Environment Variable

1. **For Development**: Edit `.env` in the project root:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=<new-anon-key-from-dashboard>
   ```

2. **For Production (Vercel)**:
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Select the SOSphere project
   - Navigate to **Settings** → **Environment Variables**
   - Find `VITE_SUPABASE_ANON_KEY` and click **Edit**
   - Replace the value with the new key
   - Click **Save**
   - **Important**: Deploy or trigger a new build to apply the change

3. **For Production (Alternative Hosting)**:
   - Update your hosting platform's environment variable configuration
   - Redeploy the application to pick up the new key

#### Step 3: Verification

- See [Verification Steps](#verification-steps) section below

---

## Firebase Credentials

### Understanding Firebase Keys

Firebase API Keys are used for:
- Push Notifications (via Firebase Cloud Messaging / FCM)
- Analytics (optional)
- Realtime Database access (if configured)

The Firebase API Key is public but should still be rotated regularly.

### Rotation Procedure: Firebase API Key

#### Step 1: Generate New Key in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select the SOSphere project
3. Navigate to **Project Settings** (gear icon) → **API Keys** tab
4. Under "API Keys", you'll see your current key(s)
5. Click **Create API Key** to generate a new key
6. A new key will be created and displayed
7. Copy the new key value

#### Step 2: Identify Which Services Use the Old Key

Before retiring the old key, check:
- Mobile app (native iOS/Android) integrations
- Any backend services that use the key
- Third-party integrations

#### Step 3: Update Environment Variable

1. **For Development**: Edit `.env`:
   ```
   VITE_FIREBASE_API_KEY=<new-api-key-from-console>
   ```

2. **For Production (Vercel)**:
   - Go to Vercel Dashboard
   - Select the SOSphere project
   - Navigate to **Settings** → **Environment Variables**
   - Find `VITE_FIREBASE_API_KEY` and click **Edit**
   - Replace the value with the new key
   - Click **Save**
   - Deploy or trigger a new build

3. **For Mobile Apps** (if applicable):
   - Update `google-services.json` or `GoogleService-Info.plist` in the native app
   - Rebuild and deploy the native application
   - Coordinate with native development team

#### Step 4: Retire Old Key

Once verification is complete and all clients are using the new key (typically after 24-48 hours):
1. Return to Firebase Console → **API Keys**
2. Click the **Delete** button on the old key
3. Confirm the deletion

---

## Sentry DSN

### Understanding Sentry DSN

A Sentry DSN (Data Source Name) is a public key that allows the client application to send error reports to your Sentry project. Even though it's not technically a "secret" (it's public), treating it as sensitive prevents:
- Attackers from flooding your Sentry project with false errors
- Leaking error details to the public
- Exposing internal system information

### Rotation Procedure: Sentry DSN

#### Step 1: Create a New Sentry Client Key

1. Go to [Sentry Dashboard](https://sentry.io)
2. Select your SOSphere organization
3. Select the SOSphere project
4. Navigate to **Settings** → **Client Keys (DSN)**
5. You'll see your current DSN listed
6. Click **Create New Key** to generate a new DSN
7. A new key will be created with a new DSN
8. Copy the new DSN value (format: `https://<public>@<host>/<project-id>`)

#### Step 2: Update Environment Variable

1. **For Development**: Edit `.env`:
   ```
   VITE_SENTRY_DSN=<new-dsn-from-sentry>
   ```

2. **For Production (Vercel)**:
   - Go to Vercel Dashboard
   - Select the SOSphere project
   - Navigate to **Settings** → **Environment Variables**
   - Find `VITE_SENTRY_DSN` and click **Edit**
   - Replace the value with the new DSN
   - Click **Save**
   - Deploy or trigger a new build

#### Step 3: Disable Old Client Key in Sentry

Once verification is complete:
1. Return to Sentry Dashboard → **Settings** → **Client Keys (DSN)**
2. Find the old key in the list
3. Click the **Disable** button (or **Delete** after a grace period)
4. Confirm the action

---

## Twilio Credentials

### Understanding Twilio Secrets

Twilio provides:
- **Account SID**: Your Twilio account identifier
- **Auth Token**: Private key for API authentication
- **API Key / Secret**: Alternative credentials for programmatic access

SOSphere uses Twilio for:
- PSTN voice calls (falling back from WebRTC)
- SMS-based authentication (optional)
- Fallback call notifications

Twilio credentials are typically stored in **Supabase Edge Function secrets** (server-side) rather than in client environment variables.

### Rotation Procedure: Twilio Auth Token

#### Step 1: Generate New Auth Token in Twilio Console

1. Go to [Twilio Console](https://www.twilio.com/console)
2. Log in to your Twilio account
3. Navigate to **Account** → **API Credentials** (or **Settings**)
4. Locate your current **Auth Token**
5. Click **Show** to reveal the token (if hidden)
6. Click **Regenerate Auth Token**
7. Confirm the regeneration
8. A new Auth Token will be generated and displayed
9. Copy the new token immediately (you won't be able to see it again)

**Warning**: Twilio will invalidate the old token immediately upon regeneration. Ensure all services are updated before regenerating.

#### Step 2: Update Supabase Edge Function Secrets

If Twilio credentials are stored in Supabase Edge Functions:

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your SOSphere project
3. Navigate to **Edge Functions** (left sidebar)
4. Find the function that uses Twilio (e.g., `twilio-call-handler`)
5. Click the function name to edit
6. Update the secret variables:
   - `TWILIO_ACCOUNT_SID`: Keep unchanged (if not rotated)
   - `TWILIO_AUTH_TOKEN`: Replace with new token
7. Click **Save**

#### Step 3: Update Application Environment

1. **For Development**: Edit `.env`:
   ```
   VITE_TWILIO_ACCOUNT_SID=<your-account-sid>
   VITE_TWILIO_API_KEY=<your-api-key>
   # (Auth Token is usually server-side only)
   ```

2. **For Production**:
   - Update Vercel / hosting platform environment variables
   - Update Supabase Edge Function secrets (as described above)
   - Redeploy application

#### Step 4: Verification

- See [Verification Steps](#verification-steps) below
- Test voice calls using the Buddy System or emergency features
- Monitor Twilio Console for successful API calls

---

## Emergency Rotation (Breach Response)

If a secret is suspected to be compromised, follow this **expedited procedure**:

### Immediate Actions (First Hour)

- [ ] **Assess the breach scope**: Which secret was exposed? For how long?
- [ ] **Notify stakeholders**: Alert your security team, DevOps, and incident response
- [ ] **Determine if active exploitation**: Check logs for unauthorized API usage
- [ ] **Do NOT commit secrets to version control**: If a secret was committed to Git, follow Git secret cleanup procedures

### Rotation (Next 2 Hours)

- [ ] **Regenerate the secret immediately** using the appropriate service dashboard
- [ ] **Update all environments** (dev, staging, production) with the new secret
- [ ] **Deploy urgently**: Use expedited CI/CD pipeline to get new secret into production ASAP
- [ ] **Monitor for errors**: Watch logs and error tracking for authentication failures
- [ ] **Verify critical paths**: Ensure authentication, API calls, and error reporting still work

### Post-Incident (Within 24 Hours)

- [ ] **Audit logs**: Check service provider logs for unauthorized access during exposure window
- [ ] **Revoke old secret**: Delete the compromised key from the service provider dashboard
- [ ] **Update documentation**: Record what happened, what was rotated, and remediation steps
- [ ] **Conduct post-mortem**: Review how the secret was exposed and implement preventive measures
- [ ] **Check for token misuse**: Monitor Sentry for suspicious errors, Firebase for unusual activity, etc.

### Preventive Measures

- [ ] **Enable secret scanning**: Ensure GitHub is scanning commits for secrets
- [ ] **Use a secrets vault**: Consider using AWS Secrets Manager, HashiCorp Vault, or similar
- [ ] **Limit secret exposure**: Never log secrets, never commit to version control, never share in Slack
- [ ] **Monitor suspicious activity**: Set up alerts in Sentry, Firebase, and Twilio consoles for unusual usage patterns

---

## Verification Steps

After rotating any secret, follow these verification steps before considering the rotation complete:

### 1. Local Development Testing

```bash
# Clear any cached environment variables
rm -f .env.local

# Reload environment
source .env

# Verify the new secret is loaded
npm run dev

# Open the browser console and check for errors:
# - Should see "[EnvShield] ACTIVE — sensitive data is being filtered from logs"
# - Should NOT see authentication failures
# - Should see successful Supabase/Firebase connections (if configured)
```

### 2. Application Smoke Testing

- [ ] **Authentication**: Log in with email/phone and verify OTP works
- [ ] **Emergency Signal**: Trigger a test SOS signal and verify it's received by administrators
- [ ] **Push Notifications**: Verify background notifications arrive on paired devices
- [ ] **Error Reporting**: Trigger a test error and verify it appears in Sentry
- [ ] **Data Sync**: Create a test record and verify it syncs to backend

### 3. Production Verification

- [ ] **Monitor logs**: Watch application logs for authentication errors
- [ ] **Check uptime**: Verify application uptime hasn't decreased
- [ ] **Monitor Sentry**: Check for new authentication-related errors
- [ ] **Monitor API usage**: In service provider dashboards, verify API calls are successful
- [ ] **User reports**: Monitor support channels for authentication complaints

### 4. Rollback Plan (If Issues)

If verification fails:

1. **Immediately revert** to the previous secret (keep it in a safe, temporary location)
2. **Redeploy** the application with the old secret
3. **Notify stakeholders** of the rollback
4. **Investigate**: Debug the issue before attempting rotation again
5. **Do NOT leave old secret exposed**: Once the immediate incident is resolved, rotate again with the fix in place

---

## Checklists

### Quarterly Rotation Checklist

Use this checklist for routine quarterly rotations:

#### Preparation Phase
- [ ] Schedule rotation during low-traffic window (evenings UTC)
- [ ] Notify team that rotation is planned
- [ ] Prepare rollback plan with previous secrets
- [ ] Review this guide and verify procedures are current

#### Supabase Anon Key
- [ ] Log in to Supabase Dashboard
- [ ] Navigate to Settings → API
- [ ] Copy current Anon Key (backup)
- [ ] Click "Regenerate" for Anon Key
- [ ] Confirm regeneration
- [ ] Copy new Anon Key
- [ ] Update `.env` in development
- [ ] Update VITE_SUPABASE_ANON_KEY in Vercel (or hosting platform)
- [ ] Deploy application
- [ ] Run local smoke tests
- [ ] Monitor production for errors (15 minutes)

#### Firebase API Key
- [ ] Log in to Firebase Console
- [ ] Select SOSphere project
- [ ] Navigate to Project Settings → API Keys
- [ ] Click "Create API Key"
- [ ] Copy new API Key
- [ ] Update `.env` in development
- [ ] Update VITE_FIREBASE_API_KEY in Vercel (or hosting platform)
- [ ] If mobile apps use the key, coordinate update with native team
- [ ] Deploy application
- [ ] Run local smoke tests
- [ ] Monitor production for errors (15 minutes)
- [ ] After 24-48 hours, delete old key in Firebase Console

#### Sentry DSN
- [ ] Log in to Sentry Dashboard
- [ ] Select SOSphere project
- [ ] Navigate to Settings → Client Keys (DSN)
- [ ] Click "Create New Key"
- [ ] Copy new DSN
- [ ] Update `.env` in development
- [ ] Update VITE_SENTRY_DSN in Vercel (or hosting platform)
- [ ] Deploy application
- [ ] Trigger a test error to verify Sentry is receiving reports
- [ ] Monitor production for errors (15 minutes)
- [ ] Disable old key in Sentry → Settings → Client Keys

#### Twilio Auth Token
- [ ] Log in to Twilio Console
- [ ] Navigate to Account → API Credentials
- [ ] Click "Regenerate Auth Token"
- [ ] Copy new Auth Token
- [ ] Update Supabase Edge Function secrets with new token
- [ ] Update application environment variables if needed
- [ ] Deploy or redeploy Edge Functions
- [ ] Test a voice call to verify Twilio integration
- [ ] Monitor for errors (15 minutes)

#### Verification & Wrap-up
- [ ] All smoke tests passed locally
- [ ] Production monitoring shows no errors
- [ ] No user complaints in support channels
- [ ] Update rotation log with completion date and time
- [ ] Archive previous secrets securely (if applicable)
- [ ] Close rotation ticket / task

---

### Emergency Rotation Checklist (Suspected Breach)

Use this checklist for immediate emergency rotations:

#### First Hour
- [ ] **ASSESS**: Determine which secret(s) were exposed
- [ ] **NOTIFY**: Alert security team, DevOps, incident response
- [ ] **ISOLATE**: Revoke any active sessions if applicable
- [ ] **PREPARE**: Have new credentials ready from service providers

#### Immediate Rotation (All Secrets)
- [ ] Regenerate Supabase Anon Key
- [ ] Regenerate Firebase API Key
- [ ] Regenerate Sentry DSN
- [ ] Regenerate Twilio Auth Token
- [ ] Copy all new values securely

#### Deploy (Next 2 Hours)
- [ ] Update all secrets in all environments simultaneously
- [ ] Use expedited deployment (skip normal QA if needed)
- [ ] Deploy to production
- [ ] Immediately monitor logs for authentication failures

#### Verification
- [ ] Verify no spike in authentication errors
- [ ] Verify critical paths still work (SOS signal, notifications, etc.)
- [ ] Confirm in all service provider dashboards that new keys are being used
- [ ] Check for unauthorized API activity in logs

#### Post-Incident (24 Hours)
- [ ] Audit service provider logs for breach impact
- [ ] Review Git history for committed secrets
- [ ] Implement secret scanning if not already enabled
- [ ] Delete old compromised secrets from service providers
- [ ] Conduct post-mortem and implement preventive measures
- [ ] Notify users if data was accessed (if required by privacy regulations)

---

## Additional Resources

### Documentation References
- [Supabase API Documentation](https://supabase.com/docs/reference)
- [Firebase Console Help](https://firebase.google.com/support)
- [Sentry Documentation](https://docs.sentry.io/)
- [Twilio Documentation](https://www.twilio.com/docs)

### Security Resources
- [OWASP: Secrets Management](https://owasp.org/www-community/attacks/Sensitive_Data_Exposure)
- [CWE-798: Use of Hard-Coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [ISO 27001: Information Security Management](https://www.iso.org/isoiec-27001-information-security-management.html)

### SOSphere Documentation
- [Environment Shield](./src/app/components/env-shield.ts)
- [Integration Examples](./INTEGRATION_EXAMPLES.md)
- [Rate Limiter Guide](./RATE_LIMITER_GUIDE.md)

---

## Document History

| Date | Version | Changes |
|---|---|---|
| 2026-04-08 | 1.0 | Initial comprehensive secret rotation guide |

---

**Contact**: For security concerns or questions about secret rotation, contact your security team or DevOps administrator.

**Last Reviewed**: 2026-04-08  
**Next Review**: 2026-07-08 (quarterly)
