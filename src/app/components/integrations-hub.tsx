// ═══════════════════════════════════════════════════════════════
// SOSphere Integrations Hub — Future Integrations Dashboard
// Premium Coming Soon Cards with Frosted Glass Overlay
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bell, Check, Send, ArrowRight, Zap } from "lucide-react";
import { toast } from "sonner";

const INTEGRATIONS_I18N_KEYS = {
  title: "integ.title",
  subtitle: "integ.subtitle",
  searchPlaceholder: "integ.search",
  smartwatch: {
    title: "integ.smartwatch.title",
    subtitle: "integ.smartwatch.subtitle",
    description: "integ.smartwatch.description",
    badge: "integ.smartwatch.badge",
    feature1: "integ.smartwatch.f1",
    feature2: "integ.smartwatch.f2",
    feature3: "integ.smartwatch.f3",
    feature4: "integ.smartwatch.f4",
  },
  dispatch: {
    title: "integ.dispatch.title",
    subtitle: "integ.dispatch.subtitle",
    description: "integ.dispatch.description",
    badge: "integ.dispatch.badge",
    feature1: "integ.dispatch.f1",
    feature2: "integ.dispatch.f2",
    feature3: "integ.dispatch.f3",
    feature4: "integ.dispatch.f4",
  },
  predictive: {
    title: "integ.predictive.title",
    subtitle: "integ.predictive.subtitle",
    description: "integ.predictive.description",
    badge: "integ.predictive.badge",
    feature1: "integ.predictive.f1",
    feature2: "integ.predictive.f2",
    feature3: "integ.predictive.f3",
    feature4: "integ.predictive.f4",
  },
  feedback: {
    title: "integ.feedback.title",
    description: "integ.feedback.description",
    placeholder: "integ.feedback.placeholder",
    submit: "integ.feedback.submit",
  },
  apiDocs: {
    title: "integ.apiDocs.title",
    description: "integ.apiDocs.description",
  },
  notify: "integ.notify",
  subscribed: "integ.subscribed",
};

// SVG Icons (inline)
function WatchIcon() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="35" y="40" width="30" height="20" rx="3" fill="currentColor" opacity="0.3" />
      <circle cx="50" cy="50" r="3" fill="currentColor" />
      <path d="M50 55 L50 70" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 30 L50 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DispatchIcon() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      <path d="M20 80 L50 20 L80 80 Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="35" cy="60" r="3" fill="currentColor" />
      <circle cx="50" cy="50" r="3" fill="currentColor" />
      <circle cx="65" cy="60" r="3" fill="currentColor" />
      <path d="M20 80 L80 80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M45 35 Q50 25 55 35" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AIIcon() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      <circle cx="50" cy="30" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="30" cy="65" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="70" cy="65" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M50 42 L30 55" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 42 L70 55" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M30 75 L50 85" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M70 75 L50 85" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="50" cy="85" r="4" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

