import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";

interface OTPVerifyProps {
  phone: string;
  onVerify: () => void;
  onBack: () => void;
  /** Optional error message to display (e.g. from Supabase verification failure) */
  error?: string;
}

export function OTPVerify({ phone, onVerify, onBack, error: externalError }: OTPVerifyProps) {
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(59);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // FIX: delay focus until after all Framer Motion animations complete
    // Input[0] animates at delay=0.2s, last input at 0.2+5*0.06=0.5s
    // We wait 650ms to be safe on slow Android devices
    const t = setTimeout(() => {
      inputRefs.current[0]?.focus();
    }, 650);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      // Strip non-digits
      const digits = value.replace(/\D/g, "");
      if (!digits && value !== "") return;

      // FIX: Handle Android SMS autofill — may send all 6 digits at once to one field
      if (digits.length > 1) {
        const newOtp = [...otp];
        for (let i = 0; i < 6; i++) {
          newOtp[i] = digits[i] || "";
        }
        setOtp(newOtp);
        const lastIndex = Math.min(digits.length - 1, 5);
        inputRefs.current[lastIndex]?.focus();
        if (digits.length >= 6) {
          verifyWithSupabase(newOtp.join(""));
        }
        return;
      }

      // Normal single-digit input
      const newOtp = [...otp];
      newOtp[index] = digits.slice(-1);
      setOtp(newOtp);

      if (digits && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }

      if (newOtp.every((d) => d !== "")) {
        verifyWithSupabase(newOtp.join(""));
      }
    },
    [otp, onVerify]
  );

  /** Verify OTP token with Supabase — falls back to onVerify on success */
  const verifyWithSupabase = async (token: string) => {
    setVerifying(true);
    setVerifyError("");
    try {
      const { verifyOTP } = await import("./api/supabase-client");
      const { error } = await verifyOTP(phone, token);
      if (error) {
        setVerifyError(error);
        setVerifying(false);
        setOtp(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }
      // Success — small delay for visual feedback
      setTimeout(() => onVerify(), 800);
    } catch {
      setVerifyError("Connection error. Please try again.");
      setVerifying(false);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (paste.length === 6) {
      setOtp(paste.split(""));
      inputRefs.current[5]?.focus();
      verifyWithSupabase(paste);
    }
  };

  const resend = () => {
    console.log("[SUPABASE_READY] otp_resent");
    setTimer(59);
    setOtp(["", "", "", "", "", ""]);
    inputRefs.current[0]?.focus();
  };

  const maskedPhone = phone.slice(0, -4).replace(/./g, "•") + phone.slice(-4);

  return (
    <div className="relative flex flex-col h-full">
      {/* Ambient */}
      <div
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[450px] h-[450px] pointer-events-none"
        style={{
          background: verifying
            ? "radial-gradient(circle, rgba(0,200,83,0.07) 0%, transparent 60%)"
            : "radial-gradient(circle, rgba(0,200,224,0.06) 0%, transparent 60%)",
          transition: "background 1s",
        }}
      />

      <div className="flex-1 flex flex-col px-6 pt-16 pb-8 relative z-10">
        {/* Back */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          onClick={onBack}
          className="flex items-center gap-1.5 mb-12 self-start group"
          style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px", fontWeight: 500 }}
        >
          <ArrowLeft className="size-[18px] group-hover:-translate-x-0.5 transition-transform" />
          رجوع
        </motion.button>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="flex flex-col items-center mb-12"
        >
          <div className="relative mb-5">
            <motion.div
              animate={{
                borderColor: verifying
                  ? "rgba(0,200,83,0.25)"
                  : "rgba(0,200,224,0.15)",
                background: verifying
                  ? "linear-gradient(145deg, rgba(0,200,83,0.12), rgba(0,200,83,0.04))"
                  : "linear-gradient(145deg, rgba(0,200,224,0.12), rgba(0,200,224,0.04))",
              }}
              transition={{ duration: 0.6 }}
              className="size-16 rounded-[18px] flex items-center justify-center"
              style={{
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(0,200,224,0.15)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <ShieldCheck
                className="size-8 transition-colors duration-700"
                style={{ color: verifying ? "#00C853" : "#00C8E0" }}
              />
            </motion.div>
          </div>
          <h2 className="text-white" style={{ fontSize: "24px", fontWeight: 700 }}>
            رمز التحقق
          </h2>
          <p className="mt-2 text-center" style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", lineHeight: 1.7 }}>
            أرسلنا رمزاً مكوناً من ٦ أرقام إلى
          </p>
          <p
            className="mt-1"
            style={{
              fontSize: "16px",
              color: "#00C8E0",
              fontWeight: 600,
              letterSpacing: "1.5px",
              direction: "ltr",
            }}
          >
            {maskedPhone}
          </p>
        </motion.div>

        {/* OTP Inputs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="flex justify-center gap-3 mb-10"
          onPaste={handlePaste}
        >
          {otp.map((digit, i) => (
            <motion.input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={6}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onFocus={(e) => e.target.select()}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 + i * 0.06 }}
              className="text-center outline-none transition-all duration-400"
              style={{
                width: 50,
                height: 60,
                borderRadius: "16px",
                background: digit
                  ? verifying
                    ? "rgba(0,200,83,0.08)"
                    : "rgba(0,200,224,0.08)"
                  : "rgba(255,255,255,0.03)",
                backdropFilter: "blur(20px)",
                border: digit
                  ? verifying
                    ? "1.5px solid rgba(0,200,83,0.3)"
                    : "1.5px solid rgba(0,200,224,0.3)"
                  : "1.5px solid rgba(255,255,255,0.06)",
                color: "#fff",
                fontSize: "24px",
                fontWeight: 600,
                fontFamily: "inherit",
                caretColor: "#00C8E0",
                boxShadow: digit
                  ? verifying
                    ? "0 4px 20px rgba(0,200,83,0.06)"
                    : "0 4px 20px rgba(0,200,224,0.06)"
                  : "none",
              }}
            />
          ))}
        </motion.div>

        {/* Verifying */}
        {verifying && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-2.5 mb-6"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="size-4 rounded-full"
              style={{
                border: "2px solid rgba(0,200,83,0.2)",
                borderTopColor: "#00C853",
              }}
            />
            <span style={{ fontSize: "14px", color: "#00C853", fontWeight: 500 }}>
              جارِ التحقق...
            </span>
          </motion.div>
        )}

        {/* Timer */}
        {!verifying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col items-center gap-3"
          >
            {timer > 0 ? (
              <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.25)" }}>
                إعادة الإرسال بعد{" "}
                <span style={{ color: "#00C8E0", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  0:{timer.toString().padStart(2, "0")}
                </span>
              </p>
            ) : (
              <button
                onClick={resend}
                className="flex items-center gap-2 transition-colors"
                style={{ fontSize: "14px", color: "#00C8E0", fontWeight: 500 }}
              >
                <RefreshCw className="size-4" />
                إعادة إرسال الرمز
              </button>
            )}
          </motion.div>
        )}

        {/* Tip */}
        <div className="mt-auto">
          <div
            className="p-4"
            style={{
              borderRadius: "16px",
              background: "rgba(255,255,255,0.02)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)", lineHeight: 1.7, textAlign: "center" }}>
              {verifyError || externalError
                ? <span style={{ color: "#FF2D55" }}>{verifyError || externalError}</span>
                : "تحقق من رسائلك النصية للحصول على الرمز"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}