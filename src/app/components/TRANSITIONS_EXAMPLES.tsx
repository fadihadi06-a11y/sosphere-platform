// ═══════════════════════════════════════════════════════════════
// SOSphere — Transitions Usage Examples
// ─────────────────────────────────────────────────────────────
// Reference examples for using the view transitions system
// ═══════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  PageTransition,
  CardReveal,
  SlidePanel,
  ScaleIn,
  ListStagger,
  motionConfig,
  useReducedMotion,
  cardVariants,
  listItemVariants,
} from "./view-transitions";

// ─────────────────────────────────────────────────────────────
// Example 1: Simple Page Transition
// ─────────────────────────────────────────────────────────────
export function PageTransitionExample() {
  const [page, setPage] = useState<"home" | "about">("home");

  return (
    <div>
      <button onClick={() => setPage("home")}>Home</button>
      <button onClick={() => setPage("about")}>About</button>

      <AnimatePresence mode="wait">
        <PageTransition key={page}>
          {page === "home" && <div>Home Content</div>}
          {page === "about" && <div>About Content</div>}
        </PageTransition>
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 2: Card Grid Reveal
// ─────────────────────────────────────────────────────────────
interface Card {
  id: string;
  title: string;
}

export function CardGridExample({ cards }: { cards: Card[] }) {
  return (
    <CardReveal className="grid grid-cols-3 gap-4">
      {cards.map((card) => (
        <motion.div
          key={card.id}
          variants={cardVariants}
          className="p-4 border rounded-lg bg-gray-50"
        >
          {card.title}
        </motion.div>
      ))}
    </CardReveal>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 3: Slide Panel (Sidebar)
// ─────────────────────────────────────────────────────────────
export function SlidePanelExample() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Toggle Sidebar</button>

      <AnimatePresence>
        {isOpen && (
          <SlidePanel direction="left" className="fixed left-0 top-0 h-full w-64 bg-white shadow-lg">
            <div className="p-4">Sidebar Content</div>
          </SlidePanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 4: Modal with Scale In
// ─────────────────────────────────────────────────────────────
export function ModalExample() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Open Modal</button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50"
              onClick={() => setIsOpen(false)}
            />
            <ScaleIn className="fixed inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white rounded-lg shadow-xl p-6 pointer-events-auto">
                <h2 className="text-lg font-bold mb-4">Modal Title</h2>
                <p>Modal content goes here</p>
                <button
                  onClick={() => setIsOpen(false)}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
                >
                  Close
                </button>
              </div>
            </ScaleIn>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 5: Table Row Stagger
// ─────────────────────────────────────────────────────────────
interface TableItem {
  id: string;
  name: string;
  email: string;
}

export function TableExample({ items }: { items: TableItem[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b">
          <th className="text-left p-2">Name</th>
          <th className="text-left p-2">Email</th>
        </tr>
      </thead>
      <tbody>
        <ListStagger>
          {items.map((item, i) => (
            <motion.tr
              key={item.id}
              variants={listItemVariants}
              custom={i}
              className="border-b hover:bg-gray-50"
            >
              <td className="p-2">{item.name}</td>
              <td className="p-2">{item.email}</td>
            </motion.tr>
          ))}
        </ListStagger>
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 6: Respecting Reduced Motion
// ─────────────────────────────────────────────────────────────
export function AccessibleAnimationExample() {
  const prefersReduced = useReducedMotion();

  return (
    <div>
      <p>Reduced motion preferred: {prefersReduced ? "Yes" : "No"}</p>

      <motion.div
        animate={{ x: 0 }}
        // When reduced motion is preferred, animation is instant
        transition={{
          duration: prefersReduced ? 0 : motionConfig.normal,
        }}
        className="w-12 h-12 bg-blue-500 rounded"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 7: Dashboard Hub Tab Transitions (from company-dashboard.tsx)
// ─────────────────────────────────────────────────────────────
export function HubTabTransitionExample() {
  const [activeTab, setActiveTab] = useState("active");

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab("active")}
          className={activeTab === "active" ? "font-bold" : ""}
        >
          Active
        </button>
        <button
          onClick={() => setActiveTab("reports")}
          className={activeTab === "reports" ? "font-bold" : ""}
        >
          Reports
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={activeTab === "history" ? "font-bold" : ""}
        >
          History
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: motionConfig.normal,
            ease: motionConfig.easeInOutCubic,
          }}
        >
          {activeTab === "active" && <div>Active tab content</div>}
          {activeTab === "reports" && <div>Reports tab content</div>}
          {activeTab === "history" && <div>History tab content</div>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Example 8: Complex Animated Card with Multiple Elements
// ─────────────────────────────────────────────────────────────
export function ComplexCardExample() {
  const cardItems = [
    { id: "1", title: "Emergency", count: 3 },
    { id: "2", title: "Operations", count: 5 },
    { id: "3", title: "People", count: 12 },
  ];

  return (
    <CardReveal className="grid grid-cols-3 gap-4">
      {cardItems.map((item) => (
        <motion.div
          key={item.id}
          variants={cardVariants}
          className="p-6 rounded-lg border border-gray-200 bg-white hover:shadow-lg transition-shadow"
        >
          <h3 className="font-bold text-lg">{item.title}</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">{item.count}</p>
          <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            View Details
          </button>
        </motion.div>
      ))}
    </CardReveal>
  );
}

// ─────────────────────────────────────────────────────────────
// Notes for Implementation
// ─────────────────────────────────────────────────────────────
/*
BEST PRACTICES:

1. Always wrap with AnimatePresence for exit animations
2. Use mode="wait" to prevent overlapping transitions
3. Use unique keys to trigger re-renders
4. Respect useReducedMotion() for accessibility
5. Keep animations quick (< 0.4s) for enterprise apps
6. Use transform-based animations for performance
7. Stagger multiple elements to avoid "jumping"
8. Test with prefers-reduced-motion enabled
9. Use motionConfig values instead of hardcoding durations
10. Wrap content in Suspense for code-split routes

COMMON MISTAKES TO AVOID:

1. ✗ Using x/y without transition - animations won't trigger
2. ✗ Forgetting AnimatePresence - no exit animations
3. ✗ Animating layout properties (width, height, padding)
4. ✗ Using mode="sync" - causes jumpy transitions
5. ✗ Not handling prefers-reduced-motion
6. ✗ Applying animations to direct <img> or <video> elements
7. ✗ Using delay instead of staggerChildren for lists
8. ✗ Forgetting to cleanup event listeners in motion callbacks

ACCESSIBILITY CHECKLIST:

- [ ] Animations respect prefers-reduced-motion
- [ ] No animations block interaction
- [ ] Keyboard navigation works during animations
- [ ] Page content is readable while animating
- [ ] Test with animation disabled
- [ ] No seizure-inducing flashing (< 3 Hz)
*/
