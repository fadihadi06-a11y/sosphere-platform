# 🔗 World SOS - Deep Linking & Company Invitation Technical Specification

## 🎯 للمبرمج: مواصفات تقنية دقيقة

---

## 📋 Table of Contents

1. [Deep Linking Overview](#deep-linking-overview)
2. [URL Schemes](#url-schemes)
3. [Universal Links (iOS)](#universal-links-ios)
4. [App Links (Android)](#app-links-android)
5. [Deferred Deep Linking](#deferred-deep-linking)
6. [Company Invitation Flow](#company-invitation-flow)
7. [API Endpoints](#api-endpoints)
8. [Security & Validation](#security--validation)
9. [Error Handling](#error-handling)
10. [Testing Guide](#testing-guide)

---

## 1. Deep Linking Overview

### Purpose

Enable company admins to send invitation links that:
- Open the app directly if installed
- Direct to app stores if not installed
- Resume the invitation flow after app installation

### Link Types

```
1. Company Invitation:
   https://worldsos.app/invite?token=XYZ123ABC456

2. Emergency Share (future):
   https://worldsos.app/emergency/share?id=EMERGENCY_ID

3. Safe Trip Share (future):
   https://worldsos.app/trip/track?id=TRIP_ID
```

---

## 2. URL Schemes

### Custom URL Scheme

```
worldsos://invite?token=XYZ123ABC456
worldsos://emergency/share?id=EMERGENCY_ID
```

### Configuration

#### iOS (Info.plist)
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleTypeRole</key>
    <string>Editor</string>
    <key>CFBundleURLName</key>
    <string>com.worldsos.app</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>worldsos</string>
    </array>
  </dict>
</array>
```

#### Android (AndroidManifest.xml)
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data
    android:scheme="worldsos"
    android:host="invite" />
</intent-filter>
```

---

## 3. Universal Links (iOS)

### Configuration

#### 1. Apple App Site Association (AASA)

Host this file at: `https://worldsos.app/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.worldsos.app",
        "paths": [
          "/invite*",
          "/emergency/*",
          "/trip/*"
        ]
      }
    ]
  },
  "webcredentials": {
    "apps": ["TEAM_ID.com.worldsos.app"]
  }
}
```

**Important:**
- Must be served over HTTPS
- Content-Type: `application/json`
- No redirects allowed
- File must be accessible without authentication

#### 2. Enable Associated Domains

**Xcode:**
```
Capabilities → Associated Domains → +

applinks:worldsos.app
webcredentials:worldsos.app
```

**Entitlements file:**
```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:worldsos.app</string>
  <string>webcredentials:worldsos.app</string>
</array>
```

#### 3. Handle Universal Links

**Swift (SceneDelegate.swift):**
```swift
func scene(_ scene: UIScene, 
           continue userActivity: NSUserActivity) {
  guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
        let url = userActivity.webpageURL else {
    return
  }
  
  handleUniversalLink(url: url)
}

func handleUniversalLink(url: URL) {
  let components = URLComponents(url: url, resolvingAgainstBaseURL: true)
  
  guard let path = components?.path else { return }
  
  switch path {
  case "/invite":
    if let token = components?.queryItems?
         .first(where: { $0.name == "token" })?.value {
      handleInviteLink(token: token)
    }
  case "/emergency/share":
    if let emergencyId = components?.queryItems?
         .first(where: { $0.name == "id" })?.value {
      handleEmergencyShare(id: emergencyId)
    }
  default:
    break
  }
}

func handleInviteLink(token: String) {
  // Navigate to InvitationScreen with token
  NotificationCenter.default.post(
    name: .openInvitation,
    object: nil,
    userInfo: ["token": token]
  )
}
```

**React Native:**
```javascript
import { Linking } from 'react-native';

// Listen for deep links
useEffect(() => {
  // App opened from link
  Linking.getInitialURL().then((url) => {
    if (url) {
      handleDeepLink(url);
    }
  });

  // App already open, link clicked
  const subscription = Linking.addEventListener('url', ({ url }) => {
    handleDeepLink(url);
  });

  return () => subscription.remove();
}, []);

function handleDeepLink(url) {
  const { path, queryParams } = parseURL(url);
  
  if (path === '/invite') {
    navigation.navigate('Invitation', { token: queryParams.token });
  }
}
```

---

## 4. App Links (Android)

### Configuration

#### 1. Digital Asset Links

Host this file at: `https://worldsos.app/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.worldsos.app",
      "sha256_cert_fingerprints": [
        "PRODUCTION_KEY_SHA256_FINGERPRINT",
        "DEBUG_KEY_SHA256_FINGERPRINT"
      ]
    }
  }
]
```

**Get SHA256 Fingerprint:**
```bash
# Production key
keytool -list -v -keystore release.keystore

# Debug key
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android
```

#### 2. AndroidManifest.xml

```xml
<activity android:name=".MainActivity">
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    
    <data
      android:scheme="https"
      android:host="worldsos.app"
      android:pathPrefix="/invite" />
    
    <data
      android:scheme="https"
      android:host="worldsos.app"
      android:pathPrefix="/emergency" />
  </intent-filter>
</activity>
```

**Important:** `android:autoVerify="true"` enables automatic verification

#### 3. Handle App Links

**Kotlin (MainActivity.kt):**
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  
  handleIntent(intent)
}

override fun onNewIntent(intent: Intent?) {
  super.onNewIntent(intent)
  handleIntent(intent)
}

private fun handleIntent(intent: Intent?) {
  val appLinkAction = intent?.action
  val appLinkData: Uri? = intent?.data
  
  if (Intent.ACTION_VIEW == appLinkAction) {
    appLinkData?.let { uri ->
      when (uri.path) {
        "/invite" -> {
          val token = uri.getQueryParameter("token")
          token?.let { handleInviteLink(it) }
        }
        "/emergency/share" -> {
          val emergencyId = uri.getQueryParameter("id")
          emergencyId?.let { handleEmergencyShare(it) }
        }
      }
    }
  }
}

private fun handleInviteLink(token: String) {
  // Navigate to Invitation screen
  val intent = Intent(this, InvitationActivity::class.java)
  intent.putExtra("token", token)
  startActivity(intent)
}
```

**React Native:**
```javascript
// Same as iOS implementation above
// React Native handles both platforms automatically
```

---

## 5. Deferred Deep Linking

### Problem

User clicks invitation link but doesn't have app installed:
1. Redirects to App Store/Play Store
2. User downloads and installs app
3. **How to resume the invitation flow?**

### Solution: Deferred Deep Linking

#### Implementation Options

##### Option 1: Branch.io (Recommended)

**Install:**
```bash
npm install react-native-branch
```

**Configuration:**

**iOS (AppDelegate.m):**
```objc
#import <RNBranch/RNBranch.h>

- (BOOL)application:(UIApplication *)application 
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  
  [RNBranch initSessionWithLaunchOptions:launchOptions 
                               isReferrable:YES];
  
  return YES;
}

- (BOOL)application:(UIApplication *)application 
    continueUserActivity:(NSUserActivity *)userActivity 
      restorationHandler:(void (^)(NSArray *restorableObjects))restorationHandler {
  
  return [RNBranch continueUserActivity:userActivity];
}
```

**Android (AndroidManifest.xml):**
```xml
<meta-data 
  android:name="io.branch.sdk.BranchKey" 
  android:value="YOUR_BRANCH_KEY" />

<intent-filter android:autoVerify="true">
  <data 
    android:scheme="https" 
    android:host="worldsos.app.link" />
</intent-filter>
```

**Usage:**
```javascript
import branch from 'react-native-branch';

// Create deep link
const branchUniversalObject = await branch.createBranchUniversalObject(
  'invite_token_XYZ123',
  {
    title: 'Company Invitation',
    contentDescription: 'Join World SOS Company',
    contentMetadata: {
      customMetadata: {
        token: 'XYZ123ABC456',
        company_id: 'company_uuid',
        company_name: 'شركة الأمل',
      }
    }
  }
);

const linkProperties = {
  feature: 'company_invitation',
  channel: 'admin_panel',
};

const controlParams = {
  $desktop_url: 'https://worldsos.app/invite?token=XYZ123',
  $ios_url: 'https://apps.apple.com/app/worldsos/id123456',
  $android_url: 'https://play.google.com/store/apps/details?id=com.worldsos.app',
  $fallback_url: 'https://worldsos.app/invite?token=XYZ123',
};

const { url } = await branchUniversalObject.generateShortUrl(
  linkProperties,
  controlParams
);

console.log('Share link:', url);
// Output: https://worldsos.app.link/abc123

// Listen for deep links
branch.subscribe(({ error, params }) => {
  if (error) {
    console.error('Branch error:', error);
    return;
  }

  if (params['+clicked_branch_link']) {
    // Came from Branch link
    const token = params.token;
    const companyId = params.company_id;
    
    navigation.navigate('Invitation', { token });
  } else if (params['+non_branch_link']) {
    // Came from non-Branch link (direct URL)
    const url = params['+non_branch_link'];
    handleDeepLink(url);
  }
});
```

##### Option 2: Custom Implementation (قياسي للتطبيقات الصغيرة)

**Web Landing Page:**

```html
<!DOCTYPE html>
<html>
<head>
  <title>World SOS Invitation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <script>
    // Get token from URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    // Store token in localStorage
    if (token) {
      localStorage.setItem('pending_invite_token', token);
      localStorage.setItem('pending_invite_timestamp', Date.now());
    }
    
    // Detect platform
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    let storeUrl;
    
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      // iOS
      storeUrl = 'https://apps.apple.com/app/worldsos/id123456';
    } else if (/android/i.test(userAgent)) {
      // Android
      storeUrl = 'https://play.google.com/store/apps/details?id=com.worldsos.app';
    }
    
    // Try to open app (will fail if not installed)
    window.location.href = `worldsos://invite?token=${token}`;
    
    // Fallback to store after delay
    setTimeout(() => {
      if (storeUrl) {
        window.location.href = storeUrl;
      }
    }, 2000);
  </script>
  
  <div id="content">
    <img src="company_logo.png" alt="Company Logo" />
    <h1>تمت دعوتك للانضمام إلى شركة X</h1>
    <p>جاري توجيهك...</p>
    
    <a href="#" onclick="window.location.href=storeUrl">
      تحميل التطبيق
    </a>
  </div>
</body>
</html>
```

**App Check on Launch:**

```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

// On app launch (App.js)
useEffect(() => {
  checkPendingInvite();
}, []);

async function checkPendingInvite() {
  try {
    // Check if coming from web landing page
    const pendingToken = await AsyncStorage.getItem('pending_invite_token');
    const timestamp = await AsyncStorage.getItem('pending_invite_timestamp');
    
    if (pendingToken) {
      // Check if token is still fresh (within 24 hours)
      const hoursSince = (Date.now() - parseInt(timestamp)) / (1000 * 60 * 60);
      
      if (hoursSince < 24) {
        // Clear stored token
        await AsyncStorage.removeItem('pending_invite_token');
        await AsyncStorage.removeItem('pending_invite_timestamp');
        
        // Navigate to invitation
        navigation.navigate('Invitation', { token: pendingToken });
      }
    }
  } catch (error) {
    console.error('Error checking pending invite:', error);
  }
}
```

##### Option 3: Firebase Dynamic Links

**Install:**
```bash
npm install @react-native-firebase/app
npm install @react-native-firebase/dynamic-links
```

**Create Dynamic Link:**
```javascript
import dynamicLinks from '@react-native-firebase/dynamic-links';

async function createInviteLink(token, companyName) {
  const link = await dynamicLinks().buildLink({
    link: `https://worldsos.app/invite?token=${token}`,
    domainUriPrefix: 'https://worldsos.page.link',
    ios: {
      bundleId: 'com.worldsos.app',
      appStoreId: '123456',
    },
    android: {
      packageName: 'com.worldsos.app',
    },
    social: {
      title: `دعوة للانضمام إلى ${companyName}`,
      descriptionText: 'تم دعوتك للانضمام إلى نظام السلامة',
      imageUrl: 'https://worldsos.app/og-image.png',
    },
  });
  
  return link;
}

// Listen for links
useEffect(() => {
  const unsubscribe = dynamicLinks().onLink(handleDynamicLink);
  
  // Check initial link
  dynamicLinks()
    .getInitialLink()
    .then(link => {
      if (link) {
        handleDynamicLink(link);
      }
    });
  
  return () => unsubscribe();
}, []);

function handleDynamicLink(link) {
  const { url } = link;
  const urlObj = new URL(url);
  const token = urlObj.searchParams.get('token');
  
  if (token) {
    navigation.navigate('Invitation', { token });
  }
}
```

---

## 6. Company Invitation Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  1. Admin sends invitation                                  │
├─────────────────────────────────────────────────────────────┤
│  POST /api/company/invite                                   │
│  → Creates invite record                                    │
│  → Generates unique token                                   │
│  → Returns shareable link                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Employee receives link via SMS/Email/WhatsApp           │
├─────────────────────────────────────────────────────────────┤
│  Link: https://worldsos.app/invite?token=XYZ123            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Employee clicks link                                    │
├─────────────────────────────────────────────────────────────┤
│  App Installed?                                             │
│    YES → Opens app directly (Universal/App Links)           │
│    NO  → Web landing page                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ├─ App Installed ──────────────────────┐
                 │                                      │
                 ▼                                      ▼
┌──────────────────────────┐            ┌──────────────────────────┐
│  4a. App Opens           │            │  4b. Web Landing Page    │
├──────────────────────────┤            ├──────────────────────────┤
│  - Validate token        │            │  - Show company info     │
│  - Check auth status     │            │  - Store token           │
│  - Navigate to screen    │            │  - Redirect to store     │
└──────────┬───────────────┘            └──────────┬───────────────┘
           │                                       │
           │                                       ▼
           │                            ┌──────────────────────────┐
           │                            │  5. Download & Install   │
           │                            ├──────────────────────────┤
           │                            │  - User downloads app    │
           │                            │  - Opens app             │
           │                            │  - Check stored token    │
           │                            └──────────┬───────────────┘
           │                                       │
           └───────────────┬───────────────────────┘
                           │
                           ▼
          ┌─────────────────────────────────────────┐
          │  6. Check Authentication                │
          ├─────────────────────────────────────────┤
          │  Logged In?                             │
          │    YES → Show Invitation Screen         │
          │    NO  → Login → Show Invitation        │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  7. Show Invitation Screen              │
          ├─────────────────────────────────────────┤
          │  - Company logo & name                  │
          │  - Expiry timer                         │
          │  - Accept/Reject buttons                │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  8. User Accepts                        │
          ├─────────────────────────────────────────┤
          │  - Navigate to Complete Profile         │
          │  - Pre-fill phone from auth             │
          │  - Collect additional data              │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  9. Submit Join Request                 │
          ├─────────────────────────────────────────┤
          │  POST /api/company/join-request         │
          │  - Validate token                       │
          │  - Mark token as used                   │
          │  - Create join request record           │
          │  - Status: pending                      │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  10. Show Pending Screen                │
          ├─────────────────────────────────────────┤
          │  - "Awaiting approval"                  │
          │  - Timestamp                            │
          │  - Refresh button                       │
          │  - Real-time updates (optional)         │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  11. Admin Approves (in Web Dashboard)  │
          ├─────────────────────────────────────────┤
          │  POST /api/company/join-approve         │
          │  - Update join_request status           │
          │  - Create employee record               │
          │  - Send push notification to employee   │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  12. Show Approved Screen               │
          ├─────────────────────────────────────────┤
          │  - Success animation                    │
          │  - Employee details                     │
          │  - "Enter App" button                   │
          └─────────────────┬───────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────────┐
          │  13. Navigate to Home (with Company tab)│
          ├─────────────────────────────────────────┤
          │  - Bottom nav now has 6 tabs            │
          │  - Company features unlocked            │
          │  - Employee mode active                 │
          └─────────────────────────────────────────┘
```

---

## 7. API Endpoints

### 7.1 Create Invitation

**Endpoint:** `POST /api/company/invite`

**Authentication:** Required (Company Admin)

**Request:**
```json
{
  "company_id": "uuid",
  "phone": "+964501234567",
  "email": "employee@example.com",
  "full_name": "أحمد محمد",
  "department": "العمليات الميدانية",
  "role": "field_employee",
  "custom_message": "مرحباً بك في فريقنا!"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "invitation_id": "uuid",
    "token": "XYZ123ABC456DEF789",
    "link": "https://worldsos.app/invite?token=XYZ123ABC456DEF789",
    "short_link": "https://worldsos.app.link/abc123",
    "expires_at": "2025-02-25T12:00:00Z",
    "created_at": "2025-02-24T12:00:00Z"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "PHONE_ALREADY_INVITED",
    "message": "هذا الرقم تمت دعوته مسبقاً",
    "details": {
      "existing_invitation_id": "uuid",
      "status": "pending"
    }
  }
}
```

**Error Codes:**
- `UNAUTHORIZED` - Not a company admin
- `PHONE_ALREADY_INVITED` - Phone already has pending invitation
- `PHONE_ALREADY_EMPLOYEE` - Phone already registered as employee
- `MAX_EMPLOYEES_REACHED` - Company reached max employees limit
- `INVALID_PHONE_FORMAT` - Phone number format invalid

---

### 7.2 Validate Invitation

**Endpoint:** `GET /api/company/invite/validate?token={TOKEN}`

**Authentication:** Optional (public endpoint)

**Response (Valid):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "company": {
      "id": "uuid",
      "name": "شركة الأمل للتجارة",
      "logo_url": "https://cdn.worldsos.app/companies/logo.png",
      "department": "العمليات الميدانية"
    },
    "invitation": {
      "id": "uuid",
      "invited_phone": "+964501234567",
      "invited_email": "employee@example.com",
      "invited_name": "أحمد محمد",
      "role": "field_employee",
      "expires_at": "2025-02-25T12:00:00Z",
      "created_by": {
        "name": "إدارة الموارد البشرية",
        "role": "HR Manager"
      },
      "created_at": "2025-02-24T12:00:00Z"
    },
    "time_remaining": {
      "hours": 23,
      "minutes": 30,
      "seconds": 15
    }
  }
}
```

**Response (Invalid):**
```json
{
  "success": false,
  "data": {
    "valid": false,
    "reason": "expired",
    "message": "انتهت صلاحية الدعوة",
    "expired_at": "2025-02-23T12:00:00Z"
  }
}
```

**Invalid Reasons:**
- `not_found` - Token doesn't exist
- `expired` - Token expired (>24 hours)
- `already_used` - Token already used
- `revoked` - Admin revoked the invitation
- `employee_limit_reached` - Company full

---

### 7.3 Submit Join Request

**Endpoint:** `POST /api/company/join-request`

**Authentication:** Required (User must be logged in)

**Request:**
```json
{
  "token": "XYZ123ABC456DEF789",
  "profile": {
    "full_name": "أحمد محمد سالم",
    "email": "ahmad@example.com",
    "employee_id": "EMP-2025-001",
    "department": "العمليات الميدانية",
    "additional_info": {
      "emergency_contact": "أمي",
      "emergency_phone": "+964507654321"
    }
  },
  "privacy_accepted": true,
  "terms_accepted": true
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "join_request_id": "uuid",
    "status": "pending",
    "submitted_at": "2025-02-24T12:30:00Z",
    "estimated_review_time": "2-4 hours",
    "message": "تم إرسال طلبك بنجاح. سيتم مراجعته قريباً."
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "TOKEN_INVALID",
    "message": "الدعوة غير صالحة أو منتهية",
    "details": {}
  }
}
```

**Error Codes:**
- `TOKEN_INVALID` - Token not valid
- `TOKEN_EXPIRED` - Token expired
- `TOKEN_USED` - Token already used
- `PHONE_MISMATCH` - User phone doesn't match invited phone
- `PRIVACY_NOT_ACCEPTED` - Privacy checkbox not checked
- `VALIDATION_ERROR` - Invalid field data

---

### 7.4 Get Join Request Status

**Endpoint:** `GET /api/company/join-request/status?request_id={ID}`

**Authentication:** Required (Request owner only)

**Response (Pending):**
```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "pending",
    "submitted_at": "2025-02-24T12:30:00Z",
    "reviewed_at": null,
    "reviewed_by": null,
    "company": {
      "name": "شركة الأمل",
      "logo_url": "https://..."
    }
  }
}
```

**Response (Approved):**
```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "approved",
    "submitted_at": "2025-02-24T12:30:00Z",
    "reviewed_at": "2025-02-24T14:00:00Z",
    "reviewed_by": {
      "name": "مدير الموارد البشرية",
      "role": "HR Manager"
    },
    "employee": {
      "id": "uuid",
      "employee_code": "EMP-2025-001",
      "department": "العمليات الميدانية",
      "role": "field_employee",
      "duty_status": "off_duty"
    },
    "message": "تمت الموافقة على طلبك! مرحباً بك في الفريق."
  }
}
```

**Response (Rejected):**
```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "rejected",
    "submitted_at": "2025-02-24T12:30:00Z",
    "reviewed_at": "2025-02-24T14:00:00Z",
    "reviewed_by": {
      "name": "مدير الموارد البشرية"
    },
    "rejection_reason": "البيانات غير مطابقة لسجلاتنا",
    "can_reapply": true,
    "message": "نأسف، لم تتم الموافقة على طلبك. يمكنك التواصل مع قسم الموارد البشرية."
  }
}
```

---

### 7.5 Approve/Reject Join Request (Admin Only)

**Endpoint:** `POST /api/company/join-request/review`

**Authentication:** Required (Company Admin)

**Request (Approve):**
```json
{
  "request_id": "uuid",
  "action": "approve",
  "employee_data": {
    "employee_code": "EMP-2025-001",
    "department": "العمليات الميدانية",
    "position": "موظف ميداني",
    "risk_level": "medium",
    "custom_fields": {}
  },
  "send_notification": true,
  "welcome_message": "مرحباً بك في فريق شركة الأمل!"
}
```

**Request (Reject):**
```json
{
  "request_id": "uuid",
  "action": "reject",
  "reason": "البيانات غير مطابقة",
  "send_notification": true,
  "allow_reapply": false
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "request_id": "uuid",
    "status": "approved",
    "employee_id": "uuid",
    "reviewed_at": "2025-02-24T14:00:00Z",
    "notification_sent": true
  }
}
```

---

## 8. Security & Validation

### 8.1 Token Security

**Token Generation:**
```javascript
// Secure random token
const crypto = require('crypto');

