# 🌍 WORLD SOS - CLEAN FILE STRUCTURE

## ✅ CLEANUP COMPLETE

All old/duplicate files removed.
Only production-ready components remain.

---

## 📁 FILE ARCHITECTURE

```
/src/app/
│
├── 01 — DASHBOARD
│   ├── App.tsx                     → Main entry point
│   ├── PremiumDashboard.tsx        → Dashboard container
│   └── pages/
│       └── OverviewPage.tsx        → Dashboard overview page
│
├── 02 — EMERGENCY SYSTEM  
│   └── components/design-system/
│       └── EmergencyDrawer.tsx     → Emergency alert overlay
│
├── 03 — DESIGN SYSTEM
│   └── components/design-system/
│       ├── index.tsx               → Centralized exports
│       ├── Layout.tsx              → Layout components
│       ├── Sidebar.tsx             → Sidebar navigation
│       ├── Topbar.tsx              → Top navigation bar
│       ├── Card.tsx                → Card components
│       ├── Badge.tsx               → Badge components
│       ├── Button.tsx              → Button component
│       ├── Table.tsx               → Table component
│       └── Alert.tsx               → Alert component
│
└── contexts/
    └── LanguageContext.tsx         → Bilingual support (EN/AR)
```

---

## 🗑️ DELETED FILES

✅ `/src/app/AppTest.tsx` - Test file (not needed)
✅ `/src/app/components/premium/*` - Duplicate components (4 files)
✅ Kept `/src/app/components/ui/*` - shadcn/ui library (may be needed later)

---

## 📐 DESIGN SYSTEM RULES

### App Shell Architecture — Layer Order (LOCKED)

All pages render inside the App Shell (`Layout.tsx`).
The App Shell uses `transform: translate3d(0,0,0)` to become the containing block
for ALL `position: fixed` descendants. This ensures drawers, overlays, and modals
never escape the 1440px frame.

```
┌─ App Shell (1440px, overflow:hidden, transform:translate3d) ──┐
│                                                                │
│  z:1   Sidebar (220px, full height)                           │
│  z:2   Main Column                                            │
│         ├ z:10  Topbar (flexShrink:0, solid bg)               │
│         ├ z:20  Alert Banner (flexShrink:0, solid bg)         │
│         └ z:1   Page Content (sole scroll container)          │
│                                                                │
│  z:100  Overlay backdrop (rgba(0,0,0,0.40), NO blur)          │
│  z:110  Side Panel / Drawer (solid bg #0B0F1A, right:0)       │
│                                                                │
│  z:200  Modal backdrop (rgba(0,0,0,0.50), NO blur)            │
│  z:210  Modal dialog (solid bg #0B0F1A)                       │
│                                                                │
│  z:300  Toast notifications (solid bg, top-most UI)           │
│                                                                │
│  z:9999 Fullscreen takeover (WallMode, RiskMap fullscreen)    │
└────────────────────────────────────────────────────────────────┘
```

**Rules:**
- ALL drawer/modal backgrounds MUST be solid `#0B0F1A` (no rgba transparency)
- NO `backdropFilter: blur()` on overlay backdrops (causes stacking bleed)
- ALL drawers MUST have `overflow: hidden` (clip content ON)
- Drawers: `position: fixed`, `right: 0`, full height, z:110
- Modals: `position: fixed`, centered, z:210
- Toasts: `position: fixed`, bottom center, z:300

### Layout Grid
- Desktop: **1440px** centered
- Sidebar: **220px** fixed width
- Container padding: **24px**
- Card internal padding: **16px**
- Element spacing: **8px**

### Colors
- Background: `#05070E`
- Surface: `#0B1220`
- Border: `rgba(255, 255, 255, 0.1)`
- Primary text: `#FFFFFF`
- Secondary text: `#E5E7EB`
- Muted text: `#A3A3A3`

### Typography
- H1: 32px / 600 weight
- H2: 24px / 600 weight
- H3: 18px / 600 weight
- Body: 14px / 500 weight
- Small: 12px / 400 weight

### Border & Radius
- Border width: **1px**
- Border radius: **12px** (cards) / **8px** (buttons)
- Glassmorphism: `backdrop-filter: blur(20px)`

---

## 🎯 NEXT STEPS

Ready for design upgrades:
1. ✅ **Scrollbar styling** - Custom dark cyber scrollbar implemented
2. ✅ **Dashboard visual authority** - Hero section, KPI cards, and depth layering upgraded
3. Typography refinement (Inter/Cairo)
4. Border/Shadow consistency
5. Icon system upgrade
6. Emergency drawer enhancements
7. RTL/LTR optimization

---

## ✅ RECENT UPDATES

### CRITICAL FIX - System Status Header Rebuilt from Scratch

