// ═══════════════════════════════════════════════════════════════
// FIX J: Proactive Risk Scoring Engine
// ═══════════════════════════════════════════════════════════════
// Calculates risk scores for employees based on multiple factors
// Enables proactive safety interventions before incidents occur
// ═══════════════════════════════════════════════════════════════

export interface RiskFactor {
  id: string;
  label: string;
  points: number;
  severity: "low" | "medium" | "high";
}

export interface EmployeeRiskScore {
  employeeId: string;
  employeeName: string;
  totalScore: number;
  factors: RiskFactor[];
  level: "safe" | "caution" | "warning" | "critical";
  suggestions: string[];
}

export interface EmployeeForRiskScoring {
  id: string;
  name: string;
  joinDate: Date | number;
  hasBuddy: boolean;
  checkInInterval: number; // minutes
  batteryLevel: number;
  isWorkingAlone: boolean;
  shift: "day" | "night";
  temperature?: number;
  isFasting?: boolean;
  lastMovement?: number; // ms since last GPS update
  incidentCount?: number;        // total incidents in last 90 days
  lastIncidentDate?: string;     // ISO date string
  openInvestigations?: number;   // count of open investigations
}

/* SUPABASE_MIGRATION_POINT: employee_risk_scores
   INSERT INTO employee_risk_scores (employee_id, score, level, factors, calculated_at)
   VALUES (:employeeId, :score, :level, :factors, NOW())
   ON CONFLICT (employee_id) DO UPDATE SET score=EXCLUDED.score */
export function calculateRiskScore(employee: EmployeeForRiskScoring): EmployeeRiskScore {
  const factors: RiskFactor[] = [];
  let totalScore = 0;

  // FIX J-1: New employee (<30 days) = +30 points
  const joinDate = typeof employee.joinDate === "number" ? employee.joinDate : employee.joinDate.getTime();
  const daysEmployed = Math.floor((Date.now() - joinDate) / (1000 * 60 * 60 * 24));
  if (daysEmployed < 30) {
    const points = 30;
    factors.push({
      id: "new_employee",
      label: `New employee (${daysEmployed} day${daysEmployed === 1 ? '' : 's'})`,
      points,
      severity: "high",
    });
    totalScore += points;
  }

  // FIX J-2: No buddy assigned = +20 points
  if (!employee.hasBuddy) {
    const points = 20;
    factors.push({
      id: "no_buddy",
      label: "No buddy assigned",
      points,
      severity: "medium",
    });
    totalScore += points;
  }

  // FIX J-3: Check-in interval > 2 hours = +20 points
  if (employee.checkInInterval > 120) {
    const points = 20;
    factors.push({
      id: "long_checkin",
      label: `Check-in interval: ${employee.checkInInterval}min (too long)`,
      points,
      severity: "medium",
    });
    totalScore += points;
  }

  // FIX J-4: Battery < 20% = +25 points
  if (employee.batteryLevel < 20) {
    const points = 25;
    factors.push({
      id: "low_battery",
      label: `Battery: ${employee.batteryLevel}% (critical)`,
      points,
      severity: "high",
    });
    totalScore += points;
  }

  // FIX J-5: Not moved in 30+ minutes = +15 points
  if (employee.lastMovement && employee.lastMovement > (30 * 60 * 1000)) {
    const points = 15;
    const minutes = Math.floor(employee.lastMovement / 60000);
    factors.push({
      id: "no_movement",
      label: `No movement for ${minutes} min (possible collapse)`,
      points,
      severity: "high",
    });
    totalScore += points;
  }

  // FIX J-6: Night shift = +10 points
  if (employee.shift === "night") {
    const points = 10;
    factors.push({
      id: "night_shift",
      label: "Night shift (reduced visibility)",
      points,
      severity: "low",
    });
    totalScore += points;
  }

  // FIX J-7: Working alone = +15 points
  if (employee.isWorkingAlone) {
    const points = 15;
    factors.push({
      id: "working_alone",
      label: "Working alone (no team nearby)",
      points,
      severity: "medium",
    });
    totalScore += points;
  }

  // FIX J-8: Extreme temperature (>45°C) = +15 points
  if (employee.temperature && employee.temperature > 45) {
    const points = 15;
    factors.push({
      id: "extreme_heat",
      label: `Temperature: ${employee.temperature}°C (extreme heat)`,
      points,
      severity: "high",
    });
    totalScore += points;
  }

  // FIX J-9: Fasting = +10 points
  if (employee.isFasting) {
    const points = 10;
    factors.push({
      id: "fasting",
      label: "Fasting (fatigue risk)",
      points,
      severity: "medium",
    });
    totalScore += points;
  }

  // Incident history factor
  let incidentFactor = 0;
  if (employee.incidentCount && employee.incidentCount > 0) {
    incidentFactor += employee.incidentCount * 2;  // +2 points per incident
  }
  if (employee.openInvestigations && employee.openInvestigations > 0) {
    incidentFactor += employee.openInvestigations * 5;  // +5 per open investigation
  }
  if (incidentFactor > 0) {
    factors.push({
      id: "incidents",
      label: `Incident history: ${employee.incidentCount || 0} incident(s), ${employee.openInvestigations || 0} open investigation(s)`,
      points: incidentFactor,
      severity: incidentFactor >= 10 ? "high" : "medium",
    });
    totalScore += incidentFactor;
  }

  // Cap at 100
  totalScore = Math.min(totalScore, 100);

  // Determine risk level
  let level: "safe" | "caution" | "warning" | "critical";
  if (totalScore >= 81) level = "critical";
  else if (totalScore >= 61) level = "warning";
  else if (totalScore >= 41) level = "caution";
  else level = "safe";

  // Generate suggestions
  const suggestions: string[] = [];
  if (factors.some(f => f.id === "new_employee")) {
    suggestions.push("Assign experienced buddy");
  }
  if (factors.some(f => f.id === "long_checkin" || f.id === "no_buddy")) {
    suggestions.push("Set check-in to 30 minutes");
  }
  if (factors.some(f => f.id === "low_battery")) {
    suggestions.push("Send battery pack or relocate worker");
  }
  if (factors.some(f => f.id === "extreme_heat")) {
    suggestions.push("Enforce hydration breaks");
  }
  if (factors.some(f => f.id === "working_alone")) {
    suggestions.push("Pair with another worker");
  }
  if (factors.some(f => f.id === "no_movement")) {
    suggestions.push("Call worker immediately");
  }
  if (factors.some(f => f.id === "fasting")) {
    suggestions.push("Reduce shift duration");
  }
  if (factors.some(f => f.id === "incidents")) {
    suggestions.push("Review incident history and ensure corrective actions are completed");
  }

  console.log("[SUPABASE_READY] risk_score_calculated: " + JSON.stringify({ employeeId: employee.id, score: totalScore, level }));
  console.log("[SUPABASE_READY] risk_score_with_incidents: " + JSON.stringify({ employeeId: employee.id, incidentFactor, finalScore: totalScore }));

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    totalScore,
    factors,
    level,
    suggestions,
  };
}

