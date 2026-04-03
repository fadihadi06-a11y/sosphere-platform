# 🌍 WORLD SOS — MASTER DESIGN REBUILD DOCUMENT
## START FROM ZERO — STRICT PRODUCT ARCHITECTURE

---

## ⚠️ 0. DO NOT DESIGN ANYTHING BEFORE READING THIS

### This is NOT:
- ❌ A landing page product
- ❌ A marketing website
- ❌ A combined dashboard

### This IS:
- ✅ A Global Emergency System
- ✅ Three architecturally separated platforms
- ✅ Mission-critical safety infrastructure

---

## 📐 1. PRODUCT STRUCTURE — VISUAL ARCHITECTURE

### Three Separate Design Files in Figma:

```
📁 Project: World SOS
  │
  ├── 📁 01_Mobile_App
  │   ├── 🎨 Cover
  │   ├── 📱 Splash
  │   ├── 🔐 Authentication Flow
  │   ├── 🏠 Main App Screens
  │   ├── 🆘 Emergency Flow
  │   ├── 👥 Employee Flow
  │   └── 🧩 Component Library
  │
  ├── 📁 02_Company_Dashboard
  │   ├── 🎨 Cover
  │   ├── 🔐 Login
  │   ├── 📊 Dashboard Screens
  │   ├── 👔 Employee Management
  │   ├── 📨 Invitations System
  │   └── 🧩 Component Library
  │
  └── 📁 03_Super_Admin
      ├── 🎨 Cover
      ├── 🔐 Login (Hidden)
      ├── 👑 System Control
      ├── 🏢 Company Management
      ├── 💰 Revenue & Billing
      └── 🧩 Component Library
```

### ⚠️ CRITICAL RULES:
- **NO shared entry screens**
- **NO combined homepage**
- **NO navigation between platforms**
- Each platform = Separate product

---

## 📱 2. MOBILE APP — FOUNDATION DESIGN

### Platform Specifications:

```
Primary Frame:   iPhone 15 Pro (393 × 852 pt)
Secondary Frame: Android (360 × 800 dp)
Orientation:     Portrait only
RTL Support:     Full mirroring
LTR Support:     Default English
Dark Mode:       Primary (required)
Light Mode:      Optional future
```

### 🎨 Color System (Dark-First Premium)

```css
/* Background */
--bg-primary:    #05070D;
--bg-surface:    #0B0F1A;
--bg-elevated:   #111827;
--bg-overlay:    rgba(5, 7, 13, 0.95);

/* Primary Brand */
--primary-red:   #FF2D55;
--primary-hover: #FF1744;

/* Accent */
--accent-cyan:   #00E0FF;
--accent-purple: #8B5CF6;

/* Status */
--success:       #00C853;
--warning:       #FFAB00;
--error:         #FF3B30;
--info:          #0EA5E9;

/* Text */
--text-primary:  #FFFFFF;
--text-secondary:#A3A3A3;
--text-tertiary: #525252;
--text-disabled: #404040;

/* Borders */
--border-subtle: rgba(255, 255, 255, 0.08);
--border-light:  rgba(255, 255, 255, 0.12);
--border-strong: rgba(255, 255, 255, 0.20);
```

### 📝 Typography System

```css
/* Font Families */
--font-arabic:  'IBM Plex Sans Arabic', -apple-system, sans-serif;
--font-english: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono:    'SF Mono', 'Courier New', monospace;

/* Type Scale */
--text-6xl:  48px / 56px;  /* Hero */
--text-5xl:  40px / 48px;  /* Display */
--text-4xl:  32px / 40px;  /* H1 */
--text-3xl:  24px / 32px;  /* H2 */
--text-2xl:  20px / 28px;  /* H3 */
--text-xl:   18px / 26px;  /* H4 */
--text-lg:   16px / 24px;  /* Body Large */
--text-base: 15px / 22px;  /* Body */
--text-sm:   14px / 20px;  /* Small */
--text-xs:   12px / 18px;  /* Tiny */

/* Weights */
--font-light:     300;
--font-regular:   400;
--font-medium:    500;
--font-semibold:  600;
--font-bold:      700;
--font-black:     900;
```

### 📏 Spacing System (8pt Grid)

```
--space-0:  0px;
--space-1:  4px;   (0.5 unit)
--space-2:  8px;   (1 unit)
--space-3:  12px;  (1.5 units)
--space-4:  16px;  (2 units)
--space-5:  20px;  (2.5 units)
--space-6:  24px;  (3 units)
--space-8:  32px;  (4 units)
--space-10: 40px;  (5 units)
--space-12: 48px;  (6 units)
--space-16: 64px;  (8 units)
--space-20: 80px;  (10 units)
```

### 🔲 Border Radius

```
--radius-sm:   8px;
--radius-md:   12px;
--radius-lg:   16px;
--radius-xl:   20px;
--radius-2xl:  24px;
--radius-full: 9999px;
```

### 🌑 Shadows

```css
--shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.2);
--shadow-md:  0 4px 8px rgba(0, 0, 0, 0.3);
--shadow-lg:  0 8px 16px rgba(0, 0, 0, 0.4);
--shadow-xl:  0 12px 24px rgba(0, 0, 0, 0.5);

/* Glows */
--glow-red:   0 0 20px rgba(255, 45, 85, 0.4);
--glow-cyan:  0 0 20px rgba(0, 224, 255, 0.4);
--glow-success: 0 0 20px rgba(0, 200, 83, 0.4);
```

---

## 🎯 3. MOBILE FLOW — EXACT SCREENS

### SCREEN 1: Splash

**Specifications:**
```
Duration:        2.5 seconds
Auto-transition: Yes (to Login)
User action:     None (automatic)
Background:      --bg-primary gradient
```

**Layout:**
```
┌─────────────────────────────────┐
│                                 │
│                                 │
│                                 │
│        [Logo 96×96px]           │
│                                 │
│                                 │
│  ══ Arabic (14px, semibold) ══  │
│  منصة السلامة والأمان العالمية  │
│                                 │
│  ══ English (14px, medium) ══   │
│  Global Emergency & Safety      │
│         Platform                │
│                                 │
│                                 │
│     [Loading Spinner 24px]      │
│                                 │
│                                 │
└─────────────────────────────────┘
```

**Design Details:**
- Logo: Centered, 96×96px, with subtle glow effect
- Arabic text: IBM Plex Sans Arabic, 14px, semibold, #A3A3A3
- English text: IBM Plex Sans, 14px, medium, #A3A3A3
- Spinner: 24px, --primary-red color
- Animation: Logo fade-in (0.5s), then text fade-in (0.3s)