**Problem Eliminated:**
❌ Two overlapping info strips completely removed
❌ Floating elements deleted
❌ Absolute positioning eliminated (except accent line and grid pattern)

**New Clean Architecture:**

✅ **StatusHeader Container** - Single two-column layout
✅ **Left Column** - Title, Badge, Subtitle, Meta row (single line)
✅ **Right Column** - Safety meter + labels + button (fixed 240px)
✅ **No absolute positioning** in content area
✅ **Card clips overflow** properly
✅ **ZERO overlap at 100% zoom**

---

**LAYOUT STRUCTURE:**

```
┌─────────────────────────────────────────────────────────────────┐
│ StatusHeader (padding: 12px 24px)                                │
│ ┌──────────────────────────────────────┬────────────────────┐   │
│ │ LEFT COLUMN (flex: 1)                │ RIGHT (160px)      │   │
│ │                                      │                    │   │
│ │ System Status [Healthy Badge]        │    ┌───────┐      │   │
│ │          ↓ 4px                       │    │  87   │      │   │
│ │ All systems are stable...            │    │ /100  │      │   │
│ │          ↓ 2px                       │    └───────┘      │   │
│ │ Live • Last sync 2 min • Units 47    │  Safety Index     │   │
│ │                                      │ [View Risk Map]    │   │
│ └──────────────────────────────────────┴────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

**SPACING RULES APPLIED:**

**Container:**
- Padding: `24px` (all sides)
- Display: `flex`
- Gap: `24px` (between left/right columns)
- Align-items: `flex-start`
- Overflow: `hidden` (clipping enforced)

**Left Column:**
- Flex: `1` (grows to fill space)
- Flex-direction: `column`
- Gap: `8px` (base spacing)
- Title → Subtitle: `8px` ✅
- Subtitle → Meta row: `10px` (marginTop: 2px after 8px gap) ✅

**Meta Row (Single Line):**
- Display: `flex`
- Gap: `16px`
- Bullet separators: `•` (rgba(255,255,255,0.2))
- Font: `12px / 500 weight`
- Components:
  - Live Monitoring (green pulse dot + text)
  - Last sync 2 min ago
  - Connected units 47

**Right Column:**
- Width: `240px` (fixed) ✅
- Flex-shrink: `0` (prevents squishing)
- Flex-direction: `column`
- Gap: `8px`
- Align-items: `center`
- Components:
  1. Safety ring (180px × 180px)
  2. "Company Safety Index" label
  3. "Real-time safety performance" text
  4. View Risk Map button

**Ring Specifications:**
- Size: `180px × 180px` (was 200px, optimized for 240px column)
- Center coordinates: `cx="90", cy="90"`
- Radius: `80` (was 90)
- Stroke width: `10` (was 12)
- Number size: `56px` (was 72px, proportional)
- Breathing animation maintained

---

**DELETED ELEMENTS:**

✅ **Removed**: Top-right "Updated..." strip (was absolute positioned)
✅ **Removed**: Bottom "Live Monitoring..." bar (was separate card)
✅ **Merged**: Live monitoring info into single meta row in left column
✅ **Simplified**: One clean layout, no floating elements

---

**TECHNICAL IMPLEMENTATION:**

**No Absolute Positioning in Content:**
```tsx
{/* StatusHeader - TWO COLUMN LAYOUT */}
<div style={{ 
  padding: '24px',
  position: 'relative',  // Only for z-index context
  zIndex: 1,
  display: 'flex',       // Flexbox layout
  gap: '24px',
  alignItems: 'flex-start',
}}>
```

**Left Column Structure:**
```tsx
<div style={{ 
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}}>
  {/* Title + Badge */}
  {/* Subtitle */}
  {/* Meta Row - SINGLE LINE */}
</div>
```

**Right Column Structure:**
```tsx
<div style={{ 
  width: '240px',
  flexShrink: 0,
  display: 'flex', 
  flexDirection: 'column', 
  alignItems: 'center',
  gap: '8px',
}}>
  {/* Safety meter */}
  {/* Label */}
  {/* Small text */}
  {/* Button */}
</div>
```

---

**RESULTS:**

✅ **ZERO OVERLAP** - Tested at 100% zoom
✅ **Clean two-column grid** - No floating elements
✅ **Single meta row** - Live • Sync • Units in one line
✅ **Proper clipping** - overflow: hidden enforced
✅ **No absolute positioning** - Pure flexbox layout
✅ **Spacing compliance** - 8px/10px/24px applied correctly
✅ **Fixed right column** - 240px width, never overlaps left
✅ **Professional structure** - Clean, organized, maintainable

---

### Top Overlap Fix – Clean Header Grid Structure

**Goal Achieved:**
✅ ZERO overlap at 100% zoom
✅ Fixed header grid with proper alignment
✅ Live monitoring strip moved out of ring area
✅ All elements clipped within card bounds
✅ Proper spacing rules enforced

**New Layout Structure:**

**HEADER ROW 1 (Top):**
```
┌──────────────────────────────────────────────────────────────┐
│ LEFT: Title + Badge          │ RIGHT: Safety Score Meter     │
│ - "System Status" (48px)     │ - Ring (200px diameter)       │
│ - "Healthy" badge            │ - All meter labels/info       │
│                              │ - View Risk Map button        │
└──────────────────────────────────────────────────────────────┘
                   ↓ 12px gap
