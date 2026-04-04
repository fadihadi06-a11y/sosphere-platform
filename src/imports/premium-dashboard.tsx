import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from './contexts/LanguageContext';
import { useAuth } from './contexts/AuthContext';
import { useCompany } from './contexts/CompanyContext';
import * as LucideIcons from 'lucide-react';

const LayoutDashboard = LucideIcons.LayoutDashboard;
const Users = LucideIcons.Users;
const AlertTriangle = LucideIcons.AlertTriangle;
const Calendar = LucideIcons.Calendar;
const Settings = LucideIcons.Settings;
const Shield = LucideIcons.Shield;
const Radio = LucideIcons.Radio;
const Bell = LucideIcons.Bell;
const MapPin = LucideIcons.MapPin;
const FileWarning = LucideIcons.FileWarning;
const MapIcon = LucideIcons.Map;
const FileText = LucideIcons.FileText;

import { 
  DashboardLayout,
  Sidebar,
  Topbar,
  SidebarMenuItem,
  SidebarMenuGroup
} from './components/design-system';
import OverviewPage from './pages/OverviewPage';
import EmployeesPage from './pages/EmployeesPage';
import CommandCenterPage from './pages/CommandCenterPage';
import NotificationsPage from './pages/NotificationsPage';
import ZonesPage from './pages/ZonesPage';
import IncidentHistoryPage from './pages/IncidentHistoryPage';
import WallModePage from './pages/WallModePage';
import RiskMapLivePage from './pages/RiskMapLivePage';
import EmergenciesPage from './pages/EmergenciesPage';
import AttendancePage from './pages/AttendancePage';
import SettingsPage from './pages/SettingsPage';
import AuditLogsPage from './pages/AuditLogsPage';
import EmergencyResponsePage from './pages/EmergencyResponsePage';
import { HazardAlertBanner } from './components/HazardAlertBanner';
import { EmergencyQueueBar } from './components/EmergencyQueueBar';
import { LiveAlertOverlay } from './components/LiveAlertOverlay';
import { toastError, toastWarning, toastSuccess } from './components/InAppToast';
import { ManualPriorityModal } from './components/ManualPriorityModal';
import { TenantBanner } from './components/TenantBanner';
import { CreateEmergencyDrawer, type CreateEmergencyData } from './components/CreateEmergencyDrawer';
import { toast } from 'sonner';
import {
  sortByPriority,
  getActiveFocus,
  getQueuedEmergencies,
  pinAsActive,
  markAsOwned,
  removeEmergency,
  type Emergency,
  type PriorityOverrideLog,
} from './utils/priorityEngine';

// ════════════════════════════════════════════════════════════════
// PREMIUM DASHBOARD — Docked Panel Architecture
// ════════════════════════════════════════════════════════════════
// Alert Handling: alert-handling-guidelines.md
//   - NO floating overlay modals for emergency alerts
//   - Alerts route to OverviewPage's docked right panel
//   - EmergencySidePanel & EmergencyPill REMOVED
//   - New emergencies → toast + audio + auto-navigate to overview
//   - Main content always interactive (zero blocking overlays)
//   - EmergencyQueueBar retained for non-overview pages only
// ════════════════════════════════════════════════════════════════

export default function PremiumDashboard() {
  return <DashboardContent />;
}

