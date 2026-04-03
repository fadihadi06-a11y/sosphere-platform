import { useState, useEffect, useCallback, useRef, type MutableRefObject } from 'react';
import * as LucideIcons from 'lucide-react';
const AlertTriangle = LucideIcons.AlertTriangle;
const Users = LucideIcons.Users;
const Clock = LucideIcons.Clock;
const Activity = LucideIcons.Activity;
const Shield = LucideIcons.Shield;
const CheckCircle = LucideIcons.CheckCircle;
const UserPlus = LucideIcons.UserPlus;
const Zap = LucideIcons.Zap;
const MapPin = LucideIcons.MapPin;
const Phone = LucideIcons.Phone;
const User = LucideIcons.User;
const Briefcase = LucideIcons.Briefcase;
const Plus = LucideIcons.Plus;
const ArrowUp = LucideIcons.ArrowUp;
const Radio = LucideIcons.Radio;
const ShieldCheck = LucideIcons.ShieldCheck;
const Target = LucideIcons.Target;
const Megaphone = LucideIcons.Megaphone;
const Send = LucideIcons.Send;
const Download = LucideIcons.Download;
const Paperclip = LucideIcons.Paperclip;
const Loader2 = LucideIcons.Loader2;
const Siren = LucideIcons.Siren;
const History = LucideIcons.History;
const Cpu = LucideIcons.Cpu;
const Wifi = LucideIcons.Wifi;
const Server = LucideIcons.Server;
const Thermometer = LucideIcons.Thermometer;
const Eye = LucideIcons.Eye;

import { toast } from 'sonner';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Button,
} from '../components/design-system';
import {
  sortByPriority,
  getEmergencyStats,
  type Emergency,
} from '../utils/priorityEngine';
import { EmergencyCreationModal } from '../components/EmergencyCreationModal';
import { ActionConfirmationDialog } from '../components/ActionConfirmationDialog';
import { 
  SkeletonLoader, 
  LoadingSpinner, 
  ErrorState,
  KPICardSkeleton,
  IncidentQueueLoading,
  IncidentDetailsLoading,
} from '../components/LoadingStates';
import { SystemActivityIndicator } from '../components/SystemActivityIndicator';

// ════════════════════════════════════════════════════════════════
// OVERVIEW PAGE — EMERGENCY ENGINE (OPERATIONS VIEW)
// ════════════════════════════════════════════════════════════════
//
// Architecture: operations-page-design.md + alert-handling-guidelines.md
//
// Layout: ALWAYS 3-column grid — NO conditional hide
//   Row 1: 4 KPI filter chips (toggle in-page filter)
//   Row 2: grid 360px 1fr 300px
//     LEFT   = Incident Queue (always visible)
//     CENTER = Incident Details / Empty Content / Filter View
//     RIGHT  = Docked Actions Panel (always visible)
//
// KPI Filter System:
//   Active Incidents → filter queue to unowned
//   SLA Breach       → filter queue to critical/elapsed >2min
//   On Duty          → show on-duty panel in center
//   System Health    → show system health panel in center
//
// Button states (Ownership Lock):
//   UNOWNED  → Primary: Take Ownership  |  rest Disabled
//   OWNED    → Primary: Resolve         |  all Enabled
//   RESOLVED → all Disabled + Export only
// ════════════════════════════════════════════════════════════════

type IncidentAction = 'TAKE' | 'RESOLVE' | 'ASSIGN' | 'DISPATCH' | 'BROADCAST' | 'ESCALATE';
type KpiFilter = 'active' | 'onDuty' | 'slaBreach' | 'systemHealth' | null;

interface OverviewPageProps {
  onNavigate?: (page: string) => void;
  onEnterWallMode?: () => void;
  onCreateEmergency?: () => void;
  allEmergencies: Emergency[];
  activeFocus: Emergency | null;
  queuedItems: Emergency[];
  emergencyTimers: MutableRefObject<Map<string, number>>;
  onTakeOwnership: (id: string) => void;
  onAssignResponder: (id: string) => void;
  onEscalateEmergency: (id: string) => void;
  onBroadcastAlert: (id: string) => void;
  onDispatchTeam: (id: string) => void;
  onResolveEmergency: (id: string) => void;
  onPinAsActive: (id: string) => void;

}

const SEVERITY_CONFIG = {
  critical: { label: 'CRITICAL', labelAr: 'حرج', color: '#FF2D55', bg: 'rgba(255,45,85,0.12)', border: 'rgba(255,45,85,0.25)' },
  high:     { label: 'HIGH',     labelAr: 'عالي', color: '#FFB300', bg: 'rgba(255,179,0,0.12)', border: 'rgba(255,179,0,0.25)' },
  medium:   { label: 'MEDIUM',   labelAr: 'متوسط', color: '#00C8E0', bg: 'rgba(0,200,224,0.12)', border: 'rgba(0,200,224,0.25)' },
  low:      { label: 'LOW',      labelAr: 'منخفض', color: '#8090A5', bg: 'rgba(128,144,165,0.12)', border: 'rgba(128,144,165,0.25)' },
} as const;

const MOCK_TIMELINE = [
  { time: '14:23:05', event: 'SOS triggered by employee', eventAr: 'تم تفعيل SOS من الموظف' },
  { time: '14:23:08', event: 'Alert dispatched to operations', eventAr: 'تم إرسال التنبيه للعمليات' },
  { time: '14:23:12', event: 'GPS location acquired', eventAr: 'تم تحديد موقع GPS' },
  { time: '14:23:45', event: 'Zone C flagged as active', eventAr: 'تم تحديد المنطقة ج كمنطقة نشطة' },
];



const MOCK_ON_DUTY = [
  { name: 'Ahmad R.', nameAr: 'أحمد ر.', role: 'Supervisor', roleAr: 'مشرف', zone: 'Zone A', zoneAr: 'المنطقة أ', status: 'available' as const },
  { name: 'Fatima H.', nameAr: 'فاطمة ح.', role: 'Responder', roleAr: 'مستجيب', zone: 'Zone B', zoneAr: 'المنطقة ب', status: 'responding' as const },
  { name: 'Sara A.', nameAr: 'سارة ع.', role: 'Medic', roleAr: 'مسعف', zone: 'Zone C', zoneAr: 'المنطقة ج', status: 'available' as const },
  { name: 'Khalid M.', nameAr: 'خالد م.', role: 'Security', roleAr: 'أمن', zone: 'Zone A', zoneAr: 'المنطقة أ', status: 'available' as const },
  { name: 'Noor B.', nameAr: 'نور ب.', role: 'Supervisor', roleAr: 'مشرف', zone: 'Zone D', zoneAr: 'المنطقة د', status: 'break' as const },
  { name: 'Hassan T.', nameAr: 'حسن ط.', role: 'Responder', roleAr: 'مستجيب', zone: 'Zone B', zoneAr: 'المنطقة ب', status: 'available' as const },
];

