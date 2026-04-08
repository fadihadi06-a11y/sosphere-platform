# SOSphere Platform Deployment Readiness Checklist

## Overview

This document provides a comprehensive step-by-step checklist for deploying the SOSphere safety platform to production with the sosphere.co domain on Vercel. Follow each section in order to ensure a successful launch.

**Last Updated:** 2026-04-08  
**Platform:** SOSphere Safety Platform  
**Target Domain:** sosphere.co  
**Hosting:** Vercel

---

## 1. Domain Configuration (sosphere.co → Vercel)

### 1.1 DNS Settings at Your Domain Registrar

Before adding the domain to Vercel, configure these DNS records at your domain registrar (e.g., Namecheap, GoDaddy, Route 53):

#### CNAME Record for www subdomain
```
Type:   CNAME
Name:   www
Value:  cname.vercel-dns.com
TTL:    3600 (or default)
```

#### A Record for root domain
```
Type:   A
Name:   @ (or leave blank)
Value:  76.76.21.21
TTL:    3600 (or default)
```

#### AAAA Record for IPv6 (optional but recommended)
```
Type:   AAAA
Name:   @ (or leave blank)
Value:  2606:4700:20::681a:3c5
TTL:    3600 (or default)
```

#### TXT Record for Vercel Verification
```
Type:   TXT
Name:   _vercel
Value:  (Vercel will provide this value after step 1.2.2)
TTL:    3600
```

---

### 1.2 Vercel Dashboard Configuration

#### Step 1: Access Project Settings
- [ ] Log in to [Vercel Dashboard](https://vercel.com/dashboard)
- [ ] Select the SOSphere project
- [ ] Navigate to **Settings** → **Domains**

#### Step 2: Add Root Domain
- [ ] Click **Add Domain**
- [ ] Enter `sosphere.co` and click **Add**
- [ ] Vercel will display the required DNS records
- [ ] If prompted for a TXT verification record, copy the value and add it to your registrar's DNS settings (see section 1.1)

#### Step 3: Add www Subdomain
- [ ] Click **Add Domain** again
- [ ] Enter `www.sosphere.co` and click **Add**
- [ ] Configure as a redirect to `sosphere.co` (Vercel should offer this option)
- [ ] Ensure redirect is set to permanent (301)

#### Step 4: DNS Propagation
- [ ] Wait for DNS propagation to complete
  - Typical time: 1-48 hours (often 30 minutes to 2 hours)
  - Monitor progress in Vercel Dashboard under "Domains"
  - Check status using: `nslookup sosphere.co`
- [ ] Once propagated, the domain status in Vercel should show **Valid Configuration**

#### Step 5: SSL Certificate Verification
- [ ] Verify that Vercel has automatically provisioned an SSL certificate (Let's Encrypt)
- [ ] Certificate status should show **Valid and Active**
- [ ] Check certificate details by visiting `https://sosphere.co` in a browser
- [ ] Verify certificate is not self-signed and is issued by Let's Encrypt

#### Step 6: Verify HSTS Header
- [ ] Open terminal and run:
  ```bash
  curl -I https://sosphere.co
  ```
- [ ] Verify the response includes:
  ```
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  ```
- [ ] This confirms HSTS is active and all traffic is forced to HTTPS

---

## 2. Environment Variables Configuration

All environment variables must be set in the Vercel Dashboard before deployment. These variables are used by both the client (Vite) and Edge Functions.

### 2.1 Setting Environment Variables in Vercel

#### Steps:
- [ ] Go to Vercel Dashboard → Project → **Settings** → **Environment Variables**
- [ ] Add each variable below for the **Production** environment
- [ ] For sensitive values, copy from your local `.env.local` or secure password manager
- [ ] After adding all variables, redeploy the project

### 2.2 Required Environment Variables

#### Supabase Configuration
```
VITE_SUPABASE_URL
Description: Supabase project URL
Example: https://your-project.supabase.co
Notes: Public, safe for client-side code
```

```
VITE_SUPABASE_ANON_KEY
Description: Supabase anonymous key for client authentication
Example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Notes: Public, safe for client-side code. Row-Level Security must protect sensitive data.
```

#### Error Tracking & Monitoring
```
VITE_SENTRY_DSN
Description: Sentry Data Source Name for error tracking
Example: https://key@sentry.io/project-id
Notes: Public DSN is safe to expose. Set up in Sentry dashboard.
```

```
VITE_APP_VERSION
Description: Application version for Sentry release tracking
Example: 1.0.0
Notes: Should match version in package.json. Used for release tracking in Sentry.
```

#### Firebase Cloud Messaging
```
VITE_FIREBASE_API_KEY
Description: Firebase public API key for Cloud Messaging
Example: AIzaSyD... (obtainable from Firebase Console)
Notes: Public, safe for client-side code
```

```
VITE_FIREBASE_VAPID_KEY
Description: VAPID key for web push notifications
Example: BJ... (generate in Firebase Cloud Messaging settings)
Notes: Public, safe for client-side code
```

#### Twilio Configuration
```
VITE_TWILIO_ENABLED
Description: Enable/disable Twilio voice calling feature
Value: "true" or "false"
Notes: Set to "true" to enable emergency calls
```

#### Optional/Advanced Variables
```
VITE_FALLBACK_API_URL
Description: Emergency fallback API endpoint for critical services
Example: https://backup-api.sosphere.co
Notes: Optional. Used if primary Supabase endpoint is unavailable.
```

```
VITE_LAST_BACKUP_TIMESTAMP
Description: ISO 8601 timestamp of last database backup
Example: 2026-04-08T15:30:00Z
Notes: For compliance dashboard. Update after each backup.
```

### 2.3 Verification Checklist
- [ ] All required variables are set in Vercel Dashboard
- [ ] No sensitive secrets are hardcoded in `vercel.json` or other tracked files
- [ ] Variables marked as "Public" do not contain authentication tokens
- [ ] Variables are set for **Production** environment
- [ ] Project has been redeployed after adding/modifying variables

---

## 3. Supabase Configuration

### 3.1 Database Migrations

#### Step 1: Run SQL Migrations
- [ ] Navigate to your Supabase project SQL editor
- [ ] Open `/supabase/migrations/001_immutable_audit_trail.sql` from the repository
- [ ] Copy the entire SQL script
- [ ] Paste into Supabase SQL editor
- [ ] Click **Run** to execute the migration
- [ ] Verify that all tables are created successfully
- [ ] Check that the `audit_trail` table exists with proper structure

#### Step 2: Verify Audit Trail Setup
- [ ] In Supabase SQL editor, run:
  ```sql
  SELECT * FROM audit_trail LIMIT 1;
  ```
- [ ] Verify the table exists and is accessible
- [ ] Confirm it has append-only properties (immutable inserts)

### 3.2 Deploy Edge Functions

Deploy all required Twilio and notification Edge Functions to Supabase.

#### Prerequisites:
- [ ] Install Supabase CLI: `npm install -g supabase`
- [ ] Authenticate: `supabase login`
- [ ] Navigate to project root directory

#### Deploy Twilio Functions:

```bash
supabase functions deploy twilio-call
supabase functions deploy twilio-twiml
supabase functions deploy twilio-twiml-ack
supabase functions deploy twilio-sms
supabase functions deploy twilio-status
supabase functions deploy twilio-token
```

#### Deploy Notification Functions:

```bash
supabase functions deploy send-invitations
supabase functions deploy invite-employees
```

#### Verify Deployment:
- [ ] All 8 functions deployed successfully
- [ ] No errors in deployment logs
- [ ] Functions appear in Supabase Dashboard → Edge Functions

### 3.3 Configure Edge Function Secrets

Edge Functions require secure environment variables set as secrets in Supabase.

#### Step 1: Set Twilio Secrets
- [ ] Navigate to Supabase Dashboard → Project → **Edge Functions** → **Secrets**
- [ ] Click **New Secret**
- [ ] Add the following secrets:

```
Name:   TWILIO_ACCOUNT_SID
Value:  (from Twilio Console)
Type:   Secret
```

```
Name:   TWILIO_AUTH_TOKEN
Value:  (from Twilio Console)
Type:   Secret
```

```
Name:   TWILIO_FROM_NUMBER
Value:  +1XXXXXXXXXX (your Twilio phone number)
Type:   Secret
```

#### Step 2: Set Supabase Service Role Key
```
Name:   SUPABASE_SERVICE_ROLE_KEY
Value:  (from Supabase Settings → API → Service Role Key)
Type:   Secret
```

#### Verify Secrets:
- [ ] All 4 secrets are set in Supabase
- [ ] Secrets are not visible in plaintext in any tracked files
- [ ] Edge Functions can access secrets (test deployment)

### 3.4 Authentication Configuration

#### Step 1: Configure Auth URL
- [ ] Go to Supabase Dashboard → **Authentication** → **URL Configuration**
- [ ] Set **Site URL** to:
  ```
  https://sosphere.co
  ```
- [ ] Set **Redirect URLs** to include:
  ```
  https://sosphere.co
  https://sosphere.co/*
  https://www.sosphere.co
  https://www.sosphere.co/*
  ```
- [ ] Click **Save**

#### Step 2: Configure Email Templates
- [ ] Go to **Authentication** → **Email Templates**
- [ ] Update all 4 email templates from `/supabase/email-templates/`:
  - [ ] Confirm signup
  - [ ] Invite user
  - [ ] Magic link
  - [ ] Reset password
- [ ] Copy HTML from each template file and paste into Supabase
- [ ] Test by sending a test email to yourself

### 3.5 Row-Level Security (RLS)

#### Enable RLS on All Tables:
- [ ] Go to Supabase Dashboard → **SQL Editor**
- [ ] Run the following to enable RLS on all tables:
  ```sql
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
  ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;
  -- Add any other tables in your schema
  ```

#### Verify RLS Policies:
- [ ] For each protected table, verify RLS policies exist
- [ ] Test RLS by querying as different users/roles
- [ ] Verify audit_trail table has append-only RLS (inserts allowed, updates/deletes blocked)

---

## 4. Third-Party Service Setup

### 4.1 Sentry Error Tracking

#### Setup:
- [ ] Go to [sentry.io](https://sentry.io)
- [ ] Create a new project or select existing
- [ ] Select **JavaScript/Vue** as platform
- [ ] Copy the **DSN** (Data Source Name)
- [ ] Add DSN to Vercel environment variable: `VITE_SENTRY_DSN`

#### Configuration:
- [ ] Go to **Project Settings** → **Integrations**
- [ ] Enable **GitHub** integration (optional but recommended)
- [ ] Set up alerts for critical errors
- [ ] Configure team member notifications

#### Verification:
- [ ] [ ] Test error reporting (see Pre-Launch Testing section)

### 4.2 Twilio Voice Calling

#### Prerequisites:
- [ ] Create account at [twilio.com](https://www.twilio.com)
- [ ] Verify phone number

#### Setup:
- [ ] Go to Twilio Console → **Phone Numbers** → **Manage Numbers**
- [ ] Purchase a phone number for the region you serve
- [ ] Note the phone number and Account SID
- [ ] Copy **Auth Token** from Twilio Console dashboard
- [ ] Set these as Edge Function secrets (see section 3.3)

#### Configuration:
- [ ] Set webhook callback URLs in Twilio Console:
  - Status Callback: `https://sosphere.co/functions/v1/twilio-status`
  - Recording Callback: `https://sosphere.co/functions/v1/twilio-twiml-ack`
- [ ] Enable **Enhanced Encryption** in Twilio settings (optional)

#### Verification:
- [ ] [ ] Test call with a real phone number (see Pre-Launch Testing section)

### 4.3 Firebase Cloud Messaging

#### Setup:
- [ ] Go to [Firebase Console](https://console.firebase.google.com)
- [ ] Create project or select existing
- [ ] Navigate to **Project Settings** → **Service Accounts**
- [ ] Under "Web API Key", copy the API key
- [ ] Set as `VITE_FIREBASE_API_KEY` in Vercel

#### Configure Web Push:
- [ ] Go to **Cloud Messaging** tab
- [ ] Under "Web configuration", note the public key
- [ ] Generate a new key pair if needed
- [ ] Copy the **VAPID public key**
- [ ] Set as `VITE_FIREBASE_VAPID_KEY` in Vercel

#### Configuration:
- [ ] Upload `firebase-messaging-sw.js` to project root `/public/firebase-messaging-sw.js`
- [ ] Verify service worker registration in app code

#### Verification:
- [ ] [ ] Test push notifications on mobile device (see Pre-Launch Testing section)

### 4.4 Mapbox (if used)

#### Setup:
- [ ] Go to [mapbox.com](https://mapbox.com)
- [ ] Create account and new project
- [ ] Go to **Account Settings** → **Access Tokens**
- [ ] Create new token (or use default)
- [ ] Note the public access token

#### Configuration:
- [ ] Add to environment variables if needed
- [ ] Verify no private tokens are exposed in client code

---

## 5. Pre-Launch Verification Checklist

### 5.1 Build Verification

- [ ] Navigate to project root:
  ```bash
  cd /path/to/sosphere-platform
  ```

- [ ] Install dependencies:
  ```bash
  npm install
  ```

- [ ] Run production build:
  ```bash
  npm run build
  ```

- [ ] Build completes with zero errors
- [ ] Build completes with zero warnings (or only acceptable warnings)
- [ ] `dist/` directory is created
- [ ] No sensitive environment variables in build output

### 5.2 Environment & Configuration

- [ ] All required environment variables set in Vercel:
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`
  - [ ] `VITE_SENTRY_DSN`
  - [ ] `VITE_FIREBASE_API_KEY`
  - [ ] `VITE_FIREBASE_VAPID_KEY`
  - [ ] `VITE_TWILIO_ENABLED`
  - [ ] `VITE_APP_VERSION`
  - [ ] (Optional) `VITE_FALLBACK_API_URL`
  - [ ] (Optional) `VITE_LAST_BACKUP_TIMESTAMP`

- [ ] No hardcoded credentials in code
- [ ] No `.env.local` file committed to git
- [ ] `vercel.json` is properly configured (CSP, security headers, redirects)

### 5.3 SSL & Security Headers

- [ ] Test HTTPS headers:
  ```bash
  curl -I https://sosphere.co
  ```

- [ ] Verify in response headers:
  - [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `X-Frame-Options: DENY`
  - [ ] `Content-Security-Policy` present
  - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
  - [ ] `Permissions-Policy` restricting camera, microphone, geolocation

- [ ] SSL certificate:
  - [ ] Valid and not expired
  - [ ] Issued by Let's Encrypt
  - [ ] Covers `sosphere.co` and `www.sosphere.co`

### 5.4 Backend Connectivity

- [ ] Supabase connection working:
  ```bash
  # In browser console after deployment:
  # Test connection to Supabase
  ```

- [ ] Edge Functions deployed:
  - [ ] All 8 functions visible in Supabase Dashboard
  - [ ] No deployment errors

- [ ] Supabase secrets configured:
  - [ ] `TWILIO_ACCOUNT_SID` set
  - [ ] `TWILIO_AUTH_TOKEN` set
  - [ ] `TWILIO_FROM_NUMBER` set
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` set

### 5.5 Third-Party Services

#### Twilio
- [ ] Test outgoing call:
  - [ ] Trigger SOS alert in staging
  - [ ] Verify call is received at test number
  - [ ] Verify call comes from configured number
  - [ ] Verify call recording works (if enabled)

#### Firebase Cloud Messaging
- [ ] Test push notification:
  - [ ] Subscribe device to notifications
  - [ ] Send test notification from Firebase Console
  - [ ] Notification appears on device
  - [ ] Click notification opens app

#### Sentry
- [ ] Test error reporting:
  - [ ] Manually trigger an error in console
  - [ ] Verify error appears in Sentry Dashboard within 1 minute
  - [ ] Error source map resolves correctly (shows original code, not minified)

### 5.6 Application Features

#### Critical Pages
- [ ] Homepage loads: `https://sosphere.co`
- [ ] Login page loads and accepts input
- [ ] Signup page loads and form validation works
- [ ] Privacy policy loads: `https://sosphere.co/privacy`
- [ ] Terms of Service loads: `https://sosphere.co/terms`

#### Compliance Dashboard
- [ ] Compliance dashboard loads: `https://sosphere.co/compliance`
- [ ] PIN authentication required and works
- [ ] Audit trail displays (recent events)
- [ ] Backup timestamp accurate

#### SOS Flow (End-to-End)
- [ ] User can trigger SOS alert
- [ ] Alert is recorded in `sos_alerts` table
- [ ] Twilio call/SMS sent to emergency contact
- [ ] User receives confirmation notification
- [ ] Alert appears in admin dashboard

#### Offline Mode
- [ ] Disconnect network (DevTools → Network → Offline)
- [ ] Trigger SOS alert while offline
- [ ] Alert is cached locally
- [ ] Alert syncs when network restored
- [ ] App shows offline indicator

### 5.7 Internationalization & Accessibility

#### Language Support
- [ ] All 12 supported languages display correctly:
  - [ ] English
  - [ ] Spanish
  - [ ] French
  - [ ] German
  - [ ] Italian
  - [ ] Portuguese
  - [ ] Russian
  - [ ] Chinese (Simplified)
  - [ ] Chinese (Traditional)
  - [ ] Arabic
  - [ ] Japanese
  - [ ] Hindi

#### RTL Support (Arabic, Hebrew)
- [ ] Arabic layout renders correctly (right-to-left)
- [ ] UI elements align properly in RTL mode
- [ ] Input fields position correctly

#### Responsive Design
- [ ] Mobile: iPhone 12 (390x844)
  - [ ] All buttons tappable (48px minimum)
  - [ ] Text readable without zoom
  - [ ] No horizontal scroll

- [ ] Tablet: iPad Air (820x1180)
  - [ ] Layout adapts appropriately
  - [ ] Touch targets adequate

- [ ] Desktop: 1920x1080
  - [ ] Full-width layout optimized
  - [ ] No layout issues

#### iOS Safari Specific
- [ ] [ ] Test on actual iPhone or Safari DevTools
  - [ ] Camera access works (for alerts)
  - [ ] Microphone access works
  - [ ] Geolocation works
  - [ ] Web app installable (Add to Home Screen)
  - [ ] Installed app works offline

#### Android Chrome Specific
- [ ] [ ] Test on actual Android device or emulator
  - [ ] Camera access works
  - [ ] Microphone access works
  - [ ] Geolocation works
  - [ ] PWA installable
  - [ ] Installed app works offline

### 5.8 Performance Checklist

- [ ] Lighthouse score (Chrome DevTools):
  - [ ] Performance: ≥ 80
  - [ ] Accessibility: ≥ 90
  - [ ] Best Practices: ≥ 90
  - [ ] SEO: ≥ 90

- [ ] Core Web Vitals:
  - [ ] Largest Contentful Paint (LCP): < 2.5s
  - [ ] First Input Delay (FID): < 100ms
  - [ ] Cumulative Layout Shift (CLS): < 0.1

- [ ] Load time:
  - [ ] First meaningful paint: < 2s
  - [ ] Time to interactive: < 4s
  - [ ] Bundle size: < 500KB (uncompressed)

---

## 6. Post-Launch Monitoring

### 6.1 Vercel Deployment

#### Daily Monitoring
- [ ] Check [Vercel Dashboard](https://vercel.com) for deployment status
- [ ] Review deployment logs for errors
- [ ] Monitor build times (should be < 60s)
- [ ] Check for any failed deployments from recent git pushes

#### Ongoing
- [ ] Set up Vercel Analytics in dashboard
- [ ] Monitor response times
- [ ] Check for 4xx/5xx errors
- [ ] Review Edge Function execution times

### 6.2 Sentry Error Dashboard

#### Daily Check
- [ ] Log in to [Sentry Dashboard](https://sentry.io)
- [ ] Review critical errors
- [ ] Check error frequency trends
- [ ] Resolve or snooze handled errors

#### Key Metrics
- [ ] Error rate: Target < 0.1% of requests
- [ ] Average error severity
- [ ] Top affected pages/features
- [ ] New vs. recurring errors

### 6.3 Supabase Monitoring

#### Query Performance
- [ ] Monitor slow queries in Supabase Dashboard → **Reports**
- [ ] Check database CPU usage
- [ ] Review disk space usage
- [ ] Monitor connection count

#### RLS & Security
- [ ] Verify no unauthorized data access attempts
- [ ] Monitor audit_trail for suspicious activity
- [ ] Check for RLS policy violations (if logging enabled)

### 6.4 Twilio Call Logs

#### Daily Review
- [ ] Log in to Twilio Console
- [ ] Check **Monitor** → **Logs** for failed calls
- [ ] Review call duration trends
- [ ] Check SMS delivery status (if SMS enabled)

#### Alert Setup
- [ ] Set up Twilio alerts for:
  - [ ] High failed call rate (> 5%)
  - [ ] Unusual call volumes
  - [ ] Account balance threshold

### 6.5 SSL Certificate Monitoring

#### Renewal Setup
- [ ] Vercel automatically renews Let's Encrypt certificates
- [ ] Monitor certificate expiry in Vercel Dashboard
- [ ] No manual action needed (usually)
- [ ] Set calendar reminder to check certificate status monthly

#### Manual Check
```bash
# Check certificate expiry date
openssl s_client -connect sosphere.co:443 </dev/null 2>/dev/null | openssl x509 -noout -dates
```

- [ ] Certificate valid for at least 30 more days

### 6.6 Uptime Monitoring (Recommended)

#### Setup External Monitoring
- [ ] Create account at [uptimerobot.com](https://uptimerobot.com) or similar
- [ ] Add monitoring for:
  - [ ] `https://sosphere.co` (GET request, expect 200)
  - [ ] `https://sosphere.co/compliance` (GET request, expect 200)
  - [ ] Twilio webhook (if applicable)

- [ ] Set up alerts for downtime

---

## 7. Rollback Plan

If critical issues are discovered post-launch:

### Immediate Response (First 30 minutes)
- [ ] Identify issue severity
- [ ] Check Sentry for error patterns
- [ ] Review Supabase logs for data integrity
- [ ] Notify team on Slack/incident channel

### Rollback to Previous Version
If current deployment is broken:

```bash
# In Vercel Dashboard:
# 1. Go to Deployments
# 2. Find the last known-good deployment
# 3. Click "Redeploy" or "Promote to Production"
# 4. Verify rollback successful
```

### Database Rollback
- [ ] If migrations caused issues:
  - [ ] Restore from Supabase backup (automated daily)
  - [ ] Re-run critical Edge Function deployments
  - [ ] Verify RLS policies intact

### Communication
- [ ] Post status update to stakeholders
- [ ] Provide ETA for fix
- [ ] Document issue in post-mortem

---

## 8. Launch Day Checklist

### 24 Hours Before
- [ ] Verify all DNS records propagated
- [ ] Test full production environment one final time
- [ ] Backup production database (manual Supabase backup)
- [ ] Brief support team on deployment

### 2 Hours Before
- [ ] Final verification of Vercel deployment
- [ ] Test Sentry error tracking
- [ ] Check all third-party services are operational
- [ ] Prepare announcement message

### At Launch
- [ ] Monitor Sentry dashboard in real-time
- [ ] Monitor Vercel deployment logs
- [ ] Check social media/support channels for user reports
- [ ] Be ready for immediate rollback if needed

### 1 Hour After
- [ ] Verify SOS alerts working from multiple devices
- [ ] Check compliance dashboard access
- [ ] Verify Firebase push notifications
- [ ] Monitor error rate in Sentry

### 24 Hours After
- [ ] Review all metrics and logs
- [ ] Check for unexpected traffic patterns
- [ ] Verify user signup funnel working
- [ ] Document any issues for post-mortem

---

## 9. Support & Troubleshooting

### Common Issues

#### Domain Not Resolving
```bash
# Check DNS propagation
nslookup sosphere.co
dig sosphere.co

# If not propagated, wait and retry in 30 minutes
```

#### SSL Certificate Errors
- Verify CNAME and A records are correct in registrar
- Wait for DNS propagation
- Revalidate domain in Vercel Dashboard (Settings → Domains)

#### Environment Variables Not Loaded
- Verify variables set in Vercel (not in `.env.local`)
- Redeploy after adding/modifying variables
- Check build output for references to variables

#### Supabase Connection Issues
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct
- Check RLS policies allow the operation
- Verify auth context is initialized before making requests

#### Twilio Calls Failing
- Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` secrets set in Supabase
- Test with Twilio CLI: `twilio api:core:available-phone-numbers:local:list --country-code US`
- Check Twilio account balance and permissions

### Support Contacts
- **Vercel Support:** https://vercel.com/support
- **Supabase Support:** https://supabase.com/docs
- **Twilio Support:** https://www.twilio.com/help
- **Firebase Support:** https://firebase.google.com/support

---

## 10. Sign-Off

### Technical Review
- [ ] Code review completed
- [ ] Security audit completed
- [ ] Performance tested
- [ ] Accessibility verified

### Business Review
- [ ] Legal/Privacy review completed
- [ ] Terms of Service approved
- [ ] Privacy Policy published
- [ ] Support team trained

### Final Approval
- [ ] Project Manager approval: _________________ Date: _______
- [ ] Technical Lead approval: _________________ Date: _______
- [ ] Product Owner approval: _________________ Date: _______

---

## Document Changelog

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-04-08 | 1.0 | Initial deployment checklist | Platform Team |

---

**Questions or issues?** Contact the SOSphere platform team or refer to the troubleshooting section above.
