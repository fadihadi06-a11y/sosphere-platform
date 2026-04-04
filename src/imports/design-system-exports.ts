// ========================================
// 03 — DESIGN SYSTEM — 🔒 LOCKED
// ========================================
// All tokens frozen. Do not modify visually.
// Spacing: 8 / 16 / 24 / 32 / 48 only
// Radius: Cards 16px | Buttons 12px | Small 8px
// Elevation: 3 levels only (0, 1, 2)
// Accent: var(--sos-accent-primary) = #00C8E0
// ========================================
// Centralized component exports
// All design system components follow:
// - 8pt grid system
// - Dark cyber minimal theme
// - Bilingual support (EN/AR)
// ========================================

// Layout Components
export { DashboardLayout, PageContainer, Grid, EnterpriseGrid, GridCol, LAYOUT } from './Layout';
export type { EnterpriseGridProps, GridColProps } from './Layout';

// Navigation Components
export { Sidebar } from './Sidebar';
export type { SidebarMenuItem, SidebarMenuGroup } from './Sidebar';
export { Topbar } from './Topbar';

// Core Components
export { Card, KPICard, SectionHeader } from './Card';
export type { CardProps, KPICardProps, SectionHeaderProps } from './Card';

export { Badge, StatusBadge } from './Badge';
export type { BadgeProps, BadgeVariant, StatusBadgeProps } from './Badge';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Table } from './Table';
export type { TableColumn, TableProps } from './Table';

export { AlertItem } from './Alert';
export type { AlertItemProps } from './Alert';

// ========================================
// 02 — EMERGENCY SYSTEM
// ========================================
export { EmergencyDrawer } from './EmergencyDrawer';
export type { EmergencyDrawerProps, EmergencyDrawerState } from './EmergencyDrawer';
Layout.tsx (/src/app/components/design-system/Layout.tsx)

// ========================================
// LAYOUT COMPONENTS — 🔒 LOCKED
// Spacing: 8/16/24/32/48 only
// Grid: 12-column | Gutter: 24px
// Sidebar: 180px | Content max: 1280px
// ========================================
// App Shell Architecture (z-index layer order):
//   ┌──────────────────────────────────────────────┐
//   │  z:0   Background                            │
//   │  z:1   Sidebar (180px)                       │
//   │  z:2   Main Column                           │
//   │         ├ z:10  Topbar (fixed height)         │
//   │         ├ z:20  Alert Banner (fixed height)   │
//   │         └ z:1   Page Content (scroll)         │
//   │  z:100  Overlay backdrop (when drawer opens)  │
//   │  z:110  Side Panel / Drawer (right:0, solid)  │
//   │  z:200  Modal backdrop                        │
//   │  z:210  Modal dialog                          │
//   └──────────────────────────────────────────────┘
//
//   12-COLUMN GRID SPEC:
//   ┌─────────────────────────────────────────────┐
//   │  Max content width: 1280px                   │
//   │  Columns: 12 × 1fr                          │
//   │  Gutter: 24px                                │
//   │  Column width: (1280 - 11×24) / 12 ≈ 84.7px │
//   │  Section vertical spacing: 32px min          │
//   └─────────────────────────────────────────────┘
//
//   KEY: App Shell uses transform to become the
//   containing block for ALL position:fixed children.
//   This ensures drawers/overlays never escape the frame.
//   Clip Content: ON (overflow:hidden on App Shell).
// ========================================

// ── Constants ──
const SIDEBAR_WIDTH = 180;
const CONTENT_MAX_WIDTH = 1280;
const GRID_COLUMNS = 12;
const GRID_GUTTER = 24;
const SECTION_GAP = 32;

// Dashboard Layout Wrapper — "App Shell"
export interface DashboardLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  banner?: React.ReactNode;
  language: string;
  fullBleed?: boolean;
}

