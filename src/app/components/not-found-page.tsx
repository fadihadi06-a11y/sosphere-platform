// ═══════════════════════════════════════════════════════════════
// SOSphere — 404 Not Found Page
// Branded, dark-themed 404 with navigation back to main routes
// ═══════════════════════════════════════════════════════════════

import { motion } from "motion/react";
import { Link } from "react-router";
import { Shield, Home, LayoutDashboard, Zap, ArrowLeft } from "lucide-react";

export function NotFoundPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "linear-gradient(160deg, #05070E 0%, #0A1220 50%, #05070E 100%)",
        fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div className="text-center px-6 max-w-md">
        {/* Animated shield icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mx-auto mb-8 size-24 rounded-3xl flex items-center justify-center relative"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.08) 0%, rgba(0,200,224,0.02) 100%)",
            border: "1px solid rgba(0,200,224,0.12)",
            boxShadow: "0 8px 40px rgba(0,200,224,0.06)",
          }}
        >
          <Shield className="size-12" style={{ color: "rgba(0,200,224,0.35)" }} strokeWidth={1.2} />
          <motion.div
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 2.5, repeat: Infinity }}
            className="absolute inset-0 rounded-3xl"
            style={{ border: "1px solid rgba(0,200,224,0.08)" }}
          />
        </motion.div>

        {/* 404 Text */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
        >
          <h1 style={{
            fontSize: 56,
            fontWeight: 900,
            color: "rgba(255,255,255,0.08)",
            letterSpacing: "-3px",
            lineHeight: 1,
            marginBottom: 8,
          }}>
            404
          </h1>
          <h2 style={{
            fontSize: 20,
            fontWeight: 800,
            color: "rgba(255,255,255,0.85)",
            letterSpacing: "-0.5px",
            marginBottom: 8,
          }}>
            Page Not Found
          </h2>
          <p style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.35)",
            lineHeight: 1.6,
            maxWidth: 320,
            margin: "0 auto",
          }}>
            The page you're looking for doesn't exist or has been moved.
            Navigate to one of the main sections below.
          </p>
        </motion.div>

        {/* Navigation buttons */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-8 space-y-3"
        >
          {[
            { href: "/", icon: Home, label: "Mobile App", desc: "Employee safety app", color: "#00C8E0" },
            { href: "/dashboard", icon: LayoutDashboard, label: "Company Dashboard", desc: "Admin control center", color: "#FF9500" },
            { href: "/demo", icon: Zap, label: "WOW Demo", desc: "Cinematic showcase", color: "#7B5EFF" },
          ].map((route) => (
            <Link
              key={route.href}
              to={route.href}
              className="flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                textDecoration: "none",
              }}
            >
              <div
                className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${route.color}15 0%, ${route.color}08 100%)`,
                  border: `1px solid ${route.color}20`,
                }}
              >
                <route.icon className="size-5" style={{ color: route.color }} strokeWidth={1.8} />
              </div>
              <div className="text-left flex-1">
                <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
                  {route.label}
                </p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  {route.desc}
                </p>
              </div>
              <ArrowLeft className="size-4 rotate-180" style={{ color: "rgba(255,255,255,0.15)" }} />
            </Link>
          ))}
        </motion.div>

        {/* Brand footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-10 flex items-center justify-center gap-2"
        >
          <Shield className="size-3.5" style={{ color: "rgba(0,200,224,0.25)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px" }}>
            SOSphere Safety Platform
          </span>
        </motion.div>
      </div>
    </div>
  );
}