const MOCK_SYSTEM_HEALTH = [
  { name: 'GPS Tracking', nameAr: 'تتبع GPS', status: 'operational' as const, uptime: '99.9%', icon: Wifi },
  { name: 'Alert Engine', nameAr: 'محرك التنبيهات', status: 'operational' as const, uptime: '100%', icon: Siren },
  { name: 'Database', nameAr: 'قاعدة البيانات', status: 'operational' as const, uptime: '99.8%', icon: Server },
  { name: 'Sensor Network', nameAr: 'شبكة المستشعرات', status: 'degraded' as const, uptime: '97.2%', icon: Thermometer },
  { name: 'SMS Gateway', nameAr: 'بوابة الرسائل', status: 'operational' as const, uptime: '99.5%', icon: Send },
  { name: 'Compute Cluster', nameAr: 'خوادم المعالجة', status: 'operational' as const, uptime: '99.9%', icon: Cpu },
];

const ACTION_LABELS: Record<IncidentAction, { en: string; ar: string; successEn: string; successAr: string }> = {
  TAKE:      { en: 'Take Ownership',   ar: 'استلام الحادث',    successEn: 'Ownership taken',              successAr: 'تم استلام الحادث' },
  RESOLVE:   { en: 'Resolve Incident', ar: 'حل الحادث',       successEn: 'Incident resolved',            successAr: 'تم حل الحادث' },
  ASSIGN:    { en: 'Assign Responder', ar: 'تعيين مستجيب',    successEn: 'Responder assigned',           successAr: 'تم تعيين المستجيب' },
  DISPATCH:  { en: 'Dispatch Team',    ar: 'إرسال فريق',      successEn: 'Team dispatched',              successAr: 'تم إرسال الفريق' },
  BROADCAST: { en: 'Broadcast Alert',  ar: 'بث تنبيه',        successEn: 'Alert broadcasted',            successAr: 'تم بث التنبيه' },
  ESCALATE:  { en: 'Escalate',         ar: 'تصعيد',           successEn: 'Incident escalated',           successAr: 'تم تصعيد الحادث' },
};

const formatElapsed = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getTimerColor = (seconds: number) => {
  if (seconds < 30) return '#34C759';
  if (seconds < 120) return '#FFB300';
  return '#FF2D55';
};

// SLA breach threshold = 120s (2 minutes)
const SLA_THRESHOLD_SECONDS = 120;

