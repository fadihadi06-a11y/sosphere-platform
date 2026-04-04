# Admin Roles & Authentication Guide

## Login Credentials (Demo)

To test different admin roles, use the following email patterns:

### Super Admin
- **Email:** `super@company.com` (or any email containing "super")
- **Password:** Any password
- **Permissions:**
  - Full system access
  - Manage all users
  - Access security settings
  - Export data
  - Edit company settings
  - Create announcements
  - Edit manager notes

### Admin
- **Email:** `admin@company.com` (or any email NOT containing "super", "manager", or "viewer")
- **Password:** Any password
- **Permissions:**
  - Manage employees
  - View reports
  - Send announcements
  - Export data
  - Edit company settings
  - Edit manager notes

### Manager
- **Email:** `manager@company.com` (or any email containing "manager")
- **Password:** Any password
- **Permissions:**
  - View team data
  - Edit manager notes
  - Send announcements
  - Limited exports

### Viewer
- **Email:** `viewer@company.com` (or any email containing "viewer")
- **Password:** Any password
- **Permissions:**
  - View dashboard (read-only)
  - Cannot edit notes
  - Cannot export
  - Cannot create announcements

## Authentication Flow

1. **Login Screen** - Email, password, and reCAPTCHA verification
2. **Welcome Screen** - Shows "Welcome back, [Admin Name]" for 2.5 seconds
3. **Dashboard** - Full Company Safety Dashboard with role-based permissions

## Settings Panel

Access via the Settings button (gear icon) in the dashboard header.

### Tabs Available by Role:

**Super Admin:**
- Company Settings
- Users & Roles
- Security Settings
- Notifications
- Data & Export

**Admin:**
- Company Settings
- Users & Roles
- Notifications
- Data & Export

**Manager:**
- Company Settings (view only)
- Notifications
- Data & Export

**Viewer:**
- Notifications (view only)
- Data & Export (view only)

## UI Elements Controlled by Roles

### Hidden for Viewers:
- "New Announcement" button
- "Export PDF" button
- "Edit" button on Manager Notes
- "Export Branded PDF Report" in employee detail panel

### Hidden for Managers:
- Security Settings tab in Settings panel

### Available to All Roles:
- View dashboard
- View announcements
- View alerts
- View company info
- Access settings panel (with limited tabs)

## Testing the System

1. Start the app - you'll see the Admin Login screen
2. Enter any email with "super", "admin", "manager", or "viewer" to test different roles
3. Check the "I'm not a robot" checkbox
4. Click "Sign In"
5. Watch the welcome screen transition
6. Observe the role badge in the header next to "ENTERPRISE"
7. Test role-based permissions by trying to access restricted features

## Notes

- This is design-only implementation - no backend logic
- All authentication is mocked client-side
- Role detection is based on email content
- reCAPTCHA is UI-only, not verified
