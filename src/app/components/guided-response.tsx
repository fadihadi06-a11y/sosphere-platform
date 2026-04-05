// ═══════════════════════════════════════════════════════════════
// SOSphere — Guided Response System v2
// ─────────────────────────────────────────────────────────────
// THREE phases:
// 1. ACTIVE RESPONSE — Rescue the employee NOW
// 2. POST-INCIDENT — Review evidence, escalate, notify
// 3. PREVENTIVE — Actions to prevent recurrence
// ─────────────────────────────────────────────────────────────
// "The dashboard that never leaves you alone"
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, ChevronRight, ChevronLeft, CheckCircle, CheckCircle2, AlertTriangle, Phone, MapPin, Users, Siren, Heart, MessageCircle, Navigation, Clock, Mic, Building2, Map as MapIcon, CreditCard, Zap, ArrowRight, X, Sparkles, ShieldCheck, UserPlus, Volume2, Eye, Compass, Activity, Ambulance, Flame, Lock, LifeBuoy, Megaphone, FileText, Camera, ArrowUpRight, Bell, AlertCircle, Search, Clipboard, Flag, Award, ExternalLink, Route, Car, PhoneOff, MapPinOff } from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface GuidedStep {
  id: string;
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  iconBg: string;
  choices?: GuidedChoice[];
  autoAction?: string;
  isCompleted?: boolean;
  phase?: "active" | "post" | "preventive" | "closed";
  parallelHint?: string; // "You can do this WHILE waiting for..."
  urgencyLevel?: number; // 1-5, affects visual pulsing
  timeTarget?: string; // e.g. "< 2 minutes"
}

interface GuidedChoice {
  id: string;
  label: string;
  description: string;
  icon: any;
  color: string;
  nextStepId: string;
  action?: string;
  dashboardAction?: string;
  badge?: string; // e.g. "RECOMMENDED", "FASTEST"
  isParallel?: boolean; // can be done while another action is happening
}

type EmergencyType =
  | "sos_button"
  | "fall_detected"
  | "missed_checkin"
  | "shake_sos"
  | "geofence_breach"
  | "hazard_report"
  | "journey_deviation"
  | "journey_sos"
  | "journey_delay"
  | "journey_no_contact";

interface JourneyContext {
  journeyId: string;
  origin: string;
  destination: string;
  lastWaypoint: string;
  nextWaypoint: string;
  vehicleType: string;
  distanceCovered: number;
  totalDistance: number;
  lastGpsTime?: Date;
  deviationKm?: number;
}

interface EmergencyContext {
  emergencyId: string;
  employeeName: string;
  employeeRole?: string;
  zone: string;
  type: EmergencyType;
  elapsed: number;
  severity: "critical" | "high" | "medium" | "low";
  journey?: JourneyContext;
}

// ═══════════════════════════════════════════════════════════════
// SCENARIO ENGINE — Deep branching with post-incident
// ═══════════════════════════════════════════════════════════════

