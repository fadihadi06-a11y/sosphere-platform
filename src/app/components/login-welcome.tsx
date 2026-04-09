import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Shield, CheckCircle2 } from "lucide-react";

interface LoginWelcomeProps {
  name: string;
  mode: "employee" | "individual" | "demo";
  onComplete: () => void;
}

export function LoginWelcome({ name, mode, onComplete }: LoginWelcomeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Analytics
  useEffect(() => {
    console.log("[SUPABASE_READY] login_welcome_shown", { mode });
  }, [mode]);

  // Particle system
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 393;
    canvas.height = 852;

    const particles: {
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; color: string; life: number;
    }[] = [];

    const colors = ["#00C8E0", "#00A5FF", "#7B5EFF", "#FF2D55", "#00C853"];

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * 393,
        y: Math.random() * 852 + 852,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -(Math.random() * 3 + 1.5),
        size: Math.random() * 4 + 1,
        opacity: Math.random() * 0.8 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
      });
    }

    let frame = 0;
    let animId: number;

    const draw = () => {
      ctx.clearRect(0, 0, 393, 852);
      frame++;

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.02;
        p.life -= 0.008;

        if (p.life <= 0 || p.y < -20) {
          particles[i] = {
            x: 100 + Math.random() * 193,
            y: 500,
            vx: (Math.random() - 0.5) * 4,
            vy: -(Math.random() * 5 + 2),
            size: Math.random() * 4 + 1,
            opacity: Math.random() * 0.8 + 0.2,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 1,
          };
        }

        ctx.save();
        ctx.globalAlpha = p.opacity * p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        // Alternate between circles and sparkles
        if (i % 3 === 0) {
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Sparkle shape
          const s = p.size * 2;
          ctx.translate(p.x, p.y);
          ctx.rotate(frame * 0.02 + i);
          ctx.fillRect(-s / 2, -1, s, 2);
          ctx.fillRect(-1, -s / 2, 2, s);
        }
        ctx.restore();
      });

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  // Auto-advance
  useEffect(() => {
    const t = setTimeout(onComplete, 2800);
    return () => clearTimeout(t);
  }, [onComplete]);

  const modeText = {
    employee: { sub: "موظف ميداني", color: "#00C8E0" },
    individual: { sub: "مستخدم فردي", color: "#7B5EFF" },
    demo: { sub: "وضع التجربة", color: "#FF9500" },
  }[mode];

  // FIX: name may be empty for OTP users who haven't completed individual-register yet
  const firstName = (name || "").split(" ")[0] || "مرحباً";

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: "#05070E" }}
      onClick={onComplete}
    >
      {/* Particle Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ opacity: 0.7 }}
      />

      {/* Deep glow rings */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1.2], opacity: [0, 0.15, 0.08] }}
        transition={{ duration: 1.2, ease: "easeOut" }}
        className="absolute"
        style={{
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, #00C8E0 0%, transparent 70%)",
        }}
      />
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.8, 1.5], opacity: [0, 0.08, 0.04] }}
        transition={{ duration: 1.5, delay: 0.2, ease: "easeOut" }}
        className="absolute"
        style={{
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, #7B5EFF 0%, transparent 70%)",
        }}
      />

      {/* Orbiting rings */}
      {[160, 210, 260].map((size, i) => (
        <motion.div
          key={size}
          initial={{ scale: 0, opacity: 0, rotate: i * 60 }}
          animate={{ scale: 1, opacity: 1, rotate: i * 60 + 360 }}
          transition={{
            scale: { duration: 0.8, delay: 0.3 + i * 0.1, ease: "easeOut" },
            opacity: { duration: 0.8, delay: 0.3 + i * 0.1 },
            rotate: { duration: 8 + i * 2, repeat: Infinity, ease: "linear" },
          }}
          className="absolute rounded-full"
          style={{
            width: size,
            height: size,
            border: `1px solid rgba(0,200,224,${0.15 - i * 0.04})`,
            boxShadow: `0 0 ${20 + i * 10}px rgba(0,200,224,${0.05 - i * 0.01})`,
          }}
        />
      ))}

      {/* Main logo container */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] }}
        className="relative flex items-center justify-center mb-8"
        style={{ width: 120, height: 120 }}
      >
        {/* Glow halo */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-[34px]"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.3), rgba(123,94,255,0.3))",
            filter: "blur(20px)",
          }}
        />

        {/* Logo box */}
        <div
          className="relative size-[100px] rounded-[30px] flex items-center justify-center"
          style={{
            background: "linear-gradient(145deg, rgba(0,200,224,0.15) 0%, rgba(123,94,255,0.1) 100%)",
            backdropFilter: "blur(40px)",
            border: "1px solid rgba(0,200,224,0.3)",
            boxShadow:
              "0 0 0 1px rgba(0,200,224,0.1), 0 20px 60px rgba(0,200,224,0.2), inset 0 1px 0 rgba(255,255,255,0.1)",
          }}
        >
          <Shield className="size-12" style={{ color: "#00C8E0" }} />
        </div>

        {/* Success checkmark badge */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
          className="absolute -bottom-2 -right-2 size-9 rounded-full flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, #00C853, #00A040)",
            border: "2px solid #05070E",
            boxShadow: "0 4px 16px rgba(0,200,83,0.4)",
          }}
        >
          <CheckCircle2 className="size-5 text-white" />
        </motion.div>
      </motion.div>

      {/* Text content */}
      <div className="relative flex flex-col items-center px-8 text-center">
        {/* Brand name */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "3px",
            color: modeText.color,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          SOSphere • {modeText.sub}
        </motion.p>

        {/* Welcome text */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.4)", fontWeight: 400, marginBottom: 4 }}>
            أهلاً وسهلاً
          </p>
          <h1
            style={{
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: "-1px",
              lineHeight: 1.1,
              background: "linear-gradient(135deg, #ffffff 0%, rgba(0,200,224,0.9) 60%, rgba(123,94,255,0.8) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {firstName}
          </h1>
        </motion.div>

        {/* Status message */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mt-6 flex items-center gap-2.5 px-5 py-3 rounded-full"
          style={{
            background: "rgba(0,200,83,0.08)",
            border: "1px solid rgba(0,200,83,0.2)",
            backdropFilter: "blur(20px)",
          }}
        >
          <motion.div
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="size-2 rounded-full"
            style={{ background: "#00C853" }}
          />
          <span style={{ fontSize: 13, color: "#00C853", fontWeight: 600 }}>
            تم تسجيل الدخول بنجاح
          </span>
        </motion.div>

        {/* Tap hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", marginTop: 32, fontWeight: 400 }}
        >
          اضغط للمتابعة
        </motion.p>
      </div>

      {/* Bottom progress bar */}
      <motion.div
        className="absolute bottom-16 left-8 right-8 h-[2px] rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 2.8, ease: "linear" }}
          className="h-full rounded-full"
          style={{
            background: "linear-gradient(90deg, #00C8E0, #7B5EFF)",
            boxShadow: "0 0 8px rgba(0,200,224,0.5)",
          }}
        />
      </motion.div>
    </div>
  );
}