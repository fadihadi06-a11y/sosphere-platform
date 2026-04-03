import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, MapPin, Users, Bell, ArrowRight, ChevronLeft, Globe } from "lucide-react";

interface WelcomeOnboardingProps {
  onComplete: () => void;
}

type Lang = "ar" | "en";

const slides = [
  {
    id: 1, icon: Shield, color: "#FF2D55", glow: "rgba(255,45,85,0.28)",
    titleAr: "طوارئ\nفورية",   subtitleAr: "المساعدة في ثوانٍ عند الحاجة",
    featuresAr: ["تفعيل SOS بلمسة واحدة", "اتصال تلقائي بجهات الطوارئ", "مشاركة الموقع الحي"],
    titleEn: "Instant\nSOS",   subtitleEn: "Help arrives in seconds",
    featuresEn: ["One-tap SOS activation", "Auto-call emergency contacts", "Live location sharing"],
  },
  {
    id: 2, icon: MapPin, color: "#00C8E0", glow: "rgba(0,200,224,0.25)",
    titleAr: "تتبع\nمباشر",    subtitleAr: "اعرف دائماً أين يوجد فريقك",
    featuresAr: ["مستشفيات وشرطة قريبة", "تتبع الفريق في الوقت الفعلي", "تنبيهات مناطق السلامة"],
    titleEn: "Live\nTracking", subtitleEn: "Always know where your team is",
    featuresEn: ["Nearby hospitals & police", "Real-time team tracking", "Safety zone alerts"],
  },
  {
    id: 3, icon: Users, color: "#7B5EFF", glow: "rgba(123,94,255,0.25)",
    titleAr: "دائرة\nالفريق",  subtitleAr: "شبكة سلامة متصلة دائماً",
    featuresAr: ["فحص سلامة جماعي", "تتبع حالة جميع الأعضاء", "تنبيهات السلامة الفورية"],
    titleEn: "Team\nSafety",   subtitleEn: "A connected safety network",
    featuresEn: ["Group safety check-ins", "Track all member statuses", "Instant safety alerts"],
  },
  {
    id: 4, icon: Bell, color: "#FF9500", glow: "rgba(255,150,0,0.25)",
    titleAr: "تسجيل\nذكي",    subtitleAr: "حماية تلقائية عند الصمت",
    featuresAr: ["SOS تلقائي عند انتهاء الوقت", "مؤقتات قابلة للتمديد", "إعدادات مخصصة"],
    titleEn: "Smart\nCheck-in", subtitleEn: "Automatic protection when silent",
    featuresEn: ["Auto-SOS when timer expires", "Extendable check-in timers", "Custom alert settings"],
  },
];