export function DashboardLayout({ children, sidebar, topbar, banner, language, fullBleed = false }: DashboardLayoutProps) {
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  const fontFamily = language === 'ar' ? '"IBM Plex Sans Arabic", sans-serif' : '"Inter", sans-serif';

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        background: 'var(--sos-bg-primary)',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* ── App Shell Frame ──
          Sidebar(180) + Content(1280) + margins = 1536px max
          transform creates a new containing block so that
          position:fixed children stay inside this frame.
          overflow:hidden clips all content. */}
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100%',
          maxWidth: '1536px',
          background: 'var(--sos-bg-primary)',
          direction,
          fontFamily,
          position: 'relative',
          overflow: 'hidden',
          // ★ This makes the App Shell the containing block
          // for ALL position:fixed descendants (drawers, overlays, modals).
          // Fixed children are now scoped to this frame.
          transform: 'translate3d(0,0,0)',
        }}
      >
        {/* ── Sidebar — full height, z:1, fixed 240px ── */}
        <div style={{ position: 'relative', zIndex: 1, flexShrink: 0, height: '100%' }}>
          {sidebar}
        </div>

        {/* ── Main Column — flex column, z:2, clipped ── */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 2,
        }}>
          {/* ── Header — fixed 76px height, no scroll, solid bg, z:10 ── */}
          <div style={{ flexShrink: 0, zIndex: 10, position: 'relative' }}>
            {topbar}
          </div>

          {/* ── Alerts — outside header, centered 1200px, z:20 ── */}
          {banner && (
            <div style={{
              flexShrink: 0,
              zIndex: 20,
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              justifyContent: 'center',
              padding: '16px 24px 0',
            }}>
              <div style={{
                width: '100%',
                maxWidth: `${CONTENT_MAX_WIDTH}px`,
              }}>
                {banner}
              </div>
            </div>
          )}

          {/* ── Content — sole scroll container, z:1
               margin-top from header controlled by paddingTop
               Always scrollable — never clip content
               Always has horizontal padding (24px) for breathing room ── */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              paddingTop: fullBleed ? 16 : GRID_GUTTER,
              paddingLeft: GRID_GUTTER,
              paddingRight: GRID_GUTTER,
              paddingBottom: fullBleed ? 0 : GRID_GUTTER,
              position: 'relative',
              zIndex: 1,
              // Hidden scrollbar — content scrolls smoothly with no visible bar
              scrollbarWidth: 'none' as any,
              msOverflowStyle: 'none' as any,
              // Flex column so full-bleed pages can use flex: 1
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE CONTAINER — Max-width wrapper with vertical spacing
// Centers content with max 1280px, 32px section gaps
// ════════════════════════════════════════════════════════════════
export interface PageContainerProps {
  children: React.ReactNode;
  maxWidth?: number;
  gap?: number;
}

export function PageContainer({ children, maxWidth = CONTENT_MAX_WIDTH, gap = SECTION_GAP }: PageContainerProps) {
  return (
    <div
      style={{
        maxWidth: `${maxWidth}px`,
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: `${gap}px`,
      }}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ENTERPRISE GRID — 12-Column CSS Grid
// Usage: <EnterpriseGrid> + <GridCol span={6}> children
// 12 cols × 1fr with 24px gutter, max-width 1280px centered
// ════════════════════════════════════════════════════════════════
export interface EnterpriseGridProps {
  children: React.ReactNode;
  /** Max width of the grid container. Default: 1280px */
  maxWidth?: number;
  /** Gap between grid items. Default: 24px (gutter) */
  gap?: number;
  /** Row gap override. Defaults to same as gap */
  rowGap?: number;
  /** Align items vertically */
  alignItems?: React.CSSProperties['alignItems'];
  /** Additional inline styles */
  style?: React.CSSProperties;
}

export function EnterpriseGrid({
  children,
  maxWidth = CONTENT_MAX_WIDTH,
  gap = GRID_GUTTER,
  rowGap,
  alignItems = 'stretch',
  style,
}: EnterpriseGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
        columnGap: `${gap}px`,
        rowGap: `${rowGap ?? gap}px`,
        maxWidth: `${maxWidth}px`,
        width: '100%',
        margin: '0 auto',
        alignItems,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// GRID COL — Column span helper for EnterpriseGrid
// Usage: <GridCol span={8}> for 8 of 12 columns
// ════════════════════════════════════════════════════════════════
export interface GridColProps {
  children: React.ReactNode;
  /** Number of columns to span (1–12). Default: 12 */
  span?: number;
  /** Starting column (1-based). Auto if not set */
  start?: number;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

export function GridCol({
  children,
  span = GRID_COLUMNS,
  start,
  style,
}: GridColProps) {
  return (
    <div
      style={{
        gridColumn: start
          ? `${start} / span ${span}`
          : `span ${span}`,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// GRID HELPER — Simple N-column grid (legacy compat)
// Updated default gutter to 24px
// ════════════════════════════════════════════════════════════════
export interface GridProps {
  children: React.ReactNode;
  columns?: number;
  gap?: number;
}

export function Grid({ children, columns = 2, gap = GRID_GUTTER }: GridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: `${gap}px`,
      }}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// LAYOUT CONSTANTS EXPORT
// ════════════════════════════════════════════════════════════════
export const LAYOUT = {
  SIDEBAR_WIDTH,
  CONTENT_MAX_WIDTH,
  GRID_COLUMNS,
  GRID_GUTTER,
  SECTION_GAP,
} as const;
Sidebar.tsx (/src/app/components/design-system/Sidebar.tsx)

import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import type { LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

const ChevronLeft = LucideIcons.ChevronLeft;
const ChevronRight = LucideIcons.ChevronRight;
const PanelLeftClose = LucideIcons.PanelLeftClose;
const PanelLeftOpen = LucideIcons.PanelLeftOpen;

// ========================================
// SIDEBAR COMPONENT — Apple macOS Aesthetic
// Collapsible: 200px expanded | 56px collapsed
// Smooth transition with hidden scrollbar
// ========================================

export interface SidebarMenuItem {
  id: string;
  icon: LucideIcon;
  label: string;
}

export interface SidebarMenuGroup {
  label: string;
  items: SidebarMenuItem[];
}

interface SidebarProps {
  logo: {
    icon: LucideIcon;
    title: string;
    subtitle: string;
  };
  menuItems?: SidebarMenuItem[];
  menuGroups?: SidebarMenuGroup[];
  currentPage: string;
  onNavigate: (page: string) => void;
}

export function Sidebar({ logo, menuItems, menuGroups, currentPage, onNavigate }: SidebarProps) {
  const { direction } = useLanguage();
  const { roleMeta } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      style={{
        width: collapsed ? '56px' : '200px',
        height: '100%',
        background: 'rgba(5, 7, 14, 0.98)',
        borderRight: direction === 'ltr' ? '1px solid rgba(255,255,255,0.05)' : 'none',
        borderLeft: direction === 'rtl' ? '1px solid rgba(255,255,255,0.05)' : 'none',
        padding: collapsed ? '16px 8px' : '20px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxSizing: 'border-box',
        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding 0.22s ease',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{
        flexShrink: 0,
        padding: collapsed ? '0 0 12px 0' : '4px 6px 16px 6px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        overflow: 'hidden',
        minWidth: 0,
      }}>
        <SidebarLogo icon={logo.icon} title={logo.title} subtitle={logo.subtitle} collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: 0,
      }}>
        {menuGroups ? (
          menuGroups.map((group, groupIndex) => (
            <div key={groupIndex} style={{ marginBottom: groupIndex < menuGroups.length - 1 ? 8 : 0 }}>
              {/* Group Label — hidden when collapsed */}
              {!collapsed && (
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.25)',
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.1em',
                  padding: '8px 10px 6px 10px',
                  marginTop: groupIndex > 0 ? 12 : 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}>
                  {group.label}
                </div>
              )}
              {collapsed && groupIndex > 0 && (
                <div style={{
                  height: 1,
                  background: 'rgba(255,255,255,0.04)',
                  margin: '10px 4px',
                }} />
              )}
              {/* Group Items */}
              {group.items.map((item) => (
                <SidebarItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  isActive={currentPage === item.id}
                  onClick={() => onNavigate(item.id)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          ))
        ) : menuItems ? (
          menuItems.map((item) => (
            <SidebarItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={currentPage === item.id}
              onClick={() => onNavigate(item.id)}
              collapsed={collapsed}
            />
          ))
        ) : null}
      </nav>

      {/* Collapse Toggle Button */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.04)',
        paddingTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {/* Role Badge — shows role when expanded */}
        {!collapsed && roleMeta && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '6px 10px',
            background: `${roleMeta.color}08`,
            border: `1px solid ${roleMeta.color}18`,
            borderRadius: 8,
            marginBottom: 2,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: roleMeta.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: roleMeta.color, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {roleMeta.label}
            </span>
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: collapsed ? 'center' : (direction === 'rtl' ? 'flex-end' : 'flex-end'),
        }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.3)',
              transition: 'all 0.12s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'rgba(255,255,255,0.3)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
            }}
          >
            {collapsed
              ? (direction === 'rtl' ? <ChevronLeft size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />)
              : (direction === 'rtl' ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronLeft size={14} strokeWidth={2} />)
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ========================================
// SIDEBAR LOGO — Apple-style, collapsible
// ========================================
function SidebarLogo({ icon: Icon, title, subtitle, collapsed }: {
  icon: LucideIcon; title: string; subtitle: string; collapsed: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: collapsed ? 0 : 10,
      overflow: 'hidden',
      minWidth: 0,
    }}>
      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: '10px',
        background: 'linear-gradient(145deg, #00C8E0 0%, #0094A8 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={20} color="#05070E" strokeWidth={2.5} />
      </div>
      {!collapsed && (
        <div style={{ overflow: 'hidden', minWidth: 0 }}>
          <div style={{
            fontSize: '15px',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.95)',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          <div style={{
            fontSize: '10px',
            fontWeight: 500,
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.03em',
            marginTop: 2,
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap',
          }}>
            {subtitle}
          </div>
        </div>
      )}
    </div>
  );
}

// ========================================
// SIDEBAR ITEM — Apple macOS style
// Supports collapsed (icon-only) mode
// ========================================
interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  onClick: () => void;
  collapsed?: boolean;
}

function SidebarItem({ icon: Icon, label, isActive, onClick, collapsed = false }: SidebarItemProps) {
  const { direction } = useLanguage();

  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: collapsed ? 0 : '9px',
        width: '100%',
        padding: collapsed ? '7px' : '8px 10px',
        background: isActive ? 'rgba(0, 200, 224, 0.1)' : 'transparent',
        border: 'none',
        outline: 'none',
        borderRadius: '10px',
        color: isActive ? '#00C8E0' : 'rgba(255,255,255,0.5)',
        fontSize: '13px',
        fontWeight: isActive ? 600 : 500,
        cursor: 'pointer',
        transition: 'all 0.12s ease',
        textAlign: direction === 'rtl' ? 'right' : 'left',
        letterSpacing: '-0.01em',
        boxSizing: 'border-box',
        flexShrink: 0,
        minHeight: '34px',
        position: 'relative',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.8)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
        }
      }}
    >
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: isActive ? 'rgba(0, 200, 224, 0.12)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 0.12s ease',
      }}>
        <Icon size={15} strokeWidth={isActive ? 2 : 1.75} style={{ flexShrink: 0 }} />
      </div>
      {!collapsed && (
        <span style={{ lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      )}
    </button>
  );
}
Topbar.tsx (/src/app/components/design-system/Topbar.tsx)

import { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCompany } from '../../contexts/CompanyContext';
import { useAuth } from '../../contexts/AuthContext';
import type { UserRole } from '../../contexts/AuthContext';
import * as LucideIcons from 'lucide-react';

const Bell = LucideIcons.Bell;
const Search = LucideIcons.Search;
const Globe = LucideIcons.Globe;
const ChevronDown = LucideIcons.ChevronDown;
const AlertTriangle = LucideIcons.AlertTriangle;
const ShieldAlert = LucideIcons.ShieldAlert;
const MapPin = LucideIcons.MapPin;
const Radio = LucideIcons.Radio;
const Clock = LucideIcons.Clock;
const Shield = LucideIcons.Shield;
const User = LucideIcons.User;
const Settings = LucideIcons.Settings;
const LogOut = LucideIcons.LogOut;
const Check = LucideIcons.Check;

// ========================================
// TOPBAR — Apple Toolbar Aesthetic
// Clean, minimal, highly refined
// ========================================

interface TopbarProps {
  language: string;
  onLanguageChange: (lang: 'en' | 'ar') => void;
  notificationCount?: number;
  searchPlaceholder: string;
  hideSearch?: boolean;
  hideNotifications?: boolean;
  compact?: boolean;
  user: {
    name: string;
    email: string;
  };
  onNavigate?: (page: string) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  rightExtra?: React.ReactNode;
}

