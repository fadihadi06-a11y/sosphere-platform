// ═══════════════════════════════════════════════════════════════
// SOSphere — Training & Drill Center
// ─────────────────────────────────────────────────────────────
// Standalone route `/training` — comprehensive emergency
// training platform with 18 real-world scenarios, interactive
// drills, progress tracking, and linked demo walkthroughs.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import {
  Shield, Play, Pause, ChevronRight, ChevronLeft,
  AlertTriangle, CheckCircle2, Phone, MapPin, Clock,
  Wifi, WifiOff, Battery, User, Bell, Zap,
  MessageCircle, Navigation, ShieldCheck,
  Siren, Brain, Radio, Sparkles,
  Map, Route, Users, Flame,
  LocateFixed, Megaphone, ShieldAlert, ClipboardCheck,
  Lock, Sun, Moon, Award, Trophy, Target,
  ArrowRight, X, Star, Eye, RefreshCw,
  Crosshair, Heart, Ambulance, CloudLightning,
  Smartphone, Volume2, Download, BarChart3,
  Crown, Medal, TrendingUp, Activity,
  BookOpen, GraduationCap, Timer, Bookmark,
  RotateCcw, ArrowLeft,
} from "lucide-react";
import { hapticSuccess, playUISound } from "./haptic-feedback";
import { getAdminRating, getIREHistory, type AdminRating } from "./ire-performance-store";
import { MultiplayerDrill } from "./multiplayer-drill";
import { CertificationPanel } from "./certification-system";
import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

// ═══════════════════════════════════════════════════════════════
// Scenario Definitions — ALL 18 Emergency Types
// ═══════════════════════════════════════════════════════════════

interface DrillScenario {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: "sos" | "journey" | "hazard" | "communication" | "evacuation" | "medical";
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  icon: typeof Shield;
  color: string;
  expectedTimeSec: number;
  demoSceneId: string; // maps to wow-demo scene
  demoTimestamp: number; // seconds into the demo
  steps: DrillStep[];
  tips: string[];
  scoring: { speed: number; accuracy: number; completeness: number }; // weights out of 100
  realWorldExample: string;
}

interface DrillStep {
  id: string;
  phase: string;
  instruction: string;
  action: string; // what the admin should do
  autoAction?: boolean; // system auto-executes
  criticalTime?: number; // max seconds for this step
  icon: typeof Shield;
  color: string;
}

const CATEGORIES: Record<DrillScenario["category"], { label: string; color: string; icon: typeof Shield; description: string }> = {
  sos:            { label: "SOS Emergencies",     color: "#FF2D55", icon: Siren,          description: "Direct emergency alerts from field workers" },
  journey:        { label: "Journey Safety",      color: "#00C8E0", icon: Route,           description: "Trip tracking and route safety incidents" },
  hazard:         { label: "Environmental Hazard", color: "#FF9500", icon: CloudLightning, description: "Weather, chemical, and site hazards" },
  communication:  { label: "Communication",       color: "#AF52DE", icon: Megaphone,       description: "Network failures and broadcast scenarios" },
  evacuation:     { label: "Evacuation",          color: "#FF6B00", icon: ShieldAlert,     description: "Zone evacuation and assembly protocols" },
  medical:        { label: "Medical Emergency",   color: "#00C853", icon: Heart,           description: "Health crises and medical response" },
};

const DIFFICULTY_META: Record<DrillScenario["difficulty"], { label: string; color: string; stars: number }> = {
  beginner:     { label: "BEGINNER",     color: "#00C853", stars: 1 },
  intermediate: { label: "INTERMEDIATE", color: "#00C8E0", stars: 2 },
  advanced:     { label: "ADVANCED",     color: "#FF9500", stars: 3 },
  expert:       { label: "EXPERT",       color: "#FF2D55", stars: 4 },
};