```

**HEADER ROW 2 (Live Monitoring Strip - LEFT SIDE ONLY):**
```
┌─────────────────────────────────────┐
│ Live Monitoring | Last sync | Units │
│ (max-width: 600px)                  │
└─────────────────────────────────────┘
                   ↓ 12px gap
```

**DESCRIPTION (Bottom):**
```
┌─────────────────────────────────────┐
│ All systems are stable...           │
│ (max-width: 520px)                  │
└─────────────────────────────────────┘
```

**Spacing Rules Applied:**

**1) Container Padding:**
- ✅ **Content padding**: `48px` (all sides)
- ✅ **Overflow**: `hidden` (clips any overflow)
- ✅ **Position**: `relative` (establishes stacking context)

**2) Header Row 1:**
- ✅ **Layout**: `display: flex`, `justify-content: space-between`
- ✅ **Alignment**: `align-items: flex-start` (top-aligned)
- ✅ **Gap**: `40px` (between left and right columns)
- ✅ **Margin-bottom**: `12px`

**3) Safety Score Right Column:**
- ✅ **Min-width**: `280px` (prevents squishing)
- ✅ **Gap**: `12px` between all child elements
- ✅ **Alignment**: `align-items: center` (horizontally centered)
- ✅ **All elements inline**: No absolute positioning

**4) Live Monitoring Strip:**
- ✅ **Max-width**: `600px` (prevents stretching)
- ✅ **Position**: Left side only (no overlap with ring)
- ✅ **Margin-bottom**: `12px`
- ✅ **Padding**: `12px 16px`
- ✅ **Moved OUT of ring area** - placed below title row

**5) Element Spacing:**
- ✅ **Row 1 → Row 2**: `12px`
- ✅ **Row 2 → Description**: `12px`
- ✅ **Safety meter internal gaps**: `12px` (compact, professional)
- ✅ **Left/right column gap**: `40px`

**Layout Flow (Vertical):**
```
[Title + Badge LEFT | Safety Score RIGHT]  ← Row 1, gap 40px
              ↓ 12px
[Live Monitoring Strip (max 600px)]        ← Row 2, left side only
              ↓ 12px
[Description Text (max 520px)]             ← Bottom
```

**Technical Implementation:**

**Container:**
```tsx
overflow: 'hidden'           // Clips content to card bounds
position: 'relative'         // Stacking context
padding: '48px'              // Uniform padding
```

**Header Row 1:**
```tsx
display: 'flex'
justifyContent: 'space-between'  // Left and right sides
alignItems: 'flex-start'         // Top-aligned (not center)
gap: '40px'
marginBottom: '12px'
```

**Right Column (Safety Score):**
```tsx
display: 'flex'
flexDirection: 'column'
alignItems: 'center'
gap: '12px'               // Compact spacing
minWidth: '280px'         // Prevents squishing
```

**Live Monitoring Strip:**
```tsx
maxWidth: '600px'         // Prevents stretching
marginBottom: '12px'      // Spacing to description
// Positioned in flow, not absolute
```

**Z-Index Hierarchy:**
- **0**: Grid pattern, radial gradient (backgrounds)
- **1**: Left accent line, content layer
- **200**: Hover tooltip (when active)

**Results:**
✅ **ZERO overlap** - All elements properly spaced
✅ **Clean grid structure** - Fixed header layout
✅ **Live strip repositioned** - Out of ring area, left side only
✅ **Proper clipping** - `overflow: hidden` enforced
✅ **Baseline alignment** - No floating/absolute positioning
✅ **Spacing compliance** - 12px between rows, 40px between columns
✅ **Professional layout** - Command center aesthetic maintained

---

### Hover Area Restriction Fix – Precise Interaction

**Goal Achieved:**
✅ Hover panel never covers button area
✅ Interaction feels precise and professional
✅ Hover restricted to circular ring only
✅ Panel positioned above, not overlapping

**Implementation:**

**1) Hover Activation Area - RING ONLY:**
- ✅ **SVG element receives hover events** - `onMouseEnter` / `onMouseLeave`
- ✅ **Ring circles have `cursor: pointer`** - visual feedback
- ✅ **Center text has `pointer-events: none`** - numbers don't trigger hover
- ✅ **Hover triggered ONLY when mouse enters SVG bounds**
- ✅ **Immediate hide when mouse leaves SVG**

**2) Hover Panel Position - ABOVE METER:**
- ✅ **Position**: `bottom: '100%'` (above the meter)
- ✅ **Alignment**: `left: '50%'`, `transform: 'translateX(-50%)'` (centered)
- ✅ **Spacing**: `marginBottom: '16px'` (16px gap from meter)
- ✅ **Result**: Panel appears ABOVE meter, never overlaps button below

**3) Pointer Events Control:**
- ✅ **Hover panel**: `pointer-events: none` (non-interactive)
- ✅ **Center text**: `pointer-events: none` (doesn't block hover)
- ✅ **SVG rings**: Interactive, trigger hover
- ✅ **View Risk Map button**: Always fully clickable

**4) Z-Index Layering:**
- **0**: Background glow (radial gradient)
- **1**: SVG meter (interactive)
- **200**: Hover panel (high layer, but `pointer-events: none`)

**Layout Flow:**
```
[Hover Panel - Above] ← Positioned with bottom: 100%
     ↑ 16px gap