function generateInviteToken() {
  // 32 bytes = 256 bits of entropy
  const token = crypto.randomBytes(32).toString('base64url');
  return token; // e.g., "XYZ123ABC456DEF789..."
}
```

**Token Structure:**
```
Format: Base64URL encoded random bytes
Length: 43 characters
Entropy: 256 bits
Collision probability: Negligible

Example: "XYZ123ABC456DEF789GHI012JKL345MNO678PQR901"
```

**Token Storage:**
```sql
CREATE TABLE company_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  token VARCHAR(64) UNIQUE NOT NULL, -- Indexed for fast lookup
  invited_phone VARCHAR(20) NOT NULL,
  invited_email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending', -- pending, used, expired, revoked
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL, -- NOW() + 24 hours
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES users(id),
  
  INDEX idx_token (token),
  INDEX idx_status_expires (status, expires_at)
);
```

### 8.2 Validation Rules

**Phone Number Matching:**
```javascript
async function validateInviteToken(token, userPhone) {
  // 1. Get invitation
  const invite = await db.query(`
    SELECT * FROM company_invites 
    WHERE token = $1 AND status = 'pending'
  `, [token]);
  
  if (!invite) {
    throw new Error('INVITE_NOT_FOUND');
  }
  
  // 2. Check expiry
  if (new Date() > new Date(invite.expires_at)) {
    await db.query(`
      UPDATE company_invites 
      SET status = 'expired' 
      WHERE id = $1
    `, [invite.id]);
    
    throw new Error('INVITE_EXPIRED');
  }
  
  // 3. Verify phone match
  const normalizedInvitePhone = normalizePhone(invite.invited_phone);
  const normalizedUserPhone = normalizePhone(userPhone);
  
  if (normalizedInvitePhone !== normalizedUserPhone) {
    throw new Error('PHONE_MISMATCH');
  }
  
  // 4. Check company limits
  const employeeCount = await getCompanyEmployeeCount(invite.company_id);
  const companyLimit = await getCompanyEmployeeLimit(invite.company_id);
  
  if (employeeCount >= companyLimit) {
    throw new Error('EMPLOYEE_LIMIT_REACHED');
  }
  
  return invite;
}