// Integration Card Component
function IntegrationCard({
  title,
  subtitle,
  description,
  features,
  badge,
  icon: Icon,
  accentColor,
  onNotify,
  isSubscribed,
  t,
}: {
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  badge: string;
  icon: React.ReactNode;
  accentColor: string;
  onNotify: () => void;
  isSubscribed: boolean;
  t: (key: string) => string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.3 }}
      className="relative group"
    >
      {/* Card Container */}
      <div
        className="relative rounded-2xl overflow-hidden h-full"
        style={{
          background: "rgba(15, 23, 42, 0.8)",
          border: "1px solid rgba(148, 163, 184, 0.15)",
        }}
      >
        {/* Gradient Accent on Top Edge */}
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{
            background: `linear-gradient(90deg, ${accentColor}, transparent)`,
          }}
        />

        {/* Content Container */}
        <div className="p-6 flex flex-col h-full relative z-10">
          {/* Icon */}
          <div
            className="w-12 h-12 mb-4 rounded-lg flex items-center justify-center"
            style={{
              background: `${accentColor}15`,
              color: accentColor,
            }}
          >
            {Icon}
          </div>

          {/* Title & Subtitle */}
          <div className="mb-3">
            <h3 className="text-lg font-bold text-white mb-1">{title}</h3>
            <p className="text-sm text-gray-400">{subtitle}</p>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-300 mb-4 flex-grow leading-relaxed">
            {description}
          </p>

          {/* Features List */}
          <div className="mb-5 space-y-2">
            {features.map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center gap-2"
              >
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: accentColor }}
                />
                <span className="text-xs text-gray-400">{feature}</span>
              </motion.div>
            ))}
          </div>

          {/* Badge */}
          <div className="mb-4 inline-flex w-fit">
            <span
              className="px-3 py-1 rounded-lg text-xs font-semibold"
              style={{
                background: `${accentColor}25`,
                color: accentColor,
              }}
            >
              {badge}
            </span>
          </div>

          {/* Notify Button */}
          <motion.button
            onClick={onNotify}
            whileTap={{ scale: 0.95 }}
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2"
            style={{
              background: isSubscribed
                ? `rgba(0, 200, 83, 0.15)`
                : `${accentColor}20`,
              color: isSubscribed ? "#00C853" : accentColor,
              border: `1px solid ${isSubscribed ? "#00C85345" : `${accentColor}30`}`,
            }}
            disabled={isSubscribed}
          >
            {isSubscribed ? (
              <>
                <Check className="w-4 h-4" />
                <span>{t(INTEGRATIONS_I18N_KEYS.subscribed)}</span>
              </>
            ) : (
              <>
                <Bell className="w-4 h-4" />
                <span>{t(INTEGRATIONS_I18N_KEYS.notify)}</span>
              </>
            )}
          </motion.button>
        </div>

        {/* Coming Soon Overlay — Frosted Glass Effect */}
        <div
          className="absolute inset-0 rounded-2xl flex items-center justify-center backdrop-blur-sm pointer-events-none"
          style={{
            background: "rgba(0, 0, 0, 0.4)",
          }}
        >
          <div
            className="px-4 py-2 rounded-lg border"
            style={{
              background: "rgba(30, 41, 59, 0.9)",
              border: "1px solid rgba(148, 163, 184, 0.3)",
              backdropFilter: "blur(10px)",
            }}
          >
            <span className="text-sm font-semibold text-white">Coming Soon</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Feedback Card Component
