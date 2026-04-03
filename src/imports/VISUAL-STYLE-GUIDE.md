# 🎨 Visual Style Guide - Quick Reference

## 🎯 The Golden Rule

```
ONE Accent Color:  Teal #14b8a6
NO Pure White:     Use rgba(255,255,255,0.xx)
NO Blue:           Ever. Use teal instead.
```

---

## 🎨 Color Palette (Copy-Paste Ready)

### Accent - Teal (Use Everywhere)
```css
/* Primary Accent */
#14b8a6          ← Main teal
#0f9688          ← Hover
#0d7f73          ← Active

/* Teal Overlays */
rgba(20, 184, 166, 0.08)   ← Subtle background
rgba(20, 184, 166, 0.12)   ← Medium background
rgba(20, 184, 166, 0.20)   ← Strong background
rgba(20, 184, 166, 0.30)   ← Border
```

### Text - Soft White Scale
```css
/* Headings → Disabled */
rgba(255, 255, 255, 0.95)  ← H1, H2
rgba(255, 255, 255, 0.88)  ← H3, Labels
rgba(255, 255, 255, 0.75)  ← Body text
rgba(255, 255, 255, 0.65)  ← Descriptions
rgba(255, 255, 255, 0.60)  ← Helper text
rgba(255, 255, 255, 0.50)  ← Subtle hints
rgba(255, 255, 255, 0.40)  ← Placeholders
rgba(255, 255, 255, 0.30)  ← Disabled
```

### Backgrounds - Dark Surfaces
```css
/* Surfaces - Darker to Lighter */
rgba(255, 255, 255, 0.02)  ← Darkest cards
rgba(255, 255, 255, 0.025) ← Standard cards
rgba(255, 255, 255, 0.03)  ← Input fields
rgba(255, 255, 255, 0.04)  ← Elevated
rgba(255, 255, 255, 0.05)  ← Hover
rgba(255, 255, 255, 0.06)  ← Active
rgba(255, 255, 255, 0.08)  ← Selected
```

### Borders - Subtle Hierarchy
```css
rgba(255, 255, 255, 0.04)  ← Very subtle
rgba(255, 255, 255, 0.08)  ← Default
rgba(255, 255, 255, 0.12)  ← Medium
rgba(255, 255, 255, 0.15)  ← Strong
#14b8a6                    ← Focus (teal)
```

### Semantic - Muted Colors
```css
/* Success - Green */
#10b981                    ← Base
rgba(16, 185, 129, 0.08)   ← Background
rgba(16, 185, 129, 0.25)   ← Border
#6ee7b7                    ← Text

/* Warning - Amber */
#f59e0b                    ← Base
rgba(245, 158, 11, 0.08)   ← Background
rgba(245, 158, 11, 0.25)   ← Border
#fcd34d                    ← Text

/* Error - Red */
#ef4444                    ← Base
rgba(239, 68, 68, 0.08)    ← Background
rgba(239, 68, 68, 0.25)    ← Border
#fca5a5                    ← Text
```

---

## 📏 Typography Scale

```
KPI Values:      48px  Bold       ← HUGE (dashboard hero)
Page Titles:     28px  SemiBold   ← H1
Section Headers: 20px  SemiBold   ← H2
Card Titles:     18px  Medium     ← H3
Subsections:     16px  Medium     ← H4
Small Headers:   15px  Medium     ← H5
Body Text:       14px  Regular    ← Standard
Helper Text:     13px  Regular    ← Minimum size
```

Visual Scale:
```
48px ████████████████████  KPI
28px ███████████          H1
20px ████████             H2
18px ███████              H3
16px ██████               H4
15px █████                H5
14px ████                 Body ← MOST CONTENT
13px ███                  Helper ← MINIMUM
```

---

## 🔘 Button Styles

### Primary - Teal Gradient
```css
background: linear-gradient(135deg, #14b8a6 0%, #0f9688 100%);
border: 1.5px solid rgba(20, 184, 166, 0.3);
color: #ffffff;
height: 44px;
font-size: 14px;
font-weight: 600;
```