export default function OverviewPage({
  onNavigate,
  onEnterWallMode,
  onCreateEmergency,
  allEmergencies,
  activeFocus,
  queuedItems,
  emergencyTimers,
  onTakeOwnership,
  onAssignResponder,
  onEscalateEmergency,
  onBroadcastAlert,
  onDispatchTeam,
  onResolveEmergency,
  onPinAsActive,
}: OverviewPageProps) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isAr = language === 'ar';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredChip, setHoveredChip] = useState<string | null>(null);
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);

  // ── State Mapping: Loading & Error States ──
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = sortByPriority(allEmergencies);
  const stats = getEmergencyStats(allEmergencies);
  const hasEmergencies = allEmergencies.length > 0;

  // ── KPI Filter Logic ──
  const getElapsed = (id: string) => emergencyTimers.current.get(id) || 0;

  const slaBreachCount = sorted.filter(e => getElapsed(e.id) >= SLA_THRESHOLD_SECONDS).length;

  const filteredQueue = (() => {
    if (!kpiFilter || kpiFilter === 'onDuty') return sorted;
    // systemHealth filter doesn't affect queue — it highlights the right sidebar card
    if (kpiFilter === 'systemHealth') return sorted;
    if (kpiFilter === 'active') return sorted.filter(e => !e.isOwned);
    if (kpiFilter === 'slaBreach') return sorted.filter(e => getElapsed(e.id) >= SLA_THRESHOLD_SECONDS);
    return sorted;
  })();

  // Toggle KPI filter — click again to deselect
  const toggleKpiFilter = (filter: KpiFilter) => {
    setKpiFilter(prev => prev === filter ? null : filter);
    // Auto-select first item when switching to queue-based filters
    if (filter === 'active' || filter === 'slaBreach') {
      setSelectedId(null); // Will default to activeFocus or first match
    }
  };

  const selectedEmergency = selectedId
    ? allEmergencies.find(e => e.id === selectedId) || activeFocus
    : activeFocus;

  // Auto-select first incident when emergencies exist
  useEffect(() => {
    if (hasEmergencies && !selectedId && !activeFocus && filteredQueue.length > 0) {
      setSelectedId(filteredQueue[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEmergencies, selectedId, activeFocus]);

  // Show center "filter view" panels — only On Duty
  // System Health is NOT shown in center (info lives in right sidebar only — no duplication)
  const showFilterView = kpiFilter === 'onDuty';

  // ── Error Retry Handler ──
  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    // Simulate data reload (in real app: fetch from API)
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  };

  // Action dispatch
  const actionDispatch: Record<IncidentAction, (id: string) => void> = {
    TAKE:      onTakeOwnership,
    RESOLVE:   onResolveEmergency,
    ASSIGN:    onAssignResponder,
    DISPATCH:  onDispatchTeam,
    BROADCAST: onBroadcastAlert,
    ESCALATE:  onEscalateEmergency,
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      /* Fill parent flex column — Layout content area is display:flex flexDirection:column */
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      gap: 0,
    }}>
      {/* ════ SYSTEM ACTIVITY INDICATOR — Mission Control Status ════ */}
      <div style={{
        paddingBottom: 12,
        flexShrink: 0,
      }}>
        <SystemActivityIndicator isAr={isAr} variant="live" updateInterval={8} />
      </div>

      {/* ════ ROW 1: KPI FILTER CHIPS — fixed height row ════ */}
      <div style={{
        display: 'flex',
        gap: 12,
        paddingBottom: 16,
        flexShrink: 0,
        alignItems: 'stretch',
        flexWrap: 'wrap',
      }}>
        <StatusChip
          id="active-incidents"
          icon={<AlertTriangle size={14} strokeWidth={2.5} />}
          label={isAr ? 'حوادث نشطة' : 'Active Incidents'}
          value={stats.unowned.toString()}
          color={stats.unowned > 0 ? '#FF2D55' : '#00C853'}
          pulse={stats.unowned > 0}
          hovered={hoveredChip === 'active-incidents'}
          active={kpiFilter === 'active'}
          onHover={setHoveredChip}
          onClick={() => toggleKpiFilter('active')}
        />
        <StatusChip
          id="on-duty"
          icon={<Users size={14} strokeWidth={2} />}
          label={isAr ? 'في الخدمة' : 'On Duty'}
          value="142"
          color="#00C8E0"
          hovered={hoveredChip === 'on-duty'}
          active={kpiFilter === 'onDuty'}
          onHover={setHoveredChip}
          onClick={() => toggleKpiFilter('onDuty')}
        />
        <StatusChip
          id="sla-breach"
          icon={<Clock size={14} strokeWidth={2} />}
          label={isAr ? 'تجاوز SLA' : 'SLA Breach'}
          value={slaBreachCount.toString()}
          color={slaBreachCount > 0 ? '#FFB300' : '#00C853'}
          hovered={hoveredChip === 'sla-breach'}
          active={kpiFilter === 'slaBreach'}
          onHover={setHoveredChip}
          onClick={() => toggleKpiFilter('slaBreach')}
        />
        <StatusChip
          id="system-health"
          icon={<Activity size={14} strokeWidth={2} />}
          label={isAr ? 'صحة النظام' : 'System Health'}
          value="99.8%"
          color="#00C853"
          hovered={hoveredChip === 'system-health'}
          active={kpiFilter === 'systemHealth'}
          onHover={setHoveredChip}
          onClick={() => toggleKpiFilter('systemHealth')}
        />
      </div>

      {/* ════ ROW 2: 3-COLUMN GRID — ALWAYS VISIBLE ════ */}
      {/* Layout: 1fr | 1.6fr | 1fr (~28% | 44% | 28%) — balanced visual weight */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1.6fr 1fr',
        gridTemplateRows: '1fr',
        gap: 12,
        overflow: 'hidden',
        minHeight: 0,
        alignItems: 'stretch',
      }}>
        {/* ─── LEFT: Incident Queue (ALWAYS visible) ─── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--sos-bg-surface)',
          border: '1px solid var(--sos-border-subtle)',
          borderRadius: 16,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {/* Queue Header */}
          <div style={{
            padding: 16,
            borderBottom: hasEmergencies ? '1px solid var(--sos-border-subtle)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: 'var(--sos-text-primary)',
                letterSpacing: '0.02em', textTransform: 'uppercase',
              }}>
                {isAr ? `قائمة الحوادث (${filteredQueue.length})` : `Incident Queue (${filteredQueue.length})`}
              </span>
              {/* Active filter indicator */}
              {kpiFilter && (kpiFilter === 'active' || kpiFilter === 'slaBreach') && (
                <button
                  onClick={() => setKpiFilter(null)}
                  style={{
                    fontSize: 9, fontWeight: 700, color: '#FFB300',
                    background: 'rgba(255,179,0,0.12)', padding: '2px 8px', borderRadius: 4,
                    border: '1px solid rgba(255,179,0,0.25)', cursor: 'pointer', fontFamily: 'inherit',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}
                >
                  {isAr ? 'مُفلتر ✕' : 'FILTERED ✕'}
                </button>
              )}
            </div>
            <button
              onClick={() => setShowEmergencyModal(true)}
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'rgba(0,200,224,0.10)',
                border: '1px solid rgba(0,200,224,0.20)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
              title={isAr ? 'إضافة حادث' : 'Add Incident'}
            >
              <Plus size={14} color="#00C8E0" strokeWidth={2.5} />
            </button>
          </div>

          {/* Queue List */}
          <div style={{ 
            flex: 1, 
            position: 'relative',
            minHeight: 0,
            overflow: 'hidden',
          }}>
            <div style={{ 
              height: '100%',
              overflowY: 'auto', 
              padding: hasEmergencies ? '8px 8px 16px 8px' : '16px 16px 12px 16px',
            }}>
            {/* State 3: Loading State */}
            {isLoading ? (
              <IncidentQueueLoading isAr={isAr} />
            ) : /* State 4: Error State */
            error ? (
              <ErrorState 
                message={error}
                messageAr={error}
                isAr={isAr}
                onRetry={handleRetry}
                compact
              />
            ) : /* State 2: Active State */
            filteredQueue.length > 0 ? (
              filteredQueue.map((emergency) => {
                const sev = SEVERITY_CONFIG[emergency.severity];
                const elapsed = getElapsed(emergency.id);
                const isSelected = selectedEmergency?.id === emergency.id;
                const isActive = activeFocus?.id === emergency.id;
                const isSlaBreached = elapsed >= SLA_THRESHOLD_SECONDS;

                return (
                  <button
                    key={emergency.id}
                    onClick={() => {
                      setSelectedId(emergency.id);
                      // Clear filter view when selecting an incident
                      if (kpiFilter === 'onDuty') {
                        setKpiFilter(null);
                      }
                    }}
                    style={{
                      width: '100%', padding: 12, borderRadius: 12,
                      background: isSelected 
                        ? 'linear-gradient(90deg, rgba(0,200,224,0.12) 0%, rgba(0,200,224,0.06) 100%)' 
                        : 'transparent',
                      border: isSelected ? '1px solid rgba(0,200,224,0.35)' : '1px solid transparent',
                      borderLeft: isSelected ? '3px solid #00C8E0' : '3px solid transparent',
                      boxShadow: isSelected ? '0 0 16px rgba(0,200,224,0.15), inset 0 0 20px rgba(0,200,224,0.08)' : 'none',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
                      textAlign: isAr ? 'right' : 'left',
                      transition: 'all 0.2s ease', fontFamily: 'inherit', marginBottom: 4,
                      position: 'relative',
                    }}
                  >
                    {/* Row 1 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', background: sev.color, flexShrink: 0,
                          boxShadow: isActive ? `0 0 8px ${sev.color}` : isSelected ? `0 0 6px ${sev.color}` : 'none',
                          animation: isActive && emergency.severity === 'critical' ? 'pulse 1.5s ease infinite' : 'none',
                        }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-primary)', fontFamily: 'monospace' }}>
                          {emergency.id}
                        </span>
                        {isSelected && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: '#00C8E0', background: 'rgba(0,200,224,0.15)',
                            padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                            border: '1px solid rgba(0,200,224,0.3)',
                          }}>
                            {isAr ? 'محدد' : 'FOCUSED'}
                          </span>
                        )}
                        {isActive && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: sev.color, background: sev.bg,
                            padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            {isAr ? 'نشط' : 'ACTIVE'}
                          </span>
                        )}
                        {isSlaBreached && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: '#FF2D55', background: 'rgba(255,45,85,0.12)',
                            padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            SLA
                          </span>
                        )}
                        {emergency.manualPriority !== undefined && (
                          <ArrowUp size={10} color="#FFB300" strokeWidth={3} />
                        )}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: getTimerColor(elapsed), fontFamily: 'monospace' }}>
                        {formatElapsed(elapsed)}
                      </span>
                    </div>
                    {/* Row 2 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
                        {isAr ? (emergency as any).employeeNameAr : (emergency as any).employeeName}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
                        {isAr ? (emergency as any).zoneAr : (emergency as any).zone}
                      </span>
                    </div>
                    {/* Row 3 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: sev.color, background: sev.bg,
                        padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        {isAr ? sev.labelAr : sev.label}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
                        {isAr ? (emergency as any).reportTypeLabelAr : (emergency as any).reportTypeLabel}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : hasEmergencies ? (
              /* State 1: Empty (Filtered) — all incidents filtered out (compact) */
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column',
                alignItems: 'center', 
                gap: 8,
              }}>
                <Clock size={20} color="var(--sos-text-muted)" strokeWidth={1.5} />
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', textAlign: 'center' }}>
                  {isAr ? 'لا توجد حوادث مطابقة للفلتر' : 'No incidents match this filter'}
                </div>
                <button
                  onClick={() => setKpiFilter(null)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: '#00C8E0',
                    background: 'rgba(0,200,224,0.08)', border: '1px solid rgba(0,200,224,0.15)',
                    borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {isAr ? 'مسح الفلتر' : 'Clear Filter'}
                </button>
              </div>
            ) : (
              /* State 1: Empty (No Data) — No emergencies at all */
              <div style={{ 
                display: 'flex', 
                alignItems: 'center',
                gap: 10,
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(0,200,83,0.08)',
                  border: '1px solid rgba(0,200,83,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <CheckCircle size={16} color="#00C853" strokeWidth={2} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: 11, 
                    fontWeight: 600, 
                    color: 'var(--sos-text-muted)',
                  }}>
                    {isAr ? '✓ النظام يعمل بشكل طبيعي' : '✓ System monitoring active'}
                  </div>
                </div>
              </div>
            )}
            </div>
            {/* Bottom fade indicator — only show when there are emergencies */}
            {hasEmergencies && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 8,
              right: 8,
              height: 2,
              background: 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)',
              pointerEvents: 'none',
            }} />
            )}
          </div>
        </div>

        {/* ─── CENTER: Content Area ─── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--sos-bg-surface)',
          border: '1px solid var(--sos-border-subtle)',
          borderRadius: 16,
          minWidth: 0,
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}> 
          {/* State 3: Loading */}
          {isLoading ? (
            <IncidentDetailsLoading isAr={isAr} />
          ) : /* State 4: Error */
          error ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <ErrorState 
                message="Unable to load incident details"
                messageAr="فشل تحميل تفاصيل الحادث"
                isAr={isAr}
                onRetry={handleRetry}
              />
            </div>
          ) : /* State 2: Active / State 1: Empty */
          showFilterView ? (
            <OnDutyPanel isAr={isAr} />
          ) : selectedEmergency && !showFilterView ? (
            <IncidentCenterContent
              emergency={selectedEmergency}
              elapsed={getElapsed(selectedEmergency.id)}
              isAr={isAr}
            />
          ) : (
            <CenterEmptyContent isAr={isAr} onCreateEmergency={() => setShowEmergencyModal(true)} onNavigate={onNavigate} hasEmergencies={hasEmergencies} />
          )}
        </div>

        {/* ─── RIGHT: Always-Visible 4-Card Sidebar ─── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}>
          <RightSidebarPanel
            isAr={isAr}
            onNavigate={onNavigate}
            selectedEmergency={selectedEmergency && !showFilterView ? selectedEmergency : null}
            getElapsed={getElapsed}
            actionDispatch={actionDispatch}
            kpiFilter={kpiFilter}
          />
        </div>
      </div>

      {/* Emergency Creation Modal */}
      {showEmergencyModal && (
        <EmergencyCreationModal
          onClose={() => setShowEmergencyModal(false)}
          onSubmit={(data) => {
            // Handle submission
            console.log('Emergency created:', data);
            onCreateEmergency?.();
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// STATUS CHIP — Interactive filter button with active state
// ════════════════════════════════════════════════════════════════
function StatusChip({
  id, icon, label, value, color, pulse, hovered, active, onHover, onClick,
}: {
  id: string;
  icon: React.ReactNode; label: string; value: string; color: string; pulse?: boolean;
  hovered?: boolean;
  active?: boolean;
  onHover?: (id: string | null) => void;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover?.(id)}
      onMouseLeave={() => onHover?.(null)}
      style={{
        flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 14px',
        minWidth: 140, height: 64,
        background: active ? `${color}12` : 'var(--sos-bg-surface)',
        border: `1px solid ${active ? `${color}50` : hovered ? `${color}40` : 'var(--sos-border-subtle)'}`,
        borderRadius: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease, border-color 0.15s ease',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0px)',
        boxShadow: active ? `0 4px 16px ${color}20, inset 0 0 0 1px ${color}15` : hovered ? `0 6px 20px ${color}15` : 'none',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `${color}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--sos-text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          textAlign: 'left',
        }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {pulse && (
            <div style={{ width: 6, height: 6, flexShrink: 0 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', background: color,
                animation: 'pulse 1.5s ease infinite',
              }} />
            </div>
          )}
          <span style={{
            fontSize: 16, fontWeight: 700, color,
            fontFamily: 'monospace', letterSpacing: '-0.02em', lineHeight: 1,
          }}>
            {value}
          </span>
        </div>
      </div>
      {/* Active filter indicator dot */}
      {active && (
        <div style={{
          width: 6, height: 6, borderRadius: '50%', background: color,
          marginLeft: 'auto', flexShrink: 0,
          boxShadow: `0 0 6px ${color}`,
        }} />
      )}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════
// CENTER: INCIDENT DETAILS (Summary + Context + Timeline)
// ════════════════════════════════════════════════════════════════
function IncidentCenterContent({
  emergency, elapsed, isAr,
}: {
  emergency: Emergency;
  elapsed: number;
  isAr: boolean;
}) {
  const sev = SEVERITY_CONFIG[emergency.severity];
  const isOwned = !!emergency.isOwned;
  const isSlaBreached = elapsed >= SLA_THRESHOLD_SECONDS;

  return (
    <div style={{
      overflowY: 'auto',
      minWidth: 0, minHeight: 0,
      flex: 1,
      height: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: 16,
    }}>
      {/* CARD 1: SUMMARY */}
      <div style={{
        padding: '16px 20px',
        background: `linear-gradient(135deg, ${sev.bg} 0%, rgba(11,15,26,0.98) 100%)`,
        border: `1px solid ${sev.border}`,
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        {/* Header row: Icon + ID + Badges + Timer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: sev.bg, border: `1px solid ${sev.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={20} color={sev.color} strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)', letterSpacing: '-0.01em' }}>
                  {emergency.id}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: sev.color, background: sev.bg,
                  padding: '3px 8px', borderRadius: 6, border: `1px solid ${sev.border}`,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {isAr ? sev.labelAr : sev.label}
                </span>
                {isOwned && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#00C853',
                    background: 'rgba(0,200,83,0.12)', padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(0,200,83,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {isAr ? 'مُستلَم' : 'OWNED'}
                  </span>
                )}
                {isSlaBreached && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#FF2D55',
                    background: 'rgba(255,45,85,0.12)', padding: '3px 8px', borderRadius: 6,
                    border: '1px solid rgba(255,45,85,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em',
                    animation: 'pulse 2s ease infinite',
                  }}>
                    {isAr ? 'تجاوز SLA' : 'SLA BREACH'}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
                {isAr ? (emergency as any).reportTypeLabelAr : (emergency as any).reportTypeLabel}
              </span>
            </div>
          </div>

          {/* SLA Timer */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: 'var(--sos-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {isAr ? 'وقت الاستجابة' : 'Response Time'}
            </span>
            <span style={{
              fontSize: 28, fontWeight: 800, color: getTimerColor(elapsed),
              fontFamily: 'monospace', letterSpacing: '0.02em', lineHeight: 1,
            }}>
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>

        {/* Employee + Detail row */}
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${sev.color}`, flexShrink: 0,
            }}>
              <User size={20} color="#FFFFFF" strokeWidth={2} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                {isAr ? (emergency as any).employeeNameAr : (emergency as any).employeeName}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', fontFamily: 'monospace' }}>
                {(emergency as any).employeeId}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', flex: 1.5 }}>
            <InfoRow icon={<Briefcase size={12} color="#00C8E0" strokeWidth={2} />} label={isAr ? 'القسم' : 'Dept'} value={isAr ? (emergency as any).departmentAr : (emergency as any).department} />
            <InfoRow icon={<MapPin size={12} color="#00C8E0" strokeWidth={2} />} label={isAr ? 'المنطقة' : 'Zone'} value={isAr ? (emergency as any).zoneAr : (emergency as any).zone} />
            <InfoRow icon={<Phone size={12} color="#4A90D9" strokeWidth={2} />} label={isAr ? 'الهاتف' : 'Phone'} value={isOwned ? ((emergency as any).phone || '—') : (isAr ? 'مقفل' : 'Locked')} locked={!isOwned} />
            <InfoRow icon={<Clock size={12} color="#FFB300" strokeWidth={2} />} label={isAr ? 'البلاغ' : 'Reported'} value={emergency.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} />
          </div>
        </div>
      </div>

      {/* CARD 2: CONTEXT (Map placeholder) */}
      <Card padding={20}>
        <SectionTitle text={isAr ? 'سياق الحادث' : 'Incident Context'} />
        <div style={{
          padding: 20,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--sos-border-subtle)',
          borderRadius: 12,
          height: 140,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}>
          <MapPin size={24} color="var(--sos-text-muted)" strokeWidth={1.5} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-muted)' }}>
            {isAr ? `المنطقة المتأثرة: ${(emergency as any).zoneAr}` : `Affected Area: ${(emergency as any).zone}`}
          </span>
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--sos-text-disabled)' }}>
            {isAr ? 'خريطة GPS في انتظار الربط' : 'GPS map integration pending'}
          </span>
        </div>
      </Card>

      {/* CARD 3: TIMELINE */}
      <Card padding={20}>
        <SectionTitle text={isAr ? 'الجدول الزمني' : 'Timeline'} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {MOCK_TIMELINE.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: i === 0 ? '#00C8E0' : 'var(--sos-border-default)',
                  flexShrink: 0, marginTop: 4,
                }} />
                {i < MOCK_TIMELINE.length - 1 && (
                  <div style={{ width: 1, flex: 1, background: 'var(--sos-border-subtle)', marginTop: 4 }} />
                )}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sos-text-secondary)' }}>
                    {isAr ? entry.eventAr : entry.event}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sos-text-muted)', fontFamily: 'monospace' }}>
                    {entry.time}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// DockedActionsPanel removed — merged into RightSidebarPanel

// ════════════════════════════════════════════════════════════════
// CENTER EMPTY CONTENT — When no incident selected
// Quick Actions + Today's Activity + Recent Resolved
// ════════════════════════════════════════════════════════════════
function CenterEmptyContent({
  isAr, onCreateEmergency, onNavigate, hasEmergencies = false,
}: {
  isAr: boolean; onCreateEmergency?: () => void; onNavigate?: (page: string) => void; hasEmergencies?: boolean;
}) {
  return (
    <div style={{
      overflowY: 'auto',
      minWidth: 0, minHeight: 0,
      flex: 1,
      height: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: 16,
    }}>
      {/* Show "No Active Emergencies" only when queue is empty */}
      {!hasEmergencies && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, padding: 20,
          background: 'rgba(10,10,15,0.4)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(0,200,83,0.08)', border: '2px solid rgba(0,200,83,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <ShieldCheck size={22} color="#00C853" strokeWidth={1.5} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', margin: '0 0 4px 0', lineHeight: 1.3 }}>
              {isAr ? 'لا توجد حوادث نشطة' : 'No Active Emergencies'}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)', margin: 0, lineHeight: 1.4 }}>
              {isAr
                ? 'جميع الأنظمة مستقرة. مركز القيادة يراقب.'
                : 'All systems stable. Command center monitoring.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="danger" size="sm" icon={AlertTriangle} iconPosition="left" onClick={() => onCreateEmergency?.()}>
              {isAr ? 'إنشاء طوارئ' : 'Create Emergency'}
            </Button>
            <Button variant="secondary" size="sm" icon={History} iconPosition="left" onClick={() => onNavigate?.('incidentHistory')}>
              {isAr ? 'سجل الحوادث' : 'View History'}
            </Button>
          </div>
        </div>
      )}

      {/* Show "Select Incident" when queue has items but none selected */}
      {hasEmergencies && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: 20,
          background: 'rgba(10,10,15,0.4)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(255,45,85,0.08)', border: '2px solid rgba(255,45,85,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Target size={22} color="#FF2D55" strokeWidth={1.5} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sos-text-primary)', margin: '0 0 4px 0', lineHeight: 1.3 }}>
              {isAr ? 'اختر حادث لعرض التفاصيل' : 'Select Incident for Details'}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)', margin: 0, lineHeight: 1.4 }}>
              {isAr
                ? 'اختر حادثاً من القائمة اليسرى لعرض التفاصيل الكاملة'
                : 'Choose an incident from the left queue to view full details'}
            </div>
          </div>
        </div>
      )}

      {/* Today's Activity */}
        <div style={{ flexShrink: 0 }}>
        <Card padding={20}>
          <SectionTitle text={isAr ? 'نشاط اليوم' : "Today's Activity"} />
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: -8 }}>
            {[
              { icon: <CheckCircle size={14} color="#00C853" strokeWidth={2} />, text: isAr ? 'حوادث محلولة' : 'Incidents resolved', time: '—' },
              { icon: <Users size={14} color="#00C8E0" strokeWidth={2} />, text: isAr ? 'موظفون في الخدمة' : 'Employees on duty', time: '—' },
              { icon: <Activity size={14} color="#34C759" strokeWidth={2} />, text: isAr ? 'معدل الاستجابة' : 'Response rate', time: '—' },
            ].map((item, i, arr) => (
              <div key={i}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: i === 0 ? '0 0 12px 0' : '12px 0' 
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {item.icon}
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--sos-text-secondary)', lineHeight: 1.5 }}>{item.text}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--sos-text-muted)', lineHeight: 1.5 }}>{item.time}</span>
                </div>
                {i < arr.length - 1 && <div style={{ height: 1, background: 'rgba(255,255,255,0.04)' }} />}
              </div>
            ))}
          </div>
        </Card>
        </div>

      {/* Recent Resolved — Clean empty state */}
        <div style={{ flexShrink: 0 }}>
        <Card padding={20}>
          <SectionTitle text={isAr ? 'آخر الحوادث المحلولة' : 'Recently Resolved'} />
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 8, padding: '12px 0 4px 0',
          }}>
            <CheckCircle size={20} color="var(--sos-text-muted)" strokeWidth={1.5} style={{ opacity: 0.5 }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)', textAlign: 'center' }}>
              {isAr ? 'لا توجد حوادث محلولة اليوم' : 'No resolved incidents today'}
            </span>
          </div>
        </Card>
        </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// RIGHT SIDEBAR PANEL — Always visible 2-card layout
// Card 1: Quick Actions (context-aware)
// Card 2: System Health (linked to KPI chip)
// ════════════════════════════════════════════════════════════════
function RightSidebarPanel({
  isAr, onNavigate,
  selectedEmergency, getElapsed, actionDispatch, kpiFilter,
}: {
  isAr: boolean; onNavigate?: (page: string) => void;
  selectedEmergency: Emergency | null;
  getElapsed: (id: string) => number;
  actionDispatch: Record<IncidentAction, (id: string) => void>;
  kpiFilter?: KpiFilter;
}) {
  const [loadingAction, setLoadingAction] = useState<IncidentAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<IncidentAction | null>(null);

  // ── System Health card ref for scroll-into-view ──
  const systemHealthRef = useRef<HTMLDivElement>(null);
  const isHealthActive = kpiFilter === 'systemHealth';

  // Scroll to System Health card when KPI chip is activated
  useEffect(() => {
    if (isHealthActive && systemHealthRef.current) {
      systemHealthRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isHealthActive]);

  const isOwned = selectedEmergency ? !!selectedEmergency.isOwned : false;
  const isResolved = selectedEmergency ? (selectedEmergency as any).status === 'resolved' : false;

  const requiresConfirmation = (action: IncidentAction): boolean => {
    return ['BROADCAST', 'DISPATCH', 'ESCALATE', 'RESOLVE'].includes(action);
  };

  const handleAction = useCallback(async (action: IncidentAction) => {
    if (loadingAction || !selectedEmergency) return;
    if (requiresConfirmation(action)) {
      setConfirmAction(action);
      return;
    }
    executeAction(action);
  }, [loadingAction, selectedEmergency]);

  const executeAction = useCallback(async (action: IncidentAction) => {
    if (!selectedEmergency) return;
    const labels = ACTION_LABELS[action];
    setLoadingAction(action);
    setConfirmAction(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 400));
      actionDispatch[action](selectedEmergency.id);
      toast.success(isAr ? labels.successAr : labels.successEn);
    } catch (e) {
      toast.error(isAr ? 'فشلت العملية. حاول مرة أخرى.' : 'Action failed. Please try again.');
    } finally {
      setLoadingAction(null);
    }
  }, [selectedEmergency, actionDispatch, isAr]);

  const getConfirmationConfig = (action: IncidentAction | null) => {
    if (!action || !selectedEmergency) return null;
    const config = {
      BROADCAST: {
        title: isAr ? 'تأكيد بث التنبيه' : 'Confirm Broadcast Alert',
        message: isAr
          ? `سيتم إرسال تنبيه طوارئ لجميع الموظفين في ${(selectedEmergency as any).zoneAr}. هل أنت متأكد؟`
          : `This will send an emergency alert to all employees in ${(selectedEmergency as any).zone}. Are you sure?`,
        confirmLabel: isAr ? 'بث التنبيه' : 'Send Alert',
        variant: 'danger' as const,
      },
      DISPATCH: {
        title: isAr ? 'تأكيد إرسال الفريق' : 'Confirm Team Dispatch',
        message: isAr
          ? `سيتم تحريك فريق الطوارئ إلى ${(selectedEmergency as any).zoneAr}. هل أنت متأكد؟`
          : `This will mobilize emergency response team to ${(selectedEmergency as any).zone}. Are you sure?`,
        confirmLabel: isAr ? 'إرسال الفريق' : 'Dispatch Team',
        variant: 'warning' as const,
      },
      ESCALATE: {
        title: isAr ? 'تأكيد التصعيد' : 'Confirm Escalation',
        message: isAr
          ? 'سيتم تصعيد هذا الحادث إلى السلطة الأعلى. هل أنت متأكد؟'
          : 'This will escalate the incident to higher authority. Are you sure?',
        confirmLabel: isAr ? 'تصعيد' : 'Escalate',
        variant: 'warning' as const,
      },
      RESOLVE: {
        title: isAr ? 'تأكيد حل الحادث' : 'Confirm Resolution',
        message: isAr
          ? 'سيتم وضع علامة على هذا الحادث كمحلول. هل أنت متأكد؟'
          : 'This will mark the incident as resolved. Are you sure?',
        confirmLabel: isAr ? 'حل الحادث' : 'Resolve',
        variant: 'info' as const,
      },
    };
    return config[action as keyof typeof config] || null;
  };

  const confirmConfig = getConfirmationConfig(confirmAction);

  return (
    <div style={{
      overflowY: 'auto',
      minWidth: 0, minHeight: 0,
      flex: 1,
      height: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 10,
    }}>
      {/* ═══ CARD 1: Quick Actions ═══ */}
      <div style={{
        padding: 12,
        background: 'rgba(10,10,15,0.4)',
        border: `1px solid ${selectedEmergency ? 'rgba(0,200,224,0.12)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionTitle text={isAr ? 'إجراءات سريعة' : 'Quick Actions'} />
          {selectedEmergency && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#00C8E0',
              background: 'rgba(0,200,224,0.12)', padding: '2px 6px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              border: '1px solid rgba(0,200,224,0.25)',
              marginTop: -8,
            }}>
              {selectedEmergency.id}
            </span>
          )}
        </div>

        {/* Incident-specific actions when an emergency is selected */}
        {selectedEmergency ? (
          <>
            {/* Ownership indicator */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 8,
              background: isOwned ? 'rgba(0,200,83,0.06)' : 'rgba(255,179,0,0.06)',
              border: `1px solid ${isOwned ? 'rgba(0,200,83,0.15)' : 'rgba(255,179,0,0.15)'}`,
            }}>
              {isOwned ? (
                <ShieldCheck size={14} color="#00C853" strokeWidth={2} />
              ) : (
                <Shield size={14} color="#FFB300" strokeWidth={2} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isOwned ? '#00C853' : '#FFB300' }}>
                  {isOwned ? (selectedEmergency.ownedBy || 'Admin') : (isAr ? 'بدون مالك' : 'Unassigned')}
                </div>
                <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
                  {isOwned ? (isAr ? 'مستلم' : 'Owner assigned') : (isAr ? 'في انتظار الاستلام' : 'Awaiting ownership')}
                </div>
              </div>
              {/* SLA Timer */}
              <span style={{
                fontSize: 13, fontWeight: 800,
                color: getTimerColor(getElapsed(selectedEmergency.id)),
                fontFamily: 'monospace', lineHeight: 1,
              }}>
                {formatElapsed(getElapsed(selectedEmergency.id))}
              </span>
            </div>

            {/* Primary Action */}
            {!isOwned ? (
              <ActionButton
                label={isAr ? ACTION_LABELS.TAKE.ar : ACTION_LABELS.TAKE.en}
                icon={<CheckCircle size={14} strokeWidth={2.5} />}
                variant="primary-green"
                loading={loadingAction === 'TAKE'}
                disabled={isResolved}
                onClick={() => handleAction('TAKE')}
              />
            ) : (
              <ActionButton
                label={isAr ? ACTION_LABELS.RESOLVE.ar : ACTION_LABELS.RESOLVE.en}
                icon={<CheckCircle size={14} strokeWidth={2.5} />}
                variant="primary-cyan"
                loading={loadingAction === 'RESOLVE'}
                disabled={isResolved}
                onClick={() => handleAction('RESOLVE')}
              />
            )}

            {/* Secondary Actions — compact grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <SmallActionBtn
                label={isAr ? 'تعيين' : 'Assign'}
                icon={<UserPlus size={12} strokeWidth={2} />}
                color="#00C8E0"
                disabled={!isOwned || isResolved}
                loading={loadingAction === 'ASSIGN'}
                onClick={() => handleAction('ASSIGN')}
              />
              <SmallActionBtn
                label={isAr ? 'بث' : 'Broadcast'}
                icon={<Megaphone size={12} strokeWidth={2} />}
                color="#FF2D55"
                disabled={!isOwned || isResolved}
                loading={loadingAction === 'BROADCAST'}
                onClick={() => handleAction('BROADCAST')}
              />
              <SmallActionBtn
                label={isAr ? 'إرسال' : 'Dispatch'}
                icon={<Send size={12} strokeWidth={2} />}
                color="#FFB300"
                disabled={!isOwned || isResolved}
                loading={loadingAction === 'DISPATCH'}
                onClick={() => handleAction('DISPATCH')}
              />
              <SmallActionBtn
                label={isAr ? 'تصعيد' : 'Escalate'}
                icon={<Zap size={12} strokeWidth={2} />}
                color="#FFB300"
                disabled={!isOwned || isResolved}
                loading={loadingAction === 'ESCALATE'}
                onClick={() => handleAction('ESCALATE')}
              />
            </div>

            {/* Lock notice */}
            {!isOwned && !isResolved && (
              <div style={{
                fontSize: 9, fontWeight: 500, color: 'var(--sos-text-muted)',
                textAlign: 'center', lineHeight: 1.4,
              }}>
                {isAr ? 'استلم الحادث أولاً لتفعيل الإجراءات' : 'Take ownership to enable actions'}
              </div>
            )}
          </>
        ) : (
          /* Navigation actions when no emergency is selected */
          <>
            <button
              onClick={() => onNavigate?.('incidentHistory')}
              style={{
                width: '100%', height: 34, borderRadius: 10,
                background: 'rgba(0,200,224,0.06)',
                border: '1px solid rgba(0,200,224,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                color: '#00C8E0', transition: 'all 0.15s ease',
                overflow: 'hidden', whiteSpace: 'nowrap' as const,
              }}
            >
              <History size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{isAr ? 'سجل الحوادث' : 'View History'}</span>
            </button>
            <button
              onClick={() => onNavigate?.('employees')}
              style={{
                width: '100%', height: 34, borderRadius: 10,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--sos-border-default)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                color: 'var(--sos-text-muted)', transition: 'all 0.15s ease',
                overflow: 'hidden', whiteSpace: 'nowrap' as const,
              }}
            >
              <Users size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{isAr ? 'إدارة الموظفين' : 'Manage Employees'}</span>
            </button>
            <button
              onClick={() => onNavigate?.('riskMapLive')}
              style={{
                width: '100%', height: 34, borderRadius: 10,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--sos-border-default)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                color: 'var(--sos-text-muted)', transition: 'all 0.15s ease',
                overflow: 'hidden', whiteSpace: 'nowrap' as const,
              }}
            >
              <Eye size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{isAr ? 'خريطة المخاطر' : 'Risk Map'}</span>
            </button>
          </>
        )}
      </div>

      {/* ═══ CARD 2: System Health — Linked to KPI chip ═══ */}
      <div
        ref={systemHealthRef}
        style={{
          padding: 16,
          background: isHealthActive ? 'rgba(0,200,83,0.04)' : 'rgba(10,10,15,0.4)',
          border: `1px solid ${isHealthActive ? 'rgba(0,200,83,0.30)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: isHealthActive ? 10 : 12,
          flexShrink: 0,
          transition: 'all 0.3s ease',
          boxShadow: isHealthActive ? '0 0 20px rgba(0,200,83,0.08), 0 0 40px rgba(0,200,83,0.04)' : 'none',
        }}
      >
        {/* Header row: title + overall % */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionTitle text={isAr ? 'صحة النظام' : 'SYSTEM HEALTH'} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            marginTop: -8,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: '#00C853',
              animation: 'pulse 3s ease infinite',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#00C853', fontFamily: 'monospace' }}>
              99.8%
            </span>
          </div>
        </div>

        {/* Overall status line */}
        <div style={{
          fontSize: 10, fontWeight: 500, color: 'rgba(0,200,83,0.7)',
          marginTop: -6,
          letterSpacing: '0.02em',
        }}>
          {isAr ? 'جميع الخدمات تعمل' : 'All services operational'}
        </div>

        {/* Service rows — show 4 normally, all 6 when active */}
        {(isHealthActive ? MOCK_SYSTEM_HEALTH : MOCK_SYSTEM_HEALTH.slice(0, 4)).map((s, i) => {
          const ServiceIcon = s.icon;
          const statusColor = s.status === 'operational' ? '#00C853' : s.status === 'degraded' ? '#FFB300' : '#FF2D55';
          const isExtra = i >= 4; // Extra services only visible when expanded
          return (
            <div key={`health-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: isHealthActive ? '6px 8px' : 0,
              background: isHealthActive ? `${statusColor}08` : 'transparent',
              borderRadius: 8,
              transition: 'all 0.25s ease',
              opacity: isExtra ? 0.9 : 1,
            }}>
              {isHealthActive ? (
                <ServiceIcon size={13} color={statusColor} strokeWidth={2} style={{ flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: statusColor, flexShrink: 0,
                }} />
              )}
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: isHealthActive ? 'var(--sos-text-primary)' : 'var(--sos-text-secondary)',
                flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {isAr ? s.nameAr : s.name}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {isHealthActive && (
                  <div style={{
                    width: 5, height: 5, borderRadius: '50%', background: statusColor,
                  }} />
                )}
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: statusColor, fontFamily: 'monospace',
                  flexShrink: 0,
                }}>
                  {s.uptime}
                </span>
              </div>
            </div>
          );
        })}

        {/* Expanded footer — only when active */}
        {isHealthActive && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 8,
            borderTop: '1px solid rgba(0,200,83,0.12)',
            marginTop: 2,
          }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {isAr ? `${MOCK_SYSTEM_HEALTH.length} خدمة مراقبة` : `${MOCK_SYSTEM_HEALTH.length} services monitored`}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#00C853', letterSpacing: '0.02em' }}>
              {isAr ? 'مباشر' : 'LIVE'}
            </span>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmConfig && (
        <ActionConfirmationDialog
          isOpen={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => confirmAction && executeAction(confirmAction)}
          title={confirmConfig.title}
          message={confirmConfig.message}
          confirmLabel={confirmConfig.confirmLabel}
          cancelLabel={isAr ? 'إلغاء' : 'Cancel'}
          variant={confirmConfig.variant}
          loading={!!loadingAction}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SMALL ACTION BUTTON — Compact 2-column grid variant
// ════════════════════════════════════════════════════════════════
function SmallActionBtn({
  label, icon, color, disabled, loading, onClick,
}: {
  label: string; icon: React.ReactNode; color: string;
  disabled?: boolean; loading?: boolean; onClick?: () => void;
}) {
  const isDisabled = !!disabled || !!loading;
  return (
    <button
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={{
        height: 32, borderRadius: 8,
        background: isDisabled ? 'rgba(128,144,165,0.04)' : `${color}0F`,
        border: `1px solid ${isDisabled ? 'rgba(128,144,165,0.10)' : `${color}30`}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
        color: isDisabled ? 'var(--sos-text-disabled)' : color,
        opacity: isDisabled ? 0.45 : 1,
        transition: 'all 0.15s ease',
      }}
    >
      {loading ? (
        <Loader2 size={12} strokeWidth={2.5} style={{ animation: 'spin 1s linear infinite' }} />
      ) : icon}
      <span>{label}</span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════
// ON DUTY PANEL — Full center panel when KPI "On Duty" is active
// ════════════════════════════════════════════════════════════════
function OnDutyPanel({ isAr }: { isAr: boolean }) {
  const statusConfig = {
    available: { label: isAr ? 'متاح' : 'Available', color: '#00C853' },
    responding: { label: isAr ? 'مستجيب' : 'Responding', color: '#FFB300' },
    break: { label: isAr ? 'استراحة' : 'On Break', color: '#8090A5' },
  };

  return (
    <div style={{
      overflowY: 'auto',
      minWidth: 0, minHeight: 0,
      flex: 1,
      height: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: 16,
    }}>
      {/* Summary Header */}
      <div style={{
        padding: '16px 20px',
        background: 'rgba(0,200,224,0.06)',
        border: '1px solid rgba(0,200,224,0.15)',
        borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'rgba(0,200,224,0.12)', border: '1px solid rgba(0,200,224,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Users size={20} color="#00C8E0" strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              {isAr ? 'الموظفون في الخدمة' : 'On-Duty Personnel'}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
              {isAr ? '142 موظف — وردية الصباح' : '142 employees — Morning Shift'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: isAr ? 'متاح' : 'Available', count: 98, color: '#00C853' },
            { label: isAr ? 'مستجيب' : 'Responding', count: 12, color: '#FFB300' },
            { label: isAr ? 'استراحة' : 'Break', count: 32, color: '#8090A5' },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'monospace' }}>{s.count}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Employee List — structural wrapper only, no visual card styling */}
      <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <SectionTitle text={isAr ? 'قائمة الموظفين' : 'Personnel List'} />
      {MOCK_ON_DUTY.map((emp, i) => {
        const sc = statusConfig[emp.status];
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
            borderBottom: i < MOCK_ON_DUTY.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <User size={16} color="#FFFFFF" strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                {isAr ? emp.nameAr : emp.name}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
                {isAr ? emp.roleAr : emp.role} · {isAr ? emp.zoneAr : emp.zone}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc.color }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: sc.color }}>
                {sc.label}
              </span>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// SystemHealthPanel REMOVED — System Health info lives exclusively in right sidebar card
// Clicking "System Health" KPI chip now highlights the sidebar card border only

// ════════════════════════════════════════════════════════════════
// ACTION BUTTON — With loading spinner support
// ════════════════════════════════════════════════════════════════
function ActionButton({
  label, icon, variant, disabled, loading, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  variant: 'primary-green' | 'primary-cyan' | 'secondary-cyan' | 'secondary-warning' | 'secondary-danger';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const styles = {
    'primary-green': {
      height: 44,
      bg: 'linear-gradient(135deg, #34C759 0%, #28A745 100%)',
      border: 'none',
      color: '#FFFFFF',
      shadow: '0 4px 16px rgba(52,199,89,0.25)',
      fontSize: 13,
      fontWeight: 700,
    },
    'primary-cyan': {
      height: 44,
      bg: 'linear-gradient(135deg, #00C8E0 0%, #0088A8 100%)',
      border: 'none',
      color: '#FFFFFF',
      shadow: '0 4px 16px rgba(0,200,224,0.25)',
      fontSize: 13,
      fontWeight: 700,
    },
    'secondary-cyan': {
      height: 36,
      bg: 'rgba(0,200,224,0.06)',
      border: '1px solid rgba(0,200,224,0.18)',
      color: '#00C8E0',
      shadow: 'none',
      fontSize: 12,
      fontWeight: 600,
    },
    'secondary-warning': {
      height: 36,
      bg: 'rgba(255,179,0,0.06)',
      border: '1px solid rgba(255,179,0,0.18)',
      color: '#FFB300',
      shadow: 'none',
      fontSize: 12,
      fontWeight: 600,
    },
    'secondary-danger': {
      height: 36,
      bg: 'rgba(255,45,85,0.08)',
      border: '1px solid rgba(255,45,85,0.25)',
      color: '#FF2D55',
      shadow: 'none',
      fontSize: 12,
      fontWeight: 600,
    },
  };

  const s = styles[variant];
  const isDisabled = !!disabled || !!loading;

  return (
    <button
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={{
        width: '100%',
        height: s.height,
        borderRadius: 10,
        background: isDisabled && !loading ? 'rgba(128,144,165,0.04)' : s.bg,
        border: isDisabled && !loading ? '1px solid rgba(128,144,165,0.10)' : s.border,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        color: isDisabled && !loading ? 'var(--sos-text-disabled)' : s.color,
        opacity: isDisabled && !loading ? 0.5 : loading ? 0.7 : 1,
        boxShadow: isDisabled ? 'none' : s.shadow,
        transition: 'all 0.15s ease',
      }}
    >
      {loading ? (
        <Loader2 size={16} strokeWidth={2.5} style={{ animation: 'spin 1s linear infinite' }} />
      ) : (
        icon
      )}
      <span>{label}</span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════
// SECTION TITLE
// ════════════════════════════════════════════════════════════════
function SectionTitle({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--sos-text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12,
    }}>
      {text}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// INFO ROW
// ════════════════════════════════════════════════════════════════
function InfoRow({
  icon, label, value, locked,
}: {
  icon: React.ReactNode; label: string; value: string; locked?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sos-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {label}
        </span>
      </div>
      <span style={{
        fontSize: 13, fontWeight: 600,
        color: locked ? 'var(--sos-text-disabled)' : 'var(--sos-text-primary)',
        fontStyle: locked ? 'italic' : 'normal',
      }}>
        {value}
      </span>
    </div>
  );
}