[SVG Meter - Interactive] ← Hover trigger
     ↓ 16px gap
[Meter Label]
     ↓ 16px gap
[Trend Indicator]
     ↓ 16px gap
[Status Text]
     ↓ 16px gap
[View Risk Map Button] ← Never overlapped
```

**Hover Panel Content:**
- Safety Score Breakdown header
- 4 metrics: Response Time, Coverage, Risk Level, System Health
- Last updated timestamp
- Styled with mission control aesthetic

**Results:**
✅ **Precise interaction** - Only ring triggers hover
✅ **No overlap** - Panel always above, button always clear
✅ **Immediate response** - Shows/hides instantly
✅ **Professional feel** - Clean, controlled behavior
✅ **8pt grid compliance** - 16px spacing maintained

---

### Interaction Fix – Layer Priority Correction

**Goal Achieved:**
✅ No interaction conflict
✅ Hover does not block click
✅ Proper z-index layering
✅ Correct spacing between elements

**Implementation:**

**1) Tooltip Pointer-Events Fix:**
- ✅ **Tooltip container**: `pointer-events: none`
- ✅ **Purpose**: Tooltip does NOT block underlying buttons
- ✅ **Z-index**: 100 (high layer for visibility)
- ✅ **Behavior**: Appears on hover, disappears on mouse leave
- ✅ **Non-interactive**: Cannot be clicked or interfere with clicks

**2) Right Column Z-Index:**
- ✅ **Right column container**: `position: relative`, `z-index: 1`
- ✅ **Purpose**: Ensures button click priority
- ✅ **View Risk Map button**: Higher z-index than background elements

**3) Spacing Compliance:**
- ✅ **Gap between elements**: 16px (2 × 8pt grid)
- ✅ **Minimum spacing**: Meter → Label → Trend → Status → Button
- ✅ **Each gap**: 16px consistently applied

**Z-Index Layering (Updated):**
- **0**: Background elements (grid pattern, radial gradient)
- **1**: Content layer (left accent, columns, content)
- **100**: Floating tooltip (non-interactive, `pointer-events: none`)

**Results:**
✅ **No blocking** - Tooltip doesn't block button clicks
✅ **Clean interactions** - All buttons fully clickable
✅ **Proper layering** - Visual hierarchy maintained
✅ **Correct spacing** - 16px gaps between all elements
✅ **Non-intrusive hover** - Tooltip appears but doesn't interfere

---

### Layout Correction – Clean Two-Column Command Center

**Goal Achieved:**
✅ Balanced, clean command center
✅ No crowding or overlap
✅ Clear two-column structure
✅ Proper spacing and alignment

**Implementation:**

**Two-Column Layout Structure:**

**LEFT COLUMN (System Status):**
- ✅ **Live Monitoring bar** - Top element, contained card style
- ✅ **System Status title** (48px) + Healthy badge
-  **Description text** - Max width 520px for readability
- ✅ **Flex: 1** - Takes remaining space
- ✅ **Gap: 16px** between elements (8pt grid)

**RIGHT COLUMN (Safety Score):**
- ✅ **Safety Score meter** - 200px diameter
- ✅ **Meter label** + description
- ✅ **Trend indicator** - +2.1% this week
- ✅ **Status explanation** - "Stable – Minor Risk Areas Detected"
- ✅ **View Risk Map button**
- ✅ **Min-width: 280px** - Prevents squishing
- ✅ **Padding-right: 24px** - Safe margin from edge
- ✅ **Vertically centered** - alignItems: 'center'

**Layout Specifications:**

**Container:**
- Display: flex
- Gap: 40px (between columns)
- Align-items: center (vertical centering)
- Equal vertical padding: 48px top and bottom

**Left Column:**
- Flex: 1 (takes available space)
- Flex-direction: column
- Gap: 16px (vertical spacing)
- Max-width on description: 520px

**Right Column:**
- Min-width: 280px (fixed)
- Flex-direction: column
- Align-items: center
- Gap: 16px
- Padding-right: 24px (safe margin)

**Live Monitoring Bar Repositioned:**
- Moved from absolute top to **first element in left column**
- Contained card style with border and background
- Padding: 12px 16px
- Border-radius: 8px
- Clean integration with left column flow

**Spacing Compliance (8pt Grid):**
- Column gap: 40px ✅
- Internal element gaps: 16px ✅
- Title-badge gap: 16px ✅
- Right column padding: 24px ✅
- Hero padding: 48px ✅

**Results:**
✅ **No overlap** - Clear separation between columns
✅ **Balanced layout** - Equal visual weight
✅ **Proper spacing** - 40px minimum between columns
✅ **Vertical centering** - Right column content centered
✅ **Safe margins** - 24px padding on right edge
✅ **Clean hierarchy** - Clear content organization
✅ **Professional command center** - Organized and authoritative

---

### Control Center Upgrade

**Goal Achieved:**
✅ Dashboard feels like a live command center
✅ Real-time monitoring visible
✅ Hero section elevated as command module
✅ Interactive elements feel alive

**Implementation:**

**1) Top System Status Bar:**
- **Position**: Absolute top of hero (40px height)
- **Background**: `rgba(0, 224, 255, 0.03)` with cyan border
- **Border Bottom**: `1px solid rgba(0, 224, 255, 0.15)`
- **Content**:
  - **Live Monitoring**: Green pulse dot (8px) with text
    - Animation: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`
    - Color: #00C853 (success green)
  - **Last Sync**: "2 min ago" - Real-time indicator
  - **Connected Units**: "47" in cyan (#00E0FF / 600 weight)
- **Typography**: 12px / 500-600 weight / clean spacing
- **Z-index**: 2 (above grid pattern)

**2) Breathing Pulse Animation:**
- **Target**: Safety Score progress ring
- **Animation**: `breathe 4s ease-in-out infinite`
- **Keyframes**:
  - 0%, 100%: opacity 1, drop-shadow 8px
  - 50%: opacity 0.75, drop-shadow 16px