function DashboardContent() {
  const { t, language, setLanguage } = useLanguage();
  const {
    user, hasPermission, canBroadcast, canManageUsers,
    canViewAudit, canManageSettings, canAccessBilling,
    canViewEmergencies, canManageZones, canCreateCommands,
    canExportAttendance, canEscalate, canAssignResponder,
    logout,
  } = useAuth();
  const { company, planConfig, hasFeature, isFeatureLocked, employeeUsagePercent, employeesRemaining, isTrial, isTrialExpired, trialDaysRemaining, isPastDue, canCreateEmergency, effectiveEmployeeLimit } = useCompany();
  const [currentPage, setCurrentPage] = useState<'overview' | 'employees' | 'commandCenter' | 'notifications' | 'zones' | 'incidentHistory' | 'emergencies' | 'attendance' | 'settings' | 'riskMapLive' | 'auditLogs'>('overview');
  const [notificationCount] = useState(3);
  const [wallMode, setWallMode] = useState(false);
  const [navParams, setNavParams] = useState<Record<string, string>>({});
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [emergencyResponseId, setEmergencyResponseId] = useState<string | null>(null);
  
  // ════════════════════════════════════════════════════════════
  // Emergency State — Docked Panel Architecture
  // NO incomingEmergency, isPanelMinimized, emergencyElapsed
  // Alerts go directly to OverviewPage's docked IncidentDetailsPanel
  // ════════════════════════════════════════════════════════════
  const knownEmergencyIdsRef = useRef<Set<string>>(new Set());
  const hasAutoEscalatedRef = useRef(false);

  // ── Live Alert Overlay State ──
  const [liveAlertEmergency, setLiveAlertEmergency] = useState<typeof activeFocus>(null);

  // ── Create Emergency Drawer — Gated by RBAC + Billing ──
  const [createEmergencyOpen, setCreateEmergencyOpen] = useState(false);

  // Combined gate: RBAC permission (emergency:create) + Billing status (canCreateEmergency from CompanyContext)
  const rbacCanCreate = hasPermission('emergency:create');

  /** Attempt to open the Create Emergency drawer. Shows toast if blocked. */
  const handleOpenCreateEmergency = () => {
    // Gate 1: RBAC — user doesn't have emergency:create permission
    if (!rbacCanCreate) {
      const msg = language === 'ar'
        ? 'ليس لديك صلاحية إنشاء حالة طوارئ. تواصل مع مسؤول النظام.'
        : 'You do not have permission to create emergencies. Contact your administrator.';
      toastError(msg);
      return;
    }
    // Gate 2: Billing — account is trial_expired / suspended / cancelled
    if (!canCreateEmergency) {
      if (isTrialExpired) {
        const msg = language === 'ar'
          ? 'انتهت الفترة التجريبية. اشترك في خطة لإنشاء حالات طوارئ جديدة.'
          : 'Trial expired. Subscribe to a plan to create new emergencies.';
        toastWarning(msg);
      } else {
        const msg = language === 'ar'
          ? 'حسابك معلق أو ملغى. يرجى حل مشاكل الفوترة أولاً.'
          : 'Your account is suspended or cancelled. Please resolve billing issues first.';
        toastError(msg);
      }
      return;
    }
    // Both gates passed -> open drawer
    setCreateEmergencyOpen(true);
  };

  /** Handle emergency creation from the drawer */
  const handleCreateEmergency = (data: CreateEmergencyData) => {
    const newEmergency: Emergency = {
      id: `EMG-${Date.now().toString(36).toUpperCase()}`,
      severity: (data.severity || 'medium') as Emergency['severity'],
      timestamp: new Date(),
      employeeId: user?.id || 'USR-ADMIN',
      employeeName: user?.name || 'Admin',
      employeeNameAr: user?.name || 'المسؤول',
      department: data.type,
      departmentAr: data.type,
      phone: '',
      zone: data.zone,
      zoneAr: data.zone,
      reportType: 'manual_sos',
      reportTypeLabel: data.title,
      reportTypeLabelAr: data.title,
    };
    setAllEmergencies(prev => [...prev, newEmergency]);
    emergencyTimers.current.set(newEmergency.id, 0);
    
    // Auto-navigate to overview (docked panel shows the incident)
    setCurrentPage('overview');
    
    const msg = language === 'ar' ? 'تم إنشاء حالة الطوارئ بنجاح' : 'Emergency created successfully';
    toastSuccess(msg);
  };

  // Priority Engine — Intelligent Queue System
  const [allEmergencies, setAllEmergencies] = useState<Emergency[]>([]);
  const [auditLogs, setAuditLogs] = useState<PriorityOverrideLog[]>([]);
  const [showManualOverrideModal, setShowManualOverrideModal] = useState(false);
  const [overrideTargetId, setOverrideTargetId] = useState<string | null>(null);
  const emergencyTimers = useRef<Map<string, number>>(new Map());

  // Get Active Focus & Queue
  const activeFocus = getActiveFocus(allEmergencies);
  const queuedItems = activeFocus ? getQueuedEmergencies(allEmergencies, activeFocus.id) : [];
  const isAr = language === 'ar';

  // ════════════════════════════════════════════════════════════
  // Docked Alert Flow: new emergency -> toast + audio + auto-navigate
  // Replaces the old EmergencySidePanel floating overlay pattern
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!activeFocus) {
      hasAutoEscalatedRef.current = false;
      return;
    }

    // Check if this is a NEW emergency (not already known)
    if (!knownEmergencyIdsRef.current.has(activeFocus.id)) {
      knownEmergencyIdsRef.current.add(activeFocus.id);
      
      // Play audio alert
      playEmergencyAlert();
      
      // Initialize timer if not set
      if (!emergencyTimers.current.has(activeFocus.id)) {
        emergencyTimers.current.set(activeFocus.id, 0);
      }
      
      // Show Live Alert Overlay (replaces toast for new emergencies)
      setLiveAlertEmergency(activeFocus);
      
      // Auto-navigate to overview if not already there
      if (currentPage !== 'overview') {
        setCurrentPage('overview');
      }
    }
  }, [activeFocus, currentPage, isAr]);

  // Track elapsed time for ALL emergencies (not just active focus)
  useEffect(() => {
    if (allEmergencies.length === 0) return;

    const interval = setInterval(() => {
      allEmergencies.forEach(e => {
        const current = emergencyTimers.current.get(e.id) || 0;
        emergencyTimers.current.set(e.id, current + 1);
      });

      // Auto-escalation at 60s for active focus (toast warning, no panel expansion)
      if (activeFocus) {
        const focusElapsed = emergencyTimers.current.get(activeFocus.id) || 0;
        if (focusElapsed === 60 && !hasAutoEscalatedRef.current) {
          hasAutoEscalatedRef.current = true;
          toast.warning(
            isAr
              ? `تصعيد تلقائي: ${activeFocus.id} — لم يتم الاستجابة خلال 60 ثانية`
              : `Auto-escalation: ${activeFocus.id} — No response for 60s`,
            { duration: 8000 }
          );
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [allEmergencies, activeFocus, isAr]);

  // Clean up known IDs when emergencies are removed
  useEffect(() => {
    const currentIds = new Set(allEmergencies.map(e => e.id));
    knownEmergencyIdsRef.current.forEach(id => {
      if (!currentIds.has(id)) {
        knownEmergencyIdsRef.current.delete(id);
      }
    });
  }, [allEmergencies]);

  // Manual Override Handler
  const handlePinAsActive = (emergencyId: string) => {
    setOverrideTargetId(emergencyId);
    setShowManualOverrideModal(true);
  };

  const handleConfirmOverride = (reason: string) => {
    if (!overrideTargetId) return;

    try {
      const { emergencies: updated, auditLog } = pinAsActive(
        allEmergencies,
        overrideTargetId,
        reason,
        user?.name || 'Admin User'
      );

      setAllEmergencies(updated);
      setAuditLogs(prev => [auditLog, ...prev]);
      
      toastSuccess(
        isAr
          ? `تم تجاوز الأولوية: ${auditLog.emergencyId} — الموضع #${auditLog.previousPosition + 1} -> #${auditLog.newPosition + 1}`
          : `Priority override applied: ${auditLog.emergencyId} — Position #${auditLog.previousPosition + 1} -> #${auditLog.newPosition + 1}`
      );
      
      setShowManualOverrideModal(false);
      setOverrideTargetId(null);
    } catch (error: any) {
      toastError(error.message);
    }
  };

  // Emergency handlers (routed through Unified Action Handler in OverviewPage)
  const handleAssignResponder = (emergencyId: string) => {
    toastSuccess(isAr ? 'تم إرسال طلب تعيين مستجيب' : 'Responder assignment requested');
  };

  const handleEscalateEmergency = (emergencyId: string) => {
    toastSuccess(isAr ? 'تم تصعيد الحادث للمستوى التالي' : 'Incident escalated to next tier');
  };

  const handleBroadcastAlert = (emergencyId: string) => {
    toastSuccess(isAr ? 'تم بث التنبيه لجميع الموظفين' : 'Alert broadcasted to all employees');
  };

  const handleDispatchTeam = (emergencyId: string) => {
    toastSuccess(isAr ? 'تم إرسال فريق الاستجابة' : 'Response team dispatched');
  };

  // Audio Alert System — In-App Sound (No Browser Notifications)
  const playEmergencyAlert = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Emergency alert tone: Two-tone siren
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.3);
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.6);

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 1);
    } catch (_) {
      // Silent fail — audio not critical
    }
  }, []);

  // Navigation with optional params (e.g. zone filter)
  const navigateTo = useCallback((page: string, params?: Record<string, string>) => {
    if (page === 'logout') {
      logout();
      return;
    }
    setCurrentPage(page as any);
    setNavParams(params || {});
  }, [logout]);

  // If wall mode is active, render only the wall mode page
  if (wallMode) {
    return <WallModePage onExit={() => setWallMode(false)} />;
  }

  // If emergency response mode is active, render only the response page
  if (emergencyResponseId) {
    return <EmergencyResponsePage emergencyId={emergencyResponseId} onClose={() => setEmergencyResponseId(null)} />;
  }

  // Plan-gated features from CompanyContext (replaces hardcoded userPlan)
  const canAccessAuditLogs = hasFeature('audit_logs') && canViewAudit;
  const canAccessRiskMap = hasFeature('risk_map');
  const canAccessWallMode = hasFeature('wall_mode');
  const canAccessCommandCenter = hasFeature('command_center') && canCreateCommands;

  // Menu Groups — RBAC + Plan gated navigation (Operations vs Management)
  const operationsItems: SidebarMenuItem[] = [
    { id: 'overview', icon: LayoutDashboard, label: isAr ? 'العمليات' : 'Operations' },
  ];
  if (canAccessCommandCenter) {
    operationsItems.push({ id: 'commandCenter', icon: Radio, label: t('nav.commandCenter') });
  }
  if (canViewEmergencies) {
    operationsItems.push(
      { id: 'emergencies', icon: AlertTriangle, label: t('nav.emergencies') },
      { id: 'incidentHistory', icon: FileWarning, label: isAr ? 'سجل الحوادث' : 'Incident History' },
    );
  }
  if (canAccessRiskMap) {
    operationsItems.push({ id: 'riskMapLive', icon: MapIcon, label: isAr ? 'خريطة المخاطر' : 'Risk Map' });
  }

  const managementItems: SidebarMenuItem[] = [];
  if (hasPermission('users:view')) {
    managementItems.push({ id: 'employees', icon: Users, label: t('nav.employees') });
  }
  if (hasPermission('zones:view')) {
    managementItems.push({ id: 'zones', icon: MapPin, label: t('nav.zones') });
  }
  if (hasPermission('attendance:view')) {
    managementItems.push({ id: 'attendance', icon: Calendar, label: t('nav.attendance') });
  }
  if (canAccessAuditLogs) {
    managementItems.push({ id: 'auditLogs', icon: FileText, label: isAr ? 'سجلات التدقيق' : 'Audit Logs' });
  }
  if (hasPermission('settings:view')) {
    managementItems.push({ id: 'settings', icon: Settings, label: t('nav.settings') });
  }

  const menuGroups: SidebarMenuGroup[] = [
    { label: isAr ? 'العمليات' : 'OPERATIONS', items: operationsItems },
    { label: isAr ? 'الإدارة' : 'MANAGEMENT', items: managementItems },
  ];

  // Attendance-specific: Live indicator chip for Topbar right group
  const isSettingsPage = currentPage === 'settings';
  const liveChip = currentPage === 'attendance' ? (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '0 12px', height: 32, borderRadius: 8,
      border: '1px solid var(--sos-border-subtle)',
      flexShrink: 0,
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00C853', animation: 'blink 3s ease-in-out infinite' }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--sos-text-muted)' }}>
        {isAr ? 'مباشر' : 'Live'}
      </span>
    </div>
  ) : undefined;

  return (
    <>
    <DashboardLayout
      language={language}
      fullBleed={currentPage === 'riskMapLive' || currentPage === 'emergencies' || currentPage === 'attendance' || currentPage === 'overview' || currentPage === 'commandCenter'}
      banner={undefined}
      sidebar={
        <Sidebar
          logo={{
            icon: Shield,
            title: 'SOSphere',
            subtitle: 'Enterprise Safety',
          }}
          menuGroups={menuGroups}
          currentPage={currentPage}
          onNavigate={(page) => setCurrentPage(page as any)}
        />
      }
      topbar={
        <Topbar
          language={language}
          onLanguageChange={setLanguage}
          notificationCount={notificationCount}
          searchPlaceholder={
            currentPage === 'attendance'
              ? (isAr ? 'بحث بالاسم، الدور، المنطقة...' : 'Search name, role, zone, ID...')
              : t('common.search')
          }
          hideSearch={isSettingsPage || currentPage === 'overview'}
          hideNotifications={isSettingsPage}
          compact={isSettingsPage}
          searchValue={currentPage === 'attendance' ? attendanceSearch : undefined}
          onSearchChange={currentPage === 'attendance' ? setAttendanceSearch : undefined}
          rightExtra={isSettingsPage ? undefined : liveChip}
          user={{
            name: user?.name || t('settings.admin'),
            email: user?.email || 'admin@company.com',
          }}
          onNavigate={(page) => navigateTo(page)}
        />
      }
    >
      {currentPage === 'overview' && <OverviewPage
        onNavigate={(page) => navigateTo(page)}
        onEnterWallMode={() => setWallMode(true)}
        onCreateEmergency={handleOpenCreateEmergency}
        allEmergencies={allEmergencies}
        activeFocus={activeFocus}
        queuedItems={queuedItems}
        emergencyTimers={emergencyTimers}
        onTakeOwnership={(id) => {
          setAllEmergencies(markAsOwned(allEmergencies, id, user?.name || 'Admin'));
          toastSuccess(isAr ? 'تم استلام الحادث' : 'Incident ownership taken');
        }}
        onAssignResponder={handleAssignResponder}
        onEscalateEmergency={handleEscalateEmergency}
        onBroadcastAlert={handleBroadcastAlert}
        onDispatchTeam={handleDispatchTeam}
        onResolveEmergency={(id) => {
          setAllEmergencies(removeEmergency(allEmergencies, id));
          emergencyTimers.current.delete(id);
          toastSuccess(isAr ? 'تم حل الحادث بنجاح' : 'Incident resolved successfully');
        }}
        onPinAsActive={handlePinAsActive}
      />}
      {currentPage === 'employees' && <EmployeesPage />}
      {currentPage === 'commandCenter' && <CommandCenterPage />}
      {currentPage === 'notifications' && <NotificationsPage onNavigate={(page) => navigateTo(page)} />}
      {currentPage === 'zones' && <ZonesPage />}
      {currentPage === 'incidentHistory' && <IncidentHistoryPage />}
      {currentPage === 'riskMapLive' && <RiskMapLivePage onNavigate={(page, params) => navigateTo(page, params)} />}

      {currentPage === 'emergencies' && <EmergenciesPage initialZoneFilter={navParams.zone} onClearParams={() => setNavParams({})} onCreateEmergency={handleOpenCreateEmergency} />}
      {currentPage === 'attendance' && <AttendancePage searchQuery={attendanceSearch} />}
      {currentPage === 'settings' && <SettingsPage onNavigate={(page) => setCurrentPage(page as any)} />}
      {currentPage === 'auditLogs' && <AuditLogsPage />}
    </DashboardLayout>
    
    {/* ── Floating Alert Overlay — Fixed, pointer-events passthrough ── */}
    <HazardAlertBanner
      onNavigate={(page, params) => navigateTo(page, params)}
    />

    {/* ─── Emergency Queue Bar — Only visible when NOT on overview page ─── */}
    {/* On overview, the docked Incident Queue panel already shows the queue */}
    {currentPage !== 'overview' && (
      <EmergencyQueueBar
        queuedEmergencies={queuedItems.map(e => ({
          id: e.id,
          severity: e.severity,
          zone: (e as any).zone || 'Unknown',
          zoneAr: (e as any).zoneAr || 'غير معروف',
          elapsed: emergencyTimers.current.get(e.id) || 0,
          manualPriority: e.manualPriority,
        }))}
        onViewQueue={() => navigateTo('overview')}
        onPinAsActive={handlePinAsActive}
      />
    )}

    {/* ─── Manual Priority Override Modal (only real modal — confirm action) ─── */}
    {showManualOverrideModal && overrideTargetId && (() => {
      const sorted = sortByPriority(allEmergencies);
      const targetIndex = sorted.findIndex(e => e.id === overrideTargetId);
      return (
        <ManualPriorityModal
          emergencyId={overrideTargetId}
          currentPosition={targetIndex}
          onConfirm={handleConfirmOverride}
          onCancel={() => {
            setShowManualOverrideModal(false);
            setOverrideTargetId(null);
          }}
        />
      );
    })()}

    {/* ─── Create Emergency Drawer (gated) ─── */}
    <CreateEmergencyDrawer
      isOpen={createEmergencyOpen}
      onClose={() => setCreateEmergencyOpen(false)}
      onCreate={handleCreateEmergency}
    />

    {/* ─── Live Alert Overlay — Top layer for new emergencies ─── */}
    <LiveAlertOverlay
      emergency={liveAlertEmergency}
      onOpenIncident={() => {
        setLiveAlertEmergency(null);
        setCurrentPage('overview');
      }}
      onDismiss={() => setLiveAlertEmergency(null)}
    />

    {/* ── Floating Tenant Banner — Trial/Billing Status ── */}
    <TenantBanner />

    {/* ── TEST BUTTONS moved to OverviewPage right sidebar per layout spec ── */}
    </>
  );
}