function normalizePhone(phone) {
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  
  // Add country code if missing (Iraq example)
  if (digits.length === 10 && digits.startsWith('0')) {
    digits = '964' + digits.substring(1);
  }
  
  return `+${digits}`;
}
```

### 8.3 One-Time Use Enforcement

```javascript
async function markTokenAsUsed(token, userId, requestId) {
  const result = await db.query(`
    UPDATE company_invites
    SET 
      status = 'used',
      used_at = NOW(),
      used_by = $2,
      join_request_id = $3
    WHERE token = $1 
      AND status = 'pending'
    RETURNING id
  `, [token, userId, requestId]);
  
  if (result.rowCount === 0) {
    throw new Error('TOKEN_ALREADY_USED');
  }
  
  return result.rows[0];
}
```

### 8.4 Rate Limiting

```javascript
// Prevent brute force token guessing
const rateLimit = require('express-rate-limit');

const validateInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per windowMs
  message: 'Too many validation attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/api/company/invite/validate', 
  validateInviteLimiter, 
  validateInviteHandler
);
```

### 8.5 Anti-Link Sharing Protection

```javascript
// Prevent sharing invitation links
async function enforcePhoneOwnership(invite, userPhone) {
  // 1. Phone must match invitation
  if (normalizePhone(invite.invited_phone) !== normalizePhone(userPhone)) {
    // Log suspicious activity
    await logSecurityEvent({
      type: 'INVITE_PHONE_MISMATCH',
      invite_id: invite.id,
      expected_phone: invite.invited_phone,
      actual_phone: userPhone,
      ip_address: req.ip,
    });
    
    throw new Error('INVITE_NOT_FOR_YOU');
  }
  
  // 2. Check for duplicate attempts
  const recentAttempts = await db.query(`
    SELECT COUNT(*) as count
    FROM join_request_attempts
    WHERE invite_id = $1 
      AND created_at > NOW() - INTERVAL '1 hour'
  `, [invite.id]);
  
  if (recentAttempts.rows[0].count > 5) {
    throw new Error('TOO_MANY_ATTEMPTS');
  }
  
  // 3. Log attempt
  await db.query(`
    INSERT INTO join_request_attempts 
      (invite_id, user_id, user_phone, ip_address)
    VALUES ($1, $2, $3, $4)
  `, [invite.id, userId, userPhone, req.ip]);
}
```

---

## 9. Error Handling

### Client-Side Error Handling

```javascript
// React Native example
async function handleInvitationAccept(token) {
  try {
    setLoading(true);
    setError(null);
    
    const response = await api.post('/company/join-request', {
      token,
      profile: profileData,
      privacy_accepted: true,
      terms_accepted: true,
    });
    
    if (response.data.success) {
      // Navigate to pending screen
      navigation.navigate('PendingApproval', {
        requestId: response.data.data.join_request_id,
      });
    }
  } catch (error) {
    const errorCode = error.response?.data?.error?.code;
    
    switch (errorCode) {
      case 'TOKEN_INVALID':
        setError('الدعوة غير صالحة. تأكد من الرابط.');
        break;
      
      case 'TOKEN_EXPIRED':
        setError('انتهت صلاحية الدعوة. تواصل مع الشركة للحصول على دعوة جديدة.');
        break;
      
      case 'TOKEN_USED':
        setError('هذه الدعوة تم استخدامها مسبقاً.');
        break;
      
      case 'PHONE_MISMATCH':
        setError('هذه الدعوة ليست لرقم هاتفك. استخدم الرقم الصحيح أو تواصل مع الشركة.');
        break;
      
      case 'EMPLOYEE_LIMIT_REACHED':
        setError('الشركة وصلت للحد الأقصى من الموظفين.');
        break;
      
      case 'PRIVACY_NOT_ACCEPTED':
        setError('يجب الموافقة على سياسة الخصوصية للمتابعة.');
        break;
      
      default:
        setError('حدث خطأ. حاول مرة أخرى.');
    }
  } finally {
    setLoading(false);
  }
}
```

### Server-Side Error Responses

```javascript
// Standardized error response format
class APIError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Error middleware
app.use((err, req, res, next) => {
  if (err instanceof APIError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }
  
  // Unknown error
  console.error('Unhandled error:', err);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'حدث خطأ في الخادم',
    },
  });
});
```

---

## 10. Testing Guide

### 10.1 Test Scenarios

#### Scenario 1: Happy Path

```
1. Admin creates invitation
   → GET invitation link
   