- **Effect**: Very soft, slow breathing effect
- **Purpose**: Makes the metric feel alive and dynamic
- **Subtlety**: Gentle enough to not distract

**3) Increased Contrast - Command Module Feel:**
- **Hero Background**: `rgba(11, 18, 32, 0.95)` (was var(--sos-bg-elevated))
- **Border**: `rgba(255, 255, 255, 0.12)` (increased from 0.06)
- **Shadow**: Increased depth
  - Layer 1: `0 16px 64px rgba(0, 0, 0, 0.5)` (was 0.3)
  - Layer 2: `0 8px 24px rgba(0, 0, 0, 0.3)` (was 0.2)
- **Result**: Hero feels like elevated command module
- **Contrast**: Strong separation from page background

**4) View Risk Map Button:**
- **Position**: Below Safety Score status text
- **Icon**: Map icon (lucide-react)
- **Size**: Small (12px / 6px-12px padding)
- **Variant**: Secondary
- **Purpose**: Quick access to risk visualization
- **Placement**: Aligned center below meter

**Live Command Center Features:**
✅ **Real-time status bar** - Live monitoring indicator
✅ **Breathing animation** - Safety meter feels alive
✅ **Elevated contrast** - Hero as command module
✅ **Quick actions** - View Risk Map button
✅ **Live data display** - Sync time, connected units
✅ **Visual hierarchy** - Command center authority

**Technical Details:**
- Status bar positioned absolutely at top (0,0)
- Content area adjusted with `marginTop: '40px'`
- Green pulse uses existing pulse animation
- Breathing animation added to theme.css
- Z-index layering maintained:
  - Grid pattern: 0
  - Accent line: 1
  - Status bar: 2
  - Content: 1
  - Tooltip: 10

**Results:**
✅ **Feels like live command center** - not static report
✅ **Real-time monitoring visible** - live indicator always present
✅ **Breathing animation** - safety score feels dynamic
✅ **Command module elevation** - strong contrast and depth
✅ **Quick navigation** - View Risk Map accessible
✅ **Professional authority** - mission control aesthetic

---

### Final Visual Identity Refinement

**Goal Achieved:**
✅ Hero has unique visual identity
✅ Not just a clean rectangle
✅ Technical "Mission Control" aesthetic

**Implementation:**

