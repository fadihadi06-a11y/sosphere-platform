import { TermsPage } from "./terms-page";
import { PrivacyPage } from "./privacy-page";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Phone, ArrowRight, Mail, Lock, Eye, EyeOff, Users, UserCheck } from "lucide-react";
import { CountryTrigger, CountrySheet, COUNTRIES, type Country } from "./country-picker";
import { OTPVerify } from "./otp-verify";
import { useLang } from "./useLang";

interface LoginPhoneProps {
  onSendOTP: (phone: string) => void;
  onGmailLogin: () => void;
  onDemoAccess?: (role?: string, name?: string) => void;
  onEmailLogin?: (email: string, name: string) => void;
  onLoginComplete?: (phone: string) => void;
}

type LoginMode = "civilian" | "staff";

/* -- Google "G" logo SVG (official branding) -- */
function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.998 23.998 0 0 0 0 24c0 3.77.9 7.35 2.56 10.53l7.97-5.94z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

// Spring transition config for "Apple Enterprise" aesthetic
const springTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

const softSpring = {
  type: "spring" as const,
  stiffness: 200,
  damping: 25,
  mass: 1,
};

export function LoginPhone({ onSendOTP, onGmailLogin, onDemoAccess, onEmailLogin, onLoginComplete }: LoginPhoneProps) {
  const { isAr } = useLang();
  const [mode, setMode] = useState<LoginMode>("civilian");
  const [showOTP, setShowOTP] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [pendingPhone, setPendingPhone] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<Country>(COUNTRIES.find(c=>c.code==="SA")!);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const isPhoneValid = phone.length >= 8;
  const isEmailValid = email.includes("@") && password.length >= 4;

  const handlePhoneSubmit = async () => {
    setOtpError("");
    if (!isPhoneValid) return;
    setOtpLoading(true);
    const full = `${country.dial}${phone}`;
    const { signInWithPhone } = await import("./api/supabase-client");
    const { error } = await signInWithPhone(full);
    if (error) { setOtpError(error); setOtpLoading(false); return; }
    setOtpLoading(false);
    setPendingPhone(full); setShowOTP(true);
  };

  const handleEmailSubmit = async () => {
    if (!isEmailValid) return;
    setEmailLoading(true);
    const name = email.split("@")[0].replace(/\./g," ").replace(/\b\w/g,c=>c.toUpperCase());
    const { supabase } = await import("./api/supabase-client");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setEmailLoading(false); return; }
    console.log("[SUPABASE_READY] email_login", { email });
    setTimeout(() => { setEmailLoading(false); onEmailLogin?.(email, name); }, 1200);
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      onGmailLogin();
    } catch {
      setGoogleLoading(false);
    }
  };

  if (showTerms) return <TermsPage onBack={() => setShowTerms(false)} />;
  if (showPrivacy) return <PrivacyPage onBack={() => setShowPrivacy(false)} />;
  if (showOTP) {
    return (
      <div className="app-screen" style={{background:"#05070E"}}>
        <OTPVerify phone={pendingPhone} onVerify={()=>{setShowOTP(false);if(onLoginComplete)onLoginComplete(pendingPhone);else onSendOTP(pendingPhone);}} onBack={()=>setShowOTP(false)}/>
      </div>
    );
  }

  const S = { fontFamily: isAr ? "'Tajawal','Outfit',sans-serif" : "'Outfit','Tajawal',sans-serif" };
  const dir = isAr ? "rtl" as const : "ltr" as const;

  return (
    <div className="app-screen" style={{background:"#05070E",...S, direction: dir}}>
      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute" style={{top:"-15%",left:"50%",transform:"translateX(-50%)",width:"min(120vw,480px)",height:"min(120vw,480px)",borderRadius:"50%",background:"radial-gradient(circle,rgba(0,200,224,.05) 0%,transparent 65%)"}}/>
        <div className="absolute bottom-0 left-0" style={{width:"50%",height:"40%",background:"radial-gradient(circle,rgba(123,94,255,.04) 0%,transparent 60%)"}}/>
        <div className="absolute bottom-0 right-0" style={{width:"50%",height:"40%",background:"radial-gradient(circle,rgba(255,45,85,.03) 0%,transparent 60%)"}}/>
      </div>

      <div className="scroll-area relative z-10">
        <div className="px-5" style={{paddingTop:"max(60px,env(safe-area-inset-top))",paddingBottom:"max(32px,env(safe-area-inset-bottom))"}}>

          {/* Logo */}
          <motion.div initial={{opacity:0,y:-16}} animate={{opacity:1,y:0}} transition={{duration:.7}} className="flex flex-col items-center mb-6">
            <div className="flex flex-col items-center mb-1">
              <div className="relative mb-2">
                <div className="absolute" style={{inset:-12,borderRadius:30,background:"radial-gradient(circle,rgba(0,200,224,.14) 0%,transparent 70%)",filter:"blur(8px)"}}/>
                <div style={{width:56,height:56,borderRadius:16,background:"linear-gradient(135deg,rgba(0,200,224,.18),rgba(0,200,224,.06))",border:"1px solid rgba(0,200,224,.2)",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                  <Shield size={26} color="#00C8E0"/>
                </div>
              </div>
              <span style={{fontSize:20,fontWeight:900,color:"#fff",letterSpacing:"-.5px"}}>SOSphere</span>
              <span style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:2}}>{isAr ? "منصة سلامة العمال الميدانيين" : "Field Worker Safety Platform"}</span>
            </div>
          </motion.div>

          {/* -- Mode Toggle: Civilian / Staff -- */}
          <motion.div
            initial={{opacity:0,y:8}}
            animate={{opacity:1,y:0}}
            transition={{delay:.15,...softSpring}}
            className="flex gap-2 mb-5 p-1 rounded-2xl"
            style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.06)"}}
          >
            {([
              { id: "civilian" as LoginMode, label: isAr ? "مدني" : "Civilian", icon: Users, desc: isAr ? "جوجل / حساب اجتماعي" : "Google Sign-In" },
              { id: "staff" as LoginMode, label: isAr ? "موظف" : "Staff", icon: UserCheck, desc: isAr ? "هاتف + رمز التحقق" : "Phone / OTP" },
            ]).map(({id, label, icon: Icon, desc}) => (
              <motion.button
                key={id}
                onClick={() => setMode(id)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 touch-target relative"
                style={{
                  height: 56,
                  borderRadius: 14,
                  background: mode === id ? "rgba(0,200,224,.08)" : "transparent",
                  border: mode === id ? "1px solid rgba(0,200,224,.2)" : "1px solid transparent",
                  transition: "border .25s",
                }}
                whileTap={{ scale: 0.97 }}
              >
                {mode === id && (
                  <motion.div
                    layoutId="mode-indicator"
                    className="absolute inset-0 rounded-[14px]"
                    style={{ background: "rgba(0,200,224,.08)" }}
                    transition={springTransition}
                  />
                )}
                <div className="flex items-center gap-1.5 relative z-10">
                  <Icon size={14} color={mode === id ? "#00C8E0" : "rgba(255,255,255,.3)"} />
                  <span style={{fontSize:13, fontWeight: mode === id ? 700 : 400, color: mode === id ? "#00C8E0" : "rgba(255,255,255,.3)", ...S}}>{label}</span>
                </div>
                <span className="relative z-10" style={{fontSize:10, color: mode === id ? "rgba(0,200,224,.5)" : "rgba(255,255,255,.15)", ...S}}>{desc}</span>
              </motion.button>
            ))}
          </motion.div>

          {/* -- Content: Civilian (Google) or Staff (Phone/OTP) -- */}
          <AnimatePresence mode="wait">
            {mode === "civilian" && (
              <motion.div
                key="civilian"
                initial={{opacity:0, x:-24}}
                animate={{opacity:1, x:0}}
                exit={{opacity:0, x:24}}
                transition={softSpring}
              >
                <p style={{fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, color:"#fff", marginBottom:4, ...S}}>
                  {isAr ? "تسجيل دخول المدنيين" : "Civilian Sign In"}
                </p>
                <p style={{fontSize:13, color:"rgba(255,255,255,.35)", marginBottom:24, lineHeight:1.7, ...S}}>
                  {isAr
                    ? "سجّل الدخول بحساب جوجل للوصول السريع والآمن"
                    : "Sign in with your Google account for fast, secure access"}
                </p>

                {/* -- Google Sign-In Button (Official Branding) -- */}
                <motion.button
                  whileHover={{ scale: 1.01, boxShadow: "0 4px 24px rgba(66,133,244,.15)" }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                  className="w-full flex items-center justify-center gap-3"
                  style={{
                    height: 54,
                    borderRadius: 16,
                    background: "#fff",
                    border: "none",
                    cursor: googleLoading ? "wait" : "pointer",
                    opacity: googleLoading ? 0.7 : 1,
                    transition: "opacity .2s",
                    fontFamily: "'Roboto', 'Outfit', system-ui, sans-serif",
                  }}
                >
                  {googleLoading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: .8, repeat: Infinity, ease: "linear" }}
                      style={{ width: 20, height: 20, borderRadius: "50%", border: "2.5px solid #ddd", borderTopColor: "#4285F4" }}
                    />
                  ) : (
                    <GoogleLogo size={20} />
                  )}
                  <span style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: "#3c4043",
                    letterSpacing: ".25px",
                  }}>
                    {googleLoading
                      ? (isAr ? "جاري التوصيل..." : "Connecting...")
                      : (isAr ? "تسجيل الدخول بجوجل" : "Sign in with Google")}
                  </span>
                </motion.button>

                {/* Divider */}
                <div className="flex items-center gap-3 my-6">
                  <div className="flex-1" style={{height:1, background:"rgba(255,255,255,.06)"}}/>
                  <span style={{fontSize:11, color:"rgba(255,255,255,.2)", ...S}}>{isAr ? "أو" : "or"}</span>
                  <div className="flex-1" style={{height:1, background:"rgba(255,255,255,.06)"}}/>
                </div>

                {/* Fallback: switch to Phone */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setMode("staff")}
                  className="w-full flex items-center justify-center gap-2"
                  style={{
                    height: 48,
                    borderRadius: 14,
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(255,255,255,.08)",
                    color: "rgba(255,255,255,.4)",
                    fontSize: 13,
                    fontWeight: 500,
                    ...S,
                  }}
                >
                  <Phone size={14} />
                  {isAr ? "تسجيل الدخول بالهاتف بدلاً من ذلك" : "Sign in with Phone instead"}
                </motion.button>
              </motion.div>
            )}

            {mode === "staff" && (
              <motion.div
                key="staff"
                initial={{opacity:0, x:24}}
                animate={{opacity:1, x:0}}
                exit={{opacity:0, x:-24}}
                transition={softSpring}
              >
                <p style={{fontSize:"clamp(17px,4.5vw,20px)", fontWeight:800, color:"#fff", marginBottom:4, ...S}}>
                  {isAr ? "تسجيل دخول الموظفين" : "Staff Sign In"}
                </p>
                <p style={{fontSize:13, color:"rgba(255,255,255,.35)", marginBottom:20, lineHeight:1.7, ...S}}>
                  {isAr ? "أدخل رقم هاتفك لاستلام رمز التحقق" : "Enter your phone number to receive a verification code"}
                </p>

                <div style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:phoneFocused?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.07)",boxShadow:phoneFocused?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s",display:"flex",alignItems:"center",overflow:"hidden",width:"100%"}}>
                  <CountryTrigger country={country} onClick={()=>setPickerOpen(true)}/>
                  <input type="tel" inputMode="numeric" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,""))} onFocus={()=>setPhoneFocused(true)} onBlur={()=>setPhoneFocused(false)} placeholder="5XX XXXX" maxLength={15} style={{flex:1,background:"transparent",color:"#fff",fontSize:16,fontFamily:"inherit",caretColor:"#00C8E0",padding:"17px 12px",direction:"ltr",textAlign:"left",width:0,outline:"none",minWidth:0}}/>
                </div>

                {otpError && <p style={{fontSize:12,color:"#FF2D55",marginTop:8,textAlign:"center"}}>{otpError}</p>}

                <motion.button whileTap={{scale:.97}} onClick={handlePhoneSubmit} disabled={!isPhoneValid||otpLoading} className="w-full flex items-center justify-center gap-2.5 mt-4 mb-5" style={{height:52,borderRadius:16,background:isPhoneValid?"linear-gradient(135deg,#00C8E0,#00A5C0)":"rgba(255,255,255,.04)",color:isPhoneValid?"#fff":"rgba(255,255,255,.2)",fontSize:15,fontWeight:700,boxShadow:isPhoneValid?"0 8px 30px rgba(0,200,224,.25)":"none",border:isPhoneValid?"none":"1px solid rgba(255,255,255,.05)",...S}}>
                  {otpLoading
                    ? (isAr ? "جاري الإرسال..." : "Sending...")
                    : (isAr ? "إرسال رمز التحقق" : "Send Verification Code")}
                  {!otpLoading && <ArrowRight size={16}/>}
                </motion.button>

                {/* Email login for staff with credentials */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1" style={{height:1, background:"rgba(255,255,255,.06)"}}/>
                  <span style={{fontSize:11, color:"rgba(255,255,255,.2)", ...S}}>{isAr ? "أو بالبريد الإلكتروني" : "or with email"}</span>
                  <div className="flex-1" style={{height:1, background:"rgba(255,255,255,.06)"}}/>
                </div>

                <div className="mb-3" style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:emailFocused?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.07)",boxShadow:emailFocused?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s"}}>
                  <div className="flex items-center px-4 gap-3">
                    <Mail size={15} color={emailFocused?"#00C8E0":"rgba(255,255,255,.2)"}/>
                    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} onFocus={()=>setEmailFocused(true)} onBlur={()=>setEmailFocused(false)} placeholder={isAr ? "البريد الإلكتروني" : "Email address"} maxLength={254} style={{flex:1,background:"transparent",color:"#fff",fontSize:15,fontFamily:"inherit",caretColor:"#00C8E0",paddingBlock:17,direction:"ltr"}}/>
                  </div>
                </div>

                <div className="mb-4" style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:passFocused?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.07)",boxShadow:passFocused?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s"}}>
                  <div className="flex items-center px-4 gap-3">
                    <Lock size={15} color={passFocused?"#00C8E0":"rgba(255,255,255,.2)"}/>
                    <input type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} onFocus={()=>setPassFocused(true)} onBlur={()=>setPassFocused(false)} placeholder={isAr ? "كلمة المرور" : "Password"} maxLength={128} style={{flex:1,background:"transparent",color:"#fff",fontSize:15,fontFamily:"inherit",caretColor:"#00C8E0",paddingBlock:17,direction:"ltr"}}/>
                    <button onClick={()=>setShowPw(!showPw)} style={{color:"rgba(255,255,255,.25)",padding:4}}>
                      {showPw?<EyeOff size={16}/>:<Eye size={16}/>}
                    </button>
                  </div>
                </div>

                <motion.button whileTap={{scale:.97}} onClick={handleEmailSubmit} disabled={!isEmailValid||emailLoading} className="w-full flex items-center justify-center gap-2.5" style={{height:52,borderRadius:16,background:isEmailValid?"linear-gradient(135deg,#00C8E0,#00A5C0)":"rgba(255,255,255,.04)",color:isEmailValid?"#fff":"rgba(255,255,255,.2)",fontSize:15,fontWeight:700,boxShadow:isEmailValid?"0 8px 30px rgba(0,200,224,.25)":"none",...S}}>
                  {emailLoading
                    ? (<><motion.div animate={{rotate:360}} transition={{duration:.8,repeat:Infinity,ease:"linear"}} style={{width:16,height:16,borderRadius:"50%",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff"}}/>{isAr ? "جاري التحقق..." : "Signing in..."}</>)
                    : (<>{isAr ? "تسجيل الدخول" : "Sign In"}<ArrowRight size={16}/></>)}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {import.meta.env.DEV && onDemoAccess && (
            <motion.button
              initial={{opacity:0}} animate={{opacity:1}} transition={{delay:1}}
              whileTap={{scale:.97}}
              onClick={()=>onDemoAccess?.()}
              style={{width:"100%",height:44,borderRadius:14,marginTop:16,
                background:"rgba(255,150,0,.06)",border:"1px dashed rgba(255,150,0,.25)",
                color:"rgba(255,150,0,.7)",fontSize:12,fontWeight:600,...S}}
            >
              {isAr ? "دخول سريع للاختبار (dev only)" : "Quick Test Entry (dev only)"}
            </motion.button>
          )}

          <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.6}} className="text-center mt-8" style={{fontSize:"clamp(10px,2.5vw,11px)",color:"rgba(255,255,255,.15)",lineHeight:1.8,...S}}>
            {isAr ? "بتسجيل الدخول، أنت توافق على" : "By signing in, you agree to our"}{" "}
            <button onClick={()=>setShowTerms(true)} style={{color:"rgba(0,200,224,.6)",background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontSize:"inherit",textDecoration:"underline"}}>
              {isAr ? "شروط الاستخدام" : "Terms of Service"}
            </button>{" "}{isAr ? "و" : "and"}{" "}
            <button onClick={()=>setShowPrivacy(true)} style={{color:"rgba(0,200,224,.6)",background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontSize:"inherit",textDecoration:"underline"}}>
              {isAr ? "سياسة الخصوصية" : "Privacy Policy"}
            </button>
          </motion.p>
        </div>
      </div>

      <CountrySheet open={pickerOpen} selected={country} onSelect={setCountry} onClose={()=>setPickerOpen(false)}/>
    </div>
  );
}
