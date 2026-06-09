// ═══════════════════════════════════════════════════════════════
// SOSphere — Drone Mission PDF Report
// Generated entirely from the light control-plane data (no video).
// Video is referenced as a pointer to the client's media server.
// ═══════════════════════════════════════════════════════════════
import jsPDF from "jspdf";
import type { DroneMission, Telemetry } from "./drone-service";

export function generateMissionReport(mission: DroneMission, track: Telemetry[], droneName?: string): void {
  const doc = new jsPDF();
  const last = track[track.length - 1];
  const dur = mission.approved_at && last
    ? Math.round((new Date(last.recorded_at).getTime() - new Date(mission.approved_at).getTime()) / 1000)
    : null;
  const maxAlt = track.reduce((m, p) => Math.max(m, p.altitude ?? 0), 0);
  const minBat = track.reduce((m, p) => Math.min(m, p.battery ?? 100), 100);

  doc.setFontSize(18); doc.setTextColor(0, 0, 0);
  doc.text("SOSphere — Drone Mission Report", 14, 20);
  doc.setDrawColor(0, 200, 224); doc.line(14, 24, 196, 24);

  doc.setFontSize(11); doc.setTextColor(60, 60, 60);
  const rows: [string, string][] = [
    ["Mission ID", mission.id],
    ["Drone", droneName || mission.drone_id || "—"],
    ["Status", mission.status],
    ["Target", `${mission.target_lat.toFixed(5)}, ${mission.target_lng.toFixed(5)}`],
    ["Approved at", mission.approved_at ?? "—"],
    ["Flight duration", dur != null ? `${dur} s` : "—"],
    ["Telemetry points", String(track.length)],
    ["Max altitude", `${Math.round(maxAlt)} m`],
    ["Min battery", `${minBat}%`],
  ];
  let y = 34;
  rows.forEach(([k, v]) => {
    doc.setFont(undefined as unknown as string, "bold"); doc.text(`${k}:`, 14, y);
    doc.setFont(undefined as unknown as string, "normal"); doc.text(String(v), 60, y);
    y += 8;
  });

  // Simple flight-path plot from telemetry
  if (track.length > 1) {
    y += 6; doc.setFontSize(12); doc.setTextColor(0, 0, 0); doc.text("Flight path", 14, y); y += 4;
    const x0 = 14, w = 120, h = 70, yTop = y;
    doc.setDrawColor(220); doc.rect(x0, yTop, w, h);
    const lats = track.map(p => p.lat).concat(mission.target_lat);
    const lngs = track.map(p => p.lng).concat(mission.target_lng);
    const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
    const sx = (lng: number) => x0 + ((lng - minLo) / ((maxLo - minLo) || 1)) * w;
    const sy = (lat: number) => yTop + (1 - (lat - minLa) / ((maxLa - minLa) || 1)) * h;
    doc.setDrawColor(0, 200, 224);
    for (let i = 1; i < track.length; i++) {
      doc.line(sx(track[i - 1].lng), sy(track[i - 1].lat), sx(track[i].lng), sy(track[i].lat));
    }
    doc.setFillColor(255, 45, 85);
    doc.circle(sx(mission.target_lng), sy(mission.target_lat), 1.6, "F");
  }

  doc.setFontSize(9); doc.setTextColor(140);
  doc.text("Video is retained on the client's media server and is not stored by the platform.", 14, 280);
  doc.save(`drone-mission-${mission.id.slice(0, 8)}.pdf`);
}
