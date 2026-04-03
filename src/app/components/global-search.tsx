// ═══════════════════════════════════════════════════════════════
// SOSphere Global Search — Apple Spotlight-style
// Lightning-fast, keyboard-first, beautiful
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, User, MapPin, AlertTriangle, ArrowRight, Command } from "lucide-react";

interface SearchResult {
  id: string;
  type: "employee" | "zone" | "incident";
  title: string;
  subtitle: string;
  status?: string;
  color?: string;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
  employees: Array<{ id: string; name: string; zone: string; status: string }>;
  zones: Array<{ id: string; name: string; risk: string }>;
  incidents: Array<{ id: string; employeeName: string; zone: string; timestamp: Date }>;
}

export function GlobalSearch({ isOpen, onClose, onSelect, employees, zones, incidents }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search logic
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const q = query.toLowerCase();
    const searchResults: SearchResult[] = [];

    // Employees
    employees.forEach((emp) => {
      if (emp.name.toLowerCase().includes(q) || emp.zone.toLowerCase().includes(q)) {
        searchResults.push({
          id: emp.id,
          type: "employee",
          title: emp.name,
          subtitle: emp.zone,
          status: emp.status,
          color: emp.status === "sos" ? "#FF2D55" : emp.status === "on-shift" ? "#00C853" : "#6E7681",
        });
      }
    });

    // Zones
    zones.forEach((zone) => {
      if (zone.name.toLowerCase().includes(q)) {
        searchResults.push({
          id: zone.id,
          type: "zone",
          title: zone.name,
          subtitle: `Risk: ${zone.risk}`,
          color: zone.risk === "high" ? "#FF2D55" : zone.risk === "medium" ? "#FF9500" : "#00C853",
        });
      }
    });

    // Incidents
    incidents.forEach((inc) => {
      if (inc.employeeName.toLowerCase().includes(q) || inc.zone.toLowerCase().includes(q)) {
        searchResults.push({
          id: inc.id,
          type: "incident",
          title: `Incident: ${inc.employeeName}`,
          subtitle: inc.zone,
          color: "#FF9500",
        });
      }
    });

    setResults(searchResults.slice(0, 6));
    setSelectedIndex(0);
  }, [query, employees, zones, incidents]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        onSelect(results[selectedIndex]);
        onClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex, onSelect, onClose]);

  if (!isOpen) return null;

  const getIcon = (type: SearchResult["type"]) => {
    switch (type) {
      case "employee": return User;
      case "zone": return MapPin;
      case "incident": return AlertTriangle;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[9999] flex items-start justify-center pt-24"
        style={{ background: "rgba(10, 14, 23, 0.85)", backdropFilter: "blur(16px)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: -10, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: -10, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl rounded-2xl overflow-hidden"
          style={{
            background: "rgba(13,17,23,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <Search className="size-5" style={{ color: "rgba(255,255,255,0.35)" }} strokeWidth={2} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees, zones, incidents..."
              className="flex-1 bg-transparent text-white outline-none placeholder:text-white/30"
              style={{ fontSize: 16, fontWeight: 500 }}
            />
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
              <Command className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} />
              <span className="font-mono font-medium" style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>K</span>
            </div>
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {results.length === 0 && query ? (
              <div className="py-16 text-center">
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>No results found</p>
              </div>
            ) : results.length === 0 ? (
              <div className="py-16 text-center">
                <Search className="size-8 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Start typing to search</p>
              </div>
            ) : (
              <div className="p-2">
                {results.map((result, i) => {
                  const Icon = getIcon(result.type);
                  const isSelected = i === selectedIndex;
                  return (
                    <motion.button
                      key={result.id}
                      onClick={() => { onSelect(result); onClose(); }}
                      whileHover={{ x: 2 }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                      style={{
                        background: isSelected ? "rgba(0,200,224,0.08)" : "transparent",
                        border: isSelected ? "1px solid rgba(0,200,224,0.15)" : "1px solid transparent",
                      }}
                    >
                      <div
                        className="size-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ 
                          background: `${result.color}12`, 
                          border: `1px solid ${result.color}20` 
                        }}
                      >
                        <Icon className="size-4" style={{ color: result.color }} strokeWidth={2} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-white font-medium truncate" style={{ fontSize: 13 }}>
                          {result.title}
                        </p>
                        <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                          {result.subtitle}
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}>↑↓</kbd>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Navigate</span>
              </div>
              <div className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}>↵</kbd>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Select</span>
              </div>
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>ESC to close</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Global keyboard shortcut hook
export function useGlobalSearch(callback: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        callback();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [callback]);
}