const SCENARIOS: DrillScenario[] = [
  // ── SOS Emergencies ────────────────────────────────────────
  {
    id: "sos_button",
    title: "SOS Button Press",
    subtitle: "Worker manually triggers emergency",
    description: "A field worker has pressed the SOS button on their device. You must assess the situation, establish contact, locate the worker, and coordinate response within the critical first 5 minutes.",
    category: "sos", difficulty: "beginner",
    icon: Siren, color: "#FF2D55",
    expectedTimeSec: 180,
    demoSceneId: "sos", demoTimestamp: 44,
    steps: [
      { id: "s1", phase: "ASSESS", instruction: "Review the SOS alert details", action: "Check severity, zone, battery, and signal status", icon: Brain, color: "#8B5CF6" },
      { id: "s2", phase: "CONTACT", instruction: "Call the worker immediately", action: "Use the Call button — try cellular first, then WhatsApp", icon: Phone, color: "#00C853" },
      { id: "s3", phase: "LOCATE", instruction: "Track GPS position", action: "Open Risk Map and verify last known location", icon: Crosshair, color: "#00C8E0" },
      { id: "s4", phase: "RESPOND", instruction: "Dispatch nearest help", action: "Use Buddy System to find nearest colleague", icon: Users, color: "#FF9500" },
      { id: "s5", phase: "DOCUMENT", instruction: "Record incident details", action: "Take notes and ensure audio recording is active", icon: ClipboardCheck, color: "#7B5EFF" },
      { id: "s6", phase: "RESOLVE", instruction: "Confirm worker safety", action: "Mark as resolved once worker confirms safe", icon: CheckCircle2, color: "#00C853" },
    ],
    tips: ["Always call within 30 seconds", "Check battery level — if below 10%, prioritize GPS capture", "Use the IRE Guide Me button for AI-assisted response"],
    scoring: { speed: 40, accuracy: 30, completeness: 30 },
    realWorldExample: "Oil rig worker trapped by equipment malfunction in Zone C. SOS triggered via device. Response time: 2:34.",
  },
  {
    id: "fall_detected",
    title: "Fall Detection Alert",
    subtitle: "Automatic fall sensor triggered",
    description: "The device's accelerometer has detected a sudden impact consistent with a fall. The worker may be unconscious and unable to communicate. Time is critical.",
    category: "sos", difficulty: "intermediate",
    icon: AlertTriangle, color: "#FF2D55",
    expectedTimeSec: 150,
    demoSceneId: "sos", demoTimestamp: 44,
    steps: [
      { id: "f1", phase: "ASSESS", instruction: "Review fall detection data", action: "Check impact severity, device orientation, and movement after fall", icon: Brain, color: "#8B5CF6" },
      { id: "f2", phase: "CONTACT", instruction: "Attempt contact immediately", action: "Call worker — they may be unconscious, so also try buddy", icon: Phone, color: "#00C853", criticalTime: 30 },
      { id: "f3", phase: "LOCATE", instruction: "Lock GPS position", action: "GPS lock is critical — worker may not be able to share location", autoAction: true, icon: Crosshair, color: "#00C8E0" },
      { id: "f4", phase: "BUDDY", instruction: "Alert nearest buddy", action: "Activate Buddy System — dispatch nearest colleague to location", icon: Users, color: "#FF9500" },
      { id: "f5", phase: "MEDICAL", instruction: "Prepare medical info", action: "Check Medical ID — blood type, allergies, emergency contact", icon: Heart, color: "#FF2D55" },
      { id: "f6", phase: "ESCALATE", instruction: "Escalate if no response", action: "If no contact within 60s, trigger emergency services", icon: Ambulance, color: "#FF6B00" },
    ],
    tips: ["Fall detection is critical — assume worst case until confirmed otherwise", "If worker doesn't answer in 30s, immediately dispatch buddy", "Check Medical ID before dispatching ambulance"],
    scoring: { speed: 50, accuracy: 25, completeness: 25 },
    realWorldExample: "Construction worker fell from 3m scaffolding. Fall detected at 14:23. Buddy arrived in 90 seconds. Ambulance dispatched.",
  },
  {
    id: "shake_sos",
    title: "Shake-to-SOS",
    subtitle: "Worker shook phone violently to trigger SOS",
    description: "The worker shook their phone in a distress pattern, indicating they cannot use the screen (hands restrained, darkness, etc). This is a silent SOS — treat as high severity.",
    category: "sos", difficulty: "intermediate",
    icon: Smartphone, color: "#FF2D55",
    expectedTimeSec: 160,
    demoSceneId: "sos", demoTimestamp: 44,
    steps: [
      { id: "sh1", phase: "ASSESS", instruction: "Analyze shake pattern", action: "Silent SOS — worker may be in danger and unable to speak", icon: Brain, color: "#8B5CF6" },
      { id: "sh2", phase: "SILENT CONTACT", instruction: "Send silent chat message", action: "DO NOT call — use Emergency Chat for silent text communication", icon: MessageCircle, color: "#FF9500" },
      { id: "sh3", phase: "LOCATE", instruction: "Track live position", action: "Enable continuous GPS tracking — watch for movement", icon: Crosshair, color: "#00C8E0" },
      { id: "sh4", phase: "DISPATCH", instruction: "Dispatch security team", action: "Send nearest security personnel to GPS location", icon: Shield, color: "#FF2D55" },
      { id: "sh5", phase: "ESCALATE", instruction: "Alert zone admin", action: "Notify zone admin and prepare for potential evacuation", icon: Megaphone, color: "#AF52DE" },
    ],
    tips: ["NEVER call during a shake SOS — the worker may be hiding from danger", "Use Emergency Chat only — silent communication", "Track GPS movement patterns for situational awareness"],
    scoring: { speed: 35, accuracy: 45, completeness: 20 },
    realWorldExample: "Worker witnessed unauthorized site access. Used shake SOS to silently alert security. Chat-only communication prevented detection.",
  },
  {
    id: "missed_checkin",
    title: "Missed Check-In",
    subtitle: "Worker failed scheduled safety check-in",
    description: "A worker has missed their scheduled check-in by 15+ minutes. This could indicate device failure, injury, or unauthorized absence.",
    category: "sos", difficulty: "beginner",
    icon: Timer, color: "#FF9500",
    expectedTimeSec: 240,
    demoSceneId: "gps-compliance", demoTimestamp: 30,
    steps: [
      { id: "mc1", phase: "VERIFY", instruction: "Check last known status", action: "Review last GPS position, battery level, and signal strength", icon: Eye, color: "#00C8E0" },
      { id: "mc2", phase: "CONTACT", instruction: "Attempt contact", action: "Call worker — if no answer, try WhatsApp and buddy", icon: Phone, color: "#00C853" },
      { id: "mc3", phase: "INVESTIGATE", instruction: "Check zone activity", action: "Review if other workers in zone reported issues", icon: MapPin, color: "#FF9500" },
      { id: "mc4", phase: "ESCALATE", instruction: "Escalate if needed", action: "If no contact within 5 minutes, dispatch investigation", icon: AlertTriangle, color: "#FF2D55" },
    ],
    tips: ["Most missed check-ins are device issues — but never assume", "Check if the worker's shift has changed", "Cross-reference with buddy's check-in status"],
    scoring: { speed: 25, accuracy: 40, completeness: 35 },
    realWorldExample: "Worker's phone died during shift. Buddy confirmed safety within 3 minutes of missed check-in alert.",
  },
  // ── Journey Safety ─────────────────────────────────────────
  {
    id: "journey_sos",
    title: "Journey SOS",
    subtitle: "Worker triggers SOS during active trip",
    description: "A worker on an active journey between sites has triggered SOS. They are between checkpoints and may be in a remote area with limited signal.",
    category: "journey", difficulty: "advanced",
    icon: Route, color: "#00C8E0",
    expectedTimeSec: 200,
    demoSceneId: "riskmap", demoTimestamp: 8,
    steps: [
      { id: "j1", phase: "ASSESS", instruction: "Review journey context", action: "Check route, current position, next checkpoint, and deviation", icon: Map, color: "#00C8E0" },
      { id: "j2", phase: "CONTACT", instruction: "Establish communication", action: "Try cellular call — if signal weak, attempt satellite backup", icon: Phone, color: "#00C853" },
      { id: "j3", phase: "TRACK", instruction: "Enable live tracking", action: "Activate continuous GPS tracking on the trip route", autoAction: true, icon: Navigation, color: "#FF9500" },
      { id: "j4", phase: "DISPATCH", instruction: "Send rescue to route", action: "Dispatch team to last known position on route", icon: Ambulance, color: "#FF2D55" },
      { id: "j5", phase: "SECURE ROUTE", instruction: "Alert other travelers", action: "Broadcast warning to all workers on the same route", icon: Megaphone, color: "#AF52DE" },
      { id: "j6", phase: "DOCUMENT", instruction: "Log journey incident", action: "Record incident in journey log with GPS trail", icon: ClipboardCheck, color: "#7B5EFF" },
    ],
    tips: ["Journey workers may have weak signal — try multiple communication methods", "Use Trip Replay to understand the worker's route", "Check weather conditions along the route"],
    scoring: { speed: 40, accuracy: 35, completeness: 25 },
    realWorldExample: "Pipeline inspector's vehicle broke down on desert route. Journey SOS triggered 45km from nearest checkpoint. Rescue dispatched using GPS coordinates.",
  },
  {
    id: "journey_deviation",
    title: "Route Deviation",
    subtitle: "Worker strayed from assigned route",
    description: "A worker on an active journey has deviated significantly from their assigned route. This could indicate a wrong turn, road closure, or potential distress.",
    category: "journey", difficulty: "intermediate",
    icon: Navigation, color: "#FF9500",
    expectedTimeSec: 180,
    demoSceneId: "riskmap", demoTimestamp: 8,
    steps: [
      { id: "rd1", phase: "ANALYZE", instruction: "Check deviation distance", action: "Review how far off-route the worker is and direction of travel", icon: Map, color: "#00C8E0" },
      { id: "rd2", phase: "CONTACT", instruction: "Ask for explanation", action: "Call worker to verify reason for deviation", icon: Phone, color: "#00C853" },
      { id: "rd3", phase: "ASSESS RISK", instruction: "Evaluate new route risk", action: "Check if deviation enters a high-risk or restricted zone", icon: AlertTriangle, color: "#FF9500" },
      { id: "rd4", phase: "GUIDE", instruction: "Provide navigation", action: "Send corrected route via Emergency Chat if needed", icon: Navigation, color: "#00C8E0" },
    ],
    tips: ["Deviation doesn't always mean danger — road closures are common", "Check for known road hazards on the deviation path", "If worker doesn't respond, treat as potential SOS"],
    scoring: { speed: 25, accuracy: 45, completeness: 30 },
    realWorldExample: "Driver deviated 12km due to flash flooding on primary route. Admin confirmed safety and approved alternate path.",
  },
  {
    id: "journey_no_contact",
    title: "Journey Lost Contact",
    subtitle: "No signal from worker during active trip",
    description: "A worker on an active journey has gone silent — no GPS updates, no check-ins, no signal. Last known position was in a remote area.",
    category: "journey", difficulty: "expert",
    icon: WifiOff, color: "#FF2D55",
    expectedTimeSec: 120,
    demoSceneId: "escalation", demoTimestamp: 52,
    steps: [
      { id: "lc1", phase: "VERIFY", instruction: "Check last signal data", action: "Review last GPS, battery, and signal before lost contact", icon: Wifi, color: "#FF9500" },
      { id: "lc2", phase: "PREDICT", instruction: "Estimate current position", action: "Use last speed and direction to predict current location", autoAction: true, icon: Brain, color: "#8B5CF6" },
      { id: "lc3", phase: "DISPATCH", instruction: "Immediate dispatch", action: "Send rescue team to predicted location — don't wait", icon: Ambulance, color: "#FF2D55", criticalTime: 60 },
      { id: "lc4", phase: "BROADCAST", instruction: "Alert all nearby workers", action: "Broadcast to all workers in surrounding zones", icon: Megaphone, color: "#AF52DE" },
      { id: "lc5", phase: "ESCALATE", instruction: "Full escalation chain", action: "Activate 4-level escalation — include emergency services", icon: Radio, color: "#FF2D55" },
    ],
    tips: ["Lost contact during journey is ALWAYS treated as critical", "The AI predicts position based on last speed/direction — use this", "Don't wait for signal to return — dispatch immediately"],
    scoring: { speed: 55, accuracy: 25, completeness: 20 },
    realWorldExample: "Survey team lost contact in mountainous terrain. AI predicted position within 500m. Rescue helicopter dispatched within 8 minutes.",
  },
  // ── Environmental Hazards ──────────────────────────────────
  {
    id: "h2s_gas_leak",
    title: "H2S Gas Detection",
    subtitle: "Toxic gas sensor threshold exceeded",
    description: "H2S levels have exceeded safe thresholds in Zone C. Multiple workers are in the affected area. You must initiate evacuation and account for all personnel.",
    category: "hazard", difficulty: "expert",
    icon: CloudLightning, color: "#FF9500",
    expectedTimeSec: 120,
    demoSceneId: "intelligence", demoTimestamp: 22,
    steps: [
      { id: "h1", phase: "ALERT", instruction: "Acknowledge hazard alert", action: "Confirm H2S levels and affected zone", autoAction: true, icon: AlertTriangle, color: "#FF2D55" },
      { id: "h2", phase: "EVACUATE", instruction: "Trigger zone evacuation", action: "Initiate immediate evacuation of Zone C", icon: ShieldAlert, color: "#FF6B00", criticalTime: 30 },
      { id: "h3", phase: "BROADCAST", instruction: "Emergency broadcast", action: "Send high-priority broadcast to ALL affected workers", icon: Megaphone, color: "#AF52DE" },
      { id: "h4", phase: "HEADCOUNT", instruction: "Track evacuation progress", action: "Monitor assembly point check-ins for 100% accountability", icon: Users, color: "#00C8E0" },
      { id: "h5", phase: "SERVICES", instruction: "Contact emergency services", action: "Call HazMat team and nearest hospital", icon: Ambulance, color: "#FF2D55" },
      { id: "h6", phase: "SECURE", instruction: "Lock down zone", action: "Prevent re-entry until all-clear from HazMat", icon: Lock, color: "#FF9500" },
    ],
    tips: ["H2S is lethal at high concentrations — every second counts", "Wind direction determines evacuation route", "Check for workers with respiratory conditions in Medical ID"],
    scoring: { speed: 55, accuracy: 25, completeness: 20 },
    realWorldExample: "H2S spike detected in processing plant Zone C. 23 workers evacuated in 4 minutes. Zero casualties due to proactive monitoring.",
  },
  {
    id: "extreme_weather",
    title: "Extreme Weather Alert",
    subtitle: "Dangerous weather conditions incoming",
    description: "A severe sandstorm/heat wave/lightning storm is approaching your site. Workers in exposed zones need shelter immediately.",
    category: "hazard", difficulty: "intermediate",
    icon: Sun, color: "#FF9500",
    expectedTimeSec: 300,
    demoSceneId: "intelligence", demoTimestamp: 22,
    steps: [
      { id: "ew1", phase: "ASSESS", instruction: "Review weather data", action: "Check temperature, wind speed, visibility forecasts", icon: CloudLightning, color: "#4A90D9" },
      { id: "ew2", phase: "CLASSIFY", instruction: "Determine risk level", action: "Rate severity — Advisory / Warning / Emergency", icon: AlertTriangle, color: "#FF9500" },
      { id: "ew3", phase: "BROADCAST", instruction: "Alert all workers", action: "Zone-targeted broadcast with shelter instructions", icon: Megaphone, color: "#AF52DE" },
      { id: "ew4", phase: "MODIFY", instruction: "Adjust operations", action: "Suspend outdoor work, modify shift schedules", icon: ClipboardCheck, color: "#00C853" },
      { id: "ew5", phase: "MONITOR", instruction: "Continuous monitoring", action: "Track weather progression and worker compliance", icon: Eye, color: "#00C8E0" },
    ],
    tips: ["Proactive weather alerts from Safety Intelligence can give 45-minute advance warning", "Check outdoor worker locations first", "Heat stress is gradual — monitor even after initial alert"],
    scoring: { speed: 20, accuracy: 40, completeness: 40 },
    realWorldExample: "Sandstorm warning triggered 45 minutes ahead. All 156 outdoor workers sheltered before arrival. Zero heat/dust injuries.",
  },
  // ── Communication ──────────────────────────────────────────
  {
    id: "network_failure",
    title: "Network Failure",
    subtitle: "Communication infrastructure down",
    description: "Cellular network has gone down in Zone B. 15 workers are now offline. You cannot reach them by phone, GPS updates have stopped.",
    category: "communication", difficulty: "expert",
    icon: WifiOff, color: "#AF52DE",
    expectedTimeSec: 180,
    demoSceneId: "broadcast", demoTimestamp: 37,
    steps: [
      { id: "nf1", phase: "IDENTIFY", instruction: "Map affected workers", action: "List all workers whose last signal was in affected zone", autoAction: true, icon: Users, color: "#00C8E0" },
      { id: "nf2", phase: "LAST KNOWN", instruction: "Review last positions", action: "Capture and save last GPS coordinates for all affected workers", icon: MapPin, color: "#FF9500" },
      { id: "nf3", phase: "PHYSICAL CHECK", instruction: "Deploy field check", action: "Send zone supervisor for physical headcount", icon: User, color: "#00C853", criticalTime: 120 },
      { id: "nf4", phase: "BUDDY VERIFY", instruction: "Cross-reference buddies", action: "Check if any affected workers have buddies with signal", icon: Users, color: "#FF9500" },
      { id: "nf5", phase: "ESCALATE", instruction: "Notify management", action: "Escalate to Main Admin — network failure affects safety coverage", icon: Radio, color: "#FF2D55" },
    ],
    tips: ["Network failure is a safety emergency — workers can't call for help", "Use satellite backup if available", "Physical headcount is the only reliable verification when network is down"],
    scoring: { speed: 30, accuracy: 40, completeness: 30 },
    realWorldExample: "Cell tower maintenance knocked out Zone B coverage for 2 hours. Physical headcount confirmed all 15 workers safe within 20 minutes.",
  },
  {
    id: "mass_broadcast",
    title: "Mass Emergency Broadcast",
    subtitle: "Critical message to all workers",
    description: "A critical situation requires immediate notification to all 500+ workers across all zones. You must craft and send an emergency broadcast.",
    category: "communication", difficulty: "beginner",
    icon: Megaphone, color: "#AF52DE",
    expectedTimeSec: 120,
    demoSceneId: "broadcast", demoTimestamp: 37,
    steps: [
      { id: "mb1", phase: "CRAFT", instruction: "Write clear message", action: "Use template or write concise emergency message", icon: MessageCircle, color: "#AF52DE" },
      { id: "mb2", phase: "TARGET", instruction: "Select audience", action: "Choose all zones or specific zones/roles", icon: Target, color: "#00C8E0" },
      { id: "mb3", phase: "SEND", instruction: "Send broadcast", action: "Send with HIGH priority flag", icon: Megaphone, color: "#FF2D55" },
      { id: "mb4", phase: "TRACK", instruction: "Monitor delivery", action: "Track read receipts and acknowledgments", icon: Eye, color: "#00C853" },
    ],
    tips: ["Keep messages under 160 characters for SMS fallback", "Always include: What happened, What to do, Where to go", "Use templates for faster response"],
    scoring: { speed: 35, accuracy: 40, completeness: 25 },
    realWorldExample: "Gas leak in adjacent facility required site-wide shelter-in-place. Broadcast reached 523 workers in 12 seconds.",
  },
  // ── Evacuation ─────────────────────────────────────────────
  {
    id: "zone_evacuation",
    title: "Zone Evacuation",
    subtitle: "Emergency evacuation of a specific zone",
    description: "Zone D requires immediate evacuation due to structural concern. 34 workers must reach assembly points safely with 100% accountability.",
    category: "evacuation", difficulty: "advanced",
    icon: ShieldAlert, color: "#FF6B00",
    expectedTimeSec: 300,
    demoSceneId: "evacuation", demoTimestamp: 67,
    steps: [
      { id: "ze1", phase: "TRIGGER", instruction: "Initiate zone evacuation", action: "Activate evacuation protocol for Zone D", icon: ShieldAlert, color: "#FF2D55", criticalTime: 15 },
      { id: "ze2", phase: "BROADCAST", instruction: "Send evacuation order", action: "Emergency broadcast with assembly point and route", autoAction: true, icon: Megaphone, color: "#AF52DE" },
      { id: "ze3", phase: "GUIDE", instruction: "Provide route guidance", action: "Ensure workers receive GPS-guided evacuation routes", icon: Navigation, color: "#00C8E0" },
      { id: "ze4", phase: "HEADCOUNT", instruction: "Track assembly check-ins", action: "Monitor real-time headcount at assembly points", icon: Users, color: "#00C853" },
      { id: "ze5", phase: "MISSING", instruction: "Account for missing", action: "If headcount < expected, dispatch search for missing workers", icon: Crosshair, color: "#FF2D55" },
      { id: "ze6", phase: "ALL CLEAR", instruction: "Confirm 100% accounted", action: "Only issue all-clear when every worker is accounted for", icon: CheckCircle2, color: "#00C853" },
    ],
    tips: ["Never skip headcount — even one missing worker could be in danger", "Assembly points should be upwind and uphill", "Use buddy system for accountability"],
    scoring: { speed: 40, accuracy: 35, completeness: 25 },
    realWorldExample: "Structural crack detected in warehouse Zone D. 34 workers evacuated to Assembly Point Alpha in 6 minutes. 100% accounted.",
  },
  {
    id: "multi_zone_evacuation",
    title: "Multi-Zone Evacuation",
    subtitle: "Site-wide evacuation emergency",
    description: "A major incident requires evacuating the entire site — all zones, all workers. This is the highest-level emergency response.",
    category: "evacuation", difficulty: "expert",
    icon: Siren, color: "#FF2D55",
    expectedTimeSec: 180,
    demoSceneId: "evacuation", demoTimestamp: 67,
    steps: [
      { id: "mz1", phase: "TRIGGER ALL", instruction: "Site-wide evacuation", action: "Activate ALL zone evacuations simultaneously", icon: Siren, color: "#FF2D55", criticalTime: 10 },
      { id: "mz2", phase: "EMERGENCY SERVICES", instruction: "Contact 911/997", action: "Immediately notify emergency services", icon: Ambulance, color: "#FF2D55" },
      { id: "mz3", phase: "BROADCAST", instruction: "Emergency broadcast ALL", action: "Send maximum priority broadcast to every device", autoAction: true, icon: Megaphone, color: "#AF52DE" },
      { id: "mz4", phase: "COORDINATE", instruction: "Manage assembly points", action: "Monitor all assembly points across the site", icon: MapPin, color: "#00C8E0" },
      { id: "mz5", phase: "SWEEP", instruction: "Deploy sweep teams", action: "Send teams to clear each zone systematically", icon: Crosshair, color: "#FF9500" },
      { id: "mz6", phase: "VERIFY", instruction: "100% accountability", action: "Cross-reference headcount with shift roster", icon: CheckCircle2, color: "#00C853" },
    ],
    tips: ["Site-wide evacuation is the most complex scenario — stay calm", "Delegate zone headcounts to zone admins", "Emergency services should be contacted within 10 seconds"],
    scoring: { speed: 50, accuracy: 30, completeness: 20 },
    realWorldExample: "Explosion risk from gas pipeline breach. 412 workers evacuated from 6 zones in 11 minutes. All accounted for.",
  },
  // ── Medical ────────────────────────────────────────────────
  {
    id: "medical_emergency",
    title: "Medical Emergency",
    subtitle: "Worker experiencing health crisis",
    description: "A worker is reporting chest pain and dizziness. You need to provide immediate guidance and coordinate medical response.",
    category: "medical", difficulty: "advanced",
    icon: Heart, color: "#00C853",
    expectedTimeSec: 150,
    demoSceneId: "response", demoTimestamp: 59,
    steps: [
      { id: "me1", phase: "ASSESS", instruction: "Get vital information", action: "Ask: conscious? breathing? chest pain? medication?", icon: Heart, color: "#FF2D55" },
      { id: "me2", phase: "MEDICAL ID", instruction: "Check Medical ID", action: "Review blood type, allergies, conditions, medications", autoAction: true, icon: ClipboardCheck, color: "#00C853" },
      { id: "me3", phase: "FIRST AID", instruction: "Guide first aid", action: "Instruct worker to sit, stay calm, loosen clothing", icon: Shield, color: "#00C8E0" },
      { id: "me4", phase: "DISPATCH", instruction: "Call ambulance", action: "Dispatch medical team with GPS coordinates", icon: Ambulance, color: "#FF2D55", criticalTime: 60 },
      { id: "me5", phase: "BUDDY", instruction: "Alert nearest buddy", action: "Buddy should stay with worker until help arrives", icon: Users, color: "#FF9500" },
      { id: "me6", phase: "PREPARE", instruction: "Prepare for handoff", action: "Share Medical ID with arriving paramedics", icon: Download, color: "#7B5EFF" },
    ],
    tips: ["Medical ID data can save lives — blood type and allergies are critical for paramedics", "Keep the worker talking to monitor consciousness", "Don't attempt to diagnose — focus on getting professional help fast"],
    scoring: { speed: 40, accuracy: 35, completeness: 25 },
    realWorldExample: "Worker experienced heat stroke symptoms. Medical ID revealed diabetes. Paramedics treated with glucose IV within 8 minutes.",
  },
  {
    id: "multi_casualty",
    title: "Multi-Casualty Incident",
    subtitle: "Multiple workers affected simultaneously",
    description: "An explosion or collapse has affected multiple workers in Zone A. You're receiving SOS from 4+ workers simultaneously. Triage and coordinate.",
    category: "medical", difficulty: "expert",
    icon: Ambulance, color: "#FF2D55",
    expectedTimeSec: 120,
    demoSceneId: "escalation", demoTimestamp: 52,
    steps: [
      { id: "mc1", phase: "TRIAGE", instruction: "Prioritize by severity", action: "Sort emergencies — critical first, then high, then medium", icon: AlertTriangle, color: "#FF2D55", criticalTime: 20 },
      { id: "mc2", phase: "MASS DISPATCH", instruction: "Request multiple units", action: "Call emergency services — specify MULTI-CASUALTY", icon: Ambulance, color: "#FF2D55" },
      { id: "mc3", phase: "EVACUATE ZONE", instruction: "Clear the area", action: "Evacuate Zone A — prevent secondary injuries", icon: ShieldAlert, color: "#FF6B00" },
      { id: "mc4", phase: "ASSIGN BUDDIES", instruction: "Pair responders", action: "Each affected worker gets a designated responder", icon: Users, color: "#FF9500" },
      { id: "mc5", phase: "TRACK ALL", instruction: "Monitor all patients", action: "Track status of each affected worker simultaneously", icon: Activity, color: "#00C8E0" },
      { id: "mc6", phase: "ESCALATE MAX", instruction: "Full chain activation", action: "Activate complete escalation chain — Owner level", icon: Radio, color: "#FF2D55" },
    ],
    tips: ["Multi-casualty requires delegation — you cannot handle everything alone", "Call for emergency services FIRST, then triage", "Use the SOS popup's multi-emergency navigation to switch between workers"],
    scoring: { speed: 50, accuracy: 30, completeness: 20 },
    realWorldExample: "Scaffolding collapse affected 5 workers. Triage identified 2 critical. Ambulances dispatched in 90 seconds. All workers survived.",
  },
  // ── More SOS ───────────────────────────────────────────────
  {
    id: "geofence_breach",
    title: "Geofence Breach",
    subtitle: "Worker entered restricted/unauthorized zone",
    description: "A worker has crossed into a restricted geofenced area. This could be accidental or indicate disorientation.",
    category: "sos", difficulty: "beginner",
    icon: LocateFixed, color: "#FF9500",
    expectedTimeSec: 300,
    demoSceneId: "gps-compliance", demoTimestamp: 30,
    steps: [
      { id: "gb1", phase: "VERIFY", instruction: "Confirm breach", action: "Check if the worker is actually outside their zone", icon: MapPin, color: "#FF9500" },
      { id: "gb2", phase: "CONTACT", instruction: "Call worker", action: "Ask worker to explain — accidental or intentional?", icon: Phone, color: "#00C853" },
      { id: "gb3", phase: "GUIDE BACK", instruction: "Direct to safe zone", action: "Provide navigation back to assigned zone", icon: Navigation, color: "#00C8E0" },
      { id: "gb4", phase: "LOG", instruction: "Document incident", action: "Record breach in compliance log", icon: ClipboardCheck, color: "#7B5EFF" },
    ],
    tips: ["GPS drift can cause false breaches — verify with the worker", "Check if the restricted zone has environmental hazards", "Repeated breaches may indicate zone boundaries need adjustment"],
    scoring: { speed: 20, accuracy: 45, completeness: 35 },
    realWorldExample: "Worker crossed into construction blast zone during lunch break. Immediate recall prevented exposure to blasting operations.",
  },
  {
    id: "night_shift_emergency",
    title: "Night Shift Emergency",
    subtitle: "Emergency during low-visibility shift",
    description: "An SOS triggered at 2:30 AM during night shift. Reduced staff, limited visibility, and fatigue increase response complexity.",
    category: "sos", difficulty: "advanced",
    icon: Moon, color: "#4A90D9",
    expectedTimeSec: 200,
    demoSceneId: "response", demoTimestamp: 59,
    steps: [
      { id: "ns1", phase: "ASSESS", instruction: "Evaluate night conditions", action: "Check: lighting, weather, zone accessibility at night", icon: Moon, color: "#4A90D9" },
      { id: "ns2", phase: "CONTACT", instruction: "Multi-method contact", action: "Call + chat + buddy — night workers may be drowsy", icon: Phone, color: "#00C853" },
      { id: "ns3", phase: "LOCATE", instruction: "High-precision tracking", action: "GPS + flashlight signal request (via chat)", icon: Crosshair, color: "#00C8E0" },
      { id: "ns4", phase: "DISPATCH", instruction: "Night-equipped team", action: "Ensure responders have lights and night safety gear", icon: Users, color: "#FF9500" },
      { id: "ns5", phase: "ESCALATE", instruction: "Wake chain if needed", action: "May need to wake off-shift supervisors", icon: Radio, color: "#FF2D55" },
    ],
    tips: ["Night emergencies take 40% longer to respond — factor this in", "Ask worker to activate phone flashlight if possible", "On-shift staff is minimal — may need to wake backup"],
    scoring: { speed: 35, accuracy: 35, completeness: 30 },
    realWorldExample: "Security guard found unconscious at 3 AM. Night buddy discovered him during patrol. Ambulance arrived in 7 minutes.",
  },
  {
    id: "remote_isolation",
    title: "Remote Worker Isolation",
    subtitle: "Solo worker in remote area stops responding",
    description: "A lone worker in a remote site has stopped all activity — no GPS movement, no check-ins, no responses. They are the only person at the location.",
    category: "medical", difficulty: "expert",
    icon: User, color: "#FF6B00",
    expectedTimeSec: 150,
    demoSceneId: "escalation", demoTimestamp: 52,
    steps: [
      { id: "ri1", phase: "URGENCY", instruction: "Treat as CRITICAL", action: "Lone worker = maximum urgency. No one nearby to help.", icon: AlertTriangle, color: "#FF2D55", criticalTime: 15 },
      { id: "ri2", phase: "ALL CHANNELS", instruction: "Try every contact method", action: "Call, WhatsApp, SMS, Emergency Chat, buddy call — everything", icon: Phone, color: "#00C853" },
      { id: "ri3", phase: "DISPATCH NOW", instruction: "Immediate dispatch", action: "Don't wait — send nearest team to GPS location NOW", icon: Ambulance, color: "#FF2D55", criticalTime: 30 },
      { id: "ri4", phase: "SERVICES", instruction: "Alert emergency services", action: "Prepare ambulance for worst-case scenario", icon: Heart, color: "#FF2D55" },
      { id: "ri5", phase: "MANAGEMENT", instruction: "Full escalation", action: "Notify Owner — solo worker non-responsive is top priority", icon: Radio, color: "#AF52DE" },
    ],
    tips: ["Solo worker emergencies are the most dangerous — there's no one to help them", "Never wait for response — dispatch immediately", "Check if the location has known hazards (wildlife, terrain, temperature)"],
    scoring: { speed: 55, accuracy: 25, completeness: 20 },
    realWorldExample: "Pipeline technician collapsed from dehydration at remote pump station. Dispatch arrived in 25 minutes. Worker survived due to immediate response.",
  },
];