---

### SCREEN 2: Login (MANDATORY ENTRY)

**This is the FIRST screen users see after splash**

**Layout:**
```
┌─────────────────────────────────┐
│  [AR/EN Toggle]                 │  Top-right
│                                 │
│        [Logo 64×64px]           │
│                                 │
│      ══ Arabic ══               │
│      تسجيل الدخول               │  32px, bold
│                                 │
│      ══ English ══              │
│         Sign In                 │  32px, bold
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  Option A — Phone OTP           │
│                                 │
│  [🇮🇶 ▼] [Phone Number]         │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: إرسال رمز التحقق     │  │
│  │  EN: Send Verification    │  │
│  └───────────────────────────┘  │
│                                 │
│        ───── OR ─────           │
│                                 │
│  Option B — Google Login        │
│                                 │
│  ┌───────────────────────────┐  │
│  │  [G] AR: المتابعة بـGoogle │  │
│  │      EN: Continue with    │  │
│  │          Google            │  │
│  └───────────────────────────┘  │
│                                 │
│  AR: بالمتابعة أنت توافق على    │
│      الشروط وسياسة الخصوصية    │
│  EN: By continuing you agree   │
│      to Terms & Privacy Policy │
│                                 │
└─────────────────────────────────┘
```

**Component Specs:**

#### Language Toggle
```
Position:  Top-right (8px from edge)
Type:      Segmented control
Options:   [AR] [EN]
Width:     80px
Height:    32px
Active:    --primary-red background
Inactive:  Transparent
```

#### Phone Input Container
```
Height:        56px
Background:    --bg-surface
Border:        1px solid --border-subtle
Border-radius: --radius-md (12px)
Padding:       0 16px
Gap:           12px

Components:
  - Country selector (80px width)
  - Phone input (flex: 1)
  
States:
  Default:   border --border-subtle
  Focus:     border --primary-red, glow-red
  Error:     border --error
  Disabled:  opacity 0.5
```

#### Primary Button (Phone)
```
Height:        56px
Background:    --primary-red
Border-radius: --radius-md (12px)
Font-size:     16px
Font-weight:   600
Color:         #FFFFFF
Shadow:        --shadow-md
Text:
  AR: إرسال رمز التحقق
  EN: Send Verification Code

States:
  Default:   full opacity
  Hover:     background --primary-hover
  Active:    scale(0.98)
  Loading:   Spinner + disabled
  Disabled:  opacity 0.5
```

#### Google Button
```
Height:        56px
Background:    #FFFFFF
Border:        1px solid --border-light
Border-radius: --radius-md
Color:         #1F2937
Icon:          Google logo 24px (left side)
Text:
  AR: المتابعة بحساب Google
  EN: Continue with Google

States:
  Default:   white background
  Hover:     background #F9FAFB
  Active:    background #F3F4F6
  Loading:   Spinner (gray)
```

#### Footer Links
```
Font-size:   12px
Color:       --text-tertiary
Links:       Underlined, --accent-cyan
Alignment:   Center
Line-height: 18px
```

**Required States:**

1. **Default State**
   - All fields empty
   - Buttons enabled

2. **Invalid Phone**
   ```
   Error text: AR: رقم الهاتف غير صحيح
               EN: Invalid phone number
   Color: --error
   Position: Below input
   Font-size: 12px
   ```

3. **Rate Limit**
   ```
   Error text: AR: حاول مرة أخرى بعد {X} ثانية
               EN: Try again after {X} seconds
   Timer: Live countdown
   Button: Disabled
   ```

4. **Loading State**
   ```
   Button: Shows spinner (24px, white)
   Text: AR: جاري الإرسال...
         EN: Sending...
   Form: Disabled
   ```

5. **Network Error**
   ```
   Toast notification:
     AR: تحقق من اتصال الإنترنت
     EN: Check your internet connection
   Duration: 3s
   Position: Top center
   ```

6. **Google Auth Failed**
   ```
   Error: AR: فشل تسجيل الدخول. حاول مرة أخرى
          EN: Login failed. Please try again
   Display: Below Google button
   Color: --error
   ```

---

### SCREEN 3: OTP Verification

**Layout:**
```
┌─────────────────────────────────┐
│  [← Back]                       │
│                                 │
│      ══ Arabic ══               │
│      إدخال رمز التحقق           │  28px, bold
│   تم إرسال رمز إلى              │  14px, secondary
│    +964 501 234 567             │  14px, primary
│                                 │
│      ══ English ══              │
│  Enter Verification Code        │  28px, bold
│     Code sent to                │  14px, secondary
│    +964 501 234 567             │  14px, primary
│                                 │
│   ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐      │  6 OTP boxes
│   │ │ │ │ │ │ │ │ │ │ │ │      │  48×56 each
│   └─┘ └─┘ └─┘ └─┘ └─┘ └─┘      │
│                                 │
│  AR: لم يصلك الرمز؟ إعادة إرسال │
│  EN: Didn't receive? Resend     │
│      (Available in 60s)         │  Countdown
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: تحقق                 │  │
│  │  EN: Verify               │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**OTP Box Specifications:**
```
Width:         48px
Height:        56px
Border:        1px solid --border-subtle
Border-radius: --radius-md (12px)
Background:    --bg-surface
Font-size:     24px
Font-weight:   700
Text-align:    center
Color:         --text-primary
Direction:     LTR (always, even in RTL)
Gap:           8px between boxes

Auto-focus:    Move to next on input
Backspace:     Focus previous box
Paste:         Distribute digits across boxes
```

**States:**

1. **Empty State**
   ```
   Border: --border-subtle
   Background: --bg-surface
   ```

2. **Focused State**
   ```
   Border: --primary-red
   Box-shadow: --glow-red
   Background: --bg-elevated
   ```

3. **Filled State**
   ```
   Border: --success
   Color: --text-primary
   ```

4. **Error State (Wrong Code)**
   ```
   Animation: Shake (keyframes)
   Border: --error
   Background: rgba(255, 59, 48, 0.1)
   
   Error message:
     AR: رمز غير صحيح. حاول مرة أخرى
     EN: Wrong code. Try again
   
   Action: Clear all boxes, focus first
   ```

5. **Expired State**
   ```
   Message:
     AR: انتهت صلاحية الرمز
     EN: Code expired
   
   Action: Show "Resend" button (enabled)
   ```

6. **Resend Disabled**
   ```
   Text: AR: إعادة إرسال (متاح بعد {X} ثانية)
         EN: Resend (available in {X}s)
   Color: --text-disabled
   Countdown: Live timer from 60 to 0
   ```

7. **Resend Success**
   ```
   Toast:
     AR: ✓ تم إرسال رمز جديد
     EN: ✓ New code sent
   Color: --success
   Duration: 3s
   Action: Reset timer to 60s
   ```

**Shake Animation:**
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  50% { transform: translateX(8px); }
  75% { transform: translateX(-8px); }
}
```