2. Employee clicks link (app not installed)
   → Lands on web page
   → Clicks "Download"
   → Installs app
   
3. App opens
   → Checks pending token
   → Shows invitation screen
   
4. Employee logs in (if not logged in)
   → Redirects back to invitation
   
5. Employee accepts invitation
   → Fills profile
   → Submits join request
   
6. Show pending screen
   → Poll for status
   
7. Admin approves (in web dashboard)
   → Employee receives notification
   
8. Employee sees approved screen
   → Clicks "Enter App"
   → Home screen with Company tab
```

#### Scenario 2: App Already Installed

```
1. Admin creates invitation
   
2. Employee clicks link (app installed)
   → App opens directly via Universal Link
   → Shows invitation screen
   
3. Rest same as Scenario 1 (steps 4-8)
```

#### Scenario 3: Token Expired

```
1. Employee clicks old link (>24 hours)
   
2. App validates token
   → Returns "expired"
   
3. Show error screen
   → "انتهت صلاحية الدعوة"
   → Button: "طلب دعوة جديدة"
```

#### Scenario 4: Token Already Used

```
1. Employee clicks link (already joined)
   
2. App validates token
   → Returns "already_used"
   
3. Show info screen
   → "أنت بالفعل موظف في هذه الشركة"
   → Button: "الذهاب للرئيسية"