function getEmergencyScenario(ctx: EmergencyContext): GuidedStep[] {
  const name = ctx.employeeName;
  const zone = ctx.zone;
  const isJourney = ctx.type.startsWith("journey_") || !!ctx.journey;
  const j = ctx.journey;

  // ── PHASE 1: ACTIVE RESPONSE ─────────────────────────────────
  const activeSteps: GuidedStep[] = [
    // ── Entry Point ──────────────────────────────────────────────
    {
      id: "assess",
      title: ctx.type === "fall_detected" ? "Fall Detected!" :
             ctx.type === "shake_sos" ? "Shake SOS!" :
             ctx.type === "missed_checkin" ? "Missed Check-in" :
             ctx.type === "geofence_breach" ? "Geofence Breach" :
             ctx.type === "journey_deviation" ? "Route Deviation!" :
             ctx.type === "journey_sos" ? "Journey SOS!" :
             ctx.type === "journey_delay" ? "Journey Delayed!" :
             ctx.type === "journey_no_contact" ? "Lost Contact on Route!" :
             "SOS Emergency!",
      subtitle: isJourney && j
        ? `${name} — On route: ${j.origin} → ${j.destination} (${j.distanceCovered}/${j.totalDistance} km)`
        : `${name} — ${zone}`,
      icon: ctx.type === "fall_detected" ? Activity :
            ctx.type === "missed_checkin" ? Clock :
            ctx.type === "geofence_breach" ? MapPin :
            isJourney ? Route : Siren,
      iconColor: ctx.severity === "critical" ? "#FF2D55" : "#FF9500",
      iconBg: ctx.severity === "critical" ? "rgba(255,45,85,0.12)" : "rgba(255,150,0,0.12)",
      phase: "active",
      urgencyLevel: ctx.severity === "critical" ? 5 : 3,
      timeTarget: ctx.severity === "critical" ? "< 30 seconds" : "< 2 minutes",
      ...(isJourney && j ? { parallelHint: `🚗 ${j.vehicleType} • Last waypoint: ${j.lastWaypoint} • Next: ${j.nextWaypoint}` } : {}),
      choices: isJourney ? [
        // ── JOURNEY-SPECIFIC CHOICES ──────────────────────────────
        {
          id: "jrn_assess_call",
          label: "Call the Driver NOW",
          description: "Direct call — are they conscious and safe?",
          icon: Phone,
          color: "#00C853",
          nextStepId: "journey_calling",
          action: "CALL_EMPLOYEE",
          badge: "FASTEST",
        },
        {
          id: "jrn_assess_track",
          label: "Track Live GPS Position",
          description: "See if vehicle is moving, stopped, or off-route",
          icon: MapPin,
          color: "#00C8E0",
          nextStepId: "journey_tracking",
          dashboardAction: "riskMap",
        },
        {
          id: "jrn_assess_chat",
          label: "Silent Chat (Can't Talk)",
          description: "Driver may be in danger and unable to speak",
          icon: MessageCircle,
          color: "#00C8E0",
          nextStepId: "chat_active",
          action: "OPEN_CHAT",
        },
        {
          id: "jrn_assess_full",
          label: "Full Road Emergency Protocol",
          description: "Call + GPS + Nearest help + 911 — ALL at once",
          icon: Siren,
          color: "#FF2D55",
          nextStepId: "journey_full_protocol",
          badge: "MAXIMUM RESPONSE",
        },
      ] : [
        // ── STANDARD (ZONE-BASED) CHOICES ─────────────────────────
        {
          id: "call_now",
          label: "Call Employee NOW",
          description: "Direct phone call — fastest way to assess",
          icon: Phone,
          color: "#00C853",
          nextStepId: "calling",
          action: "CALL_EMPLOYEE",
          badge: "FASTEST",
        },
        {
          id: "chat_silent",
          label: "Silent Chat (Can't Speak)",
          description: "Employee may be hiding or unable to talk",
          icon: MessageCircle,
          color: "#00C8E0",
          nextStepId: "chat_active",
          action: "OPEN_CHAT",
        },
        {
          id: "dispatch_blind",
          label: "Dispatch Help Blindly",
          description: "Don't wait — send nearest person NOW",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "dispatch_options",
          badge: "SAFEST",
        },
        ...(ctx.severity === "critical" ? [{
          id: "full_protocol",
          label: "Full Emergency Protocol",
          description: "Call + Dispatch + Alert — all at once",
          icon: Siren,
          color: "#FF2D55",
          nextStepId: "full_protocol",
          action: "FULL_PROTOCOL",
          badge: "MAXIMUM RESPONSE",
        }] : []),
      ],
    },

    // ── Full Protocol (Critical only) ────────────────────────────
    {
      id: "full_protocol",
      title: "Full Protocol Activated",
      subtitle: "Calling employee + Dispatching help + Alerting services",
      icon: Siren,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      parallelHint: "All actions executing simultaneously",
      autoAction: "EXECUTE_FULL_PROTOCOL",
      choices: [
        {
          id: "employee_answered",
          label: "Employee Answered!",
          description: "Got through on the call",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "triage",
        },
        {
          id: "no_answer_full",
          label: "No Answer — Help is En Route",
          description: "Responders already dispatched",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "help_enroute",
        },
      ],
    },

    // ── Calling ──────────────────────────────────────────────────
    {
      id: "calling",
      title: "Calling " + name + "...",
      subtitle: "Attempting direct phone contact",
      icon: Phone,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      parallelHint: "While waiting: review Medical ID & GPS location",
      choices: [
        {
          id: "answered",
          label: "Employee Answered",
          description: "I can hear and talk to them",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "triage",
        },
        {
          id: "no_answer",
          label: "No Answer",
          description: "Rang but nobody picked up",
          icon: AlertTriangle,
          color: "#FF9500",
          nextStepId: "no_answer_escalate",
        },
        {
          id: "phone_off",
          label: "Phone Off / Unreachable",
          description: "Goes straight to voicemail",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "phone_dead",
        },
      ],
    },

    // ── Chat Active ──────────────────────────────────────────────
    {
      id: "chat_active",
      title: "Emergency Chat Open",
      subtitle: "Communicating silently with " + name,
      icon: MessageCircle,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      parallelHint: "Send pre-built messages — they just need to tap",
      choices: [
        {
          id: "emp_ok",
          label: "Employee Says OK",
          description: "Needs help but not in immediate danger",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "send_assist",
        },
        {
          id: "emp_injured",
          label: "Employee is Injured",
          description: "Reports physical injury",
          icon: Heart,
          color: "#FF2D55",
          nextStepId: "medical_triage",
        },
        {
          id: "emp_threat",
          label: "Employee is in Danger",
          description: "Someone threatening / active hazard",
          icon: AlertTriangle,
          color: "#FF9500",
          nextStepId: "threat_response",
        },
        {
          id: "no_reply_chat",
          label: "No Reply in Chat",
          description: "Messages sent but no response",
          icon: AlertCircle,
          color: "#FF2D55",
          nextStepId: "phone_dead",
        },
      ],
    },

    // ── Triage (employee answered) ───────────────────────────────
    {
      id: "triage",
      title: "Assess the Situation",
      subtitle: "What is " + name + " reporting?",
      icon: Eye,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "false_alarm",
          label: "False Alarm / Accidental",
          description: "No actual emergency — accidental trigger",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "false_alarm_close",
        },
        {
          id: "minor_issue",
          label: "Minor Issue — Not Urgent",
          description: "Small injury, equipment problem, etc.",
          icon: ShieldCheck,
          color: "#00C8E0",
          nextStepId: "send_assist",
        },
        {
          id: "injury_moderate",
          label: "Moderate Injury",
          description: "Needs medical attention but stable",
          icon: Heart,
          color: "#FF9500",
          nextStepId: "medical_triage",
        },
        {
          id: "critical_injury",
          label: "Critical / Life-Threatening",
          description: "Severe injury, unconscious, heavy bleeding",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "critical_response",
        },
        {
          id: "security_threat",
          label: "Security / Threat Situation",
          description: "Assault, theft, hostile person",
          icon: Shield,
          color: "#FF9500",
          nextStepId: "threat_response",
        },
        {
          id: "environmental",
          label: "Environmental Hazard",
          description: "Fire, gas leak, collapse, chemical spill",
          icon: Flame,
          color: "#FF2D55",
          nextStepId: "environmental_response",
        },
      ],
    },

    // ── No Answer → Escalation ───────────────────────────────────
    {
      id: "no_answer_escalate",
      title: "No Answer — Escalating",
      subtitle: "Employee didn't pick up. Time is critical.",
      icon: AlertTriangle,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      urgencyLevel: 4,
      timeTarget: "< 1 minute",
      choices: [
        {
          id: "retry_call",
          label: "Retry Call (Auto-redial)",
          description: "Try calling one more time",
          icon: Phone,
          color: "#00C8E0",
          nextStepId: "calling",
        },
        {
          id: "try_chat",
          label: "Try Emergency Chat",
          description: "Maybe they can't talk but can read",
          icon: MessageCircle,
          color: "#00C8E0",
          nextStepId: "chat_active",
          action: "OPEN_CHAT",
        },
        {
          id: "dispatch_immediate",
          label: "Dispatch Help NOW",
          description: "Send nearest person to their location",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "dispatch_options",
          badge: "RECOMMENDED",
        },
        {
          id: "call_emergency",
          label: "Call 911 / Emergency Services",
          description: "Situation warrants professional responders",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
      ],
    },

    // ── Phone Dead / Unreachable ──────────────────────────────────
    {
      id: "phone_dead",
      title: "Employee Unreachable",
      subtitle: "Phone off, no chat response — HIGH RISK",
      icon: AlertTriangle,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      timeTarget: "IMMEDIATE",
      choices: [
        {
          id: "dispatch_now",
          label: "Dispatch Help to Last GPS",
          description: "Send nearest team member to last known location",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "dispatch_options",
          badge: "URGENT",
        },
        {
          id: "call_911_now",
          label: "Call 911 Immediately",
          description: "Employee may be unconscious or in danger",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
          badge: "RECOMMENDED",
        },
        {
          id: "contact_buddy",
          label: "Contact Their Buddy",
          description: "Ask paired colleague if they've seen them",
          icon: Users,
          color: "#00C8E0",
          nextStepId: "buddy_contacted",
        },
        {
          id: "check_cameras",
          label: "Check Cameras / Last Location",
          description: "Review CCTV or GPS trail",
          icon: Eye,
          color: "#00C8E0",
          nextStepId: "review_location",
          dashboardAction: "riskMap",
        },
      ],
    },

    // ── Dispatch Options ─────────────────────────────────────────
    {
      id: "dispatch_options",
      title: "Choose Responder",
      subtitle: "Who should go to " + name + "?",
      icon: Navigation,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      choices: [
        {
          id: "nearest_worker",
          label: "Nearest On-Duty Worker",
          description: "Fastest to arrive — general check",
          icon: Users,
          color: "#00C8E0",
          nextStepId: "help_enroute",
          badge: "FASTEST",
        },
        {
          id: "first_aid",
          label: "First-Aid Certified Worker",
          description: "Someone trained in medical response",
          icon: Heart,
          color: "#00C853",
          nextStepId: "help_enroute",
        },
        {
          id: "security_team",
          label: "Security Team",
          description: "Armed/trained security personnel",
          icon: Shield,
          color: "#FF9500",
          nextStepId: "help_enroute",
        },
        {
          id: "fire_team",
          label: "Fire Marshal / HSE Team",
          description: "For fire, chemical, environmental hazards",
          icon: Flame,
          color: "#FF2D55",
          nextStepId: "help_enroute",
        },
        {
          id: "call_ambulance",
          label: "Call Ambulance / 911",
          description: "Professional emergency responders",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
      ],
    },

    // ── Help is En Route ─────────────────────────────────────────
    {
      id: "help_enroute",
      title: "Help is On the Way",
      subtitle: "Responder dispatched to " + zone,
      icon: Navigation,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      parallelHint: "Share employee's Medical ID with the responder",
      choices: [
        {
          id: "responder_arrived_ok",
          label: "Responder Arrived — Situation OK",
          description: "Employee is safe, minor or no issue",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "responder_needs_medical",
          label: "Needs Medical Help",
          description: "Responder confirms medical attention needed",
          icon: Heart,
          color: "#FF2D55",
          nextStepId: "medical_triage",
        },
        {
          id: "responder_cant_find",
          label: "Can't Find Employee",
          description: "Employee not at expected location",
          icon: Search,
          color: "#FF9500",
          nextStepId: "search_protocol",
        },
        {
          id: "share_medical_id",
          label: "Share Medical ID with Responder",
          description: "Send allergies, blood type, conditions",
          icon: Heart,
          color: "#FF9500",
          nextStepId: "help_enroute",
          isParallel: true,
          dashboardAction: "employees",
        },
      ],
    },

    // ── Medical Triage ───────────────────────────────────────────
    {
      id: "medical_triage",
      title: "Medical Assessment",
      subtitle: "What level of medical response is needed?",
      icon: Heart,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      choices: [
        {
          id: "first_aid_enough",
          label: "First Aid is Sufficient",
          description: "Cuts, bruises, minor sprains",
          icon: Heart,
          color: "#00C853",
          nextStepId: "first_aid_applied",
        },
        {
          id: "need_ambulance",
          label: "Call Ambulance",
          description: "Fractures, deep wounds, breathing issues",
          icon: Ambulance,
          color: "#FF9500",
          nextStepId: "emergency_services_called",
        },
        {
          id: "need_airlift",
          label: "Airlift / Critical Transport",
          description: "Remote location, severe trauma, time-critical",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
          badge: "CRITICAL",
        },
      ],
    },

    // ── Critical Response ────────────────────────────────────────
    {
      id: "critical_response",
      title: "CRITICAL RESPONSE",
      subtitle: "Life-threatening situation — maximum response",
      icon: Siren,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      autoAction: "ALERT_ALL_RESPONDERS",
      choices: [
        {
          id: "call_911_critical",
          label: "Call 911 — Already Done",
          description: "Emergency services notified",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
        {
          id: "evacuate_zone",
          label: "Evacuate Zone",
          description: "Danger may affect others in the area",
          icon: Megaphone,
          color: "#FF2D55",
          nextStepId: "evacuation_triggered",
          dashboardAction: "comms",
        },
        {
          id: "dispatch_all",
          label: "Send ALL Available Help",
          description: "Every available responder to the scene",
          icon: Users,
          color: "#FF9500",
          nextStepId: "help_enroute",
        },
      ],
    },

    // ── Threat Response ──────────────────────────────────────────
    {
      id: "threat_response",
      title: "Security Threat",
      subtitle: name + " is facing a security threat",
      icon: Shield,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      urgencyLevel: 4,
      choices: [
        {
          id: "send_security",
          label: "Dispatch Security Team",
          description: "On-site security to the location",
          icon: Shield,
          color: "#FF9500",
          nextStepId: "help_enroute",
        },
        {
          id: "call_police",
          label: "Contact Police",
          description: "Law enforcement needed",
          icon: Phone,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
        {
          id: "lockdown_zone",
          label: "Lock Down the Zone",
          description: "Restrict all access to the area",
          icon: Lock,
          color: "#FF2D55",
          nextStepId: "lockdown_active",
          dashboardAction: "comms",
        },
        {
          id: "silent_alert",
          label: "Silent Alert to Nearby Workers",
          description: "Warn others without alerting the threat",
          icon: Bell,
          color: "#00C8E0",
          nextStepId: "help_enroute",
        },
      ],
    },

    // ── Environmental Response ────────────────────────────────────
    {
      id: "environmental_response",
      title: "Environmental Emergency",
      subtitle: "Fire, gas, chemical, or structural hazard",
      icon: Flame,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      choices: [
        {
          id: "evacuate_immediate",
          label: "Evacuate Zone IMMEDIATELY",
          description: "Get everyone out — danger may spread",
          icon: Megaphone,
          color: "#FF2D55",
          nextStepId: "evacuation_triggered",
          badge: "PRIORITY 1",
          dashboardAction: "comms",
        },
        {
          id: "fire_dept",
          label: "Call Fire Department",
          description: "Professional hazmat/fire response",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
        {
          id: "isolate_area",
          label: "Isolate & Contain",
          description: "Block access, shut down utilities if possible",
          icon: Lock,
          color: "#FF9500",
          nextStepId: "lockdown_active",
        },
      ],
    },

    // ── Send Assistance (minor) ──────────────────────────────────
    {
      id: "send_assist",
      title: "Sending Assistance",
      subtitle: "Help is being arranged for " + name,
      icon: Users,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "assist_resolved",
          label: "Issue Resolved",
          description: "Help arrived and situation handled",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "assist_escalated",
          label: "Situation Got Worse",
          description: "Need to escalate response",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "medical_triage",
        },
      ],
    },

    // ── First Aid Applied ────────────────────────────────────────
    {
      id: "first_aid_applied",
      title: "First Aid Applied",
      subtitle: "On-site treatment administered",
      icon: Heart,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      choices: [
        {
          id: "employee_stable",
          label: "Employee Stable — Resume Work?",
          description: "Treatment was sufficient",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "need_hospital",
          label: "Needs Hospital Visit",
          description: "Requires professional medical follow-up",
          icon: Ambulance,
          color: "#FF9500",
          nextStepId: "emergency_services_called",
        },
      ],
    },

    // ── Emergency Services Called ─────────────────────────────────
    {
      id: "emergency_services_called",
      title: "Emergency Services Notified",
      subtitle: "Professional responders have been contacted",
      icon: Ambulance,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      autoAction: "LOG_EMERGENCY_SERVICES_CALL",
      parallelHint: "Share GPS coordinates + Medical ID with dispatch",
      choices: [
        {
          id: "services_arrived",
          label: "Responders Arrived on Scene",
          description: "Professional help is now present",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "handover",
        },
        {
          id: "share_gps",
          label: "Share GPS with Dispatch",
          description: "Send exact coordinates for faster arrival",
          icon: MapPin,
          color: "#00C8E0",
          nextStepId: "emergency_services_called",
          isParallel: true,
          dashboardAction: "riskMap",
        },
        {
          id: "share_med_id",
          label: "Share Medical ID",
          description: "Blood type, allergies, medications",
          icon: Heart,
          color: "#FF9500",
          nextStepId: "emergency_services_called",
          isParallel: true,
        },
      ],
    },

    // ── Handover ─────────────────────────────────────────────────
    {
      id: "handover",
      title: "Handover to Emergency Services",
      subtitle: "Professional responders now in control",
      icon: CheckCircle,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      choices: [
        {
          id: "move_to_post",
          label: "Move to Post-Incident Steps",
          description: "Employee is in safe hands — start documentation",
          icon: FileText,
          color: "#00C8E0",
          nextStepId: "post_incident_entry",
        },
      ],
    },

    // ── Lockdown Active ──────────────────────────────────────────
    {
      id: "lockdown_active",
      title: "Zone Lockdown Active",
      subtitle: "Area access restricted — all staff notified",
      icon: Lock,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      choices: [
        {
          id: "threat_clear",
          label: "All Clear — Lift Lockdown",
          description: "Threat resolved, safe to resume",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "upgrade_evac",
          label: "Upgrade to Full Evacuation",
          description: "Threat requires everyone to leave",
          icon: Megaphone,
          color: "#FF2D55",
          nextStepId: "evacuation_triggered",
          dashboardAction: "comms",
        },
      ],
    },

    // ── Evacuation Triggered ─────────────────────────────────────
    {
      id: "evacuation_triggered",
      title: "Evacuation in Progress",
      subtitle: "Zone evacuation order sent to all workers",
      icon: Megaphone,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      autoAction: "TRIGGER_EVACUATION",
      choices: [
        {
          id: "all_accounted",
          label: "All Employees Accounted For",
          description: "Head count complete — everyone safe",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "missing_people",
          label: "Missing Employees",
          description: "Some workers unaccounted for",
          icon: Search,
          color: "#FF2D55",
          nextStepId: "search_protocol",
        },
      ],
    },

    // ── Search Protocol ──────────────────────────────────────────
    {
      id: "search_protocol",
      title: "Search Protocol",
      subtitle: "Locating missing employee(s)",
      icon: Search,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      choices: [
        {
          id: "found_safe",
          label: "Found — Employee is Safe",
          description: "Located and confirmed safe",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "found_injured",
          label: "Found — Needs Medical Help",
          description: "Located but requires treatment",
          icon: Heart,
          color: "#FF2D55",
          nextStepId: "medical_triage",
        },
        {
          id: "still_missing",
          label: "Still Missing",
          description: "Expand search area, contact authorities",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
      ],
    },

    // ── Buddy Contacted ──────────────────────────────────────────
    {
      id: "buddy_contacted",
      title: "Buddy System Check",
      subtitle: "Contacting paired colleague",
      icon: Users,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "buddy_found_them",
          label: "Buddy Found Them — They're OK",
          description: "Colleague confirmed employee is fine",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "buddy_cant_find",
          label: "Buddy Can't Find Them",
          description: "Paired worker also can't locate them",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "search_protocol",
        },
        {
          id: "buddy_confirms_danger",
          label: "Buddy Confirms Danger",
          description: "Colleague reports active hazard",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "critical_response",
        },
      ],
    },

    // ── Review Location ──────────────────────────────────────────
    {
      id: "review_location",
      title: "Reviewing Location Data",
      subtitle: "Checking GPS trail and last known position",
      icon: MapPin,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "location_found",
          label: "Found Location — Dispatch Help There",
          description: "GPS shows a clear location",
          icon: Navigation,
          color: "#00C853",
          nextStepId: "dispatch_options",
        },
        {
          id: "gps_stale",
          label: "GPS Data is Old / Unreliable",
          description: "Last update was too long ago",
          icon: AlertTriangle,
          color: "#FF9500",
          nextStepId: "search_protocol",
        },
      ],
    },

    // ══════════════════════════════════════════════════════════════
    // JOURNEY-SPECIFIC STEPS (for employees on route / no zone)
    // ══════════════════════════════════════════════════════════════

    // ── Journey Entry Point (reached from "assess" for journey types) ──
    {
      id: "journey_assess",
      title: "On-Route Emergency",
      subtitle: j ? `${name} is between ${j.lastWaypoint} and ${j.nextWaypoint}` : `${name} is on the road`,
      icon: Route,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 4,
      parallelHint: j ? `Vehicle: ${j.vehicleType} • ${j.distanceCovered}/${j.totalDistance} km covered` : undefined,
      choices: [
        {
          id: "jrn_call",
          label: "Call the Driver NOW",
          description: "Direct call — check if they're conscious and OK",
          icon: Phone,
          color: "#00C853",
          nextStepId: "journey_calling",
          badge: "FASTEST",
        },
        {
          id: "jrn_gps",
          label: "Track Live GPS Position",
          description: "See exactly where they stopped or deviated",
          icon: MapPin,
          color: "#00C8E0",
          nextStepId: "journey_tracking",
          dashboardAction: "riskMap",
        },
        {
          id: "jrn_chat",
          label: "Silent Emergency Chat",
          description: "Employee may not be able to speak — text only",
          icon: MessageCircle,
          color: "#00C8E0",
          nextStepId: "chat_active",
          action: "OPEN_CHAT",
        },
        {
          id: "jrn_full",
          label: "Full Road Emergency Protocol",
          description: "Call + GPS + Nearest help + Emergency services — ALL at once",
          icon: Siren,
          color: "#FF2D55",
          nextStepId: "journey_full_protocol",
          badge: "MAXIMUM RESPONSE",
        },
      ],
    },

    // ── Journey Calling ──────────────────────────────────────────
    {
      id: "journey_calling",
      title: "Calling " + name + "...",
      subtitle: j ? `On route to ${j.destination}` : "On field mission",
      icon: Phone,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      parallelHint: "While waiting: pull up their GPS and check the route for hazards",
      choices: [
        {
          id: "jrn_answered_ok",
          label: "Answered — Just a Breakdown",
          description: "Vehicle issue, flat tire, ran out of fuel",
          icon: Car,
          color: "#FF9500",
          nextStepId: "journey_breakdown",
        },
        {
          id: "jrn_answered_accident",
          label: "Answered — Road Accident",
          description: "Traffic collision or rollover",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "journey_accident",
        },
        {
          id: "jrn_answered_lost",
          label: "Answered — Lost / Wrong Route",
          description: "They're confused about directions",
          icon: Compass,
          color: "#00C8E0",
          nextStepId: "journey_reroute",
        },
        {
          id: "jrn_answered_threat",
          label: "Answered — Feels Unsafe",
          description: "Suspicious area, being followed, road block",
          icon: Shield,
          color: "#FF9500",
          nextStepId: "journey_threat",
        },
        {
          id: "jrn_no_answer",
          label: "No Answer",
          description: "Phone rang but nobody picked up",
          icon: PhoneOff,
          color: "#FF2D55",
          nextStepId: "journey_no_answer",
        },
      ],
    },

    // ── Journey Full Protocol ────────────────────────────────────
    {
      id: "journey_full_protocol",
      title: "Full Road Protocol Activated",
      subtitle: "All response actions executing simultaneously",
      icon: Siren,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      autoAction: "EXECUTE_ROAD_PROTOCOL",
      parallelHint: "Calling employee + Sharing GPS with emergency services + Alerting nearest field worker",
      choices: [
        {
          id: "jrn_full_answered",
          label: "Employee Responded!",
          description: "Got through on call or chat",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "triage",
        },
        {
          id: "jrn_full_no_response",
          label: "No Response — Help Dispatched",
          description: "Emergency services and nearest worker are en route",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "journey_help_enroute",
        },
      ],
    },

    // ── Journey Tracking ─────────────────────────────────────────
    {
      id: "journey_tracking",
      title: "Live GPS Tracking",
      subtitle: j ? `Last seen near ${j.lastWaypoint}${j.deviationKm ? ` — ${j.deviationKm}km off route` : ""}` : "Tracking position...",
      icon: MapPin,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "jrn_gps_moving",
          label: "Vehicle is Still Moving",
          description: "GPS shows continued movement",
          icon: Car,
          color: "#00C853",
          nextStepId: "journey_reroute",
        },
        {
          id: "jrn_gps_stopped",
          label: "Vehicle Stopped",
          description: "Not moving — could be breakdown or accident",
          icon: AlertCircle,
          color: "#FF9500",
          nextStepId: "journey_calling",
        },
        {
          id: "jrn_gps_lost",
          label: "GPS Signal Lost",
          description: "No location data — employee may be in dead zone",
          icon: MapPinOff,
          color: "#FF2D55",
          nextStepId: "journey_no_answer",
        },
      ],
    },

    // ── Vehicle Breakdown ────────────────────────────────────────
    {
      id: "journey_breakdown",
      title: "Vehicle Breakdown",
      subtitle: name + " has a vehicle issue on route",
      icon: Car,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      choices: [
        {
          id: "send_tow",
          label: "Send Tow / Mechanic",
          description: "Dispatch roadside assistance to their GPS location",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "journey_help_enroute",
        },
        {
          id: "send_replacement_vehicle",
          label: "Send Replacement Vehicle",
          description: "Another driver brings a spare vehicle",
          icon: Car,
          color: "#00C8E0",
          nextStepId: "journey_help_enroute",
        },
        {
          id: "abort_journey",
          label: "Abort Journey — Return to Base",
          description: "Cancel the mission and arrange pickup",
          icon: ArrowRight,
          color: "rgba(255,255,255,0.5)",
          nextStepId: "journey_pickup",
        },
        {
          id: "wait_safely",
          label: "Wait at Safe Location",
          description: "Employee confirmed safe, waiting for help",
          icon: Shield,
          color: "#00C853",
          nextStepId: "journey_help_enroute",
        },
      ],
    },

    // ── Road Accident ────────────────────────────────────────────
    {
      id: "journey_accident",
      title: "ROAD ACCIDENT",
      subtitle: "Traffic collision reported — assess severity",
      icon: AlertTriangle,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      timeTarget: "IMMEDIATE",
      choices: [
        {
          id: "accident_minor",
          label: "Minor — Employee is OK",
          description: "Fender bender, no injuries",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "journey_minor_accident",
        },
        {
          id: "accident_injured",
          label: "Employee is Injured",
          description: "Needs medical attention",
          icon: Heart,
          color: "#FF2D55",
          nextStepId: "journey_medical",
        },
        {
          id: "accident_severe",
          label: "Severe Accident",
          description: "Major collision — employee may be trapped/unconscious",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "journey_critical_accident",
          badge: "CRITICAL",
        },
        {
          id: "accident_multi",
          label: "Multi-Vehicle / Others Involved",
          description: "Other people also injured",
          icon: Users,
          color: "#FF9500",
          nextStepId: "journey_critical_accident",
        },
      ],
    },

    // ── Journey Medical ──────────────────────────────────────────
    {
      id: "journey_medical",
      title: "Medical Emergency on Route",
      subtitle: "Employee needs medical help on the road",
      icon: Heart,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      parallelHint: "Share Medical ID (blood type, allergies, medications) with 911 dispatcher NOW",
      choices: [
        {
          id: "jrn_call_ambulance",
          label: "Call Ambulance to GPS Location",
          description: "Emergency medical responders",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
          badge: "PRIORITY 1",
        },
        {
          id: "jrn_stay_on_line",
          label: "Stay on Phone with Employee",
          description: "Keep them calm, give first aid instructions",
          icon: Phone,
          color: "#00C853",
          nextStepId: "emergency_services_called",
          isParallel: true,
        },
        {
          id: "jrn_share_medical",
          label: "Share Medical ID with Dispatch",
          description: "Blood type, allergies, current medications",
          icon: Heart,
          color: "#FF9500",
          nextStepId: "journey_medical",
          isParallel: true,
        },
      ],
    },

    // ── Critical Accident ────────────────────────────────────────
    {
      id: "journey_critical_accident",
      title: "CRITICAL ROAD ACCIDENT",
      subtitle: "Maximum emergency response required",
      icon: Siren,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      timeTarget: "IMMEDIATE",
      autoAction: "ALERT_ALL_ROAD_EMERGENCY",
      choices: [
        {
          id: "jrn_911_done",
          label: "911 Called — Waiting for Arrival",
          description: "Professional responders notified",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
        {
          id: "jrn_send_company_team",
          label: "Send Company Emergency Team",
          description: "Nearest available employee to the scene",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "journey_help_enroute",
        },
        {
          id: "jrn_notify_family",
          label: "Notify Emergency Contacts",
          description: "Contact employee's family/next of kin",
          icon: Users,
          color: "#FF9500",
          nextStepId: "journey_family_notified",
        },
      ],
    },

    // ── Minor Accident ───────────────────────────────────────────
    {
      id: "journey_minor_accident",
      title: "Minor Accident — Document",
      subtitle: "Employee is OK — need to document for insurance",
      icon: Camera,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      choices: [
        {
          id: "jrn_take_photos",
          label: "Ask Employee to Take Photos",
          description: "Document vehicle damage, location, other vehicles",
          icon: Camera,
          color: "#00C8E0",
          nextStepId: "journey_documented",
        },
        {
          id: "jrn_continue_journey",
          label: "Vehicle is Driveable — Continue",
          description: "Minor damage, can still complete the journey",
          icon: Car,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "jrn_abort_minor",
          label: "Abort Journey — Return to Base",
          description: "Vehicle needs inspection before continuing",
          icon: ArrowRight,
          color: "#FF9500",
          nextStepId: "journey_pickup",
        },
      ],
    },

    // ── Journey Threat (security on road) ────────────────────────
    {
      id: "journey_threat",
      title: "Security Threat on Route",
      subtitle: name + " feels unsafe on the road",
      icon: Shield,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      urgencyLevel: 4,
      choices: [
        {
          id: "jrn_keep_driving",
          label: "Keep Driving — Don't Stop",
          description: "Head to nearest safe point, stay on the phone",
          icon: Car,
          color: "#00C853",
          nextStepId: "journey_safe_point",
          badge: "RECOMMENDED",
        },
        {
          id: "jrn_call_police",
          label: "Contact Police",
          description: "Report suspicious activity, share GPS",
          icon: Phone,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
        },
        {
          id: "jrn_reroute_safe",
          label: "Re-Route to Safer Road",
          description: "Find alternative route away from threat",
          icon: Route,
          color: "#00C8E0",
          nextStepId: "journey_reroute",
        },
        {
          id: "jrn_audio_record",
          label: "Start Audio Recording",
          description: "Auto-record 60 seconds as legal evidence",
          icon: Mic,
          color: "#FF9500",
          nextStepId: "journey_threat",
          isParallel: true,
          action: "START_AUDIO_RECORD",
        },
      ],
    },

    // ── Reroute ──────────────────────────────────────────────────
    {
      id: "journey_reroute",
      title: "Re-Routing Employee",
      subtitle: "Guiding " + name + " to a safer path",
      icon: Route,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "jrn_back_on_track",
          label: "Back on Planned Route",
          description: "Employee returned to original path",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "jrn_alt_route",
          label: "Taking Alternative Route",
          description: "New route is safe — continue mission",
          icon: Route,
          color: "#00C8E0",
          nextStepId: "post_incident_entry",
        },
        {
          id: "jrn_abort_reroute",
          label: "Abort — Too Risky",
          description: "Send someone to pick them up",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "journey_pickup",
        },
      ],
    },

    // ── No Answer on Journey ─────────────────────────────────────
    {
      id: "journey_no_answer",
      title: "Lost Contact with Driver",
      subtitle: "No phone answer + no GPS — HIGH RISK scenario",
      icon: PhoneOff,
      iconColor: "#FF2D55",
      iconBg: "rgba(255,45,85,0.12)",
      phase: "active",
      urgencyLevel: 5,
      timeTarget: "IMMEDIATE",
      choices: [
        {
          id: "jrn_send_to_last_gps",
          label: "Send Help to Last GPS Location",
          description: "Dispatch nearest person to where they were last seen",
          icon: Navigation,
          color: "#FF9500",
          nextStepId: "journey_help_enroute",
          badge: "URGENT",
        },
        {
          id: "jrn_call_911_road",
          label: "Call 911 with Route Details",
          description: "Share the planned route so police can search",
          icon: Ambulance,
          color: "#FF2D55",
          nextStepId: "emergency_services_called",
          badge: "RECOMMENDED",
        },
        {
          id: "jrn_check_waypoints",
          label: "Check with Waypoint Locations",
          description: "Call fuel station / checkpoint they were supposed to pass",
          icon: MapPin,
          color: "#00C8E0",
          nextStepId: "journey_waypoint_check",
        },
        {
          id: "jrn_contact_family",
          label: "Contact Emergency Contacts",
          description: "Maybe they called family before losing signal",
          icon: Users,
          color: "#FF9500",
          nextStepId: "journey_family_notified",
        },
      ],
    },

    // ── Waypoint Check ───────────────────────────────────────────
    {
      id: "journey_waypoint_check",
      title: "Checking Waypoints",
      subtitle: j ? `Calling ${j.lastWaypoint} and ${j.nextWaypoint}` : "Verifying at checkpoints...",
      icon: MapPin,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "waypoint_confirmed",
          label: "Waypoint Confirmed — Was Seen There",
          description: "Someone at the checkpoint saw them pass",
          icon: Eye,
          color: "#00C853",
          nextStepId: "journey_tracking",
        },
        {
          id: "waypoint_never_arrived",
          label: "Never Arrived at Checkpoint",
          description: "They went missing between two points",
          icon: AlertTriangle,
          color: "#FF2D55",
          nextStepId: "search_protocol",
        },
      ],
    },

    // ── Journey Help En Route ────────────────────────────────────
    {
      id: "journey_help_enroute",
      title: "Help Dispatched to Route",
      subtitle: "Responders heading to " + name + "'s location",
      icon: Navigation,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      parallelHint: "Keep trying to contact the employee while help is on the way",
      choices: [
        {
          id: "jrn_help_arrived_ok",
          label: "Help Arrived — Employee is Safe",
          description: "Responders found them, situation resolved",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
        {
          id: "jrn_help_needs_medical",
          label: "Needs Medical Attention",
          description: "Responder confirms injuries",
          icon: Heart,
          color: "#FF2D55",
          nextStepId: "journey_medical",
        },
        {
          id: "jrn_help_cant_find",
          label: "Can't Find at Location",
          description: "Employee not where GPS showed",
          icon: Search,
          color: "#FF9500",
          nextStepId: "search_protocol",
        },
      ],
    },

    // ── Journey Pickup ────────────────────────────────────────���──
    {
      id: "journey_pickup",
      title: "Arranging Pickup",
      subtitle: "Sending someone to bring " + name + " back",
      icon: Car,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "active",
      choices: [
        {
          id: "pickup_done",
          label: "Employee Picked Up — Safe",
          description: "Back at base or in safe transport",
          icon: CheckCircle,
          color: "#00C853",
          nextStepId: "post_incident_entry",
        },
      ],
    },

    // ── Journey Documented ───────────────────────────────────────
    {
      id: "journey_documented",
      title: "Incident Documented",
      subtitle: "Photos and details captured on the road",
      icon: Camera,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      choices: [
        { id: "jrn_doc_continue", label: "Continue Journey", description: "Vehicle OK, keep going to destination", icon: Car, color: "#00C853", nextStepId: "post_incident_entry" },
        { id: "jrn_doc_return", label: "Return to Base", description: "Abort mission, come back", icon: ArrowRight, color: "#FF9500", nextStepId: "journey_pickup" },
      ],
    },

    // ── Safe Point Reached ───────────────────────────────────────
    {
      id: "journey_safe_point",
      title: "Heading to Safe Point",
      subtitle: "Employee driving to nearest safe location",
      icon: Shield,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      parallelHint: "Stay on the phone until they arrive at a safe, public location",
      choices: [
        { id: "arrived_safe", label: "Arrived at Safe Location", description: "Employee is now in a secure place", icon: CheckCircle, color: "#00C853", nextStepId: "post_incident_entry" },
        { id: "threat_escalated", label: "Threat Escalated", description: "Situation got worse — need police", icon: Siren, color: "#FF2D55", nextStepId: "emergency_services_called" },
      ],
    },

    // ── Family Notified ──────────────────────────────────────────
    {
      id: "journey_family_notified",
      title: "Emergency Contacts Notified",
      subtitle: "Family / next of kin has been informed",
      icon: Users,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "active",
      autoAction: "NOTIFY_EMERGENCY_CONTACTS",
      choices: [
        { id: "family_has_info", label: "Family Has Information", description: "They know something about the employee's location", icon: Eye, color: "#00C853", nextStepId: "journey_tracking" },
        { id: "family_no_info", label: "No New Information", description: "Family doesn't know anything either", icon: AlertTriangle, color: "#FF9500", nextStepId: "emergency_services_called" },
      ],
    },

    // ── False Alarm Close ────────────────────────────────────────
    {
      id: "false_alarm_close",
      title: "False Alarm Confirmed",
      subtitle: "No actual emergency — logging event",
      icon: CheckCircle,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "active",
      choices: [
        {
          id: "close_false",
          label: "Close — File as False Alarm",
          description: "Document and close the alert",
          icon: FileText,
          color: "#00C8E0",
          nextStepId: "resolve",
        },
      ],
    },

    // ══════════════════════════════════════════════════════════════
    // PHASE 2: POST-INCIDENT
    // ══════════════════════════════════════════════════════════════
    {
      id: "post_incident_entry",
      title: "Post-Incident Protocol",
      subtitle: "Emergency resolved — now let's document & prevent",
      icon: Clipboard,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "post",
      choices: [
        {
          id: "review_evidence",
          label: "Review Evidence & Reports",
          description: "Photos, audio recordings, chat logs from the incident",
          icon: Camera,
          color: "#00C8E0",
          nextStepId: "evidence_review",
        },
        {
          id: "skip_to_notify",
          label: "Skip to Notifications",
          description: "No evidence to review — go straight to reporting",
          icon: Bell,
          color: "#FF9500",
          nextStepId: "stakeholder_notify",
        },
      ],
    },

    // ── Evidence Review ──────────────────────────────────────────
    {
      id: "evidence_review",
      title: "Review Incident Evidence",
      subtitle: "Employee-submitted photos, audio & chat logs",
      icon: Camera,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "post",
      choices: [
        {
          id: "view_photos",
          label: "View Incident Photos",
          description: "Photos submitted by " + name + " during emergency",
          icon: Camera,
          color: "#00C8E0",
          nextStepId: "photos_reviewed",
          dashboardAction: "emergencyHub",
        },
        {
          id: "listen_audio",
          label: "Listen to Audio Evidence",
          description: "60-second auto-recording from SOS trigger",
          icon: Mic,
          color: "#FF9500",
          nextStepId: "audio_reviewed",
        },
        {
          id: "read_chat_log",
          label: "Read Emergency Chat Log",
          description: "Full message history during the incident",
          icon: MessageCircle,
          color: "#00C853",
          nextStepId: "chat_reviewed",
        },
        {
          id: "all_reviewed",
          label: "Done Reviewing — Continue",
          description: "Move to stakeholder notification",
          icon: ArrowRight,
          color: "#00C8E0",
          nextStepId: "stakeholder_notify",
        },
      ],
    },

    // ── Sub-review steps (return to evidence_review) ─────────────
    {
      id: "photos_reviewed",
      title: "Photos Reviewed",
      subtitle: "Incident photos have been examined",
      icon: Camera,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "post",
      choices: [
        { id: "back_evidence", label: "Review More Evidence", description: "Check audio or chat logs", icon: ArrowRight, color: "#00C8E0", nextStepId: "evidence_review" },
        { id: "continue_notify", label: "Continue to Notifications", description: "Move to stakeholder reporting", icon: Bell, color: "#FF9500", nextStepId: "stakeholder_notify" },
      ],
    },
    {
      id: "audio_reviewed",
      title: "Audio Evidence Reviewed",
      subtitle: "60-second recording has been listened to",
      icon: Volume2,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "post",
      choices: [
        { id: "back_evidence", label: "Review More Evidence", description: "Check photos or chat logs", icon: ArrowRight, color: "#00C8E0", nextStepId: "evidence_review" },
        { id: "continue_notify", label: "Continue to Notifications", description: "Move to stakeholder reporting", icon: Bell, color: "#FF9500", nextStepId: "stakeholder_notify" },
      ],
    },
    {
      id: "chat_reviewed",
      title: "Chat Log Reviewed",
      subtitle: "Emergency chat messages have been reviewed",
      icon: MessageCircle,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "post",
      choices: [
        { id: "back_evidence", label: "Review More Evidence", description: "Check photos or audio", icon: ArrowRight, color: "#00C8E0", nextStepId: "evidence_review" },
        { id: "continue_notify", label: "Continue to Notifications", description: "Move to stakeholder reporting", icon: Bell, color: "#FF9500", nextStepId: "stakeholder_notify" },
      ],
    },

    // ── Stakeholder Notification ─────────────────────────────────
    {
      id: "stakeholder_notify",
      title: "Notify Stakeholders",
      subtitle: "Who needs to know about this incident?",
      icon: Bell,
      iconColor: "#FF9500",
      iconBg: "rgba(255,150,0,0.12)",
      phase: "post",
      choices: [
        {
          id: "escalate_owner",
          label: "Escalate to Company Owner",
          description: "Send full incident report to owner/CEO",
          icon: ArrowUpRight,
          color: "#FF2D55",
          nextStepId: "owner_notified",
        },
        {
          id: "alert_zone_admins",
          label: "Alert Other Zone Admins",
          description: "Notify admins in all other zones about this incident",
          icon: Users,
          color: "#FF9500",
          nextStepId: "zone_admins_notified",
        },
        {
          id: "company_broadcast",
          label: "Company-Wide Broadcast",
          description: "Alert ALL employees about this incident",
          icon: Megaphone,
          color: "#00C8E0",
          nextStepId: "company_notified",
          dashboardAction: "comms",
        },
        {
          id: "keep_private",
          label: "Keep Internal — No Broadcast",
          description: "Only log it, don't notify others",
          icon: Lock,
          color: "rgba(255,255,255,0.4)",
          nextStepId: "preventive_entry",
        },
        {
          id: "external_report",
          label: "File External Report (Regulatory)",
          description: "OSHA, labor authority, insurance",
          icon: ExternalLink,
          color: "#8B5CF6",
          nextStepId: "external_filed",
        },
      ],
    },

    // ── Sub-notification steps ────────────────────────────────────
    {
      id: "owner_notified",
      title: "Owner Notified",
      subtitle: "Incident report sent to company owner",
      icon: ArrowUpRight,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "post",
      autoAction: "ESCALATE_TO_OWNER",
      choices: [
        { id: "also_zone_admins", label: "Also Alert Zone Admins", description: "Spread awareness to other zones", icon: Users, color: "#FF9500", nextStepId: "zone_admins_notified" },
        { id: "also_company", label: "Also Broadcast Company-Wide", description: "Everyone should know", icon: Megaphone, color: "#00C8E0", nextStepId: "company_notified" },
        { id: "enough_notifications", label: "That's Enough — Continue", description: "Move to preventive actions", icon: ArrowRight, color: "#00C8E0", nextStepId: "preventive_entry" },
      ],
    },
    {
      id: "zone_admins_notified",
      title: "Zone Admins Alerted",
      subtitle: "All zone administrators have been notified",
      icon: Users,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "post",
      autoAction: "NOTIFY_ZONE_ADMINS",
      choices: [
        { id: "also_owner", label: "Also Escalate to Owner", description: "Owner should see this too", icon: ArrowUpRight, color: "#FF2D55", nextStepId: "owner_notified" },
        { id: "also_broadcast", label: "Also Broadcast Company-Wide", description: "All employees should know", icon: Megaphone, color: "#00C8E0", nextStepId: "company_notified" },
        { id: "enough", label: "That's Enough — Continue", description: "Move to preventive actions", icon: ArrowRight, color: "#00C8E0", nextStepId: "preventive_entry" },
      ],
    },
    {
      id: "company_notified",
      title: "Company-Wide Broadcast Sent",
      subtitle: "All employees and managers have been notified",
      icon: Megaphone,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "post",
      autoAction: "BROADCAST_COMPANY",
      choices: [
        { id: "continue_prev", label: "Continue to Prevention", description: "Set up measures to prevent recurrence", icon: ArrowRight, color: "#00C8E0", nextStepId: "preventive_entry" },
      ],
    },
    {
      id: "external_filed",
      title: "External Report Filed",
      subtitle: "Regulatory notification documented",
      icon: ExternalLink,
      iconColor: "#8B5CF6",
      iconBg: "rgba(139,92,246,0.12)",
      phase: "post",
      choices: [
        { id: "back_notify", label: "Also Notify Internal Teams", description: "Go back to internal notifications", icon: Bell, color: "#FF9500", nextStepId: "stakeholder_notify" },
        { id: "continue_prev", label: "Continue to Prevention", description: "Set up preventive measures", icon: ArrowRight, color: "#00C8E0", nextStepId: "preventive_entry" },
      ],
    },

    // ══════════════════════════════════════════════════════════════
    // PHASE 3: PREVENTIVE ACTIONS
    // ══════════════════════════════════════════════════════════════
    {
      id: "preventive_entry",
      title: "Preventive Actions",
      subtitle: "What should we do to prevent this from happening again?",
      icon: ShieldCheck,
      iconColor: "#00C8E0",
      iconBg: "rgba(0,200,224,0.12)",
      phase: "preventive",
      choices: [
        {
          id: "update_risk",
          label: "Update Zone Risk Level",
          description: "Increase risk rating for " + zone,
          icon: Flag,
          color: "#FF9500",
          nextStepId: "risk_updated",
          dashboardAction: "location",
        },
        {
          id: "schedule_briefing",
          label: "Schedule Safety Briefing",
          description: "Team meeting about this incident",
          icon: Users,
          color: "#00C8E0",
          nextStepId: "briefing_scheduled",
        },
        {
          id: "request_equipment",
          label: "Request Safety Equipment",
          description: "PPE, barriers, sensors, signage",
          icon: Shield,
          color: "#FF9500",
          nextStepId: "equipment_requested",
        },
        {
          id: "update_checklist",
          label: "Update Pre-Shift Checklist",
          description: "Add new safety checks based on this incident",
          icon: Clipboard,
          color: "#00C853",
          nextStepId: "checklist_updated",
        },
        {
          id: "skip_prevention",
          label: "No Preventive Actions Needed",
          description: "This was an isolated incident",
          icon: ArrowRight,
          color: "rgba(255,255,255,0.4)",
          nextStepId: "resolve",
        },
      ],
    },

    // ── Preventive sub-steps ─────────────────────────────────────
    {
      id: "risk_updated", title: "Risk Level Updated", subtitle: "Zone risk rating has been adjusted", icon: Flag, iconColor: "#00C853", iconBg: "rgba(0,200,83,0.12)", phase: "preventive",
      choices: [
        { id: "more_prev", label: "More Preventive Actions", description: "Additional measures", icon: ShieldCheck, color: "#00C8E0", nextStepId: "preventive_entry" },
        { id: "done", label: "Done — Close Incident", description: "Finalize and archive", icon: CheckCircle, color: "#00C853", nextStepId: "resolve" },
      ],
    },
    {
      id: "briefing_scheduled", title: "Safety Briefing Scheduled", subtitle: "Team meeting added to calendar", icon: Users, iconColor: "#00C853", iconBg: "rgba(0,200,83,0.12)", phase: "preventive",
      choices: [
        { id: "more_prev", label: "More Preventive Actions", description: "Additional measures", icon: ShieldCheck, color: "#00C8E0", nextStepId: "preventive_entry" },
        { id: "done", label: "Done — Close Incident", description: "Finalize and archive", icon: CheckCircle, color: "#00C853", nextStepId: "resolve" },
      ],
    },
    {
      id: "equipment_requested", title: "Equipment Request Submitted", subtitle: "Safety equipment order has been placed", icon: Shield, iconColor: "#00C853", iconBg: "rgba(0,200,83,0.12)", phase: "preventive",
      choices: [
        { id: "more_prev", label: "More Preventive Actions", description: "Additional measures", icon: ShieldCheck, color: "#00C8E0", nextStepId: "preventive_entry" },
        { id: "done", label: "Done — Close Incident", description: "Finalize and archive", icon: CheckCircle, color: "#00C853", nextStepId: "resolve" },
      ],
    },
    {
      id: "checklist_updated", title: "Pre-Shift Checklist Updated", subtitle: "New safety checks added for all workers", icon: Clipboard, iconColor: "#00C853", iconBg: "rgba(0,200,83,0.12)", phase: "preventive",
      choices: [
        { id: "more_prev", label: "More Preventive Actions", description: "Additional measures", icon: ShieldCheck, color: "#00C8E0", nextStepId: "preventive_entry" },
        { id: "done", label: "Done — Close Incident", description: "Finalize and archive", icon: CheckCircle, color: "#00C853", nextStepId: "resolve" },
      ],
    },

    // ══════════════════════════════════════════════════════════════
    // FINAL: RESOLVE
    // ══════════════════════════════════════════════════════════════
    {
      id: "resolve",
      title: "Incident Closed & Archived",
      subtitle: "Full response documented — great work keeping people safe",
      icon: Award,
      iconColor: "#00C853",
      iconBg: "rgba(0,200,83,0.12)",
      phase: "closed",
      isCompleted: true,
    },
  ];

  return activeSteps;
}