---

### SCREEN 4: Account Type Decision

**⚠️ CRITICAL: This screen appears ONLY for NEW users after successful OTP**

**Layout:**
```
┌─────────────────────────────────┐
│                                 │
│      ══ Arabic ══               │
│      اختر نوع الاستخدام         │  24px, bold
│                                 │
│      ══ English ══              │
│   Choose Your Usage Type        │  24px, bold
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │  Card 1
│  │      [Shield Icon 64px]   │  │  Personal
│  │                           │  │
│  │  AR: استخدام شخصي         │  │  18px, bold
│  │  EN: Personal Use         │  │
│  │                           │  │
│  │  AR: • جهات اتصال طوارئ   │  │  13px
│  │      • زر SOS             │  │
│  │      • رحلة آمنة          │  │
│  │                           │  │
│  │  EN: • Emergency contacts │  │
│  │      • SOS button         │  │
│  │      • Safe Trip          │  │
│  │                           │  │
│  │  [AR: متابعة →]           │  │
│  │  [EN: Continue →]         │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │  Card 2
│  │    [Building Icon 64px]   │  │  Employee
│  │                           │  │
│  │  AR: موظف شركة            │  │  18px, bold
│  │  EN: Company Employee     │  │
│  │                           │  │
│  │  AR: • الانضمام عبر دعوة   │  │  13px
│  │      • حماية أثناء العمل  │  │
│  │      • تسجيل حضور         │  │
│  │                           │  │
│  │  EN: • Join via invite    │  │
│  │      • Work protection    │  │
│  │      • Attendance         │  │
│  │                           │  │
│  │  [AR: لدي دعوة →]         │  │
│  │  [EN: I Have Invite →]    │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Card Specifications:**
```
Width:         100% (16px margin each side)
Height:        Auto (min 240px)
Background:    --bg-surface
Border:        1px solid --border-subtle
Border-radius: --radius-lg (16px)
Padding:       24px
Display:       Flex column, centered
Gap:           16px

Icon:
  Size:        64px
  Position:    Top center
  Color:       --primary-red
  
Title:
  Font-size:   18px
  Font-weight: 600
  Color:       --text-primary
  Align:       Center
  
Features:
  Font-size:   13px
  Color:       --text-secondary
  Line-height: 20px
  Bullets:     • (bullet points)
  Align:       Start (RTL/LTR)
  
Button:
  Background:  Transparent
  Color:       --primary-red
  Font-size:   15px
  Font-weight: 500
  Icon:        → (trailing arrow, mirrors in RTL)
  Align:       Center
```

**States:**

1. **Default**
   ```
   Both cards visible
   Equal prominence
   ```

2. **Hover (Web)**
   ```
   Border: --primary-red
   Box-shadow: --shadow-lg
   Transform: translateY(-4px)
   Transition: 0.3s ease
   ```

3. **Active/Pressed**
   ```
   Background: --bg-elevated
   Transform: scale(0.98)
   ```

4. **Selected**
   ```
   Navigate to respective flow
   ```

**⚠️ CRITICAL RULES:**

```
❌ NO "Company Owner" card
❌ NO "Create Company" option
✅ Company creation is WEB-ONLY
✅ If user has invite link → SKIP this screen entirely
✅ Go directly to Invite Validation
```

---

## 🔐 4. INVITE FLOW (DETAILED SECURITY VISUALIZATION)

### SCREEN: Invite Validation

**Layout:**
```
┌─────────────────────────────────┐
│  [X Close]                      │  Top right
│                                 │
│      [Company Logo 100px]       │  Circular
│                                 │
│      ══ Arabic ══               │
│      شركة الأمل للتجارة         │  20px, bold
│      قسم العمليات الميدانية     │  14px, secondary
│                                 │
│      ══ English ══              │
│      Al-Amal Trading Company    │  20px, bold
│      Field Operations Dept.     │  14px, secondary
│                                 │
│   ━━━━━━━━━━━━━━━━━━━━━━━━     │
│                                 │
│  ┌─────────────────────────┐    │
│  │  ⏰ AR: تنتهي خلال 24 ساعة│   │  Warning badge
│  │      EN: Expires in 24h  │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │  🔒 AR: استخدام مرة واحدة│   │  Info badge
│  │      EN: One-time use    │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────────────────────────┐    │
│  │  ✓ AR: الرقم مطابق للدعوة│   │  Success badge
│  │     EN: Phone matches    │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: إكمال التسجيل →      │  │  Primary
│  │  EN: Complete Registration│  │  button
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: إلغاء                │  │  Ghost
│  │  EN: Cancel               │  │  button
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Badge Specifications:**

1. **Warning Badge (Expiry)**
   ```
   Background:    rgba(255, 171, 0, 0.1)
   Border:        1px solid --warning
   Color:         --warning
   Border-radius: --radius-md
   Padding:       8px 16px
   Font-size:     13px
   Icon:          ⏰ (leading)
   ```

2. **Info Badge (One-time)**
   ```
   Background:    rgba(0, 224, 255, 0.1)
   Border:        1px solid --accent-cyan
   Color:         --accent-cyan
   Border-radius: --radius-md
   Padding:       8px 16px
   Font-size:     13px
   Icon:          🔒 (leading)
   ```

3. **Success Badge (Phone Match)**
   ```
   Background:    rgba(0, 200, 83, 0.1)
   Border:        1px solid --success
   Color:         --success
   Border-radius: --radius-md
   Padding:       8px 16px
   Font-size:     13px
   Icon:          ✓ (leading)
   ```

**Required States:**

1. **Valid Invitation**
   - All badges shown
   - "Complete Registration" enabled

2. **Expired**
   ```
   Replace content with:
   
   Icon: ⏰ (80px)
   
   AR: انتهت صلاحية الدعوة
   EN: Invitation Expired
   
   Message:
     AR: هذه الدعوة انتهت. تواصل مع الشركة.
     EN: This invite expired. Contact company.
   
   Button: [AR: إغلاق] [EN: Close]
   ```