export function Topbar({
  language,
  onLanguageChange,
  notificationCount = 0,
  searchPlaceholder,
  hideSearch = false,
  hideNotifications = false,
  compact = false,
  user,
  onNavigate,
  searchValue,
  onSearchChange,
  rightExtra,
}: TopbarProps) {
  const { direction } = useLanguage();
  const { company } = useCompany();

  return (
    <div
      style={{
        height: compact ? 56 : 64,
        width: '100%',
        background: 'rgba(5, 7, 14, 0.95)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        boxSizing: 'border-box' as const,
        flexShrink: 0,
        gap: 16,
      }}
    >
      {/* LEFT: Company name */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
        minWidth: 0,
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          background: 'linear-gradient(145deg, rgba(0,200,224,0.15) 0%, rgba(0,200,224,0.05) 100%)',
          border: '1px solid rgba(0,200,224,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Shield size={16} strokeWidth={2} color="#00C8E0" />
        </div>
        <div>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.9)',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}>
            {language === 'ar' ? company.nameAr : company.name}
          </div>
          <div style={{
            fontSize: 10,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.3)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase' as const,
            lineHeight: 1,
            marginTop: 2,
          }}>
            {language === 'ar' ? 'مركز العمليات' : 'Operations Center'}
          </div>
        </div>
      </div>

      {/* CENTER: Search */}
      {!hideSearch && (
        <div style={{
          flex: 1,
          maxWidth: 360,
          minWidth: 180,
          position: 'relative',
        }}>
          <Search
            size={14}
            strokeWidth={2}
            color="rgba(255,255,255,0.25)"
            style={{
              position: 'absolute',
              left: direction === 'ltr' ? '14px' : 'auto',
              right: direction === 'rtl' ? '14px' : 'auto',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          />
          <input
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange?.(e.target.value)}
            style={{
              width: '100%',
              height: 36,
              padding: direction === 'ltr' ? '0 14px 0 38px' : '0 38px 0 14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10,
              color: 'rgba(255,255,255,0.85)',
              fontSize: 13,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              outline: 'none',
              transition: 'all 0.15s ease',
              boxSizing: 'border-box' as const,
              fontFamily: 'inherit',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(0,200,224,0.3)';
              e.currentTarget.style.background = 'rgba(0,200,224,0.04)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
          />
        </div>
      )}

      {/* RIGHT: Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        {rightExtra && <div style={{ marginRight: 4 }}>{rightExtra}</div>}
        <LanguageDropdown language={language} onChange={onLanguageChange} />
        {!hideNotifications && <NotificationDropdown count={notificationCount} onNavigate={onNavigate} />}
        <UserAvatarDropdown name={user.name} email={user.email} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

// ========================================
// LANGUAGE DROPDOWN — Refined
// ========================================
function LanguageDropdown({ language, onChange }: { language: string; onChange: (lang: 'en' | 'ar') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { direction } = useLanguage();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const languages = [
    { code: 'en' as const, label: 'English', short: 'EN' },
    { code: 'ar' as const, label: 'العربية', short: 'AR' },
  ];
  const current = languages.find(l => l.code === language) || languages[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          height: '34px',
          padding: '0 10px',
          background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          border: '1px solid',
          borderColor: open ? 'rgba(255,255,255,0.1)' : 'transparent',
          borderRadius: '9px',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)',
          transition: 'all 0.12s ease',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.8)';
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
          }
        }}
      >
        <Globe size={14} strokeWidth={1.75} />
        <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.03em' }}>
          {current.short}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          style={{
            opacity: 0.5,
            transition: 'transform 0.12s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          [direction === 'rtl' ? 'left' : 'right']: 0,
          width: '150px',
          background: '#111826',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.3)',
          padding: '4px',
          zIndex: 100,
          animation: 'fadeIn 0.1s ease-out',
        }}>
          {languages.map((lang) => {
            const isActive = language === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => { onChange(lang.code); setOpen(false); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: isActive ? 'rgba(0,200,224,0.08)' : 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  color: isActive ? '#00C8E0' : 'rgba(255,255,255,0.6)',
                  fontFamily: 'inherit',
                  transition: 'all 0.1s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: isActive ? 600 : 500 }}>{lang.label}</span>
                {isActive && <Check size={13} strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========================================
// NOTIFICATION BUTTON — Apple-style
// ========================================
function NotificationDropdown({ count, onNavigate }: { count: number; onNavigate?: (page: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { direction } = useLanguage();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const notifications = [
    { id: 1, icon: AlertTriangle, color: '#FF2D55', title: 'SOS triggered — Zone C', time: '2 min ago', unread: true, targetPage: 'incidentHistory' },
    { id: 2, icon: ShieldAlert, color: '#FFB300', title: 'Geofence breach — Zone B', time: '8 min ago', unread: true, targetPage: 'zones' },
    { id: 3, icon: MapPin, color: '#00C8E0', title: 'Employee check-in — Zone A', time: '15 min ago', unread: true, targetPage: 'employees' },
    { id: 4, icon: Radio, color: 'rgba(255,255,255,0.3)', title: 'Command center sync complete', time: '32 min ago', unread: false, targetPage: 'commandCenter' },
    { id: 5, icon: Clock, color: 'rgba(255,255,255,0.3)', title: 'Shift rotation started', time: '1 hr ago', unread: false, targetPage: 'overview' },
  ];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '34px',
          height: '34px',
          position: 'relative',
          background: open ? 'rgba(255,255,255,0.06)' : 'transparent',
          border: '1px solid',
          borderColor: open ? 'rgba(255,255,255,0.1)' : 'transparent',
          borderRadius: '9px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)',
          transition: 'all 0.12s ease',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.8)';
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
          }
        }}
      >
        <Bell size={16} strokeWidth={1.75} />
        {count > 0 && (
          <div style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '14px',
            height: '14px',
            background: '#FF2D55',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '8px',
            fontWeight: 700,
            color: '#FFF',
            lineHeight: 1,
            border: '1.5px solid rgba(5,7,14,0.95)',
            pointerEvents: 'none',
          }}>
            {count}
          </div>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          [direction === 'rtl' ? 'left' : 'right']: 0,
          width: '300px',
          background: '#111826',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '14px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 100,
          overflow: 'hidden',
          animation: 'fadeIn 0.1s ease-out',
        }}>
          <div style={{
            padding: '12px 16px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.01em' }}>
              Notifications
            </span>
            {count > 0 && (
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#00C8E0',
                background: 'rgba(0,200,224,0.1)',
                padding: '2px 8px',
                borderRadius: '6px',
              }}>
                {count} new
              </span>
            )}
          </div>

          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {notifications.map((notif, i) => {
              const Icon = notif.icon;
              return (
                <div
                  key={notif.id}
                  onClick={() => { setOpen(false); onNavigate?.(notif.targetPage); }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: notif.unread ? 'rgba(0,200,224,0.02)' : 'transparent',
                    borderBottom: i < notifications.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = notif.unread ? 'rgba(0,200,224,0.02)' : 'transparent'; }}
                >
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: '1px',
                  }}>
                    <Icon size={13} strokeWidth={1.75} color={notif.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: '12px',
                      fontWeight: notif.unread ? 600 : 400,
                      color: notif.unread ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
                      margin: 0,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.4,
                    }}>
                      {notif.title}
                    </p>
                    <p style={{
                      fontSize: '11px',
                      color: 'rgba(255,255,255,0.3)',
                      margin: '2px 0 0 0',
                      fontWeight: 400,
                    }}>
                      {notif.time}
                    </p>
                  </div>
                  {notif.unread && (
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: '#00C8E0', flexShrink: 0, marginTop: '7px',
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ padding: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <button
              onClick={() => { setOpen(false); onNavigate?.('notifications'); }}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#00C8E0',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
                fontFamily: 'inherit',
                transition: 'background 0.1s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,200,224,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              View All Notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================================
// USER AVATAR — Apple-style dropdown
// ========================================
function UserAvatarDropdown({ name, email, onNavigate }: { name: string; email: string; onNavigate?: (page: string) => void }) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const [open, setOpen] = useState(false);
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { direction } = useLanguage();
  const { user, roleMeta, switchRole } = useAuth();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowRoleSwitcher(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const ROLE_SWITCH_OPTIONS: { role: UserRole; label: string; color: string }[] = [
    { role: 'company_owner',  label: 'Company Owner',  color: '#FFB300' },
    { role: 'company_admin',  label: 'Company Admin',  color: '#00C8E0' },
    { role: 'safety_manager', label: 'Safety Manager', color: '#34C759' },
    { role: 'supervisor',     label: 'Supervisor',     color: '#5856D6' },
    { role: 'viewer',         label: 'Viewer',         color: '#8090A5' },
  ];

  const menuItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'settings', label: 'Account Settings', icon: Settings },
  ];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(!open); setShowRoleSwitcher(false); }}
        style={{
          width: '34px',
          height: '34px',
          borderRadius: '50%',
          background: 'transparent',
          border: '1.5px solid',
          borderColor: open ? 'rgba(0,200,224,0.4)' : 'rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.12s ease',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(0,200,224,0.35)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      >
        <div style={{
          width: '30px', height: '30px', borderRadius: '50%',
          background: 'linear-gradient(145deg, #00C8E0 0%, #0094A8 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#05070E', letterSpacing: '0.02em', lineHeight: 1 }}>
            {initials}
          </span>
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          [direction === 'rtl' ? 'left' : 'right']: 0,
          width: showRoleSwitcher ? '240px' : '220px',
          background: '#111826',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '14px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 100,
          overflow: 'hidden',
          animation: 'fadeIn 0.1s ease-out',
        }}>
          {/* User Info */}
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(145deg, #00C8E0 0%, #0094A8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#05070E', lineHeight: 1 }}>{initials}</span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.3, letterSpacing: '-0.01em' }}>{name}</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
              {/* Role badge */}
              {roleMeta && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  marginTop: 4, padding: '2px 7px', borderRadius: 5,
                  background: `${roleMeta.color}15`,
                  border: `1px solid ${roleMeta.color}25`,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: roleMeta.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: roleMeta.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {roleMeta.label}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Role Switcher Panel */}
          {showRoleSwitcher ? (
            <div>
              <div style={{ padding: '8px 16px 4px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Switch Demo Role
              </div>
              <div style={{ padding: '4px' }}>
                {ROLE_SWITCH_OPTIONS.map(opt => (
                  <button
                    key={opt.role}
                    onClick={() => { switchRole(opt.role); setOpen(false); setShowRoleSwitcher(false); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '8px 12px', background: user?.role === opt.role ? `${opt.color}10` : 'transparent',
                      border: 'none', borderRadius: '9px', cursor: 'pointer',
                      color: user?.role === opt.role ? opt.color : 'rgba(255,255,255,0.55)',
                      fontFamily: 'inherit', transition: 'all 0.1s ease',
                    }}
                    onMouseEnter={(e) => { if (user?.role !== opt.role) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; } }}
                    onMouseLeave={(e) => { if (user?.role !== opt.role) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; } }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: user?.role === opt.role ? 700 : 500, flex: 1, textAlign: direction === 'rtl' ? 'right' : 'left' }}>{opt.label}</span>
                    {user?.role === opt.role && <Check size={12} strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '4px' }}>
                <button
                  onClick={() => setShowRoleSwitcher(false)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px', background: 'transparent', border: 'none',
                    borderRadius: '9px', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.35)', fontFamily: 'inherit',
                    fontSize: '12px', fontWeight: 500,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  ← Back
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Menu Items */}
              <div style={{ padding: '4px' }}>
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setOpen(false); onNavigate?.(item.id); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '8px 12px', background: 'transparent', border: 'none',
                        borderRadius: '9px', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.55)', fontFamily: 'inherit',
                        transition: 'all 0.1s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                      }}
                    >
                      <Icon size={14} strokeWidth={1.75} />
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{item.label}</span>
                    </button>
                  );
                })}

                {/* Switch Role — Demo Tool */}
                <button
                  onClick={() => setShowRoleSwitcher(true)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 12px', background: 'transparent', border: 'none',
                    borderRadius: '9px', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.55)', fontFamily: 'inherit',
                    transition: 'all 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                  }}
                >
                  <Shield size={14} strokeWidth={1.75} />
                  <span style={{ fontSize: '13px', fontWeight: 500, flex: 1, textAlign: direction === 'rtl' ? 'right' : 'left' }}>Switch Role</span>
                  <ChevronDown size={11} strokeWidth={2} style={{ transform: 'rotate(-90deg)', opacity: 0.5 }} />
                </button>
              </div>

              {/* Logout */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '4px' }}>
                <button
                  onClick={() => { setOpen(false); onNavigate?.('logout'); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 12px', background: 'transparent', border: 'none',
                    borderRadius: '9px', cursor: 'pointer',
                    color: '#FF2D55', fontFamily: 'inherit',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,45,85,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <LogOut size={14} strokeWidth={1.75} />
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Log Out</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}