// ═══════════════════════════════════════════════════════════════
// Phase indicator colors
// ═══════════════════════════════════════════════════════════════
const PHASE_CONFIG = {
  active:     { label: "ACTIVE RESPONSE", color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
  post:       { label: "POST-INCIDENT",   color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  preventive: { label: "PREVENTION",      color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
  closed:     { label: "CLOSED",          color: "#00C853", bg: "rgba(0,200,83,0.08)" },
};

// ═══════════════════════════════════════════════════════════════
// EMERGENCY RESPONSE WIZARD COMPONENT
// ═══════════════════════════════════════════════════════════════

export function EmergencyResponseWizard({
  context,
  onAction,
  onNavigate,
  onClose,
  onResolve,
}: {
  context: EmergencyContext;
  onAction: (action: string, data?: any) => void;
  onNavigate: (page: string) => void;
  onClose: () => void;
  onResolve: (emergencyId: string) => void;
}) {
  const steps = getEmergencyScenario(context);
  const [currentStepId, setCurrentStepId] = useState("assess");
  const [history, setHistory] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(context.elapsed);
  const [completedActions, setCompletedActions] = useState<string[]>([]);

  const currentStep = steps.find(s => s.id === currentStepId) || steps[0];
  const phase = currentStep.phase || "active";
  const phaseConfig = PHASE_CONFIG[phase];

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleChoice = (choice: GuidedChoice) => {
    // For parallel actions, don't navigate — just mark as done
    if (choice.isParallel) {
      setCompletedActions(prev => [...prev, choice.id]);
      if (choice.action) onAction(choice.action, { emergencyId: context.emergencyId, choice });
      if (choice.dashboardAction) onNavigate(choice.dashboardAction);
      return;
    }

    setHistory(prev => [...prev, currentStepId]);
    setCompletedActions(prev => [...prev, choice.id]);

    if (choice.action) onAction(choice.action, { emergencyId: context.emergencyId, choice });
    if (choice.dashboardAction) onNavigate(choice.dashboardAction);

    setCurrentStepId(choice.nextStepId);

    if (choice.nextStepId === "resolve") {
      onResolve(context.emergencyId);
    }
  };

  const handleBack = () => {
    if (history.length > 0) {
      const prevStep = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setCurrentStepId(prevStep);
    }
  };

  const Icon = currentStep.icon;
  const isUrgent = elapsed > 120 && phase === "active";
  const isCritical = context.severity === "critical" && phase === "active";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        className="relative w-full max-w-lg mx-4 flex flex-col"
        style={{
          maxHeight: "92vh",
          background: "linear-gradient(180deg, #0C1222, #05070E)",
          borderRadius: 24,
          border: `1px solid ${isCritical ? "rgba(255,45,85,0.2)" : `${phaseConfig.color}20`}`,
          boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 30px ${phaseConfig.color}10`,
          overflow: "hidden",
        }}
      >
        {/* Urgency pulse border */}
        {isCritical && (
          <motion.div
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 rounded-3xl pointer-events-none"
            style={{ border: "2px solid rgba(255,45,85,0.3)" }}
          />
        )}

        {/* Header */}
        <div className="px-5 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <LifeBuoy className="size-4" style={{ color: phaseConfig.color }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: phaseConfig.color, letterSpacing: "1px" }}>
                GUIDED RESPONSE
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Phase badge */}
              <div className="px-2 py-0.5 rounded-md" style={{ background: phaseConfig.bg, border: `1px solid ${phaseConfig.color}20` }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: phaseConfig.color, letterSpacing: "0.5px" }}>
                  {phaseConfig.label}
                </span>
              </div>
              {/* Timer */}
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
                style={{
                  background: isUrgent ? "rgba(255,45,85,0.08)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isUrgent ? "rgba(255,45,85,0.15)" : "rgba(255,255,255,0.06)"}`,
                }}>
                <Clock className="size-3" style={{ color: isUrgent ? "#FF2D55" : "rgba(255,255,255,0.3)" }} />
                <span style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isUrgent ? "#FF2D55" : "rgba(255,255,255,0.4)" }}>
                  {formatTime(elapsed)}
                </span>
              </div>
              <button onClick={onClose} className="size-7 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <X className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
              </button>
            </div>
          </div>

          {/* Progress breadcrumbs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {history.slice(-4).map((stepId, i) => {
              const step = steps.find(s => s.id === stepId);
              const stepPhase = step?.phase || "active";
              const pc = PHASE_CONFIG[stepPhase];
              return (
                <div key={i} className="flex items-center gap-1 flex-shrink-0">
                  <div className="size-4 rounded-full flex items-center justify-center"
                    style={{ background: `${pc.color}15` }}>
                    <CheckCircle2 className="size-2.5" style={{ color: pc.color }} />
                  </div>
                  <span style={{ fontSize: 7, color: `${pc.color}80`, fontWeight: 600, maxWidth: 50, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {step?.title?.slice(0, 15)}
                  </span>
                  <ChevronRight className="size-2.5" style={{ color: "rgba(255,255,255,0.1)" }} />
                </div>
              );
            })}
            <div className="flex items-center gap-1 flex-shrink-0">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="size-4 rounded-full flex items-center justify-center"
                style={{ background: currentStep.iconBg }}>
                <div className="size-2 rounded-full" style={{ background: currentStep.iconColor }} />
              </motion.div>
              <span style={{ fontSize: 7, color: currentStep.iconColor, fontWeight: 700 }}>
                Current
              </span>
            </div>
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: "none" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStepId}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Step icon + title */}
              <div className="flex items-start gap-3 mb-4">
                <motion.div
                  animate={isCritical && !currentStep.isCompleted ? {
                    boxShadow: [`0 0 0 0 ${currentStep.iconColor}40`, `0 0 0 12px ${currentStep.iconColor}00`],
                  } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="size-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: currentStep.iconBg, border: `1px solid ${currentStep.iconColor}25` }}
                >
                  <Icon className="size-6" style={{ color: currentStep.iconColor }} />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white" style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.3px" }}>
                    {currentStep.title}
                  </h3>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    {currentStep.subtitle}
                  </p>
                  {currentStep.timeTarget && phase === "active" && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <Zap className="size-3" style={{ color: "#FF9500" }} />
                      <span style={{ fontSize: 9, color: "#FF9500", fontWeight: 700 }}>
                        Target: {currentStep.timeTarget}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Parallel hint */}
              {currentStep.parallelHint && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
                  style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)" }}>
                  <Zap className="size-3 flex-shrink-0" style={{ color: "rgba(0,200,224,0.5)" }} />
                  <span style={{ fontSize: 10, color: "rgba(0,200,224,0.6)", fontWeight: 500 }}>
                    {currentStep.parallelHint}
                  </span>
                </div>
              )}

              {/* Resolved state */}
              {currentStep.isCompleted && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center gap-4 py-6"
                >
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="size-20 rounded-full flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))",
                      border: "2px solid rgba(0,200,83,0.3)",
                    }}
                  >
                    <Award className="size-10" style={{ color: "#00C853" }} />
                  </motion.div>
                  <div className="text-center">
                    <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>
                      Incident Fully Resolved
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                      Response time: {formatTime(elapsed)} &bull; {history.length + 1} steps &bull; {completedActions.length} actions
                    </p>
                  </div>

                  {/* Response summary */}
                  <div className="w-full rounded-xl p-3 space-y-2"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "1px" }}>
                      RESPONSE SUMMARY
                    </p>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Employee</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{context.employeeName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Zone</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{context.zone}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Total Time</span>
                      <span style={{ fontSize: 11, color: "#00C853", fontWeight: 700 }}>{formatTime(elapsed)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Actions Taken</span>
                      <span style={{ fontSize: 11, color: "#00C8E0", fontWeight: 700 }}>{completedActions.length}</span>
                    </div>
                  </div>

                  <button
                    onClick={onClose}
                    className="px-6 py-2.5 rounded-xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.08))",
                      border: "1px solid rgba(0,200,83,0.2)",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#00C853", fontWeight: 700 }}>
                      Close & Archive
                    </span>
                  </button>
                </motion.div>
              )}

              {/* Choices */}
              {!currentStep.isCompleted && currentStep.choices && (
                <div className="space-y-2">
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", fontWeight: 700, letterSpacing: "1px", marginBottom: 6 }}>
                    CHOOSE YOUR RESPONSE
                  </p>
                  {currentStep.choices.map((choice) => {
                    const ChoiceIcon = choice.icon;
                    const isCompleted = completedActions.includes(choice.id);
                    return (
                      <motion.button
                        key={choice.id}
                        whileHover={{ scale: 1.005 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => !isCompleted && handleChoice(choice)}
                        disabled={isCompleted}
                        className="w-full flex items-start gap-3 p-3 rounded-xl text-left relative overflow-hidden"
                        style={{
                          background: isCompleted
                            ? "rgba(0,200,83,0.04)"
                            : `linear-gradient(135deg, ${choice.color}06, ${choice.color}02)`,
                          border: `1px solid ${isCompleted ? "rgba(0,200,83,0.12)" : `${choice.color}15`}`,
                          opacity: isCompleted ? 0.5 : 1,
                        }}
                      >
                        {/* Badge */}
                        {choice.badge && !isCompleted && (
                          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md"
                            style={{
                              background: choice.badge === "FASTEST" ? "rgba(0,200,83,0.1)" :
                                         choice.badge === "RECOMMENDED" ? "rgba(0,200,224,0.1)" :
                                         choice.badge === "URGENT" ? "rgba(255,45,85,0.1)" :
                                         `${choice.color}10`,
                              border: `1px solid ${
                                choice.badge === "FASTEST" ? "rgba(0,200,83,0.2)" :
                                choice.badge === "RECOMMENDED" ? "rgba(0,200,224,0.2)" :
                                choice.badge === "URGENT" ? "rgba(255,45,85,0.2)" :
                                `${choice.color}20`
                              }`,
                            }}>
                            <span style={{
                              fontSize: 7, fontWeight: 800, letterSpacing: "0.5px",
                              color: choice.badge === "FASTEST" ? "#00C853" :
                                     choice.badge === "RECOMMENDED" ? "#00C8E0" :
                                     choice.badge === "URGENT" ? "#FF2D55" : choice.color,
                            }}>
                              {choice.badge}
                            </span>
                          </div>
                        )}

                        <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{
                            background: isCompleted ? "rgba(0,200,83,0.1)" : `${choice.color}10`,
                            border: `1px solid ${isCompleted ? "rgba(0,200,83,0.2)" : `${choice.color}18`}`,
                          }}>
                          {isCompleted ? (
                            <CheckCircle className="size-4" style={{ color: "#00C853" }} />
                          ) : (
                            <ChoiceIcon className="size-4" style={{ color: choice.color }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 pr-8">
                          <p className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>
                            {choice.label}
                          </p>
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                            {choice.description}
                          </p>
                          {choice.isParallel && !isCompleted && (
                            <span style={{ fontSize: 8, color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>
                              Can be done simultaneously
                            </span>
                          )}
                        </div>
                        {!isCompleted && !choice.isParallel && (
                          <ChevronRight className="size-4 flex-shrink-0 mt-1" style={{ color: `${choice.color}50` }} />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        {!currentStep.isCompleted && (
          <div className="px-5 py-3 flex items-center justify-between"
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
            <button
              onClick={handleBack}
              disabled={history.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
              style={{
                background: history.length > 0 ? "rgba(255,255,255,0.04)" : "transparent",
                border: history.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "1px solid transparent",
                opacity: history.length > 0 ? 1 : 0.3,
              }}
            >
              <ChevronLeft className="size-3" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Back</span>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="size-1.5 rounded-full" style={{ background: phaseConfig.color }} />
                <span style={{ fontSize: 8, fontWeight: 700, color: phaseConfig.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {context.severity}
                </span>
              </div>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.1)" }}>&bull;</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                Step {history.length + 1}
              </span>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING SETUP WIZARD (unchanged from v1)
// ═══════════════════════════════════════════════════════════════

interface SetupStep {
  id: string;
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  isCompleted: boolean;
  navigateTo?: string;
}

const SETUP_STEPS: SetupStep[] = [
  { id: "company", title: "Company Profile", subtitle: "Set up your company name, logo, and details", icon: Building2, iconColor: "#FF9500", isCompleted: true, navigateTo: "settings" },
  { id: "zones", title: "Define Work Zones", subtitle: "Add zones and set their risk levels", icon: MapIcon, iconColor: "#00C8E0", isCompleted: false, navigateTo: "location" },
  { id: "evacuation", title: "Set Evacuation Points", subtitle: "Mark assembly points for each zone", icon: Navigation, iconColor: "#FF2D55", isCompleted: false, navigateTo: "comms" },
  { id: "employees", title: "Add Employees", subtitle: "Import via CSV or invite individually", icon: UserPlus, iconColor: "#00C853", isCompleted: false, navigateTo: "employees" },
  { id: "roles", title: "Assign Roles & Permissions", subtitle: "Set up Zone Admins and supervisors", icon: Shield, iconColor: "#8B5CF6", isCompleted: false, navigateTo: "roles" },
  { id: "billing", title: "Choose Plan & Payment", subtitle: "Select the right plan for your team size", icon: CreditCard, iconColor: "#00C8E0", isCompleted: false, navigateTo: "billing" },
  { id: "test", title: "Run a Test Emergency", subtitle: "Make sure everything works before going live", icon: Zap, iconColor: "#FF9500", isCompleted: false, navigateTo: "emergencyHub" },
];

export function SetupWizardBanner({
  onNavigate,
  onDismiss,
  completedSteps = ["company"],
}: {
  onNavigate: (page: string) => void;
  onDismiss: () => void;
  completedSteps?: string[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const completed = completedSteps.length;
  const total = SETUP_STEPS.length;
  const progress = completed / total;
  const nextStep = SETUP_STEPS.find(s => !completedSteps.includes(s.id));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-5 mt-4 rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(0,200,224,0.04), rgba(0,200,224,0.01))",
        border: "1px solid rgba(0,200,224,0.1)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <button onClick={() => setIsExpanded(!isExpanded)} className="w-full flex items-center gap-3 p-3.5">
        <div className="relative size-10 flex-shrink-0">
          <svg className="size-10 -rotate-90" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(0,200,224,0.08)" strokeWidth="3" />
            <motion.circle cx="20" cy="20" r="17" fill="none" stroke="#00C8E0" strokeWidth="3" strokeLinecap="round" strokeDasharray={106.8} animate={{ strokeDashoffset: 106.8 * (1 - progress) }} transition={{ duration: 1 }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span style={{ fontSize: 10, fontWeight: 800, color: "#00C8E0" }}>{completed}/{total}</span>
          </div>
        </div>
        <div className="flex-1 text-left">
          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Setup Your Safety Platform</p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
            {nextStep ? `Next: ${nextStep.title}` : "All steps completed!"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="size-4" style={{ color: "rgba(0,200,224,0.4)" }} />
          <ChevronRight className="size-4 transition-transform" style={{ color: "rgba(255,255,255,0.2)", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }} />
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3.5 pb-3.5 space-y-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 12 }}>
              {SETUP_STEPS.map((step) => {
                const StepIcon = step.icon;
                const done = completedSteps.includes(step.id);
                return (
                  <motion.button
                    key={step.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { if (step.navigateTo) onNavigate(step.navigateTo); }}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left"
                    style={{
                      background: done ? "rgba(0,200,83,0.04)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${done ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.03)"}`,
                      opacity: done ? 0.6 : 1,
                    }}
                  >
                    <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: done ? "rgba(0,200,83,0.1)" : `${step.iconColor}10`, border: `1px solid ${done ? "rgba(0,200,83,0.15)" : `${step.iconColor}15`}` }}>
                      {done ? <CheckCircle className="size-4" style={{ color: "#00C853" }} /> : <StepIcon className="size-4" style={{ color: step.iconColor }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 12, fontWeight: 600, color: done ? "rgba(0,200,83,0.6)" : "rgba(255,255,255,0.8)", textDecoration: done ? "line-through" : "none" }}>{step.title}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{step.subtitle}</p>
                    </div>
                    {!done && <ChevronRight className="size-3.5" style={{ color: `${step.iconColor}40` }} />}
                  </motion.button>
                );
              })}
              <button onClick={onDismiss} className="w-full text-center py-2 mt-1">
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>Dismiss setup guide</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Floating "Smart Response" button ────────────────────────────────
export function GuideMeButton({
  hasActiveEmergency,
  onClick,
}: {
  hasActiveEmergency: boolean;
  onClick: () => void;
}) {
  if (!hasActiveEmergency) return null;

  return (
    <motion.button
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="fixed bottom-6 right-6 z-[150] flex items-center gap-2.5 px-5 py-3 rounded-2xl"
      style={{
        background: "linear-gradient(135deg, rgba(0,200,224,0.18), rgba(139,92,246,0.1))",
        border: "1px solid rgba(0,200,224,0.3)",
        boxShadow: "0 8px 30px rgba(0,200,224,0.15), 0 0 40px rgba(0,200,224,0.05)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Pulse ring */}
      <motion.div
        animate={{ scale: [1, 1.8, 1], opacity: [0.3, 0, 0.3] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ border: "1px solid rgba(0,200,224,0.15)" }}
      />
      <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 2, repeat: Infinity }}>
        <LifeBuoy className="size-5" style={{ color: "#00C8E0" }} />
      </motion.div>
      <div>
        <span style={{ fontSize: 13, color: "#00C8E0", fontWeight: 800, display: "block", letterSpacing: "-0.2px" }}>Smart Response</span>
        <span style={{ fontSize: 8, color: "rgba(0,200,224,0.4)", display: "block", marginTop: 1 }}>AI-guided rescue</span>
      </div>
      <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="size-2.5 rounded-full" style={{ background: "#FF2D55", boxShadow: "0 0 8px rgba(255,45,85,0.4)" }} />
    </motion.button>
  );
}