Use for: **Save, Confirm, Submit**

### Secondary - Outline
```css
background: transparent;
border: 1.5px solid rgba(255, 255, 255, 0.15);
color: rgba(255, 255, 255, 0.85);
height: 40px;
font-size: 14px;
font-weight: 500;
```

Use for: **Cancel, Back, Close**

### Destructive - Red
```css
background: rgba(239, 68, 68, 0.1);
border: 1.5px solid rgba(239, 68, 68, 0.3);
color: #fca5a5;
height: 44px;
font-size: 14px;
font-weight: 600;
```

Use for: **Delete, Remove, Logout**

---

## 📦 Card Styles

### Standard Card
```css
background: rgba(255, 255, 255, 0.025);
border: 1.5px solid rgba(255, 255, 255, 0.08);
border-radius: 10px;
padding: 20px;
```

### Hover State
```css
background: rgba(255, 255, 255, 0.03);
border-color: rgba(255, 255, 255, 0.12);
transform: translateY(-2px);
box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
```

### KPI Card (Hero)
```css
background: rgba(255, 255, 255, 0.025);
border: 1.5px solid rgba(255, 255, 255, 0.08);
border-radius: 10px;
padding: 24px;

/* KPI Value */
font-size: 48px;
font-weight: 700;
color: rgba(255, 255, 255, 0.95);
```

---

## 📊 Status Badges

### On Duty - Green
```css
background: rgba(16, 185, 129, 0.08);
border: 1px solid rgba(16, 185, 129, 0.25);
color: #6ee7b7;
padding: 6px 12px;
border-radius: 6px;
font-size: 13px;
font-weight: 500;
```

### Off Duty - Gray
```css
background: rgba(100, 116, 139, 0.12);
border: 1px solid rgba(100, 116, 139, 0.2);
color: rgba(148, 163, 184, 0.9);
```

### On Task - Teal
```css
background: rgba(20, 184, 166, 0.12);
border: 1px solid rgba(20, 184, 166, 0.3);
color: #5eead4;
```

### Emergency - Red (Pulsing)
```css
background: rgba(239, 68, 68, 0.08);
border: 1px solid rgba(239, 68, 68, 0.25);
color: #fca5a5;
animation: pulse-border 2s ease-in-out infinite;
```

---

## 📐 Spacing Scale

```css
8px   ← Icon gaps, tight spacing
12px  ← Button groups, small gaps
16px  ← Form field spacing
20px  ← Card padding, form groups
24px  ← Section margins, larger cards
32px  ← Major section spacing
40px  ← Page section spacing
```

Visual:
```
8px   ▏
12px  ▏▏
16px  ▏▏▏
20px  ▏▏▏▏
24px  ▏▏▏▏▏
32px  ▏▏▏▏▏▏▏
40px  ▏▏▏▏▏▏▏▏▏
```

---

## 🎯 Common Patterns

### Form Field
```html
<div style="margin-bottom: 20px">
  <label style="
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.88);
    margin-bottom: 8px;
  ">
    Field Label
  </label>
  <input style="
    width: 100%;
    height: 44px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1.5px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.75);
  ">
  <small style="
    display: block;
    margin-top: 6px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  ">
    Helper text
  </small>
</div>
```

### KPI Card
```html
<div style="
  background: rgba(255, 255, 255, 0.025);
  border: 1.5px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 24px;
">
  <div style="
    font-size: 14px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 16px;
  ">
    Total Employees
  </div>
  <div style="
    font-size: 48px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.95);
    line-height: 1.1;
  ">
    127
  </div>
  <div style="
    margin-top: 8px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  ">
    ↑ 8% from last week
  </div>
</div>
```

