// ════════════════════════════════════════════════════════════════
// SOSphere Design System — Enterprise SaaS Components
// Based on web dashboard design-system (Layout.tsx, Card.tsx, etc.)
// Tokens: --sos-* CSS variables (theme.css)
// Typography: Outfit (300–900)
// Spacing: 8 / 16 / 24 / 32 / 48 only
// Radius: Cards 16px | Buttons 12px | Small 8px
// ════════════════════════════════════════════════════════════════

import type { ReactNode, CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

// ═══ DESIGN TOKENS (JS mirror of CSS vars) ═══════════════════

export const TOKENS = {
  bg: {
    primary: "var(--sos-bg-primary)",
    surface: "var(--sos-bg-surface)",
    elevated: "var(--sos-bg-elevated)",
    hover: "var(--sos-bg-hover)",
    active: "var(--sos-bg-active)",
  },
  text: {
    primary: "var(--sos-text-primary)",
    secondary: "var(--sos-text-secondary)",
    muted: "var(--sos-text-muted)",
    disabled: "var(--sos-text-disabled)",
  },
  border: {
    subtle: "var(--sos-border-subtle)",
    default: "var(--sos-border-default)",
    strong: "var(--sos-border-strong)",
  },
  accent: {
    primary: "#00C8E0",
    danger: "#FF2D55",
    warning: "#FF9500",
    success: "#00C853",
    info: "#4A90D9",
  },
  radius: { card: 16, button: 12, small: 8, pill: 999 },
  space: { xs: 8, sm: 16, md: 24, lg: 32, xl: 48 },
  shadow: {
    0: "none",
    1: "0 2px 8px rgba(0,0,0,0.3)",
    2: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.2)",
  },
} as const;

// ═══ TYPOGRAPHY SYSTEM ════════════════════════════════════════
export const TYPOGRAPHY = {
  display: { fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 },
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.2 },
  h2: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.3 },
  h3: { fontSize: 15, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.4 },
  h4: { fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.4 },
  body: { fontSize: 13, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5 },
  bodySm: { fontSize: 12, fontWeight: 400, letterSpacing: "0", lineHeight: 1.5 },
  caption: { fontSize: 11, fontWeight: 500, letterSpacing: "0.01em", lineHeight: 1.4 },
  overline: { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.2, textTransform: "uppercase" as const },
  micro: { fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", lineHeight: 1.2 },
  kpiValue: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums" as const },
  kpiValueSm: { fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" as const },
} as const;

// ═══ LAYOUT CONSTANTS ═════════════════════════════════════════

export const LAYOUT = {
  SIDEBAR_WIDTH: 180,
  CONTENT_MAX_WIDTH: 1280,
  GRID_COLUMNS: 12,
  GRID_GUTTER: 24,
  SECTION_GAP: 32,
} as const;

// ═══ CARD ═════════════════════════════════════════════════════
// Glassmorphism card with optional glow border

export interface CardProps {
  children: ReactNode;
  padding?: number;
  glow?: string; // Accent color for border glow
  elevated?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function Card({ children, padding = 16, glow, elevated, onClick, style, className }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        padding,
        borderRadius: TOKENS.radius.card,
        background: elevated ? TOKENS.bg.elevated : TOKENS.bg.surface,
        border: `1px solid ${glow ? `${glow}20` : TOKENS.border.subtle}`,
        backdropFilter: "blur(16px)",
        boxShadow: glow
          ? `0 0 24px ${glow}08, 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)`
          : "0 1px 2px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.03)",
        cursor: onClick ? "pointer" : undefined,
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ═══ KPI CARD ═════════════════════════════════════════════════

export interface KPICardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  color?: string;
  trend?: { value: string; positive: boolean };
  subtitle?: string;
  onClick?: () => void;
  compact?: boolean;
}

export function KPICard({ label, value, icon: Icon, color = TOKENS.accent.primary, trend, subtitle, onClick, compact }: KPICardProps) {
  return (
    <Card padding={compact ? 14 : 18} onClick={onClick} glow={onClick ? color : undefined}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...TYPOGRAPHY.overline,
            fontSize: compact ? 9 : 10,
            color: TOKENS.text.muted,
            marginBottom: compact ? 6 : 8,
          }}>
            {label}
          </div>
          <div style={{
            ...(compact ? TYPOGRAPHY.kpiValueSm : TYPOGRAPHY.kpiValue),
            color,
          }}>
            {value}
          </div>
          {subtitle && (
            <div style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 6 }}>{subtitle}</div>
          )}
          {trend && (
            <div style={{
              ...TYPOGRAPHY.micro,
              color: trend.positive ? TOKENS.accent.success : TOKENS.accent.danger,
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                borderRadius: 4,
                background: trend.positive ? "rgba(0,200,83,0.12)" : "rgba(255,45,85,0.12)",
                fontSize: 8,
              }}>
                {trend.positive ? "↑" : "↓"}
              </span>
              {trend.value}
            </div>
          )}
        </div>
        {Icon && (
          <div style={{
            width: compact ? 32 : 40,
            height: compact ? 32 : 40,
            borderRadius: compact ? 10 : 12,
            background: `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)`,
            border: `1px solid ${color}20`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <Icon size={compact ? 15 : 19} color={color} strokeWidth={1.8} />
          </div>
        )}
      </div>
    </Card>
  );
}