3. **Already Used**
   ```
   Icon: ✓ (80px, --success)
   
   AR: تم استخدام هذه الدعوة
   EN: Invite Already Used
   
   Message:
     AR: أنت بالفعل موظف في هذه الشركة
     EN: You're already an employee
   
   Button: [AR: الذهاب للرئيسية] [EN: Go Home]
   ```

4. **Invalid/Not Found**
   ```
   Icon: ❌ (80px, --error)
   
   AR: رابط غير صحيح
   EN: Invalid Link
   
   Message:
     AR: تحقق من الرابط أو تواصل مع الشركة
     EN: Check link or contact company
   
   Button: [AR: إغلاق] [EN: Close]
   ```

5. **Phone Mismatch**
   ```
   Icon: ⚠️ (80px, --warning)
   
   AR: هذه الدعوة ليست لك
   EN: This Invite Is Not For You
   
   Details:
     AR: رقمك: +964 501 234 567
         الرقم المدعو: +964 507 XXX XXX
     EN: Your number: +964 501 234 567
         Invited number: +964 507 XXX XXX
   
   Button: [AR: إغلاق] [EN: Close]
   ```

6. **Network Error**
   ```
   Icon: 📡 (80px, --error)
   
   AR: فشل التحقق من الدعوة
   EN: Failed to Validate Invitation
   
   Message:
     AR: تحقق من اتصال الإنترنت وحاول مرة أخرى
     EN: Check internet connection and try again
   
   Buttons:
     [AR: إعادة المحاولة] [EN: Retry]
     [AR: إلغاء] [EN: Cancel]
   ```

---

### SCREEN: Employee Profile Completion

**Layout:**
```
┌─────────────────────────────────┐
│  [← Back]                       │
│                                 │
│      ══ Arabic ══               │
│      إكمال الملف الشخصي         │  24px, bold
│                                 │
│      ══ English ══              │
│      Complete Profile           │  24px, bold
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  AR: الاسم الكامل *              │  Label
│  EN: Full Name *                │
│  ┌───────────────────────────┐  │
│  │                           │  │  Input
│  └───────────────────────────┘  │
│                                 │
│  AR: رقم الهاتف *               │
│  EN: Phone Number *             │
│  ┌───────────────────────────┐  │
│  │ +964 501 234 567 🔒       │  │  Locked
│  └───────────────────────────┘  │
│  AR: محفوظ من تسجيل الدخول      │  Info
│  EN: Saved from login           │
│                                 │
│  AR: البريد الإلكتروني (اختياري)│
│  EN: Email (optional)           │
│  ┌───────────────────────────┐  │
│  │                           │  │  Input
│  └───────────────────────────┘  │
│                                 │
│  AR: القسم *                    │
│  EN: Department *               │
│  ┌───────────────────────────┐  │
│  │ اختر القسم ▼             │  │  Dropdown
│  │ Select department ▼       │  │
│  └───────────────────────────┘  │
│                                 │
│  AR: رقم الموظف (اختياري)       │
│  EN: Employee ID (optional)     │
│  ┌───────────────────────────┐  │
│  │                           │  │  Input
│  └───────────────────────────┘  │
│                                 │
│  ┌─────────────────────────┐    │
│  │ ☑ AR: أوافق على مشاركة   │   │  Checkbox
│  │      بيانات الطوارئ      │   │  REQUIRED
│  │      المرتبطة بالعمل مع   │   │
│  │      الشركة               │   │
│  │                          │   │
│  │   ☑ EN: I agree to share │   │
│  │      work-related        │   │
│  │      emergency data with │   │
│  │      company             │   │
│  └─────────────────────────┘    │
│                                 │
│  📄 AR: اقرأ سياسة الخصوصية     │  Link
│      EN: Read Privacy Policy   │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: إرسال طلب الانضمام   │  │  Primary
│  │  EN: Submit Join Request  │  │  button
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Field Specifications:**

1. **Full Name**
   ```
   Type:        Text input
   Required:    Yes
   Min length:  3 characters
   Max length:  100 characters
   Validation:  Letters + spaces only
   
   Error messages:
     AR: الاسم مطلوب (3 أحرف على الأقل)
     EN: Name required (min 3 characters)
   ```

2. **Phone Number**
   ```
   Type:        Text input (locked)
   Required:    Yes
   Pre-filled:  From OTP login
   Editable:    No
   Background:  --bg-elevated (disabled)
   Icon:        🔒 (trailing)
   ```

3. **Email**
   ```
   Type:        Email input
   Required:    No
   Validation:  Standard email regex
   
   Error:
     AR: صيغة البريد الإلكتروني غير صحيحة
     EN: Invalid email format
   ```

4. **Department**
   ```
   Type:        Dropdown/Select
   Required:    Yes
   Options:     Fetched from company settings
   Default:     Pre-selected if in invitation
   
   Error:
     AR: يرجى اختيار القسم
     EN: Please select department
   ```

5. **Employee ID**
   ```
   Type:        Text input
   Required:    No
   Pattern:     Alphanumeric + dash allowed
   Placeholder: 
     AR: مثال: EMP-2025-001
     EN: e.g., EMP-2025-001
   ```

6. **Privacy Checkbox**
   ```
   Type:        Checkbox
   Required:    Yes (must be checked)
   
   Label:
     AR: أوافق على مشاركة بيانات الطوارئ المرتبطة بالعمل مع الشركة
     EN: I agree to share work-related emergency data with company
   
   Link:        Opens Privacy Policy modal
   
   Validation:
     AR: يجب الموافقة للمتابعة
     EN: Must agree to continue
   ```

**Submit Button States:**

```
Enabled when:
  - Full name valid
  - Department selected
  - Privacy checkbox checked
  
Disabled when:
  - Any required field empty/invalid
  - Checkbox not checked
  
States:
  Disabled:
    Opacity:     0.5
    Cursor:      not-allowed
    Background:  --bg-surface
    
  Loading:
    Spinner:     24px, white
    Text:        AR: جاري الإرسال...
                 EN: Submitting...
    
  Success:
    Navigate to: Pending Approval screen
    Transition:  Fade + slide
    
  Error:
    Show error below button
    Color:       --error