### Table
```html
<table style="width: 100%; border-collapse: collapse;">
  <thead style="
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1.5px solid rgba(255, 255, 255, 0.08);
  ">
    <tr>
      <th style="
        padding: 14px 16px;
        text-align: left;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.6);
      ">
        Name
      </th>
    </tr>
  </thead>
  <tbody>
    <tr style="transition: background 0.15s ease;">
      <td style="
        padding: 16px;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.75);
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      ">
        John Doe
      </td>
    </tr>
  </tbody>
</table>
```

---

## 🚫 DON'T USE

```css
/* ❌ NEVER */
color: #fff;
color: #ffffff;
color: white;
color: blue;
color: #0000ff;
color: #007bff;
background: white;
background: #fff;
border-color: blue;

/* ✅ INSTEAD */
color: rgba(255, 255, 255, 0.95);
color: var(--text-primary);
background: rgba(255, 255, 255, 0.025);
background: var(--bg-surface-2);
border-color: var(--accent-primary);
```

---

## ✅ CSS Variable Reference

```css
/* Always use these variables */

/* Accent */
var(--accent-primary)
var(--accent-hover)
var(--accent-active)

/* Text */
var(--text-primary)
var(--text-secondary)
var(--text-body)
var(--text-muted)
var(--text-helper)
var(--text-placeholder)

/* Backgrounds */
var(--bg-surface-1)
var(--bg-surface-2)
var(--bg-surface-3)
var(--bg-hover)
var(--bg-active)

/* Borders */
var(--border-subtle)
var(--border-default)
var(--border-medium)
var(--border-focus)

/* Semantic */
var(--success)
var(--warning)
var(--error)
var(--info)

/* Spacing */
var(--space-xs)   /* 8px */
var(--space-sm)   /* 12px */
var(--space-md)   /* 16px */
var(--space-lg)   /* 20px */
var(--space-xl)   /* 24px */
var(--space-2xl)  /* 32px */
```

---

## 🎨 Quick Copy-Paste Snippets

### Teal Button
```css
background: linear-gradient(135deg, #14b8a6 0%, #0f9688 100%);
border: 1.5px solid rgba(20, 184, 166, 0.3);
color: #ffffff;
padding: 12px 24px;
border-radius: 8px;
font-size: 14px;
font-weight: 600;
cursor: pointer;
transition: all 0.2s ease;
```

### Teal Focus Ring
```css
outline: none;
border-color: #14b8a6;
box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
```

### Soft White Text
```css
color: rgba(255, 255, 255, 0.75);
```

### Dark Card
```css
background: rgba(255, 255, 255, 0.025);
border: 1.5px solid rgba(255, 255, 255, 0.08);
border-radius: 10px;
```

### Status Badge
```css
display: inline-flex;
align-items: center;
gap: 6px;
padding: 6px 12px;
border-radius: 6px;
font-size: 13px;
font-weight: 500;
background: rgba(20, 184, 166, 0.12);
border: 1px solid rgba(20, 184, 166, 0.3);
color: #5eead4;
```

---

## 📱 Responsive Breakpoints

```css
/* Tablet */
@media (max-width: 1024px) {
  /* Reduce grid columns */
}

/* Mobile */
@media (max-width: 768px) {
  /* Stack layout */
  /* Reduce title sizes slightly */
  /* But maintain 14px body text! */
}

/* Small Mobile */
@media (max-width: 480px) {
  /* Single column */
  /* Full-width buttons */
  /* Bottom sheet dropdowns */
}
```

---

## 🎯 Remember

```
1 Color:   Teal (#14b8a6)
0 Blue:    Never use blue
0 White:   Never use pure white (#fff)
48px:      KPI values (HUGE)
14px:      Body text (standard)
13px:      Minimum text size
44px:      Standard input/button height
```

---

## 📚 Full Documentation

- Color System: `/src/styles/final-color-system.css`
- Cleanup: `/src/styles/remove-blue-white.css`
- Dashboard: `/src/styles/dashboard-investor-ready.css`
- Guide: `/COLOR-CLEANUP-COMPLETE.md`

**When in doubt: Copy from existing components!** 🎯