function FeedbackCard({
  onSubmit,
  t,
}: {
  onSubmit: (feedback: string) => void;
  t: (key: string) => string;
}) {
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!feedback.trim()) {
      toast.error("Please enter your feedback");
      return;
    }

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    onSubmit(feedback);
    setFeedback("");
    setIsSubmitting(false);
    toast.success("Thank you for your feedback!");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
      className="rounded-2xl p-6"
      style={{
        background: "linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(99, 102, 241, 0.2)",
            color: "#6366f1",
          }}
        >
          <Zap className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-white mb-2">
            {t(INTEGRATIONS_I18N_KEYS.feedback.title)}
          </h3>
          <p className="text-sm text-gray-300 mb-4">
            {t(INTEGRATIONS_I18N_KEYS.feedback.description)}
          </p>

          <div className="flex gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t(INTEGRATIONS_I18N_KEYS.feedback.placeholder)}
              className="flex-1 px-3 py-2 rounded-lg text-sm bg-slate-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:outline-none resize-none"
              rows={2}
            />
            <motion.button
              onClick={handleSubmit}
              disabled={isSubmitting}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-lg font-semibold text-sm flex items-center justify-center whitespace-nowrap transition-all"
              style={{
                background: "#6366f1",
                color: "#fff",
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              <Send className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// API Documentation Card Component
function APIDocsCard({ t }: { t: (key: string) => string }) {
  return (
    <motion.a
      href="/docs/api"
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8 }}
      whileHover={{ scale: 1.02 }}
      className="rounded-2xl p-6 block cursor-pointer transition-all group"
      style={{
        background: "linear-gradient(135deg, rgba(0, 200, 131, 0.1) 0%, rgba(34, 197, 94, 0.1) 100%)",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-white mb-2">
            {t(INTEGRATIONS_I18N_KEYS.apiDocs.title)}
          </h3>
          <p className="text-sm text-gray-300">
            {t(INTEGRATIONS_I18N_KEYS.apiDocs.description)}
          </p>
        </div>
        <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-white group-hover:translate-x-1 transition-all" />
      </div>
    </motion.a>
  );
}

// Main Integrations Hub Component
export function IntegrationsHubPage({ t }: { t: (key: string) => string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [subscriptions, setSubscriptions] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("integrationSubscriptions");
      return stored ? JSON.parse(stored) : {};
    }
    return {};
  });

  // Save subscriptions to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("integrationSubscriptions", JSON.stringify(subscriptions));
    }
  }, [subscriptions]);

  const handleNotify = (integrationId: string) => {
    if (!subscriptions[integrationId]) {
      setSubscriptions((prev) => ({ ...prev, [integrationId]: true }));
      toast.success("You'll be notified when this integration launches!");
    }
  };

  const handleFeedback = (feedback: string) => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("integrationFeedback") || "[]";
      const feedbackList = JSON.parse(stored);
      feedbackList.push({
        message: feedback,
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem("integrationFeedback", JSON.stringify(feedbackList));
    }
  };

  const integrations = [
    {
      id: "smartwatch",
      title: t(INTEGRATIONS_I18N_KEYS.smartwatch.title),
      subtitle: t(INTEGRATIONS_I18N_KEYS.smartwatch.subtitle),
      description: t(INTEGRATIONS_I18N_KEYS.smartwatch.description),
      features: [
        t(INTEGRATIONS_I18N_KEYS.smartwatch.feature1),
        t(INTEGRATIONS_I18N_KEYS.smartwatch.feature2),
        t(INTEGRATIONS_I18N_KEYS.smartwatch.feature3),
        t(INTEGRATIONS_I18N_KEYS.smartwatch.feature4),
      ],
      badge: t(INTEGRATIONS_I18N_KEYS.smartwatch.badge),
      icon: <WatchIcon />,
      accentColor: "#00B4FF",
    },
    {
      id: "dispatch",
      title: t(INTEGRATIONS_I18N_KEYS.dispatch.title),
      subtitle: t(INTEGRATIONS_I18N_KEYS.dispatch.subtitle),
      description: t(INTEGRATIONS_I18N_KEYS.dispatch.description),
      features: [
        t(INTEGRATIONS_I18N_KEYS.dispatch.feature1),
        t(INTEGRATIONS_I18N_KEYS.dispatch.feature2),
        t(INTEGRATIONS_I18N_KEYS.dispatch.feature3),
        t(INTEGRATIONS_I18N_KEYS.dispatch.feature4),
      ],
      badge: t(INTEGRATIONS_I18N_KEYS.dispatch.badge),
      icon: <DispatchIcon />,
      accentColor: "#FF2D55",
    },
    {
      id: "predictive",
      title: t(INTEGRATIONS_I18N_KEYS.predictive.title),
      subtitle: t(INTEGRATIONS_I18N_KEYS.predictive.subtitle),
      description: t(INTEGRATIONS_I18N_KEYS.predictive.description),
      features: [
        t(INTEGRATIONS_I18N_KEYS.predictive.feature1),
        t(INTEGRATIONS_I18N_KEYS.predictive.feature2),
        t(INTEGRATIONS_I18N_KEYS.predictive.feature3),
        t(INTEGRATIONS_I18N_KEYS.predictive.feature4),
      ],
      badge: t(INTEGRATIONS_I18N_KEYS.predictive.badge),
      icon: <AIIcon />,
      accentColor: "#9B59B6",
    },
  ];

  const filteredIntegrations = integrations.filter(
    (integ) =>
      integ.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      integ.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen w-full p-6">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-bold text-white mb-2">
          {t(INTEGRATIONS_I18N_KEYS.title)}
        </h1>
        <p className="text-lg text-gray-300">
          {t(INTEGRATIONS_I18N_KEYS.subtitle)}
        </p>
      </motion.div>

      {/* Search Bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="mb-8"
      >
        <div
          className="relative rounded-xl overflow-hidden"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(148, 163, 184, 0.15)",
          }}
        >
          <input
            type="text"
            placeholder={t(INTEGRATIONS_I18N_KEYS.searchPlaceholder)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 bg-transparent text-white placeholder-gray-400 focus:outline-none"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>
      </motion.div>

      {/* Integration Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {filteredIntegrations.map((integ, idx) => (
          <IntegrationCard
            key={integ.id}
            title={integ.title}
            subtitle={integ.subtitle}
            description={integ.description}
            features={integ.features}
            badge={integ.badge}
            icon={integ.icon}
            accentColor={integ.accentColor}
            onNotify={() => handleNotify(integ.id)}
            isSubscribed={subscriptions[integ.id] || false}
            t={t}
          />
        ))}
      </div>

      {/* Empty State */}
      <AnimatePresence>
        {filteredIntegrations.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-12"
          >
            <p className="text-gray-400">
              No integrations match your search. Try a different query!
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback & API Docs Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FeedbackCard onSubmit={handleFeedback} t={t} />
        <APIDocsCard t={t} />
      </div>
    </div>
  );
}