```

**Required States:**

1. **Validation Errors**
   ```
   Display below each invalid field
   Font-size: 12px
   Color: --error
   
   Examples:
     Name: AR: الاسم مطلوب
           EN: Name required
     
     Email: AR: صيغة غير صحيحة
            EN: Invalid format
     
     Department: AR: اختر القسم
                 EN: Select department
     
     Checkbox: AR: يجب الموافقة
               EN: Must agree
   ```

2. **Network Error**
   ```
   Toast notification:
     AR: فشل الإرسال. تحقق من الاتصال
     EN: Failed to submit. Check connection
   
   Duration: 3s
   Action: Enable retry
   ```

---

### SCREEN: Awaiting Approval

**Layout:**
```
┌─────────────────────────────────┐
│                                 │
│                                 │
│      [Clock Icon 80px]          │  Animated
│                                 │
│      ══ Arabic ══               │
│      بانتظار موافقة الإدارة      │  20px, bold
│                                 │
│      ══ English ══              │
│      Awaiting Admin Approval    │  20px, bold
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│      ══ Arabic ══               │
│    سيتم إشعارك فور الموافقة     │  14px
│    عادةً ما يستغرق بضع ساعات    │  secondary
│                                 │
│      ══ English ══              │
│    You'll be notified once      │  14px
│    approved. Usually takes a    │  secondary
│    few hours                    │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│      ══ Arabic ══               │
│      📅 تم الإرسال في:          │  13px
│      2025/02/24 - 10:30 ص      │
│                                 │
│      ══ English ══              │
│      📅 Submitted at:           │  13px
│      2025/02/24 - 10:30 AM     │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: تحديث الحالة         │  │  Secondary
│  │  EN: Refresh Status       │  │  button
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: إلغاء الطلب          │  │  Ghost
│  │  EN: Cancel Request       │  │  button
│  └───────────────────────────┘  │
│                                 │
│      💡 AR: يمكنك التواصل مع     │  12px
│             قسم الموارد البشرية │  info
│                                 │
│      💡 EN: You can contact HR   │
│             department          │
│                                 │
└─────────────────────────────────┘
```

**Clock Animation:**
```css
@keyframes rotate-clock {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(15deg); }
}

Duration: 3s
Easing: ease-in-out
Infinite: Yes
```

**Auto-Refresh Logic:**
```
Poll interval: 30 seconds
Check status: approved/rejected/pending
If approved: Navigate to Approved screen
If rejected: Show Rejected state
```

**Actions:**

1. **Refresh Status**
   ```
   Action: Manual status check
   Loading: Show spinner in button
   Success: Update UI if status changed
   Error: Show network error toast
   ```

2. **Cancel Request**
   ```
   Show confirmation modal:
   
   AR: هل تريد إلغاء طلب الانضمام؟
   EN: Cancel join request?
   
   Buttons:
     [AR: نعم، إلغاء] [AR: لا]
     [EN: Yes, Cancel] [EN: No]
   
   If confirmed:
     - Delete request from database
     - Invalidate invitation token
     - Navigate back to home
   ```

**Required States:**

1. **Pending (Default)**
   - Clock animation active
   - Auto-refresh running
   - Show submission timestamp

2. **Approved**
   ```
   Auto-transition to Approved screen
   Animation: Fade + slide
   ```

3. **Rejected**
   ```
   Icon: ✕ (80px, --error)
   
   AR: تم رفض الطلب
   EN: Request Rejected
   
   Reason (if provided):
     AR: السبب: {reason}
     EN: Reason: {reason}
   
   Message:
     AR: نأسف، لم تتم الموافقة. تواصل مع الشركة.
     EN: Sorry, not approved. Contact company.
   
   Actions:
     [AR: العودة] [EN: Go Back]
     [AR: إعادة المحاولة] (if allowed)
   ```

---

## 🏠 5. HOME SCREEN (ULTRA PROFESSIONAL)

**Layout:**
```
┌─────────────────────────────────┐
│                                 │
│  👤 AR: مرحباً، أحمد    [🔔 3]  │  Header
│      EN: Hello, Ahmed           │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│                                 │
│        ┌─────────────┐          │
│       ╱               ╲         │  SOS Button
│      │                 │        │  120px
│      │       SOS       │        │  Glass effect
│      │                 │        │  Pulse anim
│       ╲               ╱         │
│        └─────────────┘          │
│                                 │
│    AR: اضغط مطولاً 3 ثواني      │  12px
│    EN: Press & Hold 3 Seconds   │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  AR: سيناريوهات الطوارئ:       │  14px, bold
│  EN: Emergency Scenarios:       │
│                                 │
│  [خطر] [حادث] [طبي]            │  Pills
│  [Danger] [Accident] [Medical]  │  Horizontal
│  [مطاردة] [تائه]               │  scroll
│  [Harassment] [Lost]            │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  ────── Bottom Navigation ──────│
│  [Home] [Contacts] [Map]        │
│  [History] [Profile]            │
│                                 │
└─────────────────────────────────┘
```

**SOS Button Specifications:**
```
Size:           120px × 120px
Position:       Center (horizontally + vertically)
Background:     Radial gradient
                  from: #FF2D55
                  to:   #D32F2F
Border:         4px solid rgba(255, 255, 255, 0.1)
Border-radius:  60px (circular)
Box-shadow:     0 8px 40px rgba(255, 45, 85, 0.6),
                0 0 80px rgba(255, 45, 85, 0.3)

Text:
  Content:      "SOS"
  Font-size:    40px
  Font-weight:  900
  Color:        #FFFFFF
  Text-shadow:  0 4px 20px rgba(0, 0, 0, 0.5)
  
Pulse Animation:
  @keyframes pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(255, 45, 85, 0.7);
    }
    50% {
      box-shadow: 0 0 0 20px rgba(255, 45, 85, 0);
    }
  }
  Duration: 2s
  Timing: infinite
  
Press & Hold:
  Duration: 3 seconds
  Progress ring: Circular, white, clockwise
  Haptic: Vibrate every 0.5s
  Background: Darken gradually
  
Activated:
  Flash: White pulse
  Navigate: To Active Emergency screen
```

**Scenario Pills:**
```
Height:         36px
Background:     --bg-surface
Border:         1px solid --border-subtle
Border-radius:  18px (pill)
Padding:        8px 16px
Font-size:      13px
Color:          --text-secondary
Display:        Inline-flex
Gap:            8px
Icon:           20px (leading)

States:
  Default:      As above
  Selected:     
    Border:     --primary-red
    Background: rgba(255, 45, 85, 0.1)
    Color:      --primary-red
  Active:
    Transform:  scale(0.95)

Scenarios:
  خطر / Danger:      🚨
  حادث / Accident:   🚗
  طبي / Medical:     🏥
  مطاردة / Harassment: ⚠️
  تائه / Lost:       📍
