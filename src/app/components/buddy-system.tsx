// ═══════════════════════════════════════════════════════════════
// SOSphere — Buddy System (Enterprise Dashboard)
// ─────────────────────────────────────────────────────────────
// Pairs workers together for mutual safety monitoring
// When one triggers SOS → their buddy is auto-alerted
// Nearest buddy gets location + instructions
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Users, Link, Unlink, MapPin, Phone, Shield,
  CheckCircle, AlertTriangle, ChevronRight, X,
  Heart, Navigation, Clock, Bell, Eye, Zap,
  UserPlus, Search, PhoneCall, Send, UserCheck,
  CheckCircle2, ShieldCheck, Radio,
  Sparkles, CircleCheck, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticWarning, hapticMedium, hapticLight } from "./haptic-feedback";
import { TYPOGRAPHY, TOKENS, KPICard, Card, SectionHeader, Badge, StatPill } from "./design-system";
import { saveBuddyPairs, loadBuddyPairs, emitSyncEvent, type StoredBuddyPair } from "./shared-store";
import { useDashboardStore } from "./stores/dashboard-store";

// ── Types ─────────────────────────────────────────────────────
export interface BuddyPair {
  id: string;
  employee1: { id: string; name: string; role: string; zone: string; status: "on-shift" | "off-shift"; avatar: string };
  employee2: { id: string; name: string; role: string; zone: string; status: "on-shift" | "off-shift"; avatar: string };
  pairedAt: Date;
  isActive: boolean;
  lastCheckIn?: Date;
  responseTime?: string;
}

// ── GlowIcon ──────────────────────────────────────────────────
function GlowIcon({ icon: Icon, color, size = 40, iconSize = 20, pulse }: {
  icon: any; color: string; size?: number; iconSize?: number; pulse?: boolean;
}) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {pulse && (
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-xl"
          style={{ background: `${color}20`, filter: "blur(6px)" }}
        />
      )}
      <div className="relative flex items-center justify-center rounded-xl" style={{
        width: size, height: size,
        background: `linear-gradient(145deg, ${color}20, ${color}08)`,
        border: `1px solid ${color}25`,
        boxShadow: `0 4px 16px ${color}12, inset 0 1px 0 ${color}10`,
      }}>
        <Icon size={iconSize} color={color} strokeWidth={1.6} />
      </div>
    </div>
  );
}

// ── Mock Data ─────────────────────────────────────────────────
const MOCK_PAIRS: BuddyPair[] = [
  {
    id: "BP-001",
    employee1: { id: "EMP-001", name: "Ahmed Khalil", role: "Field Engineer", zone: "Zone A", status: "on-shift", avatar: "AK" },
    employee2: { id: "EMP-008", name: "Omar Al-Farsi", role: "Site Manager", zone: "Zone A", status: "on-shift", avatar: "OF" },
    pairedAt: new Date(Date.now() - 86400000), isActive: true, lastCheckIn: new Date(Date.now() - 300000), responseTime: "12s",
  },
  {
    id: "BP-002",
    employee1: { id: "EMP-003", name: "Khalid Omar", role: "Operator", zone: "Zone A", status: "on-shift", avatar: "KO" },
    employee2: { id: "EMP-013", name: "Ali Mansour", role: "Welder", zone: "Zone A", status: "on-shift", avatar: "AM" },
    pairedAt: new Date(Date.now() - 172800000), isActive: true, lastCheckIn: new Date(Date.now() - 600000), responseTime: "8s",
  },
  {
    id: "BP-003",
    employee1: { id: "EMP-005", name: "Sara Al-Mutairi", role: "HSE Coordinator", zone: "Zone C", status: "on-shift", avatar: "SM" },
    employee2: { id: "EMP-007", name: "Lina Chen", role: "Lab Technician", zone: "Zone C", status: "on-shift", avatar: "LC" },
    pairedAt: new Date(Date.now() - 259200000), isActive: true, lastCheckIn: new Date(Date.now() - 120000), responseTime: "15s",
  },
  {
    id: "BP-004",
    employee1: { id: "EMP-006", name: "Mohammed Ali", role: "Technician", zone: "Zone D", status: "on-shift", avatar: "MA" },
    employee2: { id: "EMP-010", name: "Aisha Rahman", role: "Fire Marshal", zone: "Zone D", status: "on-shift", avatar: "AR" },
    pairedAt: new Date(Date.now() - 86400000), isActive: true, lastCheckIn: new Date(Date.now() - 900000), responseTime: "22s",
  },
];