function ParticleField({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
    resize(); window.addEventListener("resize", resize);
    const hex = color.replace("#","");
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    const pts = Array.from({length:22},()=>({ x:Math.random()*c.width, y:Math.random()*c.height, vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3, sz:Math.random()*1.6+.4, op:Math.random()*.3+.08 }));
    let id:number;
    const draw = () => {
      ctx.clearRect(0,0,c.width,c.height);
      pts.forEach((p,i)=>{ p.x+=p.vx; p.y+=p.vy; if(p.x<0)p.x=c.width; if(p.x>c.width)p.x=0; if(p.y<0)p.y=c.height; if(p.y>c.height)p.y=0; pts.slice(i+1).forEach(q=>{ const d=Math.hypot(p.x-q.x,p.y-q.y); if(d<85){ ctx.beginPath(); ctx.strokeStyle=`rgba(${r},${g},${b},${.05*(1-d/85)})`; ctx.lineWidth=.5; ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke(); }}); ctx.beginPath(); ctx.arc(p.x,p.y,p.sz,0,Math.PI*2); ctx.fillStyle=`rgba(${r},${g},${b},${p.op})`; ctx.fill(); });
      id=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{ cancelAnimationFrame(id); window.removeEventListener("resize",resize); };
  },[color]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" style={{opacity:.65}}/>;
}

export function WelcomeOnboarding({ onComplete }: WelcomeOnboardingProps) {
  // Check if language was already chosen
  const savedLang = (() => {
    try { return localStorage.getItem("sosphere_lang") as Lang | null; } catch { return null; }
  })();

  const [showLangPicker, setShowLangPicker] = useState(!savedLang);
  const [lang, setLang] = useState<Lang>(savedLang || "ar");
  const [current, setCurrent] = useState(0);
  const [dir, setDir] = useState(1);

  const slide = slides[current];
  const isLast = current === slides.length - 1;
  const Icon = slide.icon;
  const isAr = lang === "ar";

  const selectLang = (l: Lang) => {
    try { localStorage.setItem("sosphere_lang", l); } catch {}
    setLang(l);
    setShowLangPicker(false);
  };

  const goNext = () => {
    console.log("[SUPABASE_READY] onboarding_slide_viewed", { slide: current+1, lang });
    if (isLast) { console.log("[SUPABASE_READY] onboarding_completed"); onComplete(); return; }
    setDir(1); setCurrent(c=>c+1);
  };
  const goBack = () => { if(current===0)return; setDir(-1); setCurrent(c=>c-1); };

  // ── Language Picker Screen ────────────────────────────────────
  if (showLangPicker) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
        style={{background:"#05070E",fontFamily:"'Tajawal','Outfit',sans-serif"}}>

        {/* Ambient */}
        <div className="absolute pointer-events-none"
          style={{top:"-20%",left:"50%",transform:"translateX(-50%)",width:"min(140vw,560px)",height:"min(140vw,560px)",borderRadius:"50%",background:"radial-gradient(circle,rgba(0,200,224,0.07) 0%,transparent 65%)"}}/>

        {/* Logo */}
        <motion.div initial={{opacity:0,y:-20}} animate={{opacity:1,y:0}} transition={{duration:.6}}
          className="flex flex-col items-center mb-12">
          <div style={{width:64,height:64,borderRadius:20,background:"linear-gradient(135deg,rgba(0,200,224,.18),rgba(0,200,224,.06))",border:"1px solid rgba(0,200,224,.25)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}>
            <Shield size={30} color="#00C8E0"/>
          </div>
          <span style={{fontSize:24,fontWeight:900,color:"#fff",letterSpacing:"-.5px"}}>SOSphere</span>
          <div className="flex items-center gap-1.5 mt-2">
            <Globe size={12} color="rgba(255,255,255,.3)"/>
            <span style={{fontSize:12,color:"rgba(255,255,255,.3)",fontFamily:"'Outfit',sans-serif"}}>Choose your language</span>
          </div>
        </motion.div>

        {/* Language Buttons */}
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{delay:.2,duration:.5}}
          className="flex flex-col gap-4 w-full px-8" style={{maxWidth:340}}>

          {/* Arabic */}
          <motion.button whileTap={{scale:.97}} onClick={()=>selectLang("ar")}
            className="flex items-center justify-between px-6 py-5 rounded-2xl relative overflow-hidden"
            style={{background:"linear-gradient(135deg,rgba(0,200,224,.1),rgba(0,200,224,.04))",border:"1.5px solid rgba(0,200,224,.25)",boxShadow:"0 8px 32px rgba(0,200,224,.08)"}}>
            <div className="flex items-center gap-4">
              <span style={{fontSize:32}}>🇸🇦</span>
              <div style={{textAlign:"right"}}>
                <p style={{fontSize:20,fontWeight:800,color:"#fff",fontFamily:"'Tajawal',sans-serif",lineHeight:1.2}}>العربية</p>
                <p style={{fontSize:12,color:"rgba(255,255,255,.35)",fontFamily:"'Outfit',sans-serif"}}>Arabic</p>
              </div>
            </div>
            <ArrowRight size={18} color="rgba(0,200,224,.6)" style={{transform:"scaleX(-1)"}}/>
          </motion.button>

          {/* English */}
          <motion.button whileTap={{scale:.97}} onClick={()=>selectLang("en")}
            className="flex items-center justify-between px-6 py-5 rounded-2xl relative overflow-hidden"
            style={{background:"linear-gradient(135deg,rgba(123,94,255,.1),rgba(123,94,255,.04))",border:"1.5px solid rgba(123,94,255,.25)",boxShadow:"0 8px 32px rgba(123,94,255,.08)"}}>
            <div className="flex items-center gap-4">
              <span style={{fontSize:32}}>🇬🇧</span>
              <div>
                <p style={{fontSize:20,fontWeight:800,color:"#fff",fontFamily:"'Outfit',sans-serif",lineHeight:1.2}}>English</p>
                <p style={{fontSize:12,color:"rgba(255,255,255,.35)",fontFamily:"'Outfit',sans-serif"}}>الإنجليزية</p>
              </div>
            </div>
            <ArrowRight size={18} color="rgba(123,94,255,.6)"/>
          </motion.button>
        </motion.div>

        <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.5}}
          style={{fontSize:11,color:"rgba(255,255,255,.15)",marginTop:32,textAlign:"center",fontFamily:"'Outfit',sans-serif"}}>
          You can change this later in Settings
        </motion.p>
      </div>
    );
  }

  // ── Slides ────────────────────────────────────────────────────
  const title    = isAr ? slide.titleAr    : slide.titleEn;
  const subtitle = isAr ? slide.subtitleAr : slide.subtitleEn;
  const features = isAr ? slide.featuresAr : slide.featuresEn;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden"
      style={{background:"#05070E",fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif",direction: isAr ? "rtl" : "ltr"}}>
      <ParticleField color={slide.color}/>

      {/* Orb */}
      <AnimatePresence mode="wait">
        <motion.div key={slide.id} initial={{opacity:0,scale:.7}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.7}} transition={{duration:.5}}
          className="absolute pointer-events-none"
          style={{top:"-18%",left:"50%",transform:"translateX(-50%)",width:"min(130vw,520px)",height:"min(130vw,520px)",borderRadius:"50%",background:`radial-gradient(circle,${slide.glow} 0%,transparent 70%)`}}/>
      </AnimatePresence>

      {/* Header */}
      <div className="relative z-20 flex items-center justify-between px-5" style={{paddingTop:"max(18px,env(safe-area-inset-top))"}}>
        <div className="flex items-center gap-2">
          <div style={{width:34,height:34,borderRadius:10,background:"linear-gradient(135deg,rgba(0,200,224,.18),rgba(0,200,224,.06))",border:"1px solid rgba(0,200,224,.2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Shield size={16} color="#00C8E0"/>
          </div>
          <span style={{fontSize:15,fontWeight:800,color:"#fff",letterSpacing:"-.3px"}}>SOSphere</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Language switcher — small button */}
          <button onClick={()=>setShowLangPicker(true)}
            style={{width:34,height:34,borderRadius:10,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Globe size={15} color="rgba(255,255,255,.4)"/>
          </button>
          <button onClick={onComplete}
            style={{paddingInline:14,height:34,borderRadius:999,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",fontSize:13,fontWeight:600,color:"rgba(255,255,255,.4)",fontFamily:"'Tajawal',sans-serif"}}>
            {isAr ? "تخطي" : "Skip"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col px-5 relative z-10" style={{overflow:"hidden"}}>
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={slide.id} custom={dir} initial={{opacity:0,x:dir*40}} animate={{opacity:1,x:0}} exit={{opacity:0,x:dir*-30}} transition={{duration:.35,ease:[.25,.46,.45,.94]}}
            className="flex-1 flex flex-col items-center justify-center" style={{paddingBlock:"4%"}}>

            {/* Icon */}
            <div className="relative mb-7" style={{width:96,height:96}}>
              <motion.div animate={{scale:[1,1.5,1],opacity:[.12,0,.12]}} transition={{duration:2.8,repeat:Infinity}} className="absolute rounded-full" style={{inset:-28,border:`1px solid ${slide.color}`}}/>
              <motion.div animate={{scale:[1,1.25,1],opacity:[.18,0,.18]}} transition={{duration:2.8,repeat:Infinity,delay:.4}} className="absolute rounded-full" style={{inset:-14,border:`1px solid ${slide.color}`}}/>
              <motion.div animate={{y:[0,-5,0]}} transition={{duration:3.5,repeat:Infinity,ease:"easeInOut"}} className="absolute inset-0 rounded-3xl flex items-center justify-center"
                style={{background:`linear-gradient(145deg,${slide.color}18 0%,${slide.color}06 100%)`,border:`1.5px solid ${slide.color}30`,boxShadow:`0 20px 60px ${slide.color}20,inset 0 1px 0 rgba(255,255,255,.06)`}}>
                <Icon size={42} color={slide.color}/>
              </motion.div>
              <motion.div animate={{rotate:360}} transition={{duration:7,repeat:Infinity,ease:"linear"}} className="absolute" style={{inset:-18}}>
                <div style={{position:"absolute",width:9,height:9,borderRadius:"50%",background:slide.color,top:"50%",left:-4,marginTop:-4,boxShadow:`0 0 10px ${slide.color},0 0 20px ${slide.color}60`}}/>
              </motion.div>
            </div>

            <motion.p initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:.1}}
              style={{fontSize:"clamp(10px,2.8vw,12px)",fontWeight:700,letterSpacing:"2px",color:slide.color,textTransform:"uppercase",marginBottom:10,textAlign:"center",fontFamily:"'Outfit',sans-serif"}}>
              {subtitle}
            </motion.p>

            <motion.h1 initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:.15}}
              style={{fontSize:"clamp(34px,9.5vw,50px)",fontWeight:900,color:"#fff",letterSpacing:"-2px",lineHeight:1.05,whiteSpace:"pre-line",textAlign:"center",marginBottom:24,fontFamily: isAr ? "'Tajawal',sans-serif" : "'Outfit',sans-serif"}}>
              {title}
            </motion.h1>

            <div style={{width:"100%",maxWidth:300,direction: isAr ? "rtl" : "ltr"}}>
              {features.map((f,i)=>(
                <motion.div key={f} initial={{opacity:0,x: isAr ? -10 : 10}} animate={{opacity:1,x:0}} transition={{delay:.2+i*.07}} className="flex items-center gap-3 mb-3">
                  <div style={{width:22,height:22,borderRadius:"50%",flexShrink:0,background:`${slide.color}12`,border:`1px solid ${slide.color}28`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:slide.color}}/>
                  </div>
                  <span style={{fontSize:"clamp(13px,3.5vw,15px)",color:"rgba(255,255,255,.5)",fontFamily: isAr ? "'Tajawal',sans-serif" : "'Outfit',sans-serif",lineHeight:1.4}}>{f}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom */}
      <div className="relative z-20 px-5" style={{paddingBottom:"max(28px,env(safe-area-inset-bottom))"}}>
        <div className="flex items-center justify-center gap-2 mb-5">
          {slides.map((_,i)=>(
            <motion.button key={i} onClick={()=>{setDir(i>current?1:-1);setCurrent(i);}}
              animate={{width:i===current?28:7,background:i===current?slide.color:"rgba(255,255,255,.15)"}}
              transition={{duration:.3}} style={{height:7,borderRadius:999}}/>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {current>0&&(
            <motion.button initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} whileTap={{scale:.93}} onClick={goBack}
              style={{width:52,height:52,borderRadius:16,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <ChevronLeft size={20} color="rgba(255,255,255,.5)"/>
            </motion.button>
          )}
          <motion.button whileTap={{scale:.97}} onClick={goNext}
            className="flex-1 flex items-center justify-center gap-2.5 relative overflow-hidden"
            style={{height:54,borderRadius:16,background:`linear-gradient(135deg,${slide.color},${slide.color}CC)`,boxShadow:`0 8px 28px ${slide.color}35`,fontSize:"clamp(14px,4vw,16px)",fontWeight:700,color:"#fff",fontFamily: isAr ? "'Tajawal',sans-serif" : "'Outfit',sans-serif"}}>
            <motion.div animate={{x:["-120%","220%"]}} transition={{duration:2.5,repeat:Infinity,repeatDelay:1.5}}
              style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)",transform:"skewX(-15deg)"}}/>
            <span className="relative z-10">
              {isLast ? (isAr ? "ابدأ الآن" : "Get Started") : (isAr ? "التالي" : "Next")}
            </span>
            <ArrowRight size={18} className="relative z-10"/>
          </motion.button>
        </div>

        <p style={{fontSize:"clamp(9px,2.3vw,10px)",color:"rgba(255,255,255,.18)",textAlign:"center",lineHeight:1.6,marginTop:10,fontFamily:"'Tajawal',sans-serif"}}>
          {isAr
            ? "SOSphere لا يُغني عن خدمات الطوارئ الرسمية (911 / 122 / 112)"
            : "SOSphere does not replace official emergency services (911 / 122 / 112)"}
        </p>
      </div>
    </div>
  );
}