**Abstract Grid Pattern Overlay:**
- **Pattern Type**: Subtle technical grid (32px × 32px cells)
- **Color**: `rgba(0, 224, 255, 0.03)` - Extremely subtle cyan
- **Opacity**: 0.4 (barely visible, atmospheric)
- **Coverage**: Hero section only
- **Z-index**: 0 (background layer)
- **Design**: Two linear gradients (horizontal + vertical)
  - Horizontal: `linear-gradient(90deg, rgba(0, 224, 255, 0.03) 1px, transparent 1px)`
  - Vertical: `linear-gradient(0deg, rgba(0, 224, 255, 0.03) 1px, transparent 1px)`
- **Effect**: Creates faint technical grid reminiscent of command center displays
- **Non-interactive**: `pointer-events: none`

**Technical Integration:**
- Positioned absolutely with `inset: 0` (covers entire hero)
- Added `overflow: 'hidden'` to hero container (pattern stays contained)
- Z-index layering updated:
  - Grid pattern: 0 (bottom)
  - Left accent line: 1
  - Content: 1
  - Radial gradient: 0
  - Safety meter: 1
  - Tooltip: 10

**Visual Identity:**
✅ **Mission Control aesthetic** - Technical grid pattern
✅ **Unique to hero** - No other section has this treatment
✅ **Extremely subtle** - Barely visible, atmospheric depth
✅ **Professional authority** - Command center feel
✅ **Doesn't compete** - Enhances without distracting

**Design Philosophy:**
- Grid suggests **precision monitoring**
- Cyan color reinforces **World SOS brand**
- Low opacity maintains **clean minimal design**
- Unique pattern gives hero **distinct identity**
- Supports "Mission Control for Human Safety" theme

**Results:**
✅ **Hero feels unique** - not just another card
✅ **Technical authority** - command center aesthetic
✅ **Subtle depth layer** - atmospheric without heaviness
✅ **Brand reinforcement** - cyan technical grid
✅ **Clean execution** - barely visible, perfectly balanced

---

### Final Polish - Depth & Authority

**Goal Achieved:**
✅ Hero section feels elevated and premium
✅ Natural depth, not flat
✅ Subtle, refined, authoritative

**Implementation:**

**1) Increased Elevation:**
- **Shadow System**: Dual-layer soft shadow
  - Layer 1: `0 16px 64px rgba(0, 0, 0, 0.3)` - Wide, soft spread
  - Layer 2: `0 8px 24px rgba(0, 0, 0, 0.2)` - Closer, refined depth
- **Result**: Clean elevation without harsh edges
- Modern and premium feel

**2) Reduced Border Visibility:**
- Border opacity: `rgba(255, 255, 255, 0.06)` (was stronger)
- **Natural separation** - not boxed or contained
- Emphasis on shadow for depth, not borders
- Clean, minimal aesthetic maintained

**3) Subtle Radial Gradient:**
- **Position**: Behind Safety Score meter only
- **Size**: 300px diameter
- **Gradient**: `radial-gradient(circle, rgba(0, 224, 255, 0.04) 0%, transparent 70%)`
- **Opacity**: Extremely subtle (0.04) - barely visible
- **Effect**: Soft glow that draws attention without distraction
- **Technical**: Pointer-events: none, z-index: 0 (non-interactive background layer)

**4) Dominant Number Size:**
- Safety score number increased: **72px** (was 64px)
- 12.5% size increase for visual dominance
- Maintained same weight (700) and letter-spacing
- Most prominent numeric element on dashboard
- Clear visual hierarchy established

**Visual Depth Hierarchy:**
1. **Hero Container**: Elevated with dual-layer shadow (premium feel)
2. **Safety Score**: Radial glow + dominant 72px number
3. **KPI Container**: Standard elevation
4. **Content Sections**: Flat, supporting role

**Technical Details:**
- Inner container uses negative margin (`-48px`) to compensate for Card padding
- Maintains exact layout positioning while adding visual depth
- Shadow spreads outward, not inward
- Z-index layering: Gradient (0) → Meter (1) → Tooltip (10)

**Results:**
✅ **Premium elevated feel** - hero floats above page
✅ **Natural depth** - soft shadows, not harsh boxes
✅ **Subtle accent** - barely-visible radial glow draws eye
✅ **Dominant metric** - 72px number commands attention
✅ **Clean authority** - refined, professional, confident

---

### Safety Score Intelligence Upgrade

**Goal Achieved:**
✅ Safety Index feels intelligent and alive
✅ Real-time intelligence layer added
✅ Contextual insights on hover
✅ Clean, minimal intelligence display

**Implementation:**