```

**Bottom Navigation:**
```
Container:
  Position:     Fixed bottom
  Height:       64px + safe-area-inset-bottom
  Background:   --bg-surface
  Border-top:   1px solid --border-subtle
  Backdrop-filter: blur(20px)
  
Items (5):
  1. الرئيسية / Home (🏠)
  2. جهات الاتصال / Contacts (👥)
  3. الخريطة / Map (🗺️)
  4. السجل / History (📋)
  5. الحساب / Profile (👤)
  
Each Item:
  Width:        20%
  Display:      Flex column, centered
  Gap:          4px
  Padding:      8px 0
  
  Icon:         24px
  Label:        11px
  
  States:
    Inactive:
      Icon color:  --text-tertiary
      Label color: --text-tertiary
      
    Active:
      Icon color:  --primary-red
      Label color: --primary-red
      Font-weight: 600
      
      Indicator:
        Background: --primary-red
        Height:     3px
        Width:      40px
        Position:   Top of item
        Border-radius: 0 0 2px 2px
```

---

## 🚨 6. ACTIVE EMERGENCY SCREEN

**⚠️ THE MOST CRITICAL SCREEN IN THE ENTIRE SYSTEM**

**Layout:**
```
┌─────────────────────────────────┐
│  🔴 AR: طوارئ نشطة              │  Status bar
│      EN: Active Emergency       │  Red bg
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  AR: من يتم الاتصال به الآن:   │  14px, bold
│  EN: Currently Calling:         │
│                                 │
│  ┌─────────────────────────┐    │
│  │   [Avatar 100px]        │    │  Current
│  │                         │    │  contact
│  │   AR: إدارة الشركة       │    │  card
│  │   EN: Company Admin      │    │
│  │                         │    │
│  │  AR: جاري الاتصال (1/2) │    │
│  │  EN: Calling (1/2)      │    │
│  │                         │    │
│  │   ⏱️ 18s remaining       │    │  Timer
│  │                         │    │
│  │  ⭕⭕⭕⭕⭕⭕⭕⭕⭕⭕      │    │  Progress
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  AR: تسلسل الاتصالات:          │  14px, bold
│  EN: Call Sequence:             │
│                                 │
│  ✓ AR: تم إرسال SMS             │  Timeline
│     EN: SMS Sent                │
│     (12:34:20)                  │
│                                 │
│  ⟳ AR: إدارة الشركة (محاولة 1) │
│     EN: Company Admin (att. 1)  │
│     (12:34:25)                  │
│                                 │
│  ⊚ AR: جهة 2 (انتظار)          │
│     EN: Contact 2 (queued)     │
│                                 │
│  ⊚ AR: جهة 3 (انتظار)          │
│     EN: Contact 3 (queued)     │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  [Map Preview 120px]            │  Location
│  📍 AR: موقعك الحالي            │  map
│      EN: Your location          │
│                                 │
│  AR: يتم تحديث الموقع كل 30 ثانية│
│  EN: Location updated every 30s │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  ┌───────────────────────────┐  │
│  │  ✅ AR: أنا بأمان - إلغاء │  │  Big green
│  │      EN: I'm Safe - Cancel│  │  button
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Status Bar (Top):**
```
Height:     48px
Background: --error
Color:      #FFFFFF
Font-size:  16px
Font-weight: 600
Padding:    0 16px
Display:    Flex, center
Animation:  Pulse (subtle)

Icon: 🔴 (leading)
```

**Current Contact Card:**
```
Background:    --bg-surface
Border:        2px solid --primary-red
Border-radius: --radius-lg
Padding:       20px
Text-align:    center
Box-shadow:    --shadow-xl

Avatar:
  Size:        100px
  Border:      3px solid --primary-red
  Border-radius: 50%
  Margin:      0 auto 12px
  
Name:
  Font-size:   18px
  Font-weight: 600
  Color:       --text-primary
  
Status:
  Font-size:   14px
  Color:       --text-secondary
  
  AR: جاري الاتصال... (محاولة 1 من 2)
  EN: Calling... (Attempt 1 of 2)
  
Timer:
  Font-size:   16px
  Font-weight: 600
  Color:       --warning
  
  Format: ⏱️ {X}s remaining
  Update: Every second (live)
  
Progress Ring:
  Type:     Circular
  Color:    --primary-red
  Width:    4px
  Duration: 20 seconds
  Direction: Clockwise
  Fill:     0% → 100%
```

**Timeline Items:**
```
Display:    Flex
Gap:        12px
Padding:    8px 0
Font-size:  13px

Icon (leading):
  ✓ = Completed (--success)
  ⟳ = In progress (--warning, rotating animation)
  ⊚ = Queued (--text-tertiary)
  ❌ = No answer (--error)
  
Text:
  Color: Based on status
  
Time:
  Font-size: 12px
  Color:     --text-tertiary
  Format:    (HH:MM:SS)
  
Examples:
  AR: ✓ تم إرسال SMS (12:34:20)
  EN: ✓ SMS Sent (12:34:20)
  
  AR: ⟳ إدارة الشركة... (12:34:25)
  EN: ⟳ Company Admin... (12:34:25)
  
  AR: ❌ جهة 2 - لم يرد (12:35:00)
  EN: ❌ Contact 2 - No answer (12:35:00)
```

**Map Preview:**
```
Height:        120px
Border-radius: --radius-md
Overflow:      hidden
Border:        1px solid --border-subtle

Map style:     Dark mode
Center:        User's current location
Marker:        Pulsing red dot
Zoom level:    Street level
Update:        Every 30 seconds

Caption:
  AR: 📍 موقعك الحالي
  EN: 📍 Your location
  
  Font-size: 11px
  Color:     --text-secondary
```

**"I'm Safe" Button:**
```
Height:        56px
Background:    linear-gradient(135deg, #00C853 0%, #00A040 100%)
Border-radius: --radius-md
Font-size:     16px
Font-weight:   600
Color:         #FFFFFF
Box-shadow:    0 4px 16px rgba(0, 200, 83, 0.4)

Icon:          ✅ (leading)

Text:
  AR: أنا بأمان - إلغاء
  EN: I'm Safe - Cancel
  
Warning text (below):
  AR: سيتم إيقاف جميع التنبيهات والمكالمات
  EN: All alerts and calls will stop
  
  Font-size: 11px
  Color:     --text-tertiary
  
Confirmation Modal:
  AR: هل أنت متأكد أنك بأمان؟
  EN: Are you sure you're safe?
  
  Buttons:
    [AR: نعم، إلغاء الطوارئ] [AR: العودة]
    [EN: Yes, Cancel Emergency] [EN: Go Back]
```

