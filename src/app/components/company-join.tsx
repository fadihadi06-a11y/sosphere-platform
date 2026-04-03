import { useState, useRef, useEffect } from "react";
import { useLang } from "./useLang";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Link2, Hash, ArrowRight, Building2, HelpCircle, CheckCircle2, MapPin, Users, Shield, User, AlertTriangle } from "lucide-react";

export interface CompanyMatchData {
  found: boolean; companyName: string; companyLogo: string; employeeCount: number;
  zoneName: string; evacuationPoint: string; role: string; department: string;
  managerName: string; adminPhone: string; adminEmail: string; hasZones: boolean;
}

interface CompanyJoinProps {
  onSubmit: (companyName: string, matched?: boolean, matchData?: CompanyMatchData) => void;
  onBack: () => void;
}

// Company match data is now fetched from Supabase, no mock fallback

const VALID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

export function CompanyJoin({ onSubmit, onBack }: CompanyJoinProps) {
  const { isAr } = useLang();
  const [mode, setMode] = useState<"link"|"code"|null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [code, setCode] = useState(["","","","","",""]);
  const [focusedField, setFocusedField] = useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [matchData, setMatchData] = useState<CompanyMatchData|null>(null);
  const [error, setError] = useState("");
  const codeRefs = useRef<(HTMLInputElement|null)[]>([]);

  const isLinkValid = inviteLink.trim().length > 8;
  const isCodeValid = code.every(d=>d!=="");
  const canSubmit = (mode==="link"&&isLinkValid)||(mode==="code"&&isCodeValid);

  // FIX: Auto-focus first field when entering code mode
  // Delay 400ms to let Framer Motion entrance animation finish
  useEffect(() => {
    if (mode === "code") {
      const t = setTimeout(() => {
        codeRefs.current[0]?.focus();
      }, 400);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const handleCodeChange = (index: number, value: string) => {
    // FIX: strip everything except valid chars, take last char only
    const upper = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1);

    // FIX: if value came in empty (Android clearing field after maxLength) — ignore
    // This prevents the double-fire bug where Android sends "" right after the char
    if (value === "" && code[index] !== "") return;

    if (upper && !VALID_CHARS.includes(upper)) return;
    const newCode = [...code]; newCode[index] = upper; setCode(newCode);
    if (upper && index < 5) codeRefs.current[index+1]?.focus();
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key==="Backspace" && !code[index] && index>0) codeRefs.current[index-1]?.focus();
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").toUpperCase().split("").filter(c=>VALID_CHARS.includes(c)).slice(0,6);
    if (paste.length>0) { const newCode=[...code]; for(let i=0;i<paste.length&&i<6;i++){newCode[i]=paste[i];} setCode(newCode); codeRefs.current[Math.min(paste.length,5)]?.focus(); }
  };

  const handleVerify = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setError("");
    try {
      const { supabase } = await import("./api/supabase-client");
      const enteredCode = mode==="code" ? code.join("") : inviteLink.split("/").pop()||"";
      const { data: company, error: err } = await supabase.from("companies").select("id,name,invite_code,has_zones").eq("invite_code",enteredCode.toUpperCase()).single();
      if (err||!company) { setError(isAr ? "رمز غير صحيح. تحقق مع مسؤول شركتك." : "Invalid code. Please check with your company admin."); setSubmitting(false); return; }
      const { count } = await supabase.from("invitations").select("*",{count:"exact",head:true}).eq("company_id",company.id);
      const match: CompanyMatchData = {
        found: true, companyName: company.name || "", companyLogo: (company.name || "?").slice(0, 2).toUpperCase(),
        employeeCount: count || 0, zoneName: "", evacuationPoint: "", role: "",
        department: "", managerName: "", adminPhone: "", adminEmail: "",
        hasZones: company.has_zones || false,
      };
      setMatchData(match); setVerified(true);
    } catch { setError(isAr ? "خطأ في الاتصال. حاول مرة أخرى." : "Connection error. Please try again."); }
    setSubmitting(false);
  };

  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif" };
  const C = { color:"#00C8E0" };

  if (verified && matchData) {
    return (
      <div className="app-screen" style={{background:"#05070E",...S}}>
        <div className="absolute inset-0 pointer-events-none" style={{background:"radial-gradient(ellipse at 50% -20%,rgba(0,200,83,.12) 0%,transparent 60%)"}}/>
        <div className="scroll-area">
          <div className="px-5" style={{paddingTop:"max(20px,env(safe-area-inset-top))"}}>
            <motion.div initial={{opacity:0,scale:.9}} animate={{opacity:1,scale:1}} transition={{type:"spring",stiffness:300,damping:24}} className="flex flex-col items-center text-center pt-8 pb-6">
              <motion.div initial={{scale:0}} animate={{scale:1}} transition={{delay:.2,type:"spring",stiffness:400,damping:20}} style={{width:72,height:72,borderRadius:22,background:"rgba(0,200,83,.12)",border:"2px solid rgba(0,200,83,.25)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16}}>
                <CheckCircle2 size={36} color="#00C853"/>
              </motion.div>
              <h2 style={{fontSize:"clamp(20px,5.5vw,24px)",fontWeight:800,color:"#fff",marginBottom:6}}>تم التحقق بنجاح!</h2>
              <p style={{fontSize:13,color:"rgba(255,255,255,.4)",lineHeight:1.7}}>تم العثور على سجلك في</p>
              <p style={{fontSize:17,fontWeight:700,color:"#fff",marginTop:4}}>{matchData.companyName}</p>
            </motion.div>

            <div style={{borderRadius:20,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",padding:20,marginBottom:16}}>
              {[
                { icon: User, label: "المنصب الوظيفي", value: matchData.role, color: "#00C8E0" },
                { icon: Building2, label: "القسم", value: matchData.department, color: "#7B5EFF" },
                { icon: MapPin, label: "المنطقة المُخصصة", value: matchData.zoneName, color: "#00C853" },
                { icon: Shield, label: "نقطة الإخلاء", value: matchData.evacuationPoint, color: "#FF9500" },
                { icon: Users, label: "عدد الموظفين", value: `${matchData.employeeCount} موظف`, color: "#00C8E0" },
              ].map(({ icon: Icon, label, value, color }, i) => (
                <motion.div key={label} initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}} transition={{delay:.3+i*.06}} className="flex items-center gap-3 mb-4" style={{direction:"rtl"}}>
                  <div style={{width:38,height:38,borderRadius:12,background:`${color}12`,border:`1px solid ${color}20`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <Icon size={17} color={color}/>
                  </div>
                  <div>
                    <p style={{fontSize:11,color:"rgba(255,255,255,.35)",marginBottom:2}}>{label}</p>
                    <p style={{fontSize:14,fontWeight:600,color:"#fff"}}>{value}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {matchData.hasZones && (
              <div className="flex items-center gap-2 p-3 mb-6" style={{borderRadius:12,background:"rgba(0,200,83,.06)",border:"1px solid rgba(0,200,83,.15)"}}>
                <Shield size={14} color="#00C853"/>
                <p style={{fontSize:12,color:"rgba(0,200,83,.9)",lineHeight:1.5}}>GPS وتتبع المناطق مُفعّل لهذه الشركة</p>
              </div>
            )}

            <motion.button whileTap={{scale:.97}} onClick={()=>onSubmit(matchData.companyName,true,matchData)} style={{width:"100%",height:54,borderRadius:16,background:"linear-gradient(135deg,#00C853,#00A040)",boxShadow:"0 8px 28px rgba(0,200,83,.3)",fontSize:"clamp(14px,4vw,16px)",fontWeight:700,color:"#fff",...S}}>
              الانضمام إلى {matchData.companyName}
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-screen" style={{background:"#05070E",...S}}>
      <div className="absolute inset-0 pointer-events-none" style={{background:"radial-gradient(ellipse at 50% -20%,rgba(0,200,224,.06) 0%,transparent 60%)"}}/>

      <div className="scroll-area">
        <div className="px-5" style={{paddingTop:"max(20px,env(safe-area-inset-top))"}}>

          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={onBack} className="touch-target" style={{width:40,height:40,borderRadius:12,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <ArrowLeft size={18} color="rgba(255,255,255,.6)"/>
            </button>
            <div>
              <h1 style={{fontSize:"clamp(18px,5vw,22px)",fontWeight:800,color:"#fff"}}>{isAr ? "الانضمام لشركة" : "Join a Company"}</h1>
              <p style={{fontSize:12,color:"rgba(255,255,255,.35)"}}>{isAr ? "أدخل رمز الدعوة من شركتك" : "Enter your company invitation code"}</p>
            </div>
          </div>

          {/* Mode selector */}
          {!mode && (
            <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}}>
              <p style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.3)",letterSpacing:"1.5px",marginBottom:14}}>اختر طريقة الانضمام</p>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {[
                  { id:"code" as const, icon:Hash, titleAr:isAr?"رمز الدعوة":"Invite Code", descAr:isAr?"أدخل الرمز المكون من 6 أحرف":"Enter the 6-character invite code", color:"#00C8E0" },
                  { id:"link" as const, icon:Link2, titleAr:isAr?"رابط الدعوة":"Invite Link", descAr:isAr?"الصق رابط الدعوة من البريد الإلكتروني":"Paste the invite link from your email", color:"#7B5EFF" },
                ].map(({ id, icon: Icon, titleAr, descAr, color }) => (
                  <motion.button key={id} whileTap={{scale:.97}} onClick={()=>setMode(id)} className="w-full flex items-center gap-4 text-right" style={{padding:"16px 18px",borderRadius:18,background:"rgba(255,255,255,.03)",border:`1px solid ${color}20`,direction:"rtl"}}>
                    <div style={{width:46,height:46,borderRadius:14,background:`${color}12`,border:`1px solid ${color}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <Icon size={20} color={color}/>
                    </div>
                    <div className="flex-1">
                      <p style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:3}}>{titleAr}</p>
                      <p style={{fontSize:12,color:"rgba(255,255,255,.35)",lineHeight:1.5}}>{descAr}</p>
                    </div>
                    <ArrowRight size={16} color="rgba(255,255,255,.2)"/>
                  </motion.button>
                ))}
              </div>

              <div className="flex items-center gap-2 p-4 mt-6" style={{borderRadius:14,background:"rgba(0,200,224,.05)",border:"1px solid rgba(0,200,224,.12)"}}>
                <HelpCircle size={14} color="#00C8E0" style={{flexShrink:0}}/>
                <p style={{fontSize:12,color:"rgba(255,255,255,.4)",lineHeight:1.6}}>{isAr ? "لا يوجد رمز؟ اطلب من مسؤول شركتك إرسال رمز الدعوة عبر البريد الإلكتروني." : "No code? Ask your company admin to send you an invite code by email."}</p>
              </div>
            </motion.div>
          )}

          {/* Code input */}
          {mode==="code" && (
            <motion.div initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} transition={{duration:.3}}>
              <button onClick={()=>{setMode(null);setCode(["","","","","",""]);setError("");}} className="flex items-center gap-2 mb-6" style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>
                <ArrowLeft size={15}/> <span style={S}>{isAr ? "العودة" : "Back"}</span>
              </button>

              <p style={{fontSize:"clamp(17px,4.5vw,20px)",fontWeight:800,color:"#fff",marginBottom:4,...S}}>{isAr ? "رمز الدعوة" : "Invite Code"}</p>
              <p style={{fontSize:13,color:"rgba(255,255,255,.35)",marginBottom:8,lineHeight:1.7,...S}}>أدخل الرمز المكون من 6 أحرف وأرقام</p>

              {/* Hint: code comes from admin, not SMS */}
              <div className="flex items-center gap-2 p-3 mb-5" style={{borderRadius:12,background:"rgba(0,200,224,.05)",border:"1px solid rgba(0,200,224,.1)"}}>
                <HelpCircle size={13} color="#00C8E0" style={{flexShrink:0}}/>
                <p style={{fontSize:12,color:"rgba(255,255,255,.4)",lineHeight:1.6,...S}}>
                  {isAr ? "الرمز يرسله مسؤول شركتك عبر الإيميل أو واتساب — ليس رمز SMS" : "Your admin sends this code by email or WhatsApp — not an SMS code"}
                </p>
              </div>

              {/* FIX: direction ltr so fields go left→right not right→left */}
              <div className="flex justify-center gap-2 mb-6" style={{direction:"ltr"}} onPaste={handleCodePaste}>
                {code.map((digit,i)=>(
                  <input
                    key={i}
                    ref={el=>{codeRefs.current[i]=el;}}
                    type="text"
                    inputMode="text"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={2}
                    value={digit}
                    onChange={e=>handleCodeChange(i,e.target.value)}
                    onKeyDown={e=>handleCodeKeyDown(i,e)}
                    onFocus={e=>{setFocusedField(`c${i}`); e.target.select();}}
                    onBlur={()=>setFocusedField(null)}
                    style={{width:"clamp(40px,13vw,52px)",height:"clamp(48px,14vw,58px)",borderRadius:14,background:"rgba(255,255,255,.04)",border:focusedField===`c${i}`?"1.5px solid #00C8E0":`1.5px solid ${digit?"rgba(0,200,224,.35)":"rgba(255,255,255,.1)"}`,color:digit?"#00C8E0":"rgba(255,255,255,.3)",fontSize:"clamp(18px,5vw,22px)",fontWeight:800,textAlign:"center",textTransform:"uppercase",letterSpacing:1,transition:"all .2s",caretColor:"#00C8E0",fontFamily:"'Outfit',monospace",boxShadow:focusedField===`c${i}`?"0 0 0 3px rgba(0,200,224,.12)":"none"}}
                  />
                ))}
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 mb-4" style={{borderRadius:12,background:"rgba(255,45,85,.08)",border:"1px solid rgba(255,45,85,.2)"}}>
                  <AlertTriangle size={14} color="#FF2D55"/>
                  <p style={{fontSize:12,color:"#FF2D55",...S}}>{error}</p>
                </div>
              )}

              <motion.button whileTap={{scale:.97}} onClick={handleVerify} disabled={!isCodeValid||submitting} style={{width:"100%",height:54,borderRadius:16,background:isCodeValid?"linear-gradient(135deg,#00C8E0,#00A5C0)":"rgba(255,255,255,.04)",boxShadow:isCodeValid?"0 8px 28px rgba(0,200,224,.25)":"none",color:isCodeValid?"#fff":"rgba(255,255,255,.2)",fontSize:15,fontWeight:700,...S}}>
                {submitting?(<><motion.div animate={{rotate:360}} transition={{duration:.8,repeat:Infinity,ease:"linear"}} style={{width:16,height:16,borderRadius:"50%",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",display:"inline-block",marginLeft:8}}/>جاري التحقق...</>):isAr ? "التحقق من الرمز" : "Verify Code"}
              </motion.button>

              {/* Dev-only bypass — completely hidden in production builds */}
              {import.meta.env.DEV && (
                <motion.button
                  whileTap={{scale:.97}}
                  onClick={() => onSubmit("Test Company", true, {
                    found: true, companyName: "Test Company (Dev)", companyLogo: "TC",
                    employeeCount: 5, zoneName: "Zone A", evacuationPoint: "Assembly A",
                    role: "Field Engineer", department: "Operations", managerName: "Dev Admin",
                    adminPhone: "", adminEmail: "", hasZones: true,
                  })}
                  style={{width:"100%",height:44,borderRadius:14,marginTop:10,
                    background:"rgba(255,150,0,.06)",border:"1px dashed rgba(255,150,0,.25)",
                    color:"rgba(255,150,0,.7)",fontSize:12,fontWeight:600,...S}}
                >
                  {isAr ? "تجاوز للاختبار (dev only)" : "Dev Bypass (dev only)"}
                </motion.button>
              )}
            </motion.div>
          )}

          {/* Link input */}
          {mode==="link" && (
            <motion.div initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} transition={{duration:.3}}>
              <button onClick={()=>{setMode(null);setInviteLink("");setError("");}} className="flex items-center gap-2 mb-6" style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>
                <ArrowLeft size={15}/><span style={S}>{isAr ? "العودة" : "Back"}</span>
              </button>

              <p style={{fontSize:"clamp(17px,4.5vw,20px)",fontWeight:800,color:"#fff",marginBottom:4,...S}}>{isAr ? "رابط الدعوة" : "Invite Link"}</p>
              <p style={{fontSize:13,color:"rgba(255,255,255,.35)",marginBottom:24,lineHeight:1.7,...S}}>{isAr ? "الصق رابط الدعوة من بريدك الإلكتروني" : "Paste the invite link from your email"}</p>

              <div className="mb-5" style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:focusedField==="link"?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.08)",boxShadow:focusedField==="link"?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s"}}>
                <div className="flex items-center px-4 gap-3">
                  <Link2 size={15} color={focusedField==="link"?"#00C8E0":"rgba(255,255,255,.25)"}/>
                  <input type="url" value={inviteLink} onChange={e=>setInviteLink(e.target.value)} onFocus={()=>setFocusedField("link")} onBlur={()=>setFocusedField(null)} placeholder="https://sosphere.app/join/XXXXXX" style={{flex:1,background:"transparent",color:"#fff",fontSize:13,fontFamily:"'Outfit',monospace",caretColor:"#00C8E0",paddingBlock:18,direction:"ltr"}}/>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 mb-4" style={{borderRadius:12,background:"rgba(255,45,85,.08)",border:"1px solid rgba(255,45,85,.2)"}}>
                  <AlertTriangle size={14} color="#FF2D55"/>
                  <p style={{fontSize:12,color:"#FF2D55",...S}}>{error}</p>
                </div>
              )}

              <motion.button whileTap={{scale:.97}} onClick={handleVerify} disabled={!isLinkValid||submitting} style={{width:"100%",height:54,borderRadius:16,background:isLinkValid?"linear-gradient(135deg,#00C8E0,#00A5C0)":"rgba(255,255,255,.04)",boxShadow:isLinkValid?"0 8px 28px rgba(0,200,224,.25)":"none",color:isLinkValid?"#fff":"rgba(255,255,255,.2)",fontSize:15,fontWeight:700,...S}}>
                {submitting?isAr ? "جاري التحقق..." : "Verifying...":isAr ? "التحقق من الرابط" : "Verify Link"}
              </motion.button>
            </motion.div>
          )}

          <div style={{height:"max(32px,env(safe-area-inset-bottom))"}}/>
        </div>
      </div>
    </div>
  );
}