**1) Trend Indicator & Status Text:**
- **Trend**: Green ↑ "+2.1% this week" (13px / 600 weight / #00C853)
- **Status**: "Stable – Minor Risk Areas Detected" (13px / muted)
- Both positioned below the meter label
- Clean vertical stacking with 8px gaps

**2) Color Logic (Intelligent Scoring):**
- **80–100**: `#00E0FF` (cyan/green) → Excellent safety
- **60–79**: `#FFC107` (amber) → Needs attention
- **Below 60**: `#FF2D55` (red) → Critical risk
- Dynamic color applied to progress ring
- Smooth transitions (0.3s ease)

**3) Micro Caption:**
- Added under "Company Safety Index" title
- Text: *"Real-time company-wide safety performance."*
- 12px / 500 weight / muted color
- Provides context and authority

**4) Hover Tooltip (Intelligence Layer):**
- **Position**: Right side of meter (280px width)
- **Trigger**: Hover on meter container
- **Design**: Elevated card with shadow (clean, minimal)
- **Content**:
  - **Last 7 Days Trend**: +2.1% improvement (with green ↑ icon)
  - **Highest Risk Department**: "Logistics (Score: 72)"
  - **Last Incident**: "18 hours ago" + "Minor injury - Resolved"
- **Typography**: 
  - Section labels: 11px / 600 / uppercase / muted
  - Values: 13px / 600 / primary
  - Details: 12px / 500 / muted
- **Separators**: 1px horizontal lines between sections
- **Z-index**: 10 (appears above all content)
- **Transition**: Smooth 0.2s fade

**Intelligence Features:**
✅ **Real-time data** visualization
✅ **Dynamic color** based on score
✅ **Trend analysis** (weekly improvement)
✅ **Risk identification** (highest risk dept)
✅ **Incident tracking** (last incident time)
✅ **Contextual insights** (on-demand tooltip)

**Visual Hierarchy:**
1. **Score Number**: 64px (most dominant)
2. **Progress Ring**: 200px diameter (visual anchor)
3. **Trend Indicator**: Green icon + percentage
4. **Status Text**: Contextual health message
5. **Hover Tooltip**: Deep intelligence layer

**Results:**
✅ **Feels intelligent and alive** - real-time updates
✅ **Contextual insights** - hover for deep analysis
✅ **Clean minimal design** - no heavy effects
✅ **Professional authority** - enterprise-grade intelligence
✅ **Actionable data** - identifies risk areas immediately

---

### Structural Enhancement - Visual Anchor (Safety Score Meter)

**Goal Achieved:**
✅ Created visual center of gravity
 Dashboard feels intelligent and data-driven
✅ Strong compositional balance

**Implementation:**

**1) Large Circular Safety Score Meter:**
- **Position**: Right side of hero section
- **Size**: 200px × 200px (larger than KPI cards)
- **Display**: 87 / 100
- **Design**: Clean circular progress ring
  - Background ring: `rgba(255, 255, 255, 0.08)` - 12px stroke
  - Progress ring: `#00E0FF` (cyan) - 12px stroke
  - Round line caps for modern appearance
  - 1s smooth transition animation
- **Center Number**: 64px / 700 weight (dominant size)
- **Secondary Text**: 18px "/ 100" (muted)
- **Label**: "Company Safety Index" - 15px / 600 weight

**2) Visual Dominance:**
- **Largest single metric** on the dashboard
- Size comparison:
  - Safety meter: 200px diameter
  - KPI numbers: 42px
  - Hero title: 48px
- Clean, minimal design - no heavy glows
- Subtle stroke contrast for clarity
- Professional data visualization

**3) Compositional Balance:**
- **Left**: System Status text block (flex: 1)
- **Right**: Safety Score meter (fixed 200px)
- Gap between: 48px
- Perfect visual equilibrium
- Creates clear focal hierarchy

**Results:**
✅ **Strongest visual element** on screen
✅ **Immediate attention** to key metric
✅ **Professional data-driven** appearance
✅ **Balanced composition** - text vs. data
✅ **Clean minimal design** - no gaming effects

---

### Enterprise Visual Upgrade - Clean Hierarchy (CORRECTED)

**Design Philosophy:**
✅ Visual dominance through **hierarchy, not darkness**
✅ Structure and authority over gaming effects
✅ Clean, minimal, professional
✅ No heavy gradients or excessive glows

**STEP 1 – Strong Hero Block:**
- Hero section padding increased: **48px** (significant height boost)
- Card variant changed to **"elevated"** (cleaner background)
- **Left accent line**: 3px cyan gradient `rgba(0, 224, 255, 0.6)` → `0.1`
- Title enlarged: **48px / 700 weight** (true hero scale)
- Badge moved **inline with title** (horizontal alignment)
- Added micro description: *"All systems are stable and monitored in real-time."*
- Clean background, no heavy gradients