**Required States:**

1. **Initial State**
   - First contact (Admin or Contact 2)
   - Timer: 20 → 0
   - Timeline: SMS sent, first call in progress

2. **Calling State**
   - Progress ring filling
   - Timer counting down
   - Status: "Calling {name}..."

3. **No Answer**
   - Timeline: Add ❌ No answer
   - Move to next contact
   - Status: "No answer, calling next..."

4. **Call Answered**
   - Timeline: Add ✅ Answered by {name}
   - Stop countdown
   - Show: Success message
   - Auto-navigate to Resolved screen (3s delay)

5. **Retry Cycle**
   - Status: "Retrying..."
   - Back to first contact (cycle 2)
   - Timeline: Show cycle 2 marker

6. **All Exhausted**
   - Status: "No one answered - Escalated"
   - Timeline: All marked ❌
   - Show: "Contact support" option

---

## 💻 7. COMPANY DASHBOARD (SEPARATE SYSTEM)

### URL Structure:
```
Login:        dashboard.worldsos.com/login
Dashboard:    dashboard.worldsos.com/
Employees:    dashboard.worldsos.com/employees
Invitations:  dashboard.worldsos.com/invitations
Emergencies:  dashboard.worldsos.com/emergencies
Settings:     dashboard.worldsos.com/settings
```

### Login Page

**Layout (1440px width):**
```
┌──────────────────────────────────────────────┐
│                                              │
│  [Logo]                                      │  Top left
│                                              │
│          ┌──────────────────────┐            │
│          │                      │            │  Login card
│          │   ══ Arabic ══       │            │  Centered
│          │   تسجيل دخول الشركة  │            │  400px width
│          │                      │            │
│          │   ══ English ══      │            │
│          │   Company Login      │            │
│          │                      │            │
│          │  AR: البريد الإلكتروني│            │
│          │  EN: Email Address   │            │
│          │  ┌──────────────────┐│            │
│          │  │                  ││            │
│          │  └──────────────────┘│            │
│          │                      │            │
│          │  AR: كلمة المرور     │            │
│          │  EN: Password        │            │
│          │  ┌──────────────────┐│            │
│          │  │●●●●●●●●●●       ││            │
│          │  └──────────────────┘│            │
│          │                      │            │
│          │  [reCAPTCHA v3]      │            │
│          │                      │            │
│          │  ┌──────────────────┐│            │
│          │  │  AR: تسجيل الدخول││            │
│          │  │  EN: Sign In     ││            │
│          │  └──────────────────┘│            │
│          │                      │            │
│          │  AR: نسيت كلمة المرور؟│            │
│          │  EN: Forgot Password?│            │
│          │                      │            │
│          └──────────────────────┘            │
│                                              │
└──────────────────────────────────────────────┘
```

### Dashboard Layout

**Structure:**
```
┌─────┬──────────────────────────────────────────┐
│     │  Top Bar                                 │
│     │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│ S   │                                          │
│ I   │  KPI Cards (4 across)                   │
│ D   │                                          │
│ E   │  ┌───────┐ ┌───────┐ ┌───────┐ ┌─────┐ │
│ B   │  │ Total │ │Active │ │ Tasks │ │Emerg│ │
│ A   │  │  247  │ │  189  │ │   34  │ │  2  │ │
│ R   │  │  +5%  │ │  76%  │ │       │ │ 🔴  │ │
│     │  └───────┘ └───────┘ └───────┘ └─────┘ │
│     │                                          │
│ Nav │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│     │                                          │
│     │  Recent Emergencies Table               │
│     │                                          │
│     │  ┌──────────────────────────────────┐   │
│     │  │ Employee│Type│Time│Status│Actions│   │
│     │  ├──────────────────────────────────┤   │
│     │  │ Ahmed M │Med │12:34│Active│ View │   │
│     │  │ Sara A  │Acc │11:20│Resolved│ →  │   │
│     │  └──────────────────────────────────┘   │
│     │                                          │
└─────┴──────────────────────────────────────────┘
```

**Sidebar:**
```
Width:           240px
Background:      --bg-surface
Border-right:    1px solid --border-subtle

Logo + Company:
  Padding:       24px 16px
  Border-bottom: 1px solid --border-subtle
  
Nav Items:
  Padding:       12px 16px
  Font-size:     14px
  Gap:           12px (icon + text)
  
  Active:
    Background:  rgba(255, 45, 85, 0.1)
    Color:       --primary-red
    Border-left: 3px solid --primary-red
    
  Inactive:
    Color:       --text-secondary
    
  Hover:
    Background:  --bg-elevated
```

### Invitations Page

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Header: AR: الدعوات | EN: Invitations             │
│                                                     │
│  [AR: دعوة موظف جديد] [EN: Invite New Employee]   │
│                                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                                     │
│  Filters: [All] [Sent] [Opened] [Registered]      │
│                                                     │
│  Table:                                             │
│  ┌──────────────────────────────────────────────┐  │
│  │ Name    │ Phone    │ Sent    │ Status │ ... ││  │
│  ├──────────────────────────────────────────────┤  │
│  │ Ahmed M │+964501XX │24/02/25 │Sent    │ ⋯  ││  │
│  │ Sara A  │+964507XX │23/02/25 │Opened  │ ⋯  ││  │
│  │ Ali K   │+964505XX │22/02/25 │Pending │ ⋯  ││  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Invite Modal:**
```
┌─────────────────────────────────┐
│  [X Close]                      │
│                                 │
│  AR: دعوة موظف جديد             │
│  EN: Invite New Employee        │
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                 │
│  AR: رقم الهاتف *               │
│  EN: Phone Number *             │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  AR: البريد (اختياري)           │
│  EN: Email (optional)           │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  AR: القسم                      │
│  EN: Department                 │
│  ┌───────────────────────────┐  │
│  │ اختر ▼                    │  │
│  └───────────────────────────┘  │
│                                 │
│  AR: طريقة الإرسال:            │
│  EN: Send Via:                  │
│                                 │
│  [📱 WhatsApp] [📧 Email]       │
│  [📋 Copy Link]                 │
│                                 │
│  ┌───────────────────────────┐  │
│  │  AR: إرسال الدعوة         │  │
│  │  EN: Send Invitation      │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

**Generated Result:**
```
AR: تم إنشاء الدعوة بنجاح
EN: Invitation Created Successfully

