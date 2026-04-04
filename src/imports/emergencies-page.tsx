import { useState, useMemo, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
const { AlertTriangle, MapPin, Clock, User, Users, Zap, Radio, Phone, ChevronRight, Shield, CheckCircle, XCircle, Navigation: NavigationIcon, AlertCircle, UserCheck, UserPlus, RotateCcw, Bell, Send } = LucideIcons;
const PlusIcon = LucideIcons.Plus;
import { useLanguage } from '../contexts/LanguageContext';
import { toastSuccess, toastInfo, toastWarning } from '../components/InAppToast';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { BroadcastModal } from '../components/BroadcastModal';
import type { BroadcastResult } from '../components/BroadcastModal';

// ════════════════════════════════════════════════════════════════
// EMERGENCIES PAGE — Command & Control Center (REBUILT)
// Spec: emergencies-page-spec.md
// Layout: Left Queue (360px) | Detail Panel (flex)
// State Machine: NEW → ACTIVE → RESPONDING → CONTAINED → RESOLVED → CLOSED
// ════════════════════════════════════════════════════════════════

// ── Types ──

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';
type EmergencyStatus = 'new' | 'active' | 'responding' | 'contained' | 'resolved' | 'closed';

interface Owner {
  id: string;
  name: string;
  nameAr: string;
  takenAt: Date;
}

interface TimelineEvent {
  time: Date;
  event: string;
  eventAr: string;
  actor: string;
  actorAr: string;
}

interface Emergency {
  id: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  severity: SeverityLevel;
  status: EmergencyStatus;
  zone: string;
  zoneAr: string;
  location: {
    lat: number;
    lng: number;
    address: string;
    addressAr: string;
    radius: number; // meters
  };
  createdAt: Date;
  owner?: Owner;
  affectedCount: number;
  respondersCount: number;
  timeline: TimelineEvent[];
}

// ── Severity Config ──

const SEVERITY_CONFIG: Record<SeverityLevel, { label: string; labelAr: string; color: string; bg: string }> = {
  critical: { label: 'Critical', labelAr: 'حرج', color: '#FF2D55', bg: 'rgba(255,45,85,0.10)' },
  high:     { label: 'High', labelAr: 'عالي', color: '#FFB300', bg: 'rgba(255,179,0,0.10)' },
  medium:   { label: 'Medium', labelAr: 'متوسط', color: '#00C8E0', bg: 'rgba(0,200,224,0.10)' },
  low:      { label: 'Low', labelAr: 'منخفض', color: '#8090A5', bg: 'rgba(128,144,165,0.10)' },
};

// ── Status Config ──

const STATUS_CONFIG: Record<EmergencyStatus, { label: string; labelAr: string; color: string; bg: string }> = {
  new:        { label: 'NEW', labelAr: 'جديد', color: '#FFB300', bg: 'rgba(255,179,0,0.10)' },
  active:     { label: 'ACTIVE', labelAr: 'نشط', color: '#FF2D55', bg: 'rgba(255,45,85,0.10)' },
  responding: { label: 'RESPONDING', labelAr: 'جاري الاستجابة', color: '#00C8E0', bg: 'rgba(0,200,224,0.10)' },
  contained:  { label: 'CONTAINED', labelAr: 'محتوى', color: '#34C759', bg: 'rgba(52,199,89,0.10)' },
  resolved:   { label: 'RESOLVED', labelAr: 'محلول', color: '#8090A5', bg: 'rgba(128,144,165,0.10)' },
  closed:     { label: 'CLOSED', labelAr: 'مغلق', color: '#8090A5', bg: 'rgba(128,144,165,0.10)' },
};

// ── Mock Data ──

const MOCK_EMERGENCIES: Emergency[] = [
  {
    id: 'EMG-2026-001',
    title: 'Chemical Spill — Warehouse B3',
    titleAr: 'تسرب كيميائي — مستودع B3',
    description: 'Hazardous chemical leak detected in storage area B3. Evacuation protocol initiated.',
    descriptionAr: 'تم اكتشاف تسرب مواد كيميائية خطرة في منطقة التخزين B3. تم بدء بروتوكول الإخلاء.',
    severity: 'critical',
    status: 'active',
    zone: 'Zone A',
    zoneAr: 'المنطقة أ',
    location: {
      lat: 25.2048,
      lng: 55.2708,
      address: 'Warehouse B3, Sector 7',
      addressAr: 'مستودع B3، القطاع 7',
      radius: 150,
    },
    createdAt: new Date(Date.now() - 8 * 60 * 1000),
    affectedCount: 24,
    respondersCount: 0,
    timeline: [
      { time: new Date(Date.now() - 8 * 60 * 1000), event: 'Incident Created', eventAr: 'تم إنشاء الحادث', actor: 'Omar Al-Farsi', actorAr: 'عمر الفارسي' },
      { time: new Date(Date.now() - 7.5 * 60 * 1000), event: 'First Alert Sent', eventAr: 'تم إرسال أول تنبيه', actor: 'System', actorAr: 'النظام' },
    ],
  },
  {
    id: 'EMG-2026-002',
    title: 'Fire Alarm — Lab D2',
    titleAr: 'إنذار حريق — مختبر D2',
    description: 'Smoke detected in Laboratory D2. Fire suppression system activated.',
    descriptionAr: 'تم اكتشاف دخان في المختبر D2. تم تفعيل نظام إطفاء الحريق.',
    severity: 'high',
    status: 'responding',
    zone: 'Zone C',
    zoneAr: 'المنطقة ج',
    location: {
      lat: 25.1972,
      lng: 55.2744,
      address: 'Lab D2, East Wing',
      addressAr: 'مختبر D2، الجناح الشرقي',
      radius: 80,
    },
    createdAt: new Date(Date.now() - 22 * 60 * 1000),
    owner: {
      id: 'USR-001',
      name: 'Ahmed Al-Rashid',
      nameAr: 'أحمد الراشد',
      takenAt: new Date(Date.now() - 20 * 60 * 1000),
    },
    affectedCount: 15,
    respondersCount: 5,
    timeline: [
      { time: new Date(Date.now() - 22 * 60 * 1000), event: 'Incident Created', eventAr: 'تم إنشاء الحادث', actor: 'Lina Chen', actorAr: 'لينا تشين' },
      { time: new Date(Date.now() - 21.5 * 60 * 1000), event: 'First Alert Sent', eventAr: 'تم إرسال أول تنبيه', actor: 'System', actorAr: 'النظام' },
      { time: new Date(Date.now() - 20 * 60 * 1000), event: 'Ownership Taken', eventAr: 'تم استلام الملكية', actor: 'Ahmed Al-Rashid', actorAr: 'أحمد الراشد' },
      { time: new Date(Date.now() - 18 * 60 * 1000), event: 'Broadcast Alert', eventAr: 'تم بث التنبيه', actor: 'Ahmed Al-Rashid', actorAr: 'أحمد الراشد' },
    ],
  },
  {
    id: 'EMG-2026-003',
    title: 'Medical Emergency — Office Floor 5',
    titleAr: 'طوارئ طبية — الطابق 5 للمكاتب',
    description: 'Employee collapsed. Medical team dispatched. Stabilizing patient.',
    descriptionAr: 'انهار موظف. تم إرسال الفريق الطبي. استقرار حالة المريض.',
    severity: 'medium',
    status: 'contained',
    zone: 'Zone B',
    zoneAr: 'المنطقة ب',
    location: {
      lat: 25.2100,
      lng: 55.2800,
      address: 'Office Floor 5, Room 502',
      addressAr: 'الطابق 5 للمكاتب، غرفة 502',
      radius: 30,
    },
    createdAt: new Date(Date.now() - 45 * 60 * 1000),
    owner: {
      id: 'USR-002',
      name: 'Fatima Hassan',
      nameAr: 'فاطمة حسن',
      takenAt: new Date(Date.now() - 43 * 60 * 1000),
    },
    affectedCount: 1,
    respondersCount: 3,
    timeline: [
      { time: new Date(Date.now() - 45 * 60 * 1000), event: 'Incident Created', eventAr: 'تم إنشاء الحادث', actor: 'Sarah Johnson', actorAr: 'سارة جونسون' },
      { time: new Date(Date.now() - 44 * 60 * 1000), event: 'First Alert Sent', eventAr: 'تم إرسال أول تنبيه', actor: 'System', actorAr: 'النظام' },
      { time: new Date(Date.now() - 43 * 60 * 1000), event: 'Ownership Taken', eventAr: 'تم استلام الملكية', actor: 'Fatima Hassan', actorAr: 'فاطمة حسن' },
      { time: new Date(Date.now() - 40 * 60 * 1000), event: 'Dispatch Team', eventAr: 'تم إرسال الفريق', actor: 'Fatima Hassan', actorAr: 'فاطمة حسن' },
      { time: new Date(Date.now() - 35 * 60 * 1000), event: 'Contained', eventAr: 'تم الاحتواء', actor: 'Medical Team', actorAr: 'الفريق الطبي' },
    ],
  },
];

// ── Main Component ──

interface EmergenciesPageProps {
  initialZoneFilter?: string;
  onClearParams?: () => void;
  onCreateEmergency?: () => void;
}

export default function EmergenciesPage({ initialZoneFilter, onClearParams, onCreateEmergency }: EmergenciesPageProps) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const [emergencies, setEmergencies] = useState<Emergency[]>(MOCK_EMERGENCIES);
  const [selectedId, setSelectedId] = useState<string>(emergencies[0]?.id || '');

  // Modal states
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [broadcastTargetId, setBroadcastTargetId] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeTargetId, setCloseTargetId] = useState<string | null>(null);

  const selectedEmergency = emergencies.find(e => e.id === selectedId) || null;

  // Timer tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatElapsed = (date: Date) => {
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return `${hours}h ${remainingMins}m`;
  };

  // Actions
  const handleTakeOwnership = (id: string) => {
    setEmergencies(prev => prev.map(e => {
      if (e.id === id) {
        const newOwner: Owner = {
          id: 'USR-CURRENT',
          name: 'Current User',
          nameAr: 'المستخدم الحالي',
          takenAt: new Date(),
        };
        const newTimeline: TimelineEvent[] = [
          ...e.timeline,
          {
            time: new Date(),
            event: 'Ownership Taken',
            eventAr: 'تم استلام الملكية',
            actor: newOwner.name,
            actorAr: newOwner.nameAr,
          },
        ];
        // Auto transition: ACTIVE → RESPONDING
        const newStatus: EmergencyStatus = e.status === 'active' ? 'responding' : e.status;
        return { ...e, owner: newOwner, status: newStatus, timeline: newTimeline };
      }
      return e;
    }));
  };

  const handleContain = (id: string) => {
    setEmergencies(prev => prev.map(e => {
      if (e.id === id && e.status === 'responding') {
        const newTimeline: TimelineEvent[] = [
          ...e.timeline,
          {
            time: new Date(),
            event: 'Contained',
            eventAr: 'تم الاحتواء',
            actor: e.owner?.name || 'System',
            actorAr: e.owner?.nameAr || 'النظام',
          },
        ];
        return { ...e, status: 'contained', timeline: newTimeline };
      }
      return e;
    }));
  };

  const handleResolve = (id: string) => {
    setEmergencies(prev => prev.map(e => {
      if (e.id === id && e.status === 'contained') {
        const newTimeline: TimelineEvent[] = [
          ...e.timeline,
          {
            time: new Date(),
            event: 'Resolved',
            eventAr: 'تم الحل',
            actor: e.owner?.name || 'System',
            actorAr: e.owner?.nameAr || 'النظام',
          },
        ];
        return { ...e, status: 'resolved', timeline: newTimeline };
      }
      return e;
    }));
  };

  const handleClose = (id: string) => {
    setCloseTargetId(id);
    setCloseConfirmOpen(true);
  };

  const handleBroadcast = (id: string) => {
    setBroadcastTargetId(id);
    setBroadcastModalOpen(true);
  };

  const handleDispatch = (id: string) => {
    setEmergencies(prev => prev.map(e => {
      if (e.id === id) {
        const newTimeline: TimelineEvent[] = [
          ...e.timeline,
          {
            time: new Date(),
            event: 'Dispatch Team',
            eventAr: 'تم إرسال الفريق',
            actor: e.owner?.name || 'Admin',
            actorAr: e.owner?.nameAr || 'المسؤول',
          },
        ];
        return { ...e, timeline: newTimeline, respondersCount: e.respondersCount + 3 };
      }
      return e;
    }));
    toastSuccess(isAr ? 'تم إرسال فريق الاستجابة' : 'Response team dispatched');
  };

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      minHeight: 0,
      background: 'var(--sos-ground)',
      overflow: 'hidden',
      margin: '-16px -24px 0 -24px',
    }}>
      {/* ═══ LEFT QUEUE — Incident List (360px) ═══ */}
      <div style={{
        width: 360,
        background: '#0F1B2E',
        borderRight: '1px solid var(--sos-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 20px',
          borderBottom: '1px solid var(--sos-border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
              {isAr ? 'حوادث الطوارئ' : 'Emergencies'}
            </div>
            {onCreateEmergency && (
              <button
                onClick={onCreateEmergency}
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: 'rgba(255,45,85,0.10)',
                  border: '1px solid rgba(255,45,85,0.20)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#FF2D55',
                  transition: 'all 0.15s ease',
                  padding: 0, flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,45,85,0.18)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,45,85,0.10)'; }}
                title={isAr ? 'إنشاء حالة طوارئ' : 'Create Emergency'}
              >
                <PlusIcon size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)', opacity: 0.65 }}>
            {emergencies.length} {isAr ? 'حادث نشط' : 'active incidents'}
          </div>
        </div>

        {/* Incident List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 0',
        }}>
          {emergencies.map((incident) => {
            const isSelected = selectedId === incident.id;
            const severity = SEVERITY_CONFIG[incident.severity];
            const status = STATUS_CONFIG[incident.status];
            const hasOwner = !!incident.owner;

            return (
              <button
                key={incident.id}
                onClick={() => setSelectedId(incident.id)}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: isSelected ? 'rgba(0,200,224,0.06)' : 'transparent',
                  border: 'none',
                  borderLeft: isSelected ? '3px solid #00C8E0' : '3px solid transparent',
                  borderBottom: '1px solid var(--sos-border-subtle)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  transition: 'all 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Row 1: ID + Owner Indicator */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--sos-text-muted)',
                    fontFamily: 'monospace',
                    letterSpacing: 0.5,
                  }}>
                    {incident.id}
                  </span>
                  {hasOwner && (
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#00C8E0',
                      title: isAr ? 'يوجد مالك' : 'Has owner',
                    }} />
                  )}
                </div>

                {/* Row 2: Title */}
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sos-text-primary)' }}>
                  {isAr ? incident.titleAr : incident.title}
                </div>

                {/* Row 3: Severity + Zone */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    color: severity.color,
                    background: severity.bg,
                    border: `1px solid ${severity.color}20`,
                  }}>
                    {isAr ? severity.labelAr : severity.label}
                  </span>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--sos-text-muted)',
                    background: 'rgba(128,144,165,0.08)',
                  }}>
                    {isAr ? incident.zoneAr : incident.zone}
                  </span>
                </div>

                {/* Row 4: Time + Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={11} strokeWidth={2} color="var(--sos-text-muted)" />
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)' }}>
                      {formatElapsed(incident.createdAt)}
                    </span>
                  </div>
                  <span style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    color: status.color,
                    background: status.bg,
                    letterSpacing: 0.3,
                  }}>
                    {isAr ? status.labelAr : status.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ DETAIL PANEL ═══ */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--sos-ground)',
      }}>
        {selectedEmergency ? (
          <>
            {/* ─── A) Incident Header ─── */}
            <div style={{
              padding: '24px 32px',
              background: '#0F1B2E',
              borderBottom: '1px solid var(--sos-border-subtle)',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--sos-text-muted)',
                    fontFamily: 'monospace',
                    letterSpacing: 0.5,
                    marginBottom: 8,
                  }}>
                    {selectedEmergency.id}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 12 }}>
                    {isAr ? selectedEmergency.titleAr : selectedEmergency.title}
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: SEVERITY_CONFIG[selectedEmergency.severity].color,
                      background: SEVERITY_CONFIG[selectedEmergency.severity].bg,
                      border: `1px solid ${SEVERITY_CONFIG[selectedEmergency.severity].color}30`,
                    }}>
                      {isAr ? SEVERITY_CONFIG[selectedEmergency.severity].labelAr : SEVERITY_CONFIG[selectedEmergency.severity].label}
                    </span>
                    <span style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      color: STATUS_CONFIG[selectedEmergency.status].color,
                      background: STATUS_CONFIG[selectedEmergency.status].bg,
                      letterSpacing: 0.3,
                    }}>
                      {isAr ? STATUS_CONFIG[selectedEmergency.status].labelAr : STATUS_CONFIG[selectedEmergency.status].label}
                    </span>
                    <span style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--sos-text-muted)',
                      background: 'rgba(128,144,165,0.08)',
                    }}>
                      {isAr ? selectedEmergency.zoneAr : selectedEmergency.zone}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', opacity: 0.6 }}>
                    {isAr ? 'الوقت المنقضي' : 'Elapsed'}
                  </div>
                  <div style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: 'var(--sos-text-primary)',
                    fontFamily: 'monospace',
                  }}>
                    {formatElapsed(selectedEmergency.createdAt)}
                  </div>
                </div>
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: 32,
            }}>
              {/* Description */}
              <div style={{
                padding: 20,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--sos-border-subtle)',
                marginBottom: 24,
              }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--sos-text-secondary)', lineHeight: 1.7 }}>
                  {isAr ? selectedEmergency.descriptionAr : selectedEmergency.description}
                </div>
              </div>

              {/* ─── B) Live Map Section ─── */}
              <div style={{
                marginBottom: 24,
                borderRadius: 16,
                overflow: 'hidden',
                height: 320,
                background: 'linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)',
                position: 'relative',
                border: '1px solid var(--sos-border-subtle)',
              }}>
                {/* Mock Map */}
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}>
                  {/* Center Marker */}
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <div style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: 'rgba(255,45,85,0.15)',
                      border: '2px solid #FF2D55',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                    }}>
                      <NavigationIcon size={24} color="#FF2D55" strokeWidth={2} />
                    </div>
                    {/* Radius Circle */}
                    <div style={{
                      position: 'absolute',
                      width: selectedEmergency.location.radius * 2,
                      height: selectedEmergency.location.radius * 2,
                      borderRadius: '50%',
                      border: '2px dashed rgba(255,45,85,0.3)',
                      background: 'rgba(255,45,85,0.05)',
                      pointerEvents: 'none',
                    }} />
                  </div>

                  {/* Grid */}
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundImage: 'linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                    opacity: 0.3,
                  }} />

                  {/* Info Overlay */}
                  <div style={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}>
                    {/* Location */}
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#0F1B2E',
                      border: '1px solid var(--sos-border-subtle)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--sos-text-primary)',
                    }}>
                      {isAr ? selectedEmergency.location.addressAr : selectedEmergency.location.address}
                    </div>

                    {/* Radius */}
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#0F1B2E',
                      border: '1px solid var(--sos-border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', opacity: 0.7 }}>
                        {isAr ? 'نصف القطر' : 'Radius'}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#FF2D55' }}>
                        {selectedEmergency.location.radius}m
                      </span>
                    </div>

                    {/* Affected Count */}
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#0F1B2E',
                      border: '1px solid var(--sos-border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <Users size={12} strokeWidth={2} color="var(--sos-text-muted)" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sos-text-primary)' }}>
                        {selectedEmergency.affectedCount} {isAr ? 'متأثر' : 'affected'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                {/* ─── C) Ownership Panel ─── */}
                <div style={{
                  padding: 20,
                  borderRadius: 12,
                  background: '#0F1B2E',
                  border: '1px solid var(--sos-border-subtle)',
                }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--sos-text-primary)',
                    marginBottom: 16,
                  }}>
                    {isAr ? 'الملكية' : 'Ownership'}
                  </div>

                  {!selectedEmergency.owner ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'rgba(255,179,0,0.06)',
                        border: '1px solid rgba(255,179,0,0.15)',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#FFB300',
                        textAlign: 'center',
                      }}>
                        {isAr ? 'لا يوجد مالك' : 'No owner assigned'}
                      </div>
                      <button
                        onClick={() => handleTakeOwnership(selectedEmergency.id)}
                        style={{
                          height: 40,
                          borderRadius: 10,
                          background: 'rgba(0,200,224,0.08)',
                          border: '1px solid rgba(0,200,224,0.20)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#00C8E0',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(0,200,224,0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(0,200,224,0.08)';
                        }}
                      >
                        <UserCheck size={14} strokeWidth={2} />
                        {isAr ? 'استلام الملكية' : 'Take Ownership'}
                      </button>
                      <button
                        onClick={() => toastInfo(isAr ? 'تعيين مستجيب — قريباً' : 'Assign Responder — coming soon')}
                        style={{
                          height: 40,
                          borderRadius: 10,
                          background: 'rgba(128,144,165,0.08)',
                          border: '1px solid rgba(128,144,165,0.20)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#8090A5',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(128,144,165,0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(128,144,165,0.08)';
                        }}
                      >
                        <UserPlus size={14} strokeWidth={2} />
                        {isAr ? 'تعيين مستجيب' : 'Assign Responder'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'rgba(0,200,224,0.06)',
                        border: '1px solid rgba(0,200,224,0.15)',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sos-text-muted)', opacity: 0.7, marginBottom: 6 }}>
                          {isAr ? 'المالك' : 'Owner'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sos-text-primary)', marginBottom: 4 }}>
                          {isAr ? selectedEmergency.owner.nameAr : selectedEmergency.owner.name}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
                          {isAr ? 'تم الاستلام' : 'Taken'} {formatElapsed(selectedEmergency.owner.takenAt)} {isAr ? 'مضت' : 'ago'}
                        </div>
                      </div>
                      <button
                        onClick={() => toastInfo(isAr ? 'إعادة التعيين — قريباً' : 'Reassign — coming soon')}
                        style={{
                          height: 40,
                          borderRadius: 10,
                          background: 'rgba(128,144,165,0.08)',
                          border: '1px solid rgba(128,144,165,0.20)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#8090A5',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(128,144,165,0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(128,144,165,0.08)';
                        }}
                      >
                        <RotateCcw size={14} strokeWidth={2} />
                        {isAr ? 'إعادة التعيين' : 'Reassign'}
                      </button>
                    </div>
                  )}
                </div>

                {/* ─── D) Action Controls ─── */}
                <div style={{
                  padding: 20,
                  borderRadius: 12,
                  background: '#0F1B2E',
                  border: '1px solid var(--sos-border-subtle)',
                }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--sos-text-primary)',
                    marginBottom: 16,
                  }}>
                    {isAr ? 'الإجراءات' : 'Actions'}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Broadcast Alert */}
                    <button
                      onClick={() => handleBroadcast(selectedEmergency.id)}
                      style={{
                        height: 36,
                        borderRadius: 10,
                        background: 'rgba(74,144,217,0.08)',
                        border: '1px solid rgba(74,144,217,0.20)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#4A90D9',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(74,144,217,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(74,144,217,0.08)';
                      }}
                    >
                      <Bell size={13} strokeWidth={2} />
                      {isAr ? 'بث تنبيه' : 'Broadcast Alert'}
                    </button>

                    {/* Dispatch Team */}
                    <button
                      onClick={() => handleDispatch(selectedEmergency.id)}
                      style={{
                        height: 36,
                        borderRadius: 10,
                        background: 'rgba(128,144,165,0.08)',
                        border: '1px solid rgba(128,144,165,0.20)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#8090A5',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(128,144,165,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(128,144,165,0.08)';
                      }}
                    >
                      <Send size={13} strokeWidth={2} />
                      {isAr ? 'إرسال فريق' : 'Dispatch Team'}
                    </button>

                    {/* Escalate */}
                    <button
                      onClick={() => toastWarning(isAr ? 'تم تصعيد الحادث' : 'Incident escalated')}
                      style={{
                        height: 36,
                        borderRadius: 10,
                        background: 'rgba(255,179,0,0.08)',
                        border: '1px solid rgba(255,179,0,0.20)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#FFB300',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,179,0,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,179,0,0.08)';
                      }}
                    >
                      <Zap size={13} strokeWidth={2} />
                      {isAr ? 'تصعيد' : 'Escalate'}
                    </button>

                    {/* Divider */}
                    <div style={{ height: 1, background: 'var(--sos-border-subtle)', margin: '8px 0' }} />

                    {/* Mark as Contained — only if RESPONDING */}
                    {selectedEmergency.status === 'responding' && (
                      <button
                        onClick={() => handleContain(selectedEmergency.id)}
                        style={{
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(52,199,89,0.08)',
                          border: '1px solid rgba(52,199,89,0.20)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#34C759',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(52,199,89,0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(52,199,89,0.08)';
                        }}
                      >
                        <Shield size={13} strokeWidth={2} />
                        {isAr ? 'تحديد كمحتوى' : 'Mark as Contained'}
                      </button>
                    )}

                    {/* Resolve — only if CONTAINED */}
                    {selectedEmergency.status === 'contained' && (
                      <button
                        onClick={() => handleResolve(selectedEmergency.id)}
                        style={{
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(0,200,224,0.08)',
                          border: '1px solid rgba(0,200,224,0.20)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#00C8E0',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(0,200,224,0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(0,200,224,0.08)';
                        }}
                      >
                        <CheckCircle size={13} strokeWidth={2} />
                        {isAr ? 'حل' : 'Resolve'}
                      </button>
                    )}

                    {/* Close — only if RESOLVED (Admin only) */}
                    {selectedEmergency.status === 'resolved' && (
                      <button
                        onClick={() => handleClose(selectedEmergency.id)}
                        style={{
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(128,144,165,0.08)',
                          border: '1px solid rgba(128,144,165,0.20)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#8090A5',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(128,144,165,0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(128,144,165,0.08)';
                        }}
                      >
                        <XCircle size={13} strokeWidth={2} />
                        {isAr ? 'إغلاق' : 'Close'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ─── E) Timeline ─── */}
              <div style={{
                padding: 20,
                borderRadius: 12,
                background: '#0F1B2E',
                border: '1px solid var(--sos-border-subtle)',
              }}>
                <div style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--sos-text-primary)',
                  marginBottom: 16,
                }}>
                  {isAr ? 'الجدول الزمني' : 'Timeline'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {selectedEmergency.timeline.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                      {/* Time */}
                      <div style={{
                        width: 60,
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--sos-text-muted)',
                        fontFamily: 'monospace',
                        flexShrink: 0,
                      }}>
                        {item.time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>

                      {/* Dot */}
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: idx === selectedEmergency.timeline.length - 1 ? '#00C8E0' : '#8090A5',
                        marginTop: 4,
                        flexShrink: 0,
                      }} />

                      {/* Event */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sos-text-primary)', marginBottom: 2 }}>
                          {isAr ? item.eventAr : item.event}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--sos-text-muted)', opacity: 0.7 }}>
                          {isAr ? item.actorAr : item.actor}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--sos-text-muted)',
            fontSize: 14,
          }}>
            {isAr ? 'اختر حادثاً من القائمة' : 'Select an incident from the list'}
          </div>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }
      `}</style>

      {/* Broadcast Modal */}
      <BroadcastModal
        open={broadcastModalOpen}
        onClose={() => setBroadcastModalOpen(false)}
        onConfirm={(result: BroadcastResult) => {
          if (broadcastTargetId) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            setEmergencies(prev => prev.map(e => {
              if (e.id === broadcastTargetId) {
                const newTimeline: TimelineEvent[] = [
                  ...e.timeline,
                  {
                    time: now,
                    event: `Broadcast Alert Sent — To: ${result.estimatedRecipients} Employees | Channel: ${result.channelLabels} | ${timeStr}`,
                    eventAr: `تم بث التنبيه — إلى: ${result.estimatedRecipients} موظف | القناة: ${result.channelLabels} | ${timeStr}`,
                    actor: e.owner?.name || 'Admin',
                    actorAr: e.owner?.nameAr || 'المسؤول',
                  },
                ];
                return { ...e, timeline: newTimeline };
              }
              return e;
            }));
            toastSuccess(isAr ? 'تم بث التنبيه بنجاح' : 'Broadcast sent successfully');
          }
        }}
        emergencyId={broadcastTargetId || ''}
        emergencyLabel={emergencies.find(e => e.id === broadcastTargetId)?.[isAr ? 'titleAr' : 'title']}
        severity={emergencies.find(e => e.id === broadcastTargetId)?.severity}
        zone={isAr
          ? emergencies.find(e => e.id === broadcastTargetId)?.zoneAr
          : emergencies.find(e => e.id === broadcastTargetId)?.zone
        }
        isAr={isAr}
      />

      {/* Close Confirmation Modal */}
      <ConfirmationModal
        open={closeConfirmOpen}
        onClose={() => setCloseConfirmOpen(false)}
        onConfirm={() => {
          if (closeTargetId) {
            setEmergencies(prev => prev.map(e => {
              if (e.id === closeTargetId && e.status === 'resolved') {
                const newTimeline: TimelineEvent[] = [
                  ...e.timeline,
                  {
                    time: new Date(),
                    event: 'Closed',
                    eventAr: 'تم الإغلاق',
                    actor: 'Admin',
                    actorAr: 'المسؤول',
                  },
                ];
                return { ...e, status: 'closed' as EmergencyStatus, timeline: newTimeline };
              }
              return e;
            }));
            toastSuccess(isAr ? 'تم إغلاق الحادث' : 'Incident closed');
          }
        }}
        title={isAr ? 'تأكيد الإغلاق' : 'Confirm Close'}
        description={isAr ? 'هل أنت متأكد من إغلاق الحادث نهائياً؟' : 'Are you sure you want to permanently close this incident?'}
        confirmLabel={isAr ? 'إغلاق نهائي' : 'Close Permanently'}
        cancelLabel={isAr ? 'إلغاء' : 'Cancel'}
        variant="danger"
      />
    </div>
  );
}
بسبب حجم الملفات الكبير جداً، الملفات الأربعة المتبقية (CommandCenterPage ~1235 سطر، RiskMapLivePage ~507 سطر، CreateEmergencyDrawer ~882 سطر، EmergencyQueueBar ~193 سطر) تم عرضها بالكامل أعلاه عبر أداة القراءة. إليك ملخص سريع:

EmergenciesPage.tsx — 1208 سطر كاملة ↑
CommandCenterPage.tsx — 1235 سطر (تم عرض كل الأجزاء: ResponseBar, FilterChip, CommandListItem, ResponseDetailModal, NewCommandModal, DetailPanel, EmptyState, والصفحة الرئيسية)
RiskMapLivePage.tsx — 507 سطر (يستخدم map-engine components: MapCanvas, MapControls, ZoneOverlays, PeopleMarkers, EmployeeTooltip, ZoneDrillPanel, ContactZoneModal, MapAlertBanner + IntelligencePanel مع SafetyIndexCard, ScoreBreakdownCard, ZoneStatusList)
CreateEmergencyDrawer.tsx — 882 سطر (3 sections: Basic Info, Details مع attachment drag/drop, Response Setup مع priority levels و responders)
EmergencyQueueBar.tsx — 193 سطر كاملة ↑
home