const STORAGE_KEY = "sosphere_drill_progress";

interface DrillProgress {
  scenarioId: string;
  completed: boolean;
  bestScore: number;
  bestTime: number;
  attempts: number;
  lastAttempt: string;
}

function loadProgress(): Record<string, DrillProgress> {
  return loadJSONSync<Record<string, DrillProgress>>(STORAGE_KEY, {});
}

function saveProgress(progress: Record<string, DrillProgress>) {
  storeJSONSync(STORAGE_KEY, progress);
}

// Circle placeholder for uncompleted steps
const StepCircle = (props: any) => (
  <div className={props.className} style={{ ...props.style, width: 16, height: 16, borderRadius: "50%", border: `2px solid ${props.style?.color || "rgba(255,255,255,0.1)"}`, flexShrink: 0 }} />
);

// ═══════════════════════════════════════════════════════════════
// Difficulty Badge
// ═══════════════════════════════════════════════════════════════
function DifficultyBadge({ difficulty }: { difficulty: DrillScenario["difficulty"] }) {
  const m = DIFFICULTY_META[difficulty];
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
      style={{ background: `${m.color}12`, border: `1px solid ${m.color}25` }}>
      <div className="flex gap-px">
        {Array.from({ length: 4 }).map((_, i) => (
          <Star key={i} className="size-2" style={{ color: i < m.stars ? m.color : "rgba(255,255,255,0.1)" }}
            fill={i < m.stars ? m.color : "none"} />
        ))}
      </div>
      <span style={{ fontSize: 7, fontWeight: 800, color: m.color, letterSpacing: "0.5px" }}>{m.label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Active Drill Component
// ═══════════════════════════════════════════════════════════════
function ActiveDrill({
  scenario,
  onComplete,
  onExit,
  onWatchDemo,
}: {
  scenario: DrillScenario;
  onComplete: (score: number, timeSec: number) => void;
  onExit: () => void;
  onWatchDemo: (sceneId: string, timestamp: number) => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(100);
  const [showHint, setShowHint] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const scoreRef = useRef(score);
  scoreRef.current = score;

  // Timer
  useEffect(() => {
    if (isPaused || showComplete) return;
    const t = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => clearInterval(t);
  }, [isPaused, showComplete]);

  // Score decay
  useEffect(() => {
    if (isPaused || showComplete) return;
    const decay = setInterval(() => {
      setScore(p => Math.max(10, p - 0.15));
    }, 1000);
    return () => clearInterval(decay);
  }, [isPaused, showComplete]);

  const step = scenario.steps[currentStep];

  const completeStep = () => {
    playUISound("actionDone");
    const newCompleted = new Set(completedSteps);
    newCompleted.add(currentStep);
    setCompletedSteps(newCompleted);

    // Bonus for speed
    if (step?.criticalTime && elapsed < step.criticalTime) {
      setScore(p => Math.min(100, p + 3));
    }

    if (currentStep < scenario.steps.length - 1) {
      setCurrentStep(currentStep + 1);
      playUISound("phaseComplete");
    } else {
      // Drill complete
      hapticSuccess();
      setShowComplete(true);
    }
  };

  const handleFinish = () => {
    onComplete(Math.round(scoreRef.current), elapsed);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const progress = ((completedSteps.size) / scenario.steps.length) * 100;
  const scoreColor = score >= 85 ? "#00C853" : score >= 60 ? "#00C8E0" : score >= 40 ? "#FF9500" : "#FF2D55";
  const timeStatus = elapsed <= scenario.expectedTimeSec ? "good" : elapsed <= scenario.expectedTimeSec * 1.5 ? "warning" : "over";

  if (showComplete) {
    const finalScore = Math.round(scoreRef.current);
    const gradeLabel = finalScore >= 90 ? "OUTSTANDING" : finalScore >= 75 ? "EXCELLENT" : finalScore >= 60 ? "GOOD" : finalScore >= 40 ? "NEEDS IMPROVEMENT" : "FAILED";
    const gradeColor = finalScore >= 90 ? "#FFD700" : finalScore >= 75 ? "#00C853" : finalScore >= 60 ? "#00C8E0" : finalScore >= 40 ? "#FF9500" : "#FF2D55";

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "#05070E" }}
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300 }}
          className="w-full max-w-md p-6 rounded-3xl"
          style={{ background: "rgba(10,18,32,0.95)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Score */}
          <div className="flex flex-col items-center mb-6">
            <div className="relative size-32 mb-3">
              <svg className="size-32 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
                <motion.circle
                  cx="50" cy="50" r="42" fill="none" stroke={gradeColor}
                  strokeWidth="5" strokeLinecap="round" strokeDasharray={264}
                  initial={{ strokeDashoffset: 264 }}
                  animate={{ strokeDashoffset: 264 * (1 - finalScore / 100) }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.3, type: "spring" }}
                  style={{ fontSize: 36, fontWeight: 900, color: gradeColor }}
                >{finalScore}</motion.span>
                <span style={{ fontSize: 8, fontWeight: 700, color: `${gradeColor}80`, letterSpacing: "1px" }}>{gradeLabel}</span>
              </div>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>Drill Complete!</h2>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              {scenario.title} — {fmtTime(elapsed)} (Target: {fmtTime(scenario.expectedTimeSec)})
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {[
              { label: "Steps", value: `${completedSteps.size}/${scenario.steps.length}`, color: "#00C8E0" },
              { label: "Time", value: fmtTime(elapsed), color: timeStatus === "good" ? "#00C853" : timeStatus === "warning" ? "#FF9500" : "#FF2D55" },
              { label: "Score", value: `${finalScore}`, color: gradeColor },
            ].map(s => (
              <div key={s.label} className="p-3 rounded-xl text-center"
                style={{ background: `${s.color}08`, border: `1px solid ${s.color}15` }}>
                <p style={{ fontSize: 18, fontWeight: 900, color: s.color }}>{s.value}</p>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <motion.button whileTap={{ scale: 0.97 }} onClick={handleFinish}
              className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
              style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
              <CheckCircle2 className="size-4" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#00C853" }}>Save & Continue</span>
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }}
              onClick={() => onWatchDemo(scenario.demoSceneId, scenario.demoTimestamp)}
              className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
              style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
              <Play className="size-4" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Watch Demo for This Scenario</span>
            </motion.button>
            <button onClick={onExit}
              className="w-full py-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", fontSize: 12, fontWeight: 600 }}>
              Back to Scenarios
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(10,18,32,0.8)" }}>
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <ArrowLeft className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <scenario.icon className="size-4" style={{ color: scenario.color }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{scenario.title}</span>
            </div>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
              Step {currentStep + 1}/{scenario.steps.length} — {step?.phase}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p style={{
              fontSize: 20, fontWeight: 900, fontVariantNumeric: "tabular-nums",
              color: timeStatus === "good" ? "#00C853" : timeStatus === "warning" ? "#FF9500" : "#FF2D55",
            }}>{fmtTime(elapsed)}</p>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>TARGET: {fmtTime(scenario.expectedTimeSec)}</p>
          </div>
          <button onClick={() => setIsPaused(!isPaused)} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: isPaused ? "rgba(0,200,83,0.1)" : "rgba(255,255,255,0.04)" }}>
            {isPaused ? <Play className="size-4" style={{ color: "#00C853" }} /> : <Pause className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: "rgba(255,255,255,0.03)" }}>
        <motion.div className="h-full" animate={{ width: `${progress}%` }}
          style={{ background: `linear-gradient(90deg, ${scenario.color}, ${scenario.color}80)` }} />
      </div>

      {/* Score bar */}
      <div className="px-5 py-2 flex items-center justify-between"
        style={{ background: "rgba(0,0,0,0.2)" }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)" }}>SCORE</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>{Math.round(score)}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="size-2 rounded-full" style={{ background: "#00C853" }} />
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{completedSteps.size} done</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="size-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{scenario.steps.length - completedSteps.size} left</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ scrollbarWidth: "none" }}>
        {/* Current step card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="p-5 rounded-2xl"
            style={{
              background: `linear-gradient(135deg, ${step?.color}10, ${step?.color}03)`,
              border: `1px solid ${step?.color}20`,
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="size-8 rounded-lg flex items-center justify-center"
                style={{ background: `${step?.color}20`, border: `1px solid ${step?.color}30` }}>
                {step && <step.icon className="size-4" style={{ color: step.color }} />}
              </div>
              <div>
                <p style={{ fontSize: 8, fontWeight: 800, color: step?.color, letterSpacing: "1px" }}>
                  PHASE {currentStep + 1}: {step?.phase}
                </p>
                {step?.criticalTime && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Timer className="size-2.5" style={{ color: "#FF2D55" }} />
                    <span style={{ fontSize: 7, color: "#FF2D55", fontWeight: 700 }}>
                      CRITICAL: Complete within {step.criticalTime}s
                    </span>
                  </div>
                )}
              </div>
              {step?.autoAction && (
                <div className="ml-auto px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <span style={{ fontSize: 7, fontWeight: 800, color: "#8B5CF6" }}>AUTO</span>
                </div>
              )}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
              {step?.instruction}
            </h3>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              {step?.action}
            </p>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={completeStep}
              className="w-full mt-4 py-3 rounded-xl flex items-center justify-center gap-2"
              style={{
                background: `linear-gradient(135deg, ${step?.color}20, ${step?.color}08)`,
                border: `1px solid ${step?.color}30`,
              }}
            >
              <CheckCircle2 className="size-4" style={{ color: step?.color }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: step?.color }}>
                {step?.autoAction ? "Confirm Auto-Action" : "Mark Complete"}
              </span>
            </motion.button>
          </motion.div>
        </AnimatePresence>

        {/* Step list */}
        <div className="space-y-1.5">
          {scenario.steps.map((s, i) => (
            <div key={s.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{
                background: i === currentStep ? `${s.color}08` : "rgba(255,255,255,0.01)",
                border: `1px solid ${i === currentStep ? `${s.color}15` : "rgba(255,255,255,0.03)"}`,
                opacity: completedSteps.has(i) ? 0.5 : 1,
              }}>
              {completedSteps.has(i) ? (
                <CheckCircle2 className="size-4 flex-shrink-0" style={{ color: "#00C853" }} />
              ) : i === currentStep ? (
                <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                  <s.icon className="size-4 flex-shrink-0" style={{ color: s.color }} />
                </motion.div>
              ) : (
                <StepCircle className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.1)" }} />
              )}
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 10, fontWeight: 700, color: i === currentStep ? "#fff" : "rgba(255,255,255,0.35)" }}>
                  {s.phase}: {s.instruction}
                </p>
              </div>
              {s.autoAction && <Zap className="size-3 flex-shrink-0" style={{ color: "#8B5CF6" }} />}
            </div>
          ))}
        </div>

        {/* Hint / Tips */}
        <button onClick={() => setShowHint(!showHint)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl"
          style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.1)" }}>
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5" style={{ color: "#8B5CF6" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6" }}>AI Tips & Hints</span>
          </div>
          <ChevronRight className="size-3" style={{ color: "#8B5CF6", transform: showHint ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        <AnimatePresence>
          {showHint && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-2 px-1">
              {scenario.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg"
                  style={{ background: "rgba(139,92,246,0.04)" }}>
                  <Sparkles className="size-3 flex-shrink-0 mt-0.5" style={{ color: "rgba(139,92,246,0.5)" }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>{tip}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Watch Demo button */}
        <motion.button whileTap={{ scale: 0.97 }}
          onClick={() => onWatchDemo(scenario.demoSceneId, scenario.demoTimestamp)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
          style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
          <Play className="size-4" style={{ color: "#00C8E0" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>Stuck? Watch Demo for This Scenario</span>
        </motion.button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Training Center
// ═══════════════════════════════════════════════════════════════

export function TrainingCenter() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"scenarios" | "progress" | "leaderboard" | "multiplayer" | "certifications">("scenarios");
  const [selectedCategory, setSelectedCategory] = useState<DrillScenario["category"] | "all">("all");
  const [activeDrill, setActiveDrill] = useState<DrillScenario | null>(null);
  const [progress, setProgress] = useState<Record<string, DrillProgress>>(loadProgress());
  const [adminRating, setAdminRating] = useState<AdminRating | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setAdminRating(getAdminRating());
  }, []);

  const filteredScenarios = SCENARIOS.filter(s => {
    if (selectedCategory !== "all" && s.category !== selectedCategory) return false;
    if (searchQuery && !s.title.toLowerCase().includes(searchQuery.toLowerCase()) && !s.subtitle.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const totalCompleted = Object.values(progress).filter(p => p.completed).length;
  const avgScore = Object.values(progress).filter(p => p.completed).length > 0
    ? Math.round(Object.values(progress).filter(p => p.completed).reduce((a, p) => a + p.bestScore, 0) / Object.values(progress).filter(p => p.completed).length)
    : 0;

  const handleDrillComplete = (score: number, timeSec: number) => {
    if (!activeDrill) return;
    const prev = progress[activeDrill.id];
    const updated: DrillProgress = {
      scenarioId: activeDrill.id,
      completed: true,
      bestScore: prev ? Math.max(prev.bestScore, score) : score,
      bestTime: prev ? Math.min(prev.bestTime, timeSec) : timeSec,
      attempts: (prev?.attempts || 0) + 1,
      lastAttempt: new Date().toISOString(),
    };
    const newProgress = { ...progress, [activeDrill.id]: updated };
    setProgress(newProgress);
    saveProgress(newProgress);
    setActiveDrill(null);
  };

  const handleWatchDemo = (sceneId: string, timestamp: number) => {
    navigate(`/demo?scene=${sceneId}&t=${timestamp}`);
  };

  // Active drill view
  if (activeDrill) {
    return (
      <ActiveDrill
        scenario={activeDrill}
        onComplete={handleDrillComplete}
        onExit={() => setActiveDrill(null)}
        onWatchDemo={handleWatchDemo}
      />
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Hero Header */}
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(10,18,32,0.95), #05070E)" }}>
        <motion.div
          animate={{ opacity: [0.03, 0.06, 0.03] }}
          transition={{ duration: 4, repeat: Infinity }}
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(0,200,224,0.12), transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.08), transparent 50%)" }}
        />
        <div className="relative max-w-6xl mx-auto px-6 pt-8 pb-6">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-8">
            <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <ArrowLeft className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Dashboard</span>
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate("/demo")} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                <Play className="size-3.5" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>Full Platform Demo</span>
              </button>
            </div>
          </div>

          {/* Title */}
          <div className="flex items-start gap-4 mb-6">
            <div className="size-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(139,92,246,0.1))", border: "1px solid rgba(0,200,224,0.2)" }}>
              <GraduationCap className="size-7" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-0.5px" }}>
                Training & Drill Center
              </h1>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                Master every emergency scenario. Practice makes perfect response.
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "SCENARIOS", value: `${SCENARIOS.length}`, color: "#00C8E0", icon: BookOpen },
              { label: "COMPLETED", value: `${totalCompleted}/${SCENARIOS.length}`, color: "#00C853", icon: CheckCircle2 },
              { label: "AVG SCORE", value: avgScore > 0 ? `${avgScore}` : "--", color: "#8B5CF6", icon: Target },
              { label: "IRE RATING", value: adminRating ? adminRating.tier : "ROOKIE", color: adminRating?.tierColor || "#00C8E0", icon: Award },
            ].map(s => (
              <div key={s.label} className="p-4 rounded-2xl"
                style={{ background: `${s.color}06`, border: `1px solid ${s.color}10` }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <s.icon className="size-3.5" style={{ color: `${s.color}60` }} />
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>{s.label}</span>
                </div>
                <p style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl flex-wrap" style={{ background: "rgba(255,255,255,0.03)" }}>
            {[
              { id: "scenarios" as const, label: "Scenarios", icon: BookOpen },
              { id: "multiplayer" as const, label: "Multiplayer", icon: Users },
              { id: "certifications" as const, label: "Certs", icon: Award },
              { id: "progress" as const, label: "Progress", icon: TrendingUp },
              { id: "leaderboard" as const, label: "Ranks", icon: Trophy },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg transition-all"
                style={{
                  background: activeTab === tab.id ? "rgba(0,200,224,0.08)" : "transparent",
                  border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.15)" : "transparent"}`,
                }}>
                <tab.icon className="size-3.5" style={{ color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.25)" }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.35)" }}>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* ── SCENARIOS TAB ── */}
        {activeTab === "scenarios" && (
          <>
            {/* Category filters */}
            <div className="flex flex-wrap gap-2 mb-6">
              <button onClick={() => setSelectedCategory("all")}
                className="px-3 py-1.5 rounded-lg"
                style={{
                  background: selectedCategory === "all" ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${selectedCategory === "all" ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}`,
                  color: selectedCategory === "all" ? "#00C8E0" : "rgba(255,255,255,0.35)",
                  fontSize: 11, fontWeight: 700,
                }}>
                All ({SCENARIOS.length})
              </button>
              {(Object.entries(CATEGORIES) as [DrillScenario["category"], typeof CATEGORIES[keyof typeof CATEGORIES]][]).map(([key, cat]) => {
                const count = SCENARIOS.filter(s => s.category === key).length;
                return (
                  <button key={key} onClick={() => setSelectedCategory(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{
                      background: selectedCategory === key ? `${cat.color}10` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${selectedCategory === key ? `${cat.color}20` : "rgba(255,255,255,0.06)"}`,
                      color: selectedCategory === key ? cat.color : "rgba(255,255,255,0.35)",
                      fontSize: 11, fontWeight: 700,
                    }}>
                    <cat.icon className="size-3" />
                    {cat.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Scenario grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredScenarios.map(scenario => {
                const prog = progress[scenario.id];
                const catMeta = CATEGORIES[scenario.category];
                return (
                  <motion.div
                    key={scenario.id}
                    whileHover={{ y: -2, scale: 1.01 }}
                    className="rounded-2xl overflow-hidden cursor-pointer group"
                    style={{
                      background: "rgba(10,18,32,0.8)",
                      border: `1px solid ${prog?.completed ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.05)"}`,
                    }}
                    onClick={() => setActiveDrill(scenario)}
                  >
                    {/* Color strip */}
                    <div className="h-1" style={{ background: `linear-gradient(90deg, ${scenario.color}, ${scenario.color}40)` }} />

                    <div className="p-4">
                      {/* Top row */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="size-9 rounded-xl flex items-center justify-center"
                            style={{ background: `${scenario.color}12`, border: `1px solid ${scenario.color}20` }}>
                            <scenario.icon className="size-5" style={{ color: scenario.color }} />
                          </div>
                          <div>
                            <span style={{ fontSize: 7, fontWeight: 700, color: catMeta.color, letterSpacing: "0.5px" }}>
                              {catMeta.label.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <DifficultyBadge difficulty={scenario.difficulty} />
                      </div>

                      {/* Title */}
                      <h3 style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
                        {scenario.title}
                      </h3>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.5, marginBottom: 8 }}>
                        {scenario.subtitle}
                      </p>

                      {/* Meta */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex items-center gap-1">
                          <Clock className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                            Target: {Math.floor(scenario.expectedTimeSec / 60)}:{(scenario.expectedTimeSec % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Activity className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                            {scenario.steps.length} steps
                          </span>
                        </div>
                      </div>

                      {/* Progress or Start */}
                      {prog?.completed ? (
                        <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                          style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.1)" }}>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="size-3.5" style={{ color: "#00C853" }} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>Completed</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#00C853" }}>Best: {prog.bestScore}/100</span>
                            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>({prog.attempts}x)</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                          style={{ background: `${scenario.color}06`, border: `1px solid ${scenario.color}10` }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: scenario.color }}>Start Drill</span>
                          <ChevronRight className="size-4 group-hover:translate-x-1 transition-transform" style={{ color: scenario.color }} />
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}

        {/* ── PROGRESS TAB ── */}
        {activeTab === "progress" && (
          <div className="space-y-6">
            {/* Overall progress */}
            <div className="p-6 rounded-2xl" style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 16 }}>Training Progress</h3>
              <div className="w-full h-3 rounded-full mb-4" style={{ background: "rgba(255,255,255,0.04)" }}>
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${(totalCompleted / SCENARIOS.length) * 100}%` }}
                  style={{ background: "linear-gradient(90deg, #00C8E0, #8B5CF6)" }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                  {totalCompleted} of {SCENARIOS.length} scenarios completed
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#00C8E0" }}>
                  {Math.round((totalCompleted / SCENARIOS.length) * 100)}%
                </span>
              </div>
            </div>

            {/* Category breakdown */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {(Object.entries(CATEGORIES) as [DrillScenario["category"], typeof CATEGORIES[keyof typeof CATEGORIES]][]).map(([key, cat]) => {
                const catScenarios = SCENARIOS.filter(s => s.category === key);
                const catCompleted = catScenarios.filter(s => progress[s.id]?.completed).length;
                return (
                  <div key={key} className="p-4 rounded-2xl"
                    style={{ background: `${cat.color}05`, border: `1px solid ${cat.color}10` }}>
                    <div className="flex items-center gap-2 mb-3">
                      <cat.icon className="size-4" style={{ color: cat.color }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: cat.color }}>{cat.label}</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="h-full rounded-full" style={{ background: cat.color, width: `${catScenarios.length > 0 ? (catCompleted / catScenarios.length) * 100 : 0}%` }} />
                    </div>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{catCompleted}/{catScenarios.length}</span>
                  </div>
                );
              })}
            </div>

            {/* History */}
            <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 12 }}>Recent Attempts</h3>
              <div className="space-y-2">
                {Object.values(progress)
                  .filter(p => p.completed)
                  .sort((a, b) => new Date(b.lastAttempt).getTime() - new Date(a.lastAttempt).getTime())
                  .slice(0, 10)
                  .map(p => {
                    const sc = SCENARIOS.find(s => s.id === p.scenarioId);
                    if (!sc) return null;
                    return (
                      <div key={p.scenarioId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                        onClick={() => setActiveDrill(sc)}>
                        <sc.icon className="size-4 flex-shrink-0" style={{ color: sc.color }} />
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{sc.title}</p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                            {p.attempts} attempt{p.attempts !== 1 ? "s" : ""} -- Best: {Math.floor(p.bestTime / 60)}:{(p.bestTime % 60).toString().padStart(2, "0")}
                          </p>
                        </div>
                        <div className="text-right">
                          <span style={{ fontSize: 16, fontWeight: 900, color: p.bestScore >= 85 ? "#00C853" : p.bestScore >= 60 ? "#00C8E0" : "#FF9500" }}>
                            {p.bestScore}
                          </span>
                          <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>BEST</p>
                        </div>
                      </div>
                    );
                  })}
                {Object.values(progress).filter(p => p.completed).length === 0 && (
                  <div className="text-center py-8">
                    <GraduationCap className="size-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.08)" }} />
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)" }}>No drills completed yet</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>Start a scenario to begin tracking your progress</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── LEADERBOARD TAB ── */}
        {activeTab === "leaderboard" && (
          <AdminLeaderboardContent adminRating={adminRating} drillProgress={progress} scenarios={SCENARIOS} />
        )}

        {/* ── MULTIPLAYER TAB ── */}
        {activeTab === "multiplayer" && (
          <MultiplayerDrill onExit={() => setActiveTab("scenarios")} />
        )}

        {/* ── CERTIFICATIONS TAB ── */}
        {activeTab === "certifications" && (
          <CertificationPanel />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Admin Leaderboard (shared between dashboard page and training)
// ═══════════════════════════════════════════════════════════════

// Tier classification based on score
function scoreToTier(score: number): "PLATINUM" | "GOLD" | "SILVER" | "BRONZE" | "ROOKIE" {
  if (score >= 90) return "PLATINUM";
  if (score >= 75) return "GOLD";
  if (score >= 60) return "SILVER";
  if (score >= 40) return "BRONZE";
  return "ROOKIE";
}

// ─── Leaderboard row shape ───────────────────────────────────
// Exported so consumers can type their local state without having to
// dereference `typeof FALLBACK_ADMINS[number]` (which is brittle once
// anything in the fallback changes).
export interface LeaderboardAdmin {
  id: string;
  name: string;
  role: string;
  avatar: string;
  avgScore: number;
  totalIncidents: number;
  streak: number;
  tier: "PLATINUM" | "GOLD" | "SILVER" | "BRONZE" | "ROOKIE";
  drillsCompleted: number;
  avgResponseTime: number;
  trend: "improving" | "stable" | "declining";
}

// ── Row-building helper ──────────────────────────────────────
// Shared by both the sync localStorage path and the async Supabase
// path so the score formula stays in a single place. Changing the
// formula here updates both surfaces simultaneously.
function buildAdminRow(args: {
  name: string;
  idx: number;
  incidents: number;
  responseTimes: number[];
  drills: number;
}): LeaderboardAdmin {
  const avgRT = args.responseTimes.length > 0
    ? Math.round(args.responseTimes.reduce((a, b) => a + b, 0) / args.responseTimes.length)
    : 0;
  // Score: incidents×2 + drills×5 − (avgRT > 120 ? 10 : 0), capped 0-100
  const score = Math.min(
    100,
    Math.max(0, args.incidents * 2 + args.drills * 5 - (avgRT > 120 ? 10 : 0)),
  );
  const initials = args.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return {
    id: String(args.idx + 1),
    name: args.name,
    role: args.idx === 0 ? "Main Admin" : `Zone Admin ${String.fromCharCode(65 + args.idx)}`,
    avatar: initials || "??",
    avgScore: score,
    totalIncidents: args.incidents,
    streak: args.drills > 5 ? 3 : args.drills > 2 ? 1 : 0,
    tier: scoreToTier(score),
    drillsCompleted: args.drills,
    avgResponseTime: avgRT,
    trend: "stable",
  };
}

// Build real leaderboard from localStorage (audit log + drill progress).
// This is the SYNC fallback used on first render before Supabase data
// arrives. Once the server fetch completes (see fetchLeaderboardFromServer
// below), the async result takes over and the page shows team-wide
// stats rather than device-local ones.
export function getRealLeaderboard(): LeaderboardAdmin[] {
  try {
    const auditRaw = localStorage.getItem("sosphere_audit_log");
    const drillRaw = localStorage.getItem("sosphere_drill_progress_global");
    if (!auditRaw && !drillRaw) return FALLBACK_ADMINS;

    const auditLogs: any[] = auditRaw ? JSON.parse(auditRaw) : [];
    const drillProgress: Record<string, any> = drillRaw ? JSON.parse(drillRaw) : {};

    // Group audit events by admin name
    const adminMap: Record<string, { incidents: number; responseTimes: number[] }> = {};
    for (const entry of auditLogs) {
      const name = entry.adminName || entry.user || entry.actor?.name || "Unknown";
      if (!adminMap[name]) adminMap[name] = { incidents: 0, responseTimes: [] };
      if (entry.action?.includes("emergency") || entry.action?.includes("resolved")) {
        adminMap[name].incidents++;
        if (entry.responseTimeSec) adminMap[name].responseTimes.push(entry.responseTimeSec);
      }
    }

    // Count drills per admin
    const drillCounts: Record<string, number> = {};
    for (const [key, val] of Object.entries(drillProgress)) {
      const adminName = (val as any).adminName || key.split(":")[0] || "Unknown";
      if ((val as any).completed) {
        drillCounts[adminName] = (drillCounts[adminName] || 0) + 1;
      }
    }

    const allNames = Array.from(new Set([...Object.keys(adminMap), ...Object.keys(drillCounts)]));
    if (allNames.length === 0) return FALLBACK_ADMINS;

    return allNames.map((name, idx) =>
      buildAdminRow({
        name,
        idx,
        incidents: adminMap[name]?.incidents ?? 0,
        responseTimes: adminMap[name]?.responseTimes ?? [],
        drills: drillCounts[name] || 0,
      }),
    );
  } catch { return FALLBACK_ADMINS; }
}

// ═══════════════════════════════════════════════════════════════
// Server-backed leaderboard (P3-#11h)
// ─────────────────────────────────────────────────────────────
// Pulls authoritative admin activity from Supabase so the leaderboard
// reflects the entire team, not just what happened to be written on
// this device. Source:
//
//   • audit_log   → incident counts (category='emergency') keyed by
//                   actor_name. This is the canonical record of
//                   every admin-initiated emergency action.
//
// Response-time dimension is intentionally omitted here because
// audit_log has no response_time column and rrp_sessions does not
// carry actor attribution (its employee_name is the SOS trigger, not
// the responding admin). When an admin-actor column lands on
// rrp_sessions in a future slice, this function gains a second
// Promise.all leg and the score formula automatically picks up the
// new response-time signal via buildAdminRow.
//
// Drill completion is still sourced from localStorage for now — there
// is no server-side drill_progress table yet. When that ships, this
// function becomes the single join point and the localStorage branch
// can be removed.
//
// Returns `null` when there is no company context, no server data, or
// on RLS / network failure. The caller is expected to fall back to the
// sync `getRealLeaderboard()` in that case (which in turn falls back
// to FALLBACK_ADMINS when no local data exists either).
// ═══════════════════════════════════════════════════════════════
export async function fetchLeaderboardFromServer(): Promise<LeaderboardAdmin[] | null> {
  const companyId = getCompanyId();
  if (!companyId) return null;

  try {
    const { data: auditRows, error: auditErr } = await supabase
      .from("audit_log")
      .select("actor_id, actor_name, action, category")
      .eq("company_id", companyId)
      .eq("category", "emergency");

    if (auditErr) {
      console.warn("[leaderboard] audit fetch:", auditErr.message);
      return null;
    }

    // Aggregate per-admin incident counts keyed by actor_name. We key
    // by name (not id) because drill counts and FALLBACK_ADMINS are
    // also name-indexed — ids are not shared between the client-side
    // admin roster and audit rows.
    const adminMap: Record<string, { incidents: number; responseTimes: number[] }> = {};
    for (const row of (auditRows ?? []) as any[]) {
      const name: string = row.actor_name || row.actor_id || "System";
      // Skip system-generated rows — they would dominate the board
      // with non-human actors (auto-escalations, scheduled sweeps, …).
      if (!name || name.toLowerCase().startsWith("system")) continue;
      if (!adminMap[name]) adminMap[name] = { incidents: 0, responseTimes: [] };
      if (typeof row.action === "string" && /emergency|resolved|escalat/i.test(row.action)) {
        adminMap[name].incidents++;
      }
    }

    // Drill counts — still device-local until a drill_progress table lands.
    const drillCounts: Record<string, number> = {};
    try {
      const drillRaw = localStorage.getItem("sosphere_drill_progress_global");
      const drillProgress: Record<string, any> = drillRaw ? JSON.parse(drillRaw) : {};
      for (const [key, val] of Object.entries(drillProgress)) {
        const adminName = (val as any).adminName || key.split(":")[0] || "Unknown";
        if ((val as any).completed) {
          drillCounts[adminName] = (drillCounts[adminName] || 0) + 1;
        }
      }
    } catch {}

    const names = Array.from(new Set([...Object.keys(adminMap), ...Object.keys(drillCounts)]));
    if (names.length === 0) return null;

    return names.map((name, idx) =>
      buildAdminRow({
        name,
        idx,
        incidents: adminMap[name]?.incidents ?? 0,
        responseTimes: adminMap[name]?.responseTimes ?? [],
        drills: drillCounts[name] || 0,
      }),
    );
  } catch (err) {
    console.warn("[leaderboard] server fetch exception:", err);
    return null;
  }
}

// Fallback static leaderboard (only used when no real data exists yet)
export const FALLBACK_ADMINS = [
  { id: "1", name: "Rania Al-Dosari", role: "Main Admin", avatar: "RA", avgScore: 94, totalIncidents: 47, streak: 12, tier: "PLATINUM" as const, drillsCompleted: 16, avgResponseTime: 78, trend: "improving" as const },
  { id: "2", name: "Ahmed Al-Rashid", role: "Zone Admin A", avatar: "AR", avgScore: 87, totalIncidents: 31, streak: 8, tier: "GOLD" as const, drillsCompleted: 14, avgResponseTime: 95, trend: "stable" as const },
  { id: "3", name: "Khalid Bin Saeed", role: "Zone Admin B", avatar: "KS", avgScore: 82, totalIncidents: 23, streak: 5, tier: "GOLD" as const, drillsCompleted: 11, avgResponseTime: 110, trend: "improving" as const },
  { id: "4", name: "Noura Al-Shammari", role: "Zone Admin C", avatar: "NS", avgScore: 78, totalIncidents: 19, streak: 3, tier: "SILVER" as const, drillsCompleted: 9, avgResponseTime: 125, trend: "stable" as const },
  { id: "5", name: "Omar Al-Qahtani", role: "Zone Admin D", avatar: "OQ", avgScore: 71, totalIncidents: 15, streak: 2, tier: "SILVER" as const, drillsCompleted: 7, avgResponseTime: 140, trend: "declining" as const },
  { id: "6", name: "Fatima Al-Harbi", role: "Zone Admin E", avatar: "FH", avgScore: 65, totalIncidents: 8, streak: 1, tier: "BRONZE" as const, drillsCompleted: 5, avgResponseTime: 165, trend: "improving" as const },
];

// Keep MOCK_ADMINS as alias for backwards compatibility (exported from here)
export const MOCK_ADMINS = FALLBACK_ADMINS;

export const TIER_COLORS: Record<string, { color: string; bg: string; icon: typeof Crown }> = {
  PLATINUM: { color: "#E5E4E2", bg: "rgba(229,228,226,0.1)", icon: Crown },
  GOLD: { color: "#FFD700", bg: "rgba(255,215,0,0.1)", icon: Star },
  SILVER: { color: "#C0C0C0", bg: "rgba(192,192,192,0.08)", icon: Medal },
  BRONZE: { color: "#CD7F32", bg: "rgba(205,127,50,0.08)", icon: Shield },
  ROOKIE: { color: "#00C8E0", bg: "rgba(0,200,224,0.08)", icon: Zap },
};

export function AdminLeaderboardContent({
  adminRating,
  drillProgress,
  scenarios,
}: {
  adminRating: AdminRating | null;
  drillProgress?: Record<string, DrillProgress>;
  scenarios?: DrillScenario[];
}) {
  // Server-backed leaderboard (P3-#11h). On mount we try the Supabase
  // aggregator; if it returns rows they take precedence over the sync
  // localStorage build, so the podium reflects the whole team rather
  // than just what this device happened to record. If the fetch fails
  // or returns null (no company, empty data, RLS denial) we silently
  // stay on the sync path — the UI never goes blank.
  const [serverAdmins, setServerAdmins] = useState<LeaderboardAdmin[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await fetchLeaderboardFromServer();
      if (!cancelled && rows) setServerAdmins(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  // Merge "You" into the real leaderboard (falls back to static if no data)
  const allAdmins: LeaderboardAdmin[] = [...(serverAdmins ?? getRealLeaderboard())];
  // Insert current admin ("You") based on their actual rating
  if (adminRating) {
    const yourEntry = {
      id: "you",
      name: "You",
      role: "Current Admin",
      avatar: "YO",
      avgScore: adminRating.avgScore,
      totalIncidents: adminRating.totalIncidents,
      streak: adminRating.currentStreak,
      tier: adminRating.tier,
      drillsCompleted: drillProgress ? Object.values(drillProgress).filter(p => p.completed).length : 0,
      avgResponseTime: adminRating.avgResponseTime,
      trend: adminRating.trend,
    };
    allAdmins.push(yourEntry);
  }

  const sorted = allAdmins.sort((a, b) => b.avgScore - a.avgScore);

  return (
    <div className="space-y-6">
      {/* Top 3 podium */}
      <div className="grid grid-cols-3 gap-3 items-end">
        {[1, 0, 2].map(rank => {
          const admin = sorted[rank];
          if (!admin) return <div key={rank} />;
          const tierMeta = TIER_COLORS[admin.tier] || TIER_COLORS.ROOKIE;
          const isYou = admin.id === "you";
          const heights = [160, 190, 140];
          return (
            <motion.div
              key={admin.id}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: rank * 0.15 }}
              className="flex flex-col items-center"
            >
              {/* Avatar */}
              <div className="relative mb-2">
                <div className={`size-14 rounded-2xl flex items-center justify-center ${isYou ? "ring-2 ring-offset-2" : ""}`}
                  style={{
                    background: `linear-gradient(135deg, ${tierMeta.color}30, ${tierMeta.color}10)`,
                    border: `2px solid ${tierMeta.color}50`,
                    ringColor: isYou ? "#00C8E0" : undefined,
                    ringOffsetColor: "#05070E",
                  }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: tierMeta.color }}>{admin.avatar}</span>
                </div>
                {rank === 0 && (
                  <motion.div
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.5, type: "spring" }}
                    className="absolute -top-2 -right-2 size-7 rounded-full flex items-center justify-center"
                    style={{ background: "#FFD700", border: "2px solid #05070E" }}>
                    <Crown className="size-3.5" style={{ color: "#05070E" }} />
                  </motion.div>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: isYou ? "#00C8E0" : "#fff", textAlign: "center" }}>
                {admin.name}
              </span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>{admin.role}</span>
              {/* Podium bar */}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: heights[rank === 0 ? 1 : rank === 1 ? 0 : 2] }}
                transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
                className="w-full rounded-t-xl mt-2 flex flex-col items-center justify-start pt-3"
                style={{
                  background: `linear-gradient(180deg, ${tierMeta.color}15, ${tierMeta.color}05)`,
                  border: `1px solid ${tierMeta.color}15`,
                  borderBottom: "none",
                }}
              >
                <span style={{ fontSize: 28, fontWeight: 900, color: tierMeta.color }}>
                  {rank === 0 ? "1st" : rank === 1 ? "2nd" : "3rd"}
                </span>
                <span style={{ fontSize: 20, fontWeight: 900, color: "#fff", marginTop: 4 }}>{admin.avgScore}</span>
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>AVG SCORE</span>
              </motion.div>
            </motion.div>
          );
        })}
      </div>

      {/* Full ranking table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Full Ranking</h3>
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
          {sorted.map((admin, i) => {
            const tierMeta = TIER_COLORS[admin.tier] || TIER_COLORS.ROOKIE;
            const TierIcon = tierMeta.icon;
            const isYou = admin.id === "you";
            return (
              <div key={admin.id}
                className="px-5 py-3 flex items-center gap-4"
                style={{ background: isYou ? "rgba(0,200,224,0.03)" : "transparent" }}>
                {/* Rank */}
                <div className="w-8 text-center">
                  <span style={{
                    fontSize: 16, fontWeight: 900,
                    color: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "rgba(255,255,255,0.2)",
                  }}>#{i + 1}</span>
                </div>
                {/* Avatar */}
                <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: tierMeta.bg, border: `1px solid ${tierMeta.color}25` }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: tierMeta.color }}>{admin.avatar}</span>
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12, fontWeight: 700, color: isYou ? "#00C8E0" : "#fff" }}>
                      {admin.name}
                    </span>
                    {isYou && (
                      <span className="px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,200,224,0.1)", fontSize: 7, fontWeight: 800, color: "#00C8E0" }}>YOU</span>
                    )}
                  </div>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{admin.role}</p>
                </div>
                {/* Tier */}
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
                  style={{ background: tierMeta.bg, border: `1px solid ${tierMeta.color}15` }}>
                  <TierIcon className="size-3" style={{ color: tierMeta.color }} />
                  <span style={{ fontSize: 8, fontWeight: 800, color: tierMeta.color }}>{admin.tier}</span>
                </div>
                {/* Stats */}
                <div className="hidden md:flex items-center gap-4">
                  <div className="text-center">
                    <p style={{ fontSize: 14, fontWeight: 900, color: "#fff" }}>{admin.totalIncidents}</p>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>INCIDENTS</p>
                  </div>
                  <div className="text-center">
                    <p style={{ fontSize: 14, fontWeight: 900, color: admin.streak >= 5 ? "#FF9500" : "rgba(255,255,255,0.5)" }}>
                      {admin.streak > 0 ? admin.streak : "--"}
                    </p>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>STREAK</p>
                  </div>
                  <div className="text-center">
                    <p style={{ fontSize: 14, fontWeight: 900, color: "#00C8E0" }}>{admin.drillsCompleted}</p>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>DRILLS</p>
                  </div>
                </div>
                {/* Score */}
                <div className="w-14 text-right">
                  <span style={{
                    fontSize: 20, fontWeight: 900,
                    color: admin.avgScore >= 85 ? "#00C853" : admin.avgScore >= 60 ? "#00C8E0" : admin.avgScore >= 40 ? "#FF9500" : "rgba(255,255,255,0.2)",
                  }}>
                    {admin.avgScore > 0 ? admin.avgScore : "--"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