// ═══ SECTION HEADER ═══════════════════════════════════════════

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  icon?: LucideIcon;
  color?: string;
}

export function SectionHeader({ title, subtitle, action, icon: Icon, color }: SectionHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {Icon && (
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `linear-gradient(135deg, ${color || TOKENS.accent.primary}15 0%, ${color || TOKENS.accent.primary}08 100%)`,
            border: `1px solid ${color || TOKENS.accent.primary}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Icon size={14} color={color || TOKENS.accent.primary} strokeWidth={1.8} />
          </div>
        )}
        <div>
          <div style={{
            ...TYPOGRAPHY.h4,
            color: TOKENS.text.primary,
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            ...TYPOGRAPHY.caption,
            fontWeight: 600,
            color: TOKENS.accent.primary,
            background: "rgba(0,200,224,0.06)",
            border: "1px solid rgba(0,200,224,0.12)",
            cursor: "pointer",
            padding: "5px 12px",
            borderRadius: TOKENS.radius.small,
            transition: "all 0.15s ease",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ═══ PAGE HEADER ══════════════════════════════════════════════
// Enterprise-grade page header with icon, description, and actions

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  color?: string;
  badge?: { label: string; color?: string; pulse?: boolean };
  actions?: ReactNode;
}

export function PageHeader({ title, description, icon: Icon, color = TOKENS.accent.primary, badge, actions }: PageHeaderProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      padding: "20px 24px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      marginBottom: 4,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {Icon && (
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: `linear-gradient(135deg, ${color}20 0%, ${color}08 100%)`,
            border: `1px solid ${color}22`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: `0 4px 16px ${color}10`,
          }}>
            <Icon size={22} color={color} strokeWidth={1.8} />
          </div>
        )}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ ...TYPOGRAPHY.h2, color: TOKENS.text.primary }}>{title}</span>
            {badge && (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 10px",
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 700,
                color: badge.color || color,
                background: `${badge.color || color}12`,
                border: `1px solid ${badge.color || color}20`,
              }}>
                {badge.pulse && (
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: badge.color || color,
                    animation: "pulse 1.5s ease infinite",
                  }} />
                )}
                {badge.label}
              </span>
            )}
          </div>
          {description && (
            <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 4 }}>{description}</p>
          )}
        </div>
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

// ═══ STAT PILL ════════════════════════════════════════════════
// Compact inline stat for dashboards

export function StatPill({ label, value, color = TOKENS.accent.primary }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 12px",
      borderRadius: 20,
      background: `${color}08`,
      border: `1px solid ${color}15`,
    }}>
      <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

// ═══ BADGE ══════════════════════════════���═════════════════════

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "muted";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  color?: string;
  pulse?: boolean;
  size?: "sm" | "md";
}

const BADGE_COLORS: Record<BadgeVariant, string> = {
  default: TOKENS.accent.primary,
  success: TOKENS.accent.success,
  warning: TOKENS.accent.warning,
  danger: TOKENS.accent.danger,
  info: TOKENS.accent.info,
  muted: "rgba(128,144,165,1)",
};

export function Badge({ children, variant = "default", color, pulse, size = "sm" }: BadgeProps) {
  const c = color || BADGE_COLORS[variant];
  const isSm = size === "sm";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: pulse ? 5 : 0,
      padding: isSm ? "3px 8px" : "4px 10px",
      fontSize: isSm ? 9 : 11,
      fontWeight: 700,
      color: c,
      background: `${c}10`,
      border: `1px solid ${c}18`,
      borderRadius: isSm ? 6 : 8,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}>
      {pulse && (
        <span style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: c,
          animation: "pulse 1.5s ease infinite",
          flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  );
}

// ═══ STATUS BADGE ═════════════════════════════════════════════

export interface StatusBadgeProps {
  status: "online" | "offline" | "away" | "busy" | "active" | "inactive";
  label?: string;
  showDot?: boolean;
}

const STATUS_COLORS: Record<StatusBadgeProps["status"], string> = {
  online: TOKENS.accent.success,
  active: TOKENS.accent.success,
  away: TOKENS.accent.warning,
  busy: TOKENS.accent.danger,
  offline: "rgba(128,144,165,1)",
  inactive: "rgba(128,144,165,1)",
};

export function StatusBadge({ status, label, showDot = true }: StatusBadgeProps) {
  const c = STATUS_COLORS[status];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 9,
      fontWeight: 600,
      color: c,
    }}>
      {showDot && (
        <span style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: c,
          flexShrink: 0,
        }} />
      )}
      {label || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ═══ BUTTON ═══════════════════════════════════════════════════

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

const BUTTON_STYLES: Record<ButtonVariant, { bg: string; border: string; color: string; shadow: string }> = {
  primary: {
    bg: "linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)",
    border: "none",
    color: "#FFFFFF",
    shadow: "0 4px 16px rgba(0,200,224,0.25)",
  },
  secondary: {
    bg: "rgba(0,200,224,0.06)",
    border: "1px solid rgba(0,200,224,0.18)",
    color: "#00C8E0",
    shadow: "none",
  },
  danger: {
    bg: "linear-gradient(135deg, #FF2D55 0%, #FF1744 100%)",
    border: "none",
    color: "#FFFFFF",
    shadow: "0 4px 16px rgba(255,45,85,0.25)",
  },
  success: {
    bg: "linear-gradient(135deg, #34C759 0%, #28A745 100%)",
    border: "none",
    color: "#FFFFFF",
    shadow: "0 4px 16px rgba(52,199,89,0.25)",
  },
  ghost: {
    bg: "transparent",
    border: "1px solid var(--sos-border-default)",
    color: "var(--sos-text-secondary)",
    shadow: "none",
  },
};

const BUTTON_SIZES: Record<ButtonSize, { height: number; fontSize: number; padding: string; iconSize: number }> = {
  sm: { height: 32, fontSize: 11, padding: "0 12px", iconSize: 13 },
  md: { height: 40, fontSize: 12, padding: "0 16px", iconSize: 15 },
  lg: { height: 48, fontSize: 13, padding: "0 20px", iconSize: 17 },
};

export function Button({
  children, variant = "primary", size = "md", icon: Icon, iconPosition = "left",
  disabled, loading, fullWidth, onClick, style: extraStyle,
}: ButtonProps) {
  const s = BUTTON_STYLES[variant];
  const sz = BUTTON_SIZES[size];
  const isDisabled = !!disabled || !!loading;

  return (
    <button
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={{
        width: fullWidth ? "100%" : undefined,
        height: sz.height,
        padding: sz.padding,
        borderRadius: TOKENS.radius.button,
        background: isDisabled ? "rgba(128,144,165,0.04)" : s.bg,
        border: isDisabled ? "1px solid rgba(128,144,165,0.10)" : s.border,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        cursor: isDisabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        fontSize: sz.fontSize,
        fontWeight: 700,
        color: isDisabled ? "var(--sos-text-disabled)" : s.color,
        opacity: isDisabled ? 0.5 : 1,
        boxShadow: isDisabled ? "none" : s.shadow,
        transition: "all 0.15s ease",
        ...extraStyle,
      }}
    >
      {Icon && iconPosition === "left" && <Icon size={sz.iconSize} strokeWidth={2} />}
      <span>{children}</span>
      {Icon && iconPosition === "right" && <Icon size={sz.iconSize} strokeWidth={2} />}
    </button>
  );
}

// ═══ ALERT ITEM ═══════════════════════════════════════════════

export interface AlertItemProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  color?: string;
  timestamp?: string;
  unread?: boolean;
  onClick?: () => void;
}

export function AlertItem({ title, subtitle, icon: Icon, color = TOKENS.accent.danger, timestamp, unread, onClick }: AlertItemProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: TOKENS.radius.small,
        background: unread ? `${color}04` : "transparent",
        cursor: onClick ? "pointer" : undefined,
        transition: "background 0.15s ease",
      }}
    >
      {Icon && (
        <div style={{
          width: 28,
          height: 28,
          borderRadius: TOKENS.radius.small,
          background: `${color}12`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}>
          <Icon size={13} color={color} strokeWidth={2} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: unread ? 600 : 500,
          color: unread ? TOKENS.text.primary : TOKENS.text.secondary,
          lineHeight: 1.4,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 10, color: TOKENS.text.muted, marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        {timestamp && (
          <span style={{ fontSize: 9, color: TOKENS.text.muted, fontVariantNumeric: "tabular-nums" }}>{timestamp}</span>
        )}
        {unread && (
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
        )}
      </div>
    </div>
  );
}

// ═══ DIVIDER ══════════════════════════════════════════════════

export function Divider({ spacing = 0, color }: { spacing?: number; color?: string }) {
  return (
    <div style={{
      height: 1,
      background: color || TOKENS.border.subtle,
      margin: `${spacing}px 0`,
    }} />
  );
}

// ═══ SEVERITY CONFIG ══════════════════════════════════════════

export const SEVERITY = {
  critical: { label: "Critical", color: "#FF2D55", bg: "rgba(255,45,85,0.12)", border: "rgba(255,45,85,0.25)" },
  high: { label: "High", color: "#FFB300", bg: "rgba(255,179,0,0.12)", border: "rgba(255,179,0,0.25)" },
  medium: { label: "Medium", color: "#00C8E0", bg: "rgba(0,200,224,0.12)", border: "rgba(0,200,224,0.25)" },
  low: { label: "Low", color: "#8090A5", bg: "rgba(128,144,165,0.12)", border: "rgba(128,144,165,0.25)" },
} as const;

// ═══ EMPTY STATE ══════════════════════════════════════════════
// Reusable component for when a section has no data

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  color?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, color = TOKENS.accent.primary, compact }: EmptyStateProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: compact ? "24px 16px" : "48px 24px",
      textAlign: "center",
    }}>
      {Icon && (
        <div style={{
          width: compact ? 48 : 64,
          height: compact ? 48 : 64,
          borderRadius: compact ? 14 : 18,
          background: `linear-gradient(135deg, ${color}12 0%, ${color}06 100%)`,
          border: `1px solid ${color}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: compact ? 12 : 16,
        }}>
          <Icon size={compact ? 22 : 28} color={color} strokeWidth={1.5} />
        </div>
      )}
      <div style={{
        ...TYPOGRAPHY.h4,
        color: TOKENS.text.secondary,
        marginBottom: 4,
      }}>
        {title}
      </div>
      {description && (
        <p style={{
          ...TYPOGRAPHY.bodySm,
          color: TOKENS.text.muted,
          maxWidth: 280,
          marginTop: 4,
        }}>
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: compact ? 12 : 16,
            padding: "8px 16px",
            borderRadius: TOKENS.radius.button,
            background: `${color}10`,
            border: `1px solid ${color}20`,
            color,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ═══ SKELETON LOADER ══════════════════════════════════════════
// Animated placeholder for loading states

export function Skeleton({ width, height = 16, radius = 6, style }: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div style={{
      width: width ?? "100%",
      height,
      borderRadius: radius,
      background: "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

// ═══ ICON BUTTON ══════════════════════════════════════════════
// Compact icon-only button for toolbars and actions

export interface IconButtonProps {
  icon: LucideIcon;
  onClick?: () => void;
  color?: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "filled" | "outlined";
  tooltip?: string;
  disabled?: boolean;
  badge?: number;
}

export function IconButton({ icon: Icon, onClick, color = TOKENS.text.secondary, size = "md", variant = "ghost", disabled, badge }: IconButtonProps) {
  const sizes = { sm: { box: 28, icon: 13 }, md: { box: 34, icon: 15 }, lg: { box: 40, icon: 18 } };
  const s = sizes[size];
  
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        position: "relative",
        width: s.box,
        height: s.box,
        borderRadius: TOKENS.radius.small,
        background: variant === "filled"
          ? `${color}12`
          : variant === "outlined"
            ? "transparent"
            : "transparent",
        border: variant === "outlined"
          ? `1px solid ${TOKENS.border.default}`
          : variant === "filled"
            ? `1px solid ${color}18`
            : "1px solid transparent",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.15s ease",
        flexShrink: 0,
      }}
    >
      <Icon size={s.icon} color={color} strokeWidth={1.8} />
      {badge !== undefined && badge > 0 && (
        <span style={{
          position: "absolute",
          top: -4,
          right: -4,
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          background: TOKENS.accent.danger,
          color: "#fff",
          fontSize: 9,
          fontWeight: 800,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 4px",
        }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

// ═══ PROGRESS BAR ═════════════════════════════════════════════
// Thin animated progress indicator

export function ProgressBar({ value, max = 100, color = TOKENS.accent.primary, height = 4, showLabel }: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  showLabel?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1,
        height,
        borderRadius: height,
        background: "rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: height,
          background: `linear-gradient(90deg, ${color}, ${color}CC)`,
          transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
        }} />
      </div>
      {showLabel && (
        <span style={{
          ...TYPOGRAPHY.micro,
          color: TOKENS.text.muted,
          minWidth: 32,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}>
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
}