```

#### Scenario 5: Phone Number Mismatch

```
1. Employee A receives invitation
2. Employee A shares link with Employee B
3. Employee B clicks link
4. Employee B logs in with their phone
5. App validates token
   → Phone doesn't match
   → Returns "PHONE_MISMATCH"
6. Show error
   → "هذه الدعوة ليست لك"
```

### 10.2 Testing Tools

**Test Deep Links:**

```bash
# iOS Simulator
xcrun simctl openurl booted "https://worldsos.app/invite?token=TEST123"

# Android Emulator
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://worldsos.app/invite?token=TEST123" \
  com.worldsos.app

# Or use custom scheme
adb shell am start -W -a android.intent.action.VIEW \
  -d "worldsos://invite?token=TEST123" \
  com.worldsos.app
```

**Validate AASA/assetlinks:**

```bash
# iOS
curl https://worldsos.app/.well-known/apple-app-site-association

# Android
curl https://worldsos.app/.well-known/assetlinks.json
```

**Test Universal Links (iOS):**
```bash
# Must test on real device (simulator doesn't work for Universal Links)
# Send link via Messages or Notes app
# Tap link → should open app
```

**Verify Deep Link Handler:**

```javascript
// Add logging in app
Linking.addEventListener('url', ({ url }) => {
  console.log('🔗 Deep link received:', url);
  // Check if handled correctly
});
```

### 10.3 Test Checklist

```
Deep Linking:
  □ Universal Links (iOS) - Real device
  □ App Links (Android) - Real device
  □ Custom URL scheme - Both platforms
  □ Deferred deep linking - Fresh install
  □ Web landing page - All browsers
  
Invitation Flow:
  □ Valid token - Accept invitation
  □ Expired token - Show error
  □ Used token - Show info
  □ Invalid token - Show error
  □ Phone mismatch - Show error
  
Security:
  □ One-time use enforced
  □ Expiry enforced (24h)
  □ Phone matching enforced
  □ Rate limiting working
  
Edge Cases:
  □ App not installed
  □ App already installed
  □ User not logged in
  □ User already employee
  □ Company at max employees
  □ Network offline
  □ Token revoked by admin
```

---

**Last Updated:** February 2026  
**Version:** 1.0  
**Author:** World SOS Development Team

**🚀 Ready for Implementation!**