Link:
  https://worldsos.app/invite?token=XYZ123ABC

QR Code:
  [QR Code Image 200×200]
  
Actions:
  [AR: نسخ الرابط] [EN: Copy Link]
  [AR: مشاركة عبر WhatsApp] [EN: Share via WhatsApp]
  [AR: تحميل QR] [EN: Download QR]
```

---

## 👑 8. SUPER ADMIN (HIDDEN SYSTEM)

### URL:
```
Hidden URL:   admin.worldsos.com
Login:        admin.worldsos.com/login
```

**Layout (1440px):**
```
┌─────┬──────────────────────────────────────────┐
│     │  Super Admin - World SOS Platform       │
│     │                                          │
│ Sec │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│ tion│                                          │
│ s   │  Executive KPIs (4 across - LARGE)      │
│     │                                          │
│ Com │  ┌───────┐ ┌───────┐ ┌───────┐ ┌─────┐ │
│ pani│  │ Users │ │Companies│Revenue│ │Emerg│ │
│ es  │  │12,847│ │  234  │ │$458K │ │  3  │ │
│ User│  │+23.5%│ │ +8.3% │ │+18.2%│ │     │ │
│ s   │  └───────┘ └───────┘ └───────┘ └─────┘ │
│ Plan│                                          │
│ s   │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│ Bill│                                          │
│ ing │  System Health                          │
│ Comp│                                          │
│ lia │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ nce │  │ API │ │ SMS │ │Calls│ │Load │       │
│ Logs│  │99.9%│ │98.5%│ │97.8%│ │34% │       │
│ Supp│  │  ✓  │ │  ✓  │ │  ✓  │ │ ✓  │       │
│ ort │  └─────┘ └─────┘ └─────┘ └─────┘       │
│ Sett│                                          │
│ ings│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│     │                                          │
│     │  Charts & Analytics                     │
│     │  [User Growth] [Revenue] [Emergencies]  │
│     │                                          │
└─────┴──────────────────────────────────────────┘
```

**Design Principles:**
- Dark, data-heavy, enterprise look
- Large numbers with strong hierarchy
- Real-time data (live updates)
- Health indicators with colors
- Minimal decoration, maximum clarity

---

## 🧩 9. COMPONENT LIBRARY REQUIREMENTS

### Must Build All States For:

1. **Buttons**
   - Primary
   - Secondary
   - Danger
   - Ghost
   - Icon button
   
   States: Default, Hover, Active, Disabled, Loading

2. **Inputs**
   - Text
   - Email
   - Password
   - Phone
   - OTP (6 boxes)
   
   States: Default, Focus, Error, Success, Disabled

3. **Dropdowns/Selects**
   - Single select
   - Multi-select (future)
   
   States: Default, Open, Selected, Error

4. **Form Elements**
   - Checkbox
   - Radio
   - Toggle/Switch
   
   States: Unchecked, Checked, Disabled

5. **Feedback**
   - Toast notifications
   - Modal dialogs
   - Alert banners
   - Status badges
   
   Types: Success, Error, Warning, Info

6. **Layout**
   - Card
   - Table
   - Empty state
   - Loading skeleton
   
   Variants: Elevated, Flat, Interactive

7. **Navigation**
   - Bottom nav (mobile)
   - Sidebar (web)
   - Tabs
   - Breadcrumbs

---

## 🔴 10. STRICT DESIGN RULES

### DO NOT:

```
❌ Combine mobile & dashboard in one screen
❌ Create marketing homepage
❌ Show "Owner Dashboard" publicly
❌ Skip RTL mirroring for Arabic
❌ Skip error states
❌ Skip loading states
❌ Skip empty states
❌ Use colors outside defined palette
❌ Break 8pt grid system
❌ Use fonts other than specified
❌ Create components without all states
❌ Mix platforms in navigation
```

### MUST DO:

```
✅ Separate files for each platform
✅ Full RTL support with mirrored layout
✅ All states for every component
✅ Consistent spacing (8pt grid)
✅ Accessibility (WCAG AA minimum)
✅ Dark mode as primary
✅ Loading states everywhere
✅ Error handling everywhere
✅ Empty states everywhere
✅ Bilingual text (AR + EN)
```

---

## 📦 FINAL DELIVERY MUST INCLUDE

### Figma Files:

1. **01_Mobile_App**
   - Cover page
   - All screens with states
   - Interactive prototype (fully linked)
   - Component library
   - RTL + LTR versions

2. **02_Company_Dashboard**
   - Cover page
   - All pages with states
   - Interactive prototype
   - Component library
   - 1440px layout

3. **03_Super_Admin**
   - Cover page
   - All panels
   - Component library
   - 1440px layout

### Documentation:

1. **Design System**
   - Colors (with hex codes)
   - Typography (sizes, weights, line-heights)
   - Spacing (8pt grid values)
   - Shadows
   - Border radius values

2. **Component Specs**
   - All components with measurements
   - All states documented
   - Interaction notes

3. **Responsive Specs**
   - Breakpoints
   - Layout behaviors
   - Adaptive rules

4. **Animation Specs**
   - Durations
   - Easing functions
   - Keyframes

### Handoff:

1. **For Developers**
   - Design tokens (JSON export)
   - Icons (SVG export @1x, @2x, @3x)
   - Images (PNG/WebP optimized)
   - Fonts (files + license info)

2. **Interactive Prototype**
   - Full user flow linked
   - All states accessible
   - Shareable link

---

## ✅ VERIFICATION CHECKLIST

Before delivery, verify:

```
□ All screens have Arabic + English text
□ All screens have RTL + LTR versions
□ All components have all states (min 5: default, hover, active, disabled, loading)
□ Prototype is fully interactive
□ Deep linking flow is clear
□ Company invitation flow is complete
□ Emergency screen shows escalation clearly
□ Design system is comprehensive
□ Responsive layouts provided (mobile + 1440px web)
□ No white/light backgrounds (dark-first)
□ All icons included
□ All error states designed
□ All empty states designed
□ All loading states designed
□ 8pt grid maintained throughout
□ Typography hierarchy clear
□ Color system consistent
□ Accessibility checked (contrast, touch targets)
```

---

**Document Version:** 1.0  
**Last Updated:** February 24, 2026  
**Status:** 🔒 LOCKED  
**For:** Figma Designer  
**Project:** World SOS

---

# 🎯 YOU ARE NOW READY TO DESIGN

**This is a Global Emergency System.**  
**Design accordingly.**

Good luck! 🚀