const UNASSIGNED = [
  { id: "EMP-011", name: "Hassan Jaber", role: "Crane Operator", zone: "Zone E", avatar: "HJ" },
  { id: "EMP-015", name: "Tariq Zayed", role: "Plumber", zone: "Zone D", avatar: "TZ" },
  { id: "EMP-017", name: "Faisal Qasim", role: "Driver", zone: "Logistics", avatar: "FQ" },
];

const ALL_WORKERS = [
  ...UNASSIGNED,
  { id: "EMP-002", name: "Youssef Nabil", role: "Electrician", zone: "Zone B", avatar: "YN" },
  { id: "EMP-009", name: "Layla Farouk", role: "Safety Officer", zone: "Zone B", avatar: "LF" },
  { id: "EMP-012", name: "Rami Haddad", role: "Supervisor", zone: "Zone E", avatar: "RH" },
  { id: "EMP-014", name: "Dana Khaleel", role: "Nurse", zone: "Zone C", avatar: "DK" },
  { id: "EMP-016", name: "Saeed Abbas", role: "Mechanic", zone: "Zone A", avatar: "SA" },
];

// ── Dashboard Buddy System Page ───────────────────────────────
export function BuddySystemPage({ t, webMode }: { t: (k: string) => string; webMode?: boolean }) {
  const storeEmployees = useDashboardStore(s => s.employees);

  // Build a real worker list from actual employees, fall back to ALL_WORKERS mock
  const realWorkers = useMemo(() => {
    if (storeEmployees && storeEmployees.length > 0) {
      return storeEmployees.map(e => ({
        id: e.id,
        name: e.name,
        role: e.role || "Worker",
        zone: e.zone || "Unknown",
        avatar: e.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
      }));
    }
    // Fall back to localStorage sosphere_employees
    try {
      const saved = JSON.parse(localStorage.getItem("sosphere_employees") || "[]");
      if (saved.length > 0) return saved.map((e: any) => ({
        id: e.id, name: e.name, role: e.role || "Worker", zone: e.zone || "Unknown",
        avatar: e.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
      }));
    } catch { /* fallback */ }
    return ALL_WORKERS;
  }, [storeEmployees]);

  const [pairs, setPairs] = useState(MOCK_PAIRS);
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "unassigned">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [calledPairs, setCalledPairs] = useState<Set<string>>(new Set());
  const [locatedPairs, setLocatedPairs] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorker1, setNewWorker1] = useState("");
  const [newWorker2, setNewWorker2] = useState("");
  const unassignedRef = useRef<HTMLDivElement>(null);

  // ── FIX 1: Persist buddy pairs to localStorage for cross-feature access ──
  // On mount: load saved pairs (if any), otherwise use MOCK_PAIRS as seed
  useEffect(() => {
    const saved = loadBuddyPairs();
    if (saved.length > 0) {
      // Rehydrate BuddyPair objects from stored format
      const rehydrated: BuddyPair[] = saved.map(sp => {
        // Try to find original mock pair for full employee data
        const mock = MOCK_PAIRS.find(m => m.id === sp.id);
        if (mock) return { ...mock, isActive: sp.isActive };
        // For newly created pairs, reconstruct from stored + ALL_WORKERS
        const w1 = realWorkers.find(w => w.id === sp.employee1Id);
        const w2 = realWorkers.find(w => w.id === sp.employee2Id);
        return {
          id: sp.id,
          employee1: w1
            ? { ...w1, status: "on-shift" as const, avatar: w1.avatar }
            : { id: sp.employee1Id, name: sp.employee1Name, role: "Worker", zone: "Unknown", status: "on-shift" as const, avatar: sp.employee1Name.split(" ").map(n => n[0]).join("") },
          employee2: w2
            ? { ...w2, status: "on-shift" as const, avatar: w2.avatar }
            : { id: sp.employee2Id, name: sp.employee2Name, role: "Worker", zone: "Unknown", status: "on-shift" as const, avatar: sp.employee2Name.split(" ").map(n => n[0]).join("") },
          pairedAt: new Date(),
          isActive: sp.isActive,
        };
      });
      setPairs(rehydrated);
    } else {
      // First run — seed with real employees if available, else use MOCK_PAIRS
      const initialPairs = (() => {
        try {
          const savedEmps = JSON.parse(localStorage.getItem("sosphere_employees") || "[]");
          if (savedEmps.length >= 2) {
            // Build real pairs from employee roster
            const paired: BuddyPair[] = [];
            for (let i = 0; i + 1 < savedEmps.length && paired.length < 4; i += 2) {
              const e1 = savedEmps[i], e2 = savedEmps[i + 1];
              const av1 = e1.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              const av2 = e2.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              paired.push({
                id: `BP-${Date.now()}-${i}`,
                employee1: { id: e1.id, name: e1.name, role: e1.role || "Worker", zone: e1.zone || "Unknown", status: "on-shift" as const, avatar: av1 },
                employee2: { id: e2.id, name: e2.name, role: e2.role || "Worker", zone: e2.zone || "Unknown", status: "on-shift" as const, avatar: av2 },
                pairedAt: new Date(), isActive: true,
                lastCheckIn: new Date(Date.now() - 600000), responseTime: "N/A",
              });
            }
            if (paired.length > 0) { syncPairsToStorage(paired); return; }
          }
        } catch { /* fall through */ }
        syncPairsToStorage(MOCK_PAIRS);
      })();
    }
  }, []);

  // Sync to localStorage whenever pairs change (after initial load)
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current) { initialLoadDone.current = true; return; }
    syncPairsToStorage(pairs);
  }, [pairs]);

  const filteredPairs = pairs.filter(p => {
    if (filter === "unassigned") return false; // unassigned filter shows workers, not pairs
    const matchesFilter = filter === "all" || (filter === "active" ? p.isActive : !p.isActive);
    const matchesSearch = !searchQuery ||
      p.employee1.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.employee2.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });
  const activePairs = pairs.filter(p => p.isActive).length;
  const totalWorkers = pairs.length * 2;

  // Dynamically compute unassigned workers: those not in any active buddy pair
  const pairedIds = new Set(
    pairs.filter(p => p.isActive).flatMap(p => [p.employee1.id, p.employee2.id])
  );
  const dynamicUnassigned = realWorkers.filter(w => !pairedIds.has(w.id));

  const handleToggle = useCallback((id: string) => {
    hapticMedium();
    setPairs(prev => {
      const pair = prev.find(p => p.id === id);
      if (!pair) return prev;
      const newState = !pair.isActive;
      toast(newState ? "Buddy Pair Activated" : "Buddy Pair Paused", {
        description: `${pair.employee1.name} & ${pair.employee2.name}`,
        icon: newState ? "✅" : "⏸️",
      });
      return prev.map(p => p.id === id ? { ...p, isActive: newState } : p);
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    hapticWarning();
    const pair = pairs.find(p => p.id === id);
    setPairs(prev => prev.filter(p => p.id !== id));
    toast("Buddy Pair Removed", {
      description: `${pair?.employee1.name} & ${pair?.employee2.name} have been unpaired`,
      icon: "🔓",
    });
  }, [pairs]);

  const handleCallBuddy = useCallback((pairId: string, name: string) => {
    hapticSuccess();
    setCalledPairs(prev => new Set([...prev, pairId]));
    toast.success("Calling Buddy", { description: `Initiating call to ${name}...` });
  }, []);

  const handleLocateBuddy = useCallback((pairId: string, name: string) => {
    hapticSuccess();
    setLocatedPairs(prev => new Set([...prev, pairId]));
    const pair = pairs.find(p => p.id === pairId);
    if (pair) {
      emitSyncEvent({
        type: "BUDDY_LOCATE_REQUEST",
        employeeId: pair.employee1.id,
        employeeName: pair.employee1.name,
        zone: pair.employee1.zone,
        timestamp: Date.now(),
        data: {
          buddyName: name,
          buddyZone: pair.employee2.zone,
        },
      });
    }
    console.log("[SUPABASE_READY] buddy_locate_requested: " + name);
    toast.success("Locating Buddy", { description: `GPS location of ${name} shown on map` });
  }, [pairs]);

  const handleConfirmCreate = useCallback(() => {
    if (!newWorker1 || !newWorker2) {
      hapticWarning();
      toast.error("Select Both Workers", { description: "You must select two workers to create a buddy pair" });
      return;
    }
    if (newWorker1 === newWorker2) {
      hapticWarning();
      toast.error("Different Workers Required", { description: "You cannot pair a worker with themselves" });
      return;
    }
    const w1 = realWorkers.find(w => w.id === newWorker1);
    const w2 = realWorkers.find(w => w.id === newWorker2);
    if (!w1 || !w2) return;
    const newPair: BuddyPair = {
      id: `BP-${Date.now()}`,
      employee1: { ...w1, status: "on-shift", avatar: w1.avatar },
      employee2: { ...w2, status: "on-shift", avatar: w2.avatar },
      pairedAt: new Date(), isActive: true,
    };
    setPairs(prev => [...prev, newPair]);
    setShowCreateModal(false);
    setNewWorker1("");
    setNewWorker2("");
    hapticSuccess();
    toast.success("Buddy Pair Created", { description: `${w1.name} & ${w2.name} are now buddies` });
  }, [newWorker1, newWorker2]);

  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 12,
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
    color: "#fff", fontSize: 13, fontFamily: "'Outfit', sans-serif", outline: "none",
    cursor: "pointer", appearance: "none" as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
  };

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Active Pairs" value={activePairs} icon={Link} color="#00C853"
          trend={{ value: "All connected", positive: true }} subtitle="Mutual safety monitoring" />
        <KPICard label="Workers Paired" value={totalWorkers} icon={Users} color="#00C8E0"
          subtitle="Covered by buddy system" trend={{ value: `${Math.round(totalWorkers / (totalWorkers + dynamicUnassigned.length) * 100)}% coverage`, positive: true }} />
        {/* Unassigned — amber warning card with Assign Now action */}
        <Card padding={18} glow={dynamicUnassigned.length > 0 ? "#FF9500" : undefined} style={dynamicUnassigned.length > 0 ? { border: "1px solid rgba(255,149,0,0.25)" } : undefined}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TYPOGRAPHY.overline, fontSize: 10, color: TOKENS.text.muted, marginBottom: 8 }}>Unassigned</div>
              <div style={{ ...TYPOGRAPHY.kpiValue, color: "#FF9500" }}>{dynamicUnassigned.length}</div>
              <div style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 6 }}>Need buddy assignment</div>
            </div>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "linear-gradient(135deg, rgba(255,149,0,0.12) 0%, rgba(255,149,0,0.04) 100%)",
              border: "1px solid rgba(255,149,0,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <UserPlus size={19} color="#FF9500" strokeWidth={1.8} />
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => {
              setFilter("unassigned");
              setSearchQuery("");
              setTimeout(() => unassignedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
            }}
            className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-lg"
            style={{
              background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.18)",
              cursor: "pointer",
            }}>
            <UserPlus size={11} color="#FF9500" strokeWidth={2} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>Assign Now</span>
          </motion.button>
        </Card>
        <KPICard label="Avg Response" value="14s" icon={Zap} color="#7B5EFF"
          trend={{ value: "↓ from 45s", positive: true }} subtitle="Buddy response time" />
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5 p-1.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            {(["all", "active", "inactive", "unassigned"] as const).map(f => (
              <motion.button key={f} whileTap={{ scale: 0.97 }} onClick={() => setFilter(f)}
                className="px-4 py-2 rounded-lg" style={{
                  background: filter === f ? "rgba(0,200,224,0.08)" : "transparent",
                  border: filter === f ? "1px solid rgba(0,200,224,0.18)" : "1px solid transparent",
                  cursor: "pointer",
                }}>
                <span style={{ ...TYPOGRAPHY.caption, fontWeight: filter === f ? 700 : 500, color: filter === f ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </span>
              </motion.button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <Search size={13} color="rgba(255,255,255,0.25)" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search workers..."
              className="bg-transparent outline-none text-white" style={{ ...TYPOGRAPHY.caption, width: 140, caretColor: "#00C8E0" }} />
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }}
          onClick={() => { hapticLight(); setShowCreateModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.06))",
            border: "1px solid rgba(0,200,224,0.18)", cursor: "pointer",
          }}>
          <UserPlus size={15} color="#00C8E0" strokeWidth={1.8} />
          <span style={{ ...TYPOGRAPHY.caption, color: "#00C8E0", fontWeight: 600 }}>Create Pair</span>
        </motion.button>
      </div>

      {/* Buddy Pairs / Unassigned Workers List */}
      <div className="space-y-3" ref={filter === "unassigned" ? unassignedRef : undefined}>
        {filter === "unassigned" ? (
          dynamicUnassigned.length === 0 ? (
            <Card padding={32}>
              <div className="text-center">
                <GlowIcon icon={CheckCircle2} color="#00C853" size={48} iconSize={22} />
                <p style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary, marginTop: 12 }}>All workers assigned</p>
                <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 4 }}>Every worker has an active buddy pair</p>
              </div>
            </Card>
          ) : (
            dynamicUnassigned.map(emp => (
              <motion.div key={emp.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-4 p-4 rounded-xl"
                style={{ background: "rgba(255,149,0,0.02)", border: "1px solid rgba(255,149,0,0.1)" }}>
                <div className="size-10 rounded-xl flex items-center justify-center" style={{
                  background: "linear-gradient(135deg, rgba(255,149,0,0.2), rgba(255,149,0,0.08))", border: "1px solid rgba(255,149,0,0.2)",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#FF9500" }}>{emp.avatar}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }} className="truncate">{emp.name}</p>
                    <Badge variant="warning" size="sm">Needs Buddy</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>
                      <MapPin size={9} /> {emp.zone}
                    </span>
                    <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>{emp.role}</span>
                    <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>{emp.id}</span>
                  </div>
                </div>
                <motion.button whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }}
                  onClick={() => { hapticLight(); setNewWorker1(emp.id); setShowCreateModal(true); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{
                    background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.06))",
                    border: "1px solid rgba(0,200,224,0.18)", cursor: "pointer",
                  }}>
                  <UserPlus size={13} color="#00C8E0" strokeWidth={1.8} />
                  <span style={{ ...TYPOGRAPHY.caption, color: "#00C8E0", fontWeight: 600 }}>Assign</span>
                </motion.button>
              </motion.div>
            ))
          )
        ) : filteredPairs.length === 0 ? (
          <Card padding={32}>
            <div className="text-center">
              <GlowIcon icon={Search} color="#00C8E0" size={48} iconSize={22} />
              <p style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary, marginTop: 12 }}>No pairs found</p>
              <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 4 }}>Try adjusting your search or filter</p>
            </div>
          </Card>
        ) : (
          filteredPairs.map(pair => (
            <BuddyPairCard key={pair.id} pair={pair}
              onToggle={() => handleToggle(pair.id)} onRemove={() => handleRemove(pair.id)}
              onCall={name => handleCallBuddy(pair.id, name)} onLocate={name => handleLocateBuddy(pair.id, name)}
              called={calledPairs.has(pair.id)} located={locatedPairs.has(pair.id)} />
          ))
        )}
      </div>

      {/* Unassigned Workers */}
      {filter !== "unassigned" && dynamicUnassigned.length > 0 && (
        <div ref={unassignedRef}>
          <SectionHeader title="Unassigned Workers" subtitle={`${dynamicUnassigned.length} workers need a buddy`}
            icon={AlertTriangle} color="#FF9500"
            action={{ label: "Auto-Assign", onClick: () => { hapticMedium(); toast("Auto-Assign", { description: "AI is finding optimal buddy pairs based on zone proximity..." }); } }} />
          <div className="grid grid-cols-3 gap-3 mt-3">
            {dynamicUnassigned.map(emp => (
              <Card key={emp.id} glow="#FF9500" padding={14}>
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-xl flex items-center justify-center" style={{
                    background: "linear-gradient(135deg, rgba(255,149,0,0.2), rgba(255,149,0,0.08))", border: "1px solid rgba(255,149,0,0.2)",
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#FF9500" }}>{emp.avatar}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }} className="truncate">{emp.name}</p>
                    <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 2 }}>{emp.role} · {emp.zone}</p>
                  </div>
                  <Badge variant="warning" size="sm">Needs Buddy</Badge>
                  <motion.button whileTap={{ scale: 0.9 }}
                    onClick={() => { hapticLight(); setNewWorker1(emp.id); setShowCreateModal(true); }}
                    className="size-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>
                    <UserPlus size={12} color="#00C8E0" />
                  </motion.button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* How It Works */}
      <Card glow="#00C8E0" padding={24}>
        <SectionHeader title="How Buddy System Works" subtitle="Mutual safety monitoring protocol" icon={ShieldCheck} color="#00C8E0" />
        <div className="grid grid-cols-4 gap-4 mt-4">
          {[
            { icon: Link, text: "Pair two workers in the same zone for mutual safety", color: "#00C8E0", step: "01" },
            { icon: Bell, text: "When one triggers SOS, their buddy is instantly alerted", color: "#FF2D55", step: "02" },
            { icon: MapPin, text: "Buddy receives exact GPS location of their partner", color: "#00C853", step: "03" },
            { icon: Navigation, text: "Buddy is closest responder — reaches them fastest", color: "#7B5EFF", step: "04" },
          ].map((item, i) => (
            <div key={i} className="text-center p-4 rounded-xl relative" style={{ background: `${item.color}04`, border: `1px solid ${item.color}10` }}>
              <div className="absolute top-3 right-3">
                <span style={{ ...TYPOGRAPHY.micro, color: `${item.color}40`, fontSize: 20, fontWeight: 900 }}>{item.step}</span>
              </div>
              <GlowIcon icon={item.icon} color={item.color} size={36} iconSize={16} />
              <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.secondary, marginTop: 10, lineHeight: 1.5 }}>{item.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ═════════════════════════════════════════════════════════ */}
      {/* CREATE PAIR MODAL                                       */}
      {/* ═════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
              onClick={() => setShowCreateModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] rounded-2xl overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #0A1220 0%, #050710 100%)",
                border: "1px solid rgba(0,200,224,0.15)",
                boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 60px rgba(0,200,224,0.05)",
              }}>
              {/* Header */}
              <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center gap-3">
                  <GlowIcon icon={UserPlus} color="#00C8E0" size={40} iconSize={18} />
                  <div>
                    <h3 style={{ ...TYPOGRAPHY.h2, color: TOKENS.text.primary }}>Create Buddy Pair</h3>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 2 }}>Select two workers for mutual safety</p>
                  </div>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowCreateModal(false)}
                  className="size-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
                  <X size={16} color="rgba(255,255,255,0.4)" />
                </motion.button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5">
                {/* Worker 1 */}
                <div>
                  <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>BUDDY 1</label>
                  <select value={newWorker1} onChange={e => setNewWorker1(e.target.value)} style={selectStyle}>
                    <option value="" style={{ background: "#0A1220" }}>Select first worker...</option>
                    {realWorkers.filter(w => w.id !== newWorker2).map(w => (
                      <option key={w.id} value={w.id} style={{ background: "#0A1220" }}>{w.name} — {w.role} ({w.zone})</option>
                    ))}
                  </select>
                </div>

                {/* Link Icon */}
                <div className="flex justify-center">
                  <div className="size-10 rounded-full flex items-center justify-center" style={{
                    background: newWorker1 && newWorker2 ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${newWorker1 && newWorker2 ? "rgba(0,200,83,0.2)" : "rgba(255,255,255,0.06)"}`,
                  }}>
                    <Link size={16} color={newWorker1 && newWorker2 ? "#00C853" : "rgba(255,255,255,0.2)"} />
                  </div>
                </div>

                {/* Worker 2 */}
                <div>
                  <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>BUDDY 2</label>
                  <select value={newWorker2} onChange={e => setNewWorker2(e.target.value)} style={selectStyle}>
                    <option value="" style={{ background: "#0A1220" }}>Select second worker...</option>
                    {realWorkers.filter(w => w.id !== newWorker1).map(w => (
                      <option key={w.id} value={w.id} style={{ background: "#0A1220" }}>{w.name} — {w.role} ({w.zone})</option>
                    ))}
                  </select>
                </div>

                {/* Zone match warning */}
                {newWorker1 && newWorker2 && (() => {
                  const w1 = realWorkers.find(w => w.id === newWorker1);
                  const w2 = realWorkers.find(w => w.id === newWorker2);
                  if (!w1 || !w2) return null;
                  const sameZone = w1.zone === w2.zone;
                  return (
                    <div className="flex items-center gap-3 p-3 rounded-xl" style={{
                      background: sameZone ? "rgba(0,200,83,0.04)" : "rgba(255,149,0,0.04)",
                      border: `1px solid ${sameZone ? "rgba(0,200,83,0.12)" : "rgba(255,149,0,0.12)"}`,
                    }}>
                      {sameZone ? <CheckCircle2 size={16} color="#00C853" /> : <AlertTriangle size={16} color="#FF9500" />}
                      <div>
                        <p style={{ ...TYPOGRAPHY.caption, color: sameZone ? "#00C853" : "#FF9500", fontWeight: 700 }}>
                          {sameZone ? "Same Zone — Optimal Pair" : "Different Zones — Consider Proximity"}
                        </p>
                        <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 2 }}>
                          {sameZone ? `Both workers are in ${w1.zone}` : `${w1.name} is in ${w1.zone}, ${w2.name} is in ${w2.zone}`}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="flex gap-3 p-6" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowCreateModal(false)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                  <span style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.muted, fontWeight: 600 }}>Cancel</span>
                </motion.button>
                <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }} onClick={handleConfirmCreate}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{
                    background: newWorker1 && newWorker2 ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.08))" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${newWorker1 && newWorker2 ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.04)"}`,
                    cursor: newWorker1 && newWorker2 ? "pointer" : "not-allowed",
                    opacity: newWorker1 && newWorker2 ? 1 : 0.5,
                  }}>
                  <UserPlus size={15} color="#00C8E0" />
                  <span style={{ ...TYPOGRAPHY.caption, color: "#00C8E0", fontWeight: 600 }}>Create Buddy Pair</span>
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Buddy Pair Card ───────────────────────────────────────────
function BuddyPairCard({ pair, onToggle, onRemove, onCall, onLocate, called, located }: {
  pair: BuddyPair; onToggle: () => void; onRemove: () => void;
  onCall: (name: string) => void; onLocate: (name: string) => void;
  called: boolean; located: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const e1 = pair.employee1;
  const e2 = pair.employee2;
  const sameZone = e1.zone === e2.zone;
  const checkInAgo = pair.lastCheckIn ? Math.round((Date.now() - pair.lastCheckIn.getTime()) / 60000) : null;

  return (
    <motion.div layout className="rounded-xl overflow-hidden" style={{
      background: pair.isActive ? "rgba(0,200,83,0.02)" : "rgba(255,255,255,0.015)",
      border: `1px solid ${pair.isActive ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.04)"}`,
    }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-4 p-4 text-left cursor-pointer">
        <div className="flex items-center -space-x-3">
          <div className="size-10 rounded-xl flex items-center justify-center border-2 z-10" style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.05))", borderColor: "#0A1220",
          }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#00C8E0" }}>{e1.avatar}</span>
          </div>
          <div className="size-10 rounded-xl flex items-center justify-center border-2" style={{
            background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))", borderColor: "#0A1220",
          }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#00C853" }}>{e2.avatar}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }} className="truncate">{e1.name} & {e2.name}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}><MapPin size={9} /> {e1.zone}</span>
            {!sameZone && <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: "#FF9500" }}><AlertTriangle size={9} /> {e2.zone}</span>}
            {checkInAgo !== null && <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: checkInAgo > 10 ? "#FF9500" : TOKENS.text.muted }}><Clock size={9} /> {checkInAgo}m ago</span>}
            {pair.responseTime && <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: "#7B5EFF" }}><Zap size={9} /> {pair.responseTime}</span>}
          </div>
        </div>
        <Badge variant={pair.isActive ? "success" : "muted"} pulse={pair.isActive} size="md">{pair.isActive ? "ACTIVE" : "PAUSED"}</Badge>
        <ChevronRight size={14} color="rgba(255,255,255,0.15)" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-5 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 14 }}>
              {[e1, e2].map((emp, i) => {
                const c = i === 0 ? "#00C8E0" : "#00C853";
                return (
                  <div key={emp.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: `${c}03`, border: `1px solid ${c}08` }}>
                    <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${c}20, ${c}08)`, border: `1px solid ${c}20` }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: c }}>{emp.avatar}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary }} className="truncate">{emp.name}</p>
                      <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 1 }}>{emp.role} · {emp.zone}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="size-2 rounded-full" style={{ background: emp.status === "on-shift" ? "#00C853" : "rgba(255,255,255,0.15)" }} />
                      <span style={{ ...TYPOGRAPHY.micro, color: emp.status === "on-shift" ? "#00C853" : TOKENS.text.muted }}>{emp.status === "on-shift" ? "On Shift" : "Off Shift"}</span>
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-3 pt-1">
                <ABtnComp icon={pair.isActive ? Unlink : Link} label={pair.isActive ? "Pause" : "Activate"} color={pair.isActive ? "#FF9500" : "#00C853"} onClick={onToggle} />
                <ABtnComp icon={called ? CheckCircle2 : PhoneCall} label={called ? "Called ✓" : "Call"} color="#00C8E0" onClick={() => onCall(e2.name)} done={called} />
                <ABtnComp icon={located ? CheckCircle2 : MapPin} label={located ? "Located ✓" : "Locate"} color="#7B5EFF" onClick={() => onLocate(e1.name)} done={located} />
                <ABtnComp icon={X} label="Remove" color="#FF2D55" onClick={onRemove} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ABtnComp({ icon: Icon, label, color, onClick, done }: { icon: any; label: string; color: string; onClick: () => void; done?: boolean }) {
  return (
    <motion.button whileHover={!done ? { scale: 1.03 } : {}} whileTap={!done ? { scale: 0.96 } : {}}
      onClick={!done ? onClick : undefined}
      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl"
      style={{ background: done ? "rgba(0,200,83,0.06)" : `${color}06`, border: `1px solid ${done ? "rgba(0,200,83,0.15)" : `${color}12`}`, color: done ? "#00C853" : color, cursor: done ? "default" : "pointer", ...TYPOGRAPHY.caption, fontWeight: 600 }}>
      <Icon size={14} strokeWidth={1.8} /> {label}
    </motion.button>
  );
}

// ── Helper Function ───────────────────────────────────────────
function syncPairsToStorage(pairs: BuddyPair[]) {
  const stored: StoredBuddyPair[] = pairs.map(p => ({
    id: p.id,
    employee1Id: p.employee1.id,
    employee1Name: p.employee1.name,
    employee2Id: p.employee2.id,
    employee2Name: p.employee2.name,
    isActive: p.isActive,
  }));
  saveBuddyPairs(stored);
}