# SOSphere Supabase Auth Email Templates

This directory contains professionally designed email templates for Supabase Authentication with SOSphere branding. All templates are fully responsive and optimized for email clients.

## Overview

- **otp.html** — One-Time Password / Magic Link verification email
- **welcome.html** — Account confirmation and welcome email
- **password-reset.html** — Password reset request email
- **invitation.html** — Team invitation email

## Features

All templates include:
- SOSphere brand identity (dark theme with #05070E background, #FF2D55 red, #00C8E0 cyan)
- Inline SVG shield icon logo
- Fully responsive HTML/CSS design (compatible with all email clients)
- Table-based layout for maximum email client compatibility
- Inline styles (email clients strip `<style>` tags)
- Professional typography and spacing
- Clear calls-to-action
- Security notices and helpful information
- Links to sosphere.co and info@sosphere.co

## Supabase Template Variables

These templates use Supabase template variables that will be automatically replaced:

- `{{ .Token }}` — OTP code (6-digit verification code)
- `{{ .ConfirmationURL }}` — URL for email confirmation links
- `{{ .Data.company_name }}` — Company name (for invitation emails)

## Setup Instructions

### 1. Access Supabase Dashboard

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your SOSphere project
3. Navigate to **Authentication** → **Email Templates**

### 2. Configure Each Email Template

#### OTP Email Template

1. Click on the **OTP / Magic Link** template
2. Paste the contents of `otp.html` into the template editor
3. Update the subject line to: `Your SOSphere Verification Code`
4. Click **Save**

**Subject line:** `Your SOSphere Verification Code`

**Template variables to verify:**
- `{{ .Token }}` — Displays the one-time code
- `{{ .ConfirmationURL }}` — Verification link

---

#### Welcome Email Template

1. Click on the **Confirmation** template
2. Paste the contents of `welcome.html` into the template editor
3. Update the subject line to: `Welcome to SOSphere — Confirm Your Account`
4. Click **Save**

**Subject line:** `Welcome to SOSphere — Confirm Your Account`

**Template variables to verify:**
- `{{ .ConfirmationURL }}` — Account confirmation link

---

#### Password Reset Email Template

1. Click on the **Password Reset** template
2. Paste the contents of `password-reset.html` into the template editor
3. Update the subject line to: `Reset Your SOSphere Password`
4. Click **Save**

**Subject line:** `Reset Your SOSphere Password`

**Template variables to verify:**
- `{{ .ConfirmationURL }}` — Password reset link

---

#### Invitation Email Template

1. Click on the **Invite** template
2. Paste the contents of `invitation.html` into the template editor
3. Update the subject line to: `You've been invited to join SOSphere`
4. Click **Save**

**Subject line:** `You've been invited to join SOSphere`

**Template variables to verify:**
- `{{ .ConfirmationURL }}` — Invitation acceptance link
- `{{ .Data.company_name }}` — Organization name (if using invitations)

---

## Testing

After setting up the templates in Supabase:

1. **Test OTP Email**
   - Sign up a new user or use the "Send password reset email" in the Auth Users list
   - Verify the email renders correctly with the verification code

2. **Test Welcome Email**
   - Create a new user in the Supabase dashboard
   - Check the welcome email design and links

3. **Test Password Reset Email**
   - Trigger a password reset request
   - Verify the security information and link are displayed correctly

4. **Test Invitation Email**
   - Send a team invitation (if implemented in your app)
   - Verify company name and details display correctly

## Email Client Compatibility

These templates are tested and optimized for:
- Gmail
- Outlook / Office 365
- Apple Mail
- Mozilla Thunderbird
- Mobile email clients (iOS Mail, Gmail app, Outlook mobile)
- Web-based email clients

## Technical Details

### Email Styling
- **Inline CSS only** — No `<style>` tags used
- **Table-based layout** — Maximum compatibility
- **Responsive design** — Mobile-first approach
- **Dark theme** — Dark background (#05070E) with white text

### Colors
- **Primary Background:** #05070E (Dark navy)
- **Secondary Background:** #0F1620 (Slightly lighter navy)
- **Primary Color (Red):** #FF2D55
- **Accent Color (Cyan):** #00C8E0
- **Text (Primary):** #FFFFFF
- **Text (Secondary):** #B4BAC8
- **Text (Tertiary):** #8B92A9

### Typography
- **Font Stack:** -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
- **Fallback Fonts:** System fonts for maximum compatibility

## Customization

If you need to customize the templates:

1. **Update colors** — Replace hex codes while maintaining the dark theme aesthetic
2. **Change copy** — Modify text content while preserving template variables
3. **Add/remove sections** — Adjust content blocks as needed
4. **Update support email** — Change `info@sosphere.co` throughout
5. **Update domain** — Change `sosphere.co` to your domain

**Important:** Always preserve the Supabase template variables (`{{ .Variable }}`) or emails will not render correctly.

## Troubleshooting

### Variables Not Rendering
- Ensure template variables are not modified or wrapped in tags
- Check the exact variable name matches Supabase documentation
- Verify the variable is supported for that email type

### Images Not Displaying
- All assets are inline SVGs — no external image files needed
- If you need to add a logo image, use base64 encoding or reference Supabase's image hosting

### Email Client Rendering Issues
- Test in multiple email clients using a service like Litmus or Email on Acid
- Inline CSS may be stripped by some clients — styles are duplicated where critical
- Table-based layout ensures structure is preserved

## Support

For issues or questions:
- Supabase Email Template Docs: https://supabase.com/docs/guides/auth/auth-email-templates
- Contact SOSphere Support: info@sosphere.co

## Updates

These templates are versioned with the SOSphere platform. Check for updates in the repository regularly.

---

**Last Updated:** 2026-04-08
**SOSphere Version:** Current
**Supabase Compatibility:** Latest versions