// Helper to get risk badge color
export function getRiskColor(level: "safe" | "caution" | "warning" | "critical"): string {
  switch (level) {
    case "critical": return "#FF2D55";
    case "warning": return "#FF9500";
    case "caution": return "#FFB300";
    case "safe": return "#00C853";
  }
}

// Helper to get risk label
export function getRiskLabel(level: "safe" | "caution" | "warning" | "critical"): string {
  switch (level) {
    case "critical": return "🚨 CRITICAL RISK";
    case "warning": return "⚠️ HIGH RISK";
    case "caution": return "MEDIUM RISK";
    case "safe": return "LOW RISK";
  }
}

export function mapRiskLevelToRegisterLevel(
  engineLevel: "safe" | "caution" | "warning" | "critical"
): "negligible" | "low" | "medium" | "high" | "extreme" {
  const map: Record<string, "negligible" | "low" | "medium" | "high" | "extreme"> = {
    safe: "negligible",
    caution: "low",
    warning: "high",
    critical: "extreme",
  };
  const result = map[engineLevel];
  console.log("[SUPABASE_READY] risk_level_mapped: " + engineLevel + " → " + result);
  return result;
}

export function mapRegisterLevelToEngineLevel(
  registerLevel: "extreme" | "high" | "medium" | "low" | "negligible"
): "safe" | "caution" | "warning" | "critical" {
  const map: Record<string, "safe" | "caution" | "warning" | "critical"> = {
    negligible: "safe",
    low: "caution",
    medium: "caution",
    high: "warning",
    extreme: "critical",
  };
  const result = map[registerLevel];
  console.log("[SUPABASE_READY] risk_level_mapped: " + registerLevel + " → " + result);
  return result;
}