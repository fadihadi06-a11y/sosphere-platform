import { TermsPage } from "./terms-page";
import { PrivacyPage } from "./privacy-page";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Phone, ArrowRight, Mail, Lock, Eye, EyeOff } from "lucide-react";
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

type Tab = "phone" | "email";

export function LoginPhone({ onSendOTP, onGmailLogin, onDemoAccess, onEmailLogin, onLoginComplete }: LoginPhoneProps) {
  const { isAr } = useLang();
  const [tab, setTab] = useState<Tab>("phone");
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

  const TABS: { id: Tab; label: string; icon: typeof Phone }[] = [
    { id: "phone", label: isAr ? "الهاتف" : "Phone", icon: Phone },
  ];

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
          <motion.div initial={{opacity:0,y:-16}} animate={{opacity:1,y:0}} transition={{duration:.7}} className="flex flex-col items-center mb-8">
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

          {/* Tabs */}
          <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.2}} className="flex gap-2 mb-6 p-1 rounded-2xl" style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.06)"}}>
            {TABS.map(({id,label,icon:Icon})=>(
              <button key={id} onClick={()=>setTab(id)} className="flex-1 flex items-center justify-center gap-1.5 touch-target" style={{height:44,borderRadius:12,background:tab===id?"rgba(0,200,224,.1)":"transparent",border:tab===id?"1px solid rgba(0,200,224,.2)":"1px solid transparent",transition:"all .25s"}}>
                <Icon size={14} color={tab===id?"#00C8E0":"rgba(255,255,255,.3)"}/>
                <span style={{fontSize:13,fontWeight:tab===id?700:400,color:tab===id?"#00C8E0":"rgba(255,255,255,.3)",...S}}>{label}</span>
              </button>
            ))}
          </motion.div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            {tab==="phone"&&(
              <motion.div key="phone" initial={{opacity:0,x:-20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:20}} transition={{duration:.28}}>
                <p style={{fontSize:"clamp(17px,4.5vw,20px)",fontWeight:800,color:"#fff",marginBottom:4,...S}}>
                  {isAr ? "تسجيل الدخول" : "Sign In"}
                </p>
                <p style={{fontSize:13,color:"rgba(255,255,255,.3)",marginBottom:20,lineHeight:1.7,...S}}>
                  {isAr ? "أدخل رقم هاتفك لاستلام رمز التحقق" : "Enter your phone number to receive a verification code"}
                </p>

                <div style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:phoneFocused?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.07)",boxShadow:phoneFocused?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s",display:"flex",alignItems:"center",overflow:"hidden",width:"100%"}}>
                  <CountryTrigger country={country} onClick={()=>setPickerOpen(true)}/>
                  <input type="tel" inputMode="numeric" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,""))} onFocus={()=>setPhoneFocused(true)} onBlur={()=>setPhoneFocused(false)} placeholder="5XX XXXX" maxLength={15} style={{flex:1,background:"transparent",color:"#fff",fontSize:16,fontFamily:"inherit",caretColor:"#00C8E0",padding:"17px 12px",direction:"ltr",textAlign:"left",width:0,outline:"none",minWidth:0}}/>
                </div>

                {otpError && <p style={{fontSize:12,color:"#FF2D55",marginTop:8,textAlign:"center"}}>{otpError}</p>}

                <motion.button whileTap={{scale:.97}} onClick={handlePhoneSubmit} disabled={!isPhoneValid||otpLoading} className="w-full flex items-center justify-center gap-2.5 mt-4 mb-7" style={{height:52,borderRadius:16,background:isPhoneValid?"linear-gradient(135deg,#00C8E0,#00A5C0)":"rgba(255,255,255,.04)",color:isPhoneValid?"#fff":"rgba(255,255,255,.2)",fontSize:15,fontWeight:700,boxShadow:isPhoneValid?"0 8px 30px rgba(0,200,224,.25)":"none",border:isPhoneValid?"none":"1px solid rgba(255,255,255,.05)",...S}}>
                  {otpLoading
                    ? (isAr ? "جاري الإرسال..." : "Sending...")
                    : (isAr ? "إرسال رمز التحقق" : "Send Verification Code")}
                  {!otpLoading && <ArrowRight size={16}/>}
                </motion.button>
              </motion.div>
            )}

            {tab==="email"&&(
              <motion.div key="email" initial={{opacity:0,x:-20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:20}} transition={{duration:.28}}>
                <p style={{fontSize:"clamp(17px,4.5vw,20px)",fontWeight:800,color:"#fff",marginBottom:4,...S}}>
                  {isAr ? "تسجيل بالبريد" : "Email Sign In"}
                </p>
                <p style={{fontSize:13,color:"rgba(255,255,255,.3)",marginBottom:20,lineHeight:1.7,...S}}>
                  {isAr ? "أدخل بريدك الإلكتروني وكلمة المرور" : "Enter your email and password"}
                </p>

                <div className="mb-3" style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:emailFocused?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.07)",boxShadow:emailFocused?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s"}}>
                  <div className="flex items-center px-4 gap-3">
                    <Mail size={15} color={emailFocused?"#00C8E0":"rgba(255,255,255,.2)"}/>
                    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} onFocus={()=>setEmailFocused(true)} onBlur={()=>setEmailFocused(false)} placeholder={isAr ? "البريد الإلكتروني" : "Email address"} maxLength={254} style={{flex:1,background:"transparent",color:"#fff",fontSize:15,fontFamily:"inherit",caretColor:"#00C8E0",paddingBlock:17,direction:"ltr"}}/>
                  </div>
                </div>

                <div className="mb-5" style={{borderRadius:16,background:"rgba(255,255,255,.03)",border:passFocused?"1px solid rgba(0,200,224,.3)":"1px solid rgba(255,255,255,.07)",boxShadow:passFocused?"0 0 0 4px rgba(0,200,224,.06)":"none",transition:"all .25s"}}>
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

            {/* Dev-only quick access — hidden in production builds */}
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