**STEP 2 – KPI Structure Enhancement:**
- KPI cards wrapped in **unified container** (Card with 32px padding)
- Increased spacing between cards: **24px gap** (was 16px)
- KPI numbers: **42px** (maintained larger size)
- Icons: **28px / 56px container** (maintained larger size)
- **Removed heavy gradients** - clean elevated background
- **Subtle hover**: Border color change + 2px lift (clickable only)
- No gaming glows or excessive shadows

**STEP 3 – Contrast Correction:**
- **Removed dark background overlay** from page content
- Text brightness increased:
  - Primary: `rgba(255, 255, 255, 0.95)` (was 0.92)
  - Secondary: `rgba(255, 255, 255, 0.75)` (was 0.72)
  - Muted: `rgba(255, 255, 255, 0.55)` (was 0.52)
- **Removed ping animation** from status badge
- Clean page background (no gradient overlay)

**Visual Hierarchy Achieved:**
1. **Hero Block** - Largest, most prominent with accent line
2. **KPI Container** - Unified structure with clear elevation
3. **Activity Section** - Standard layout
4. **Quick Actions** - Supporting content

**Results:**
✅ Increased clarity and readability
✅ Professional enterprise authority
✅ Clean structure-based hierarchy
✅ No excessive darkness or gaming effects
✅ Subtle, confident, powerful

---

### Custom Scrollbar (Dark Cyber Minimal - Auto-Hide)
- Width: **6px** (ultra-thin, enterprise minimal)
- Track: **100% transparent** (always)
- Thumb: **transparent by default** → **8% on hover** → **18% on thumb hover**
- Border radius: **999px** (fully pill-shaped)
- Smooth transitions (0.3s ease)
- **Auto-hide**: Hidden when not scrolling, only visible on hover/interaction
- **Scroll depth indicators**: Subtle 32px gradient fades at top/bottom of scrollable containers
  - Top fade: `rgba(5, 7, 14, 0.95)` → `transparent`
  - Bottom fade: `rgba(5, 7, 14, 0.95)` → `transparent`
  - Auto-applies to overflow containers
- Works with RTL/LTR layouts
- Firefox and Webkit support

**Goal achieved**: Scrollbar feels native and invisible unless needed. Gradient indicators show scroll depth without relying on scrollbar visibility.

---

**Structure cleaned and organized.**
**All sections clearly labeled.**
**Ready for next phase.**

---

### Map Engine — Reusable Component Set (v6)

**Location:** `/src/app/components/map-engine/`

**Architecture:**
```
/src/app/components/map-engine/
├── index.ts            → Barrel export (all components + data)
├── map-data.ts         → Shared types, constants, zone/employee data, helpers
├── map-keyframes.ts    → Shared CSS @keyframes (inject via <style>)
├── MapCanvas.tsx        → Procedural grid background + pan/zoom container
├── MapControls.tsx      → Floating controls (zoom stack, fullscreen, legend, status pills)
├── ZoneOverlays.tsx     → SVG zone circles + labels + badges (severity-colored)
├── PeopleMarkers.tsx    → Employee markers (neutral) + cluster markers + tooltip card
├── ZoneDrillPanel.tsx   → 480px slide-in zone command panel + contact modal
└── MapAlertBanner.tsx   → In-map alert banner strip (dismissible, severity-colored)
```

**Consumers:**
- `RiskMapLivePage.tsx` — Full page: MapCanvas + MapControls + ZoneOverlays + PeopleMarkers + ZoneDrillPanel + MapAlertBanner
- `RiskMapModal.tsx` — Modal: SimpleZoneCircles + MAP_KEYFRAMES + SCORE_ITEMS (lightweight)
- `ZonesPage.tsx` — Page: MAP_KEYFRAMES + CTRL_BG/CTRL_BORDER (shared control styling)

**Color Rules (severity only):**
- `#FF2D55` — Critical (red)
- `#FFB300` — High (orange/amber)
- `#00C8E0` — Medium (cyan)
- `#6B7280` — Low (gray)
- `#8891A0` — Personnel markers (neutral, no status coloring)
- `#2A3040` — Zones with no incidents (ZONE_NEUTRAL)

**API Pattern:**
```tsx
<MapCanvas interactive zoomIdx={idx} panOffset={pan} overlay={<MapControls ... />}>
  <ZoneOverlays zones={ZONES} zoneStates={ZONE_STATES} ... />
  <PeopleMarkers employees={EMPLOYEES} clusters={CLUSTERS} ... />
</MapCanvas>
```

**Rules:**
- Zero duplicate map rendering logic across pages
- All color constants centralized in `map-data.ts`
- Keyframes injected once per page via `<style>{MAP_KEYFRAMES}</style>`
- MapCanvas children render inside pan/zoom transform; overlay renders outside
- ZoneDrillPanel + ContactZoneModal are independent — compose alongside MapCanvas