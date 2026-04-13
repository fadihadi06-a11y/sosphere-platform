import { useState, useEffect } from "react";
import { useLang } from "./useLang";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Bell, MapPin, Clock, CheckCircle, AlertTriangle, Phone, Home, Map, User, Timer, Heart, Package, FileText, ChevronRight, LogOut, Navigation, X } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { emitSyncEvent, getHybridMode, onHybridModeChange, recordAttendance, autoBroadcastHazard } from "./shared-store";
import { MissionNotificationBanner } from "./mission-tracker-mobile";
import { toast } from "sonner";
import { MonitoringModeBanner } from "./monitoring-mode-banner";
import { Activity } from "lucide-react";

type Tab = "home" | "alerts" | "map" | "profile";

interface EmployeeDashboardProps {
  companyName: string; userName: string; userZone: string;
  onSOSTrigger: () => void; onCheckinTimer?: () => void; onMedicalID?: () => void;
  onEmergencyPacket?: () => void; onEmergencyServices?: () => void; onEmergencyContacts?: () => void;
  onNotifications?: () => void; onIncidentHistory?: () => void; onLogout?: () => void;
  timerActive?: boolean; onMissionTracker?: () => void; onSafeWalk?: () => void;
}

// Avatar and role are read from localStorage (saved during employee-quick-setup)
const AVATAR_FALLBACK = "https://images.unsplash.com/photo-1769636929231-3cd7f853d038?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=400";

// ─── SOS Button ───────────────────────────────────────────────────────────────
function SOSButton({ onSOSTrigger }: { onSOSTrigger: () => void }) {
  const { isAr } = useLang();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdRef = { interval: null as any, timeout: null as any };

  const startHold = () => {
    setHolding(true); setProgress(0);
    let p = 0;
    holdRef.interval = setInterval(() => { p += 3.33; setProgress(Math.min(p,100)); if(p>=100){clearInterval(holdRef.interval);} }, 100);
    holdRef.timeout = setTimeout(() => { setHolding(false); setProgress(0); onSOSTrigger(); }, 3000);
  };

  const endHold = () => {
    clearInterval(holdRef.interval); clearTimeout(holdRef.timeout);
    setHolding(false); setProgress(0);
  };

  return (
    <div className="flex flex-col items-center py-6 mx-5 mb-4">
      <div className="relative flex items-center justify-center" style={{width:160,height:160,marginBottom:16}}>
        {/* Rings */}
        <motion.div animate={holding?{scale:[1,1.4,1],opacity:[.3,0,.3]}:{scale:1,opacity:.25}} transition={holding?{duration:1,repeat:Infinity}:{}} className="absolute rounded-full" style={{width:160,height:160,border:"1.5px solid #FF2D55"}}/>
        <motion.div animate={holding?{scale:[1,1.25,1],opacity:[.4,0,.4]}:{scale:1,opacity:.18}} transition={holding?{duration:1,repeat:Infinity,delay:.2}:{}} className="absolute rounded-full" style={{width:132,height:132,border:"1.5px solid #FF2D55"}}/>

        {/* Button */}
        <motion.button
          whileTap={{scale:.94}}
          onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold}
          onTouchStart={startHold} onTouchEnd={endHold}
          className="relative flex flex-col items-center justify-center"
          style={{width:104,height:104,borderRadius:"50%",background:holding?"linear-gradient(135deg,#FF1A3C,#CC0028)":"linear-gradient(135deg,#FF2D55,#E0002A)",boxShadow:holding?"0 0 60px rgba(255,45,85,.7),0 0 30px rgba(255,45,85,.4)":"0 8px 40px rgba(255,45,85,.45),0 4px 16px rgba(255,45,85,.3)",border:"none",transition:"box-shadow .3s"}}>

          {/* Progress ring */}
          {holding && (
            <svg className="absolute" width="104" height="104" style={{transform:"rotate(-90deg)"}}>
              <circle cx="52" cy="52" r="48" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3"/>
              <motion.circle cx="52" cy="52" r="48" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="3" strokeLinecap="round" strokeDasharray={Math.PI*2*48} strokeDashoffset={Math.PI*2*48*(1-progress/100)} style={{transition:"stroke-dashoffset .1s linear"}}/>
            </svg>
          )}

          <Shield size={30} color="#fff" style={{position:"relative",zIndex:1}}/>
          <span style={{fontSize:13,fontWeight:900,color:"#fff",letterSpacing:.5,marginTop:4,position:"relative",zIndex:1,fontFamily:"'Outfit',sans-serif"}}>SOS</span>
        </motion.button>
      </div>

      <p style={{fontSize:11,color:"rgba(255,255,255,.3)",textAlign:"center",fontFamily:"'Tajawal',sans-serif"}}>
        {isAr ? (holding ? "أفلت للإلغاء..." : "اضغط مع الاستمرار 3 ثوانٍ للطوارئ") : (holding ? "Release to cancel..." : "Hold 3 seconds for emergency")}
      </p>
    </div>
  );
}

// ─── Alert Item ───────────────────────────────────────────────────────────────
interface AlertItem {
  id:string;title:string;subtitle:string;desc:string;time:string;
  color:string;severity:string;severityColor:string;zone:string;
  icon:any;iconColor:string;read:boolean;
}

export function EmployeeDashboard({
  companyName, userName, userZone, onSOSTrigger, onCheckinTimer, onMedicalID,
  onEmergencyPacket, onEmergencyServices, onEmergencyContacts,
  onNotifications, onIncidentHistory, onLogout, timerActive, onMissionTracker, onSafeWalk,
}: EmployeeDashboardProps) {
  const { isAr } = useLang();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [onDuty, setOnDuty] = useState(true);

  // FIX: Read avatar and role from localStorage — saved during employee-quick-setup
  const [avatarUrl] = useState<string>(() => {
    try { return localStorage.getItem("sosphere_employee_avatar") || AVATAR_FALLBACK; }
    catch { return AVATAR_FALLBACK; }
  });
  const [employeeProfile] = useState<{role?:string;department?:string}>(() => {
    try {
      const raw = localStorage.getItem("sosphere_employee_profile");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  // Fallback role if not saved yet
  const prefilledRole = "Field Engineer";
  const [hybridMode, setHybridModeState] = useState(() => getHybridMode());
  const [nearZone, setNearZone] = useState(false);
  const [attended, setAttended] = useState(false);
  const [showAttendConfirm, setShowAttendConfirm] = useState(false);
  const [monitoringMode, setMonitoringMode] = useState(false);
  const [monitoringData, setMonitoringData] = useState<{checkInInterval:number;nextCheckIn:number;monitorUntil:number;}|null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([
    { id:"a1",title:"إحاطة السلامة الإلزامية",subtitle:"يلزم مراجعة بروتوكول السلامة المحدث",desc:"يجب على جميع العمال مراجعة بروتوكول السلامة المحدث قبل الوردية التالية.",time:"اليوم",color:"#FF2D55",severity:"حرج",severityColor:"#FF2D55",zone:"جميع المناطق",icon:AlertTriangle,iconColor:"#FF2D55",read:false },
    { id:"a2",title:"المنطقة C مقيدة",subtitle:"المنطقة C تحت الصيانة حتى 10 مارس",desc:"المنطقة C تحت الصيانة. يُمنع الدخول. سيتم إلغاء الوصول فوراً للمخالفين.",time:"أمس",color:"#FF9500",severity:"عالٍ",severityColor:"#FF9500",zone:"المنطقة C",icon:MapPin,iconColor:"#FF9500",read:false },
    { id:"a3",title:"تدريب الإخلاء الشهري",subtitle:"تدريب طوارئ يوم 12 مارس الساعة 10 صباحاً",desc:"تدريب إخلاء طارئ يوم 12 مارس. يجب على جميع العمال المشاركة.",time:"3 مارس",color:"#00C8E0",severity:"متوسط",severityColor:"#00C8E0",zone:"جميع المناطق",icon:Clock,iconColor:"#00C8E0",read:false },
    { id:"a4",title:"فحص معدات الوقاية",subtitle:"موعد الفحص الربع سنوي يقترب",desc:"سلّم معدات الحماية الشخصية للفحص الربعي. الموعد النهائي 15 مارس.",time:"1 مارس",color:"#00C853",severity:"منخفض",severityColor:"#00C853",zone:"المنطقة B-7",icon:CheckCircle,iconColor:"#00C853",read:true },
  ]);
  const [selectedAlert, setSelectedAlert] = useState<string|null>(null);

  const unreadCount = alerts.filter(a=>!a.read).length;
  const activeAlert = alerts.find(a=>a.id===selectedAlert)||null;

  const markAsRead = (id: string) => { setAlerts(prev=>prev.map(a=>a.id===id?{...a,read:true}:a)); setSelectedAlert(null); };

  useEffect(() => { const unsub = onHybridModeChange(v=>setHybridModeState(v)); return unsub; }, []);

  useEffect(() => {
    const checkMonitoring = () => {
      const data = localStorage.getItem("monitoring_EMP-APP");
      if (data) { const p = JSON.parse(data); setMonitoringMode(true); setMonitoringData({checkInInterval:p.checkInInterval,nextCheckIn:p.nextCheckIn,monitorUntil:p.monitorUntil}); }
      else { setMonitoringMode(false); setMonitoringData(null); }
    };
    checkMonitoring();
    window.addEventListener("storage", checkMonitoring);
    const intv = setInterval(checkMonitoring, 10000);
    return () => { window.removeEventListener("storage", checkMonitoring); clearInterval(intv); };
  }, []);

  const handleMonitoringCheckIn = () => {
    const data = localStorage.getItem("monitoring_EMP-APP");
    if (data) {
      const p = JSON.parse(data);
      const next = Date.now()+(p.checkInInterval*60*1000);
      localStorage.setItem("monitoring_EMP-APP", JSON.stringify({...p,nextCheckIn:next}));
      emitSyncEvent({type:"MONITORING_CHECKIN",employeeId:"EMP-APP",employeeName:userName,zone:userZone,timestamp:Date.now(),data:{nextCheckIn:next}});
      setMonitoringData(prev=>prev?{...prev,nextCheckIn:next}:null);
      toast.success(isAr ? "تم تسجيل الحضور" : "Check-in confirmed", {description: isAr ? `التسجيل التالي خلال ${p.checkInInterval} دقائق` : `Next check-in in ${p.checkInInterval} minutes`});
    }
  };

  useEffect(() => {
    if(!hybridMode||!onDuty){setNearZone(false);return;}
    const t = setTimeout(()=>setNearZone(true),5000);
    return ()=>clearTimeout(t);
  },[hybridMode,onDuty]);

  const handleAttend = () => {
    recordAttendance({employeeId:"EMP-APP",employeeName:userName,zoneId:"GZ-1",zoneName:userZone,timestamp:Date.now(),type:"enter"});
    setAttended(true); setShowAttendConfirm(true);
    setTimeout(()=>setShowAttendConfirm(false),3000);
  };

  const TABS = [
    { id:"home" as Tab, icon:Home, labelAr: isAr ? "الرئيسية" : "Home" },
    { id:"alerts" as Tab, icon:Bell, labelAr: isAr ? "التنبيهات" : "Alerts", badge:unreadCount },
    { id:"map" as Tab, icon:Map, labelAr: isAr ? "الخريطة" : "Map" },
    { id:"profile" as Tab, icon:User, labelAr: isAr ? "الملف" : "Profile" },
  ];

  const quickActions = [
    { icon:Shield, labelAr: isAr ? "الحالة" : "Status", color:"#00C8E0", action:()=>{ emitSyncEvent({type:"STATUS_UPDATE",employeeId:"EMP-APP",employeeName:userName,zone:userZone,timestamp:Date.now(),data:{status:"safe"}}); toast.success(isAr ? "تم إرسال تحديث الحالة" : "Status updated"); }},
    { icon:AlertTriangle, labelAr: isAr ? "خطر" : "Hazard", color:"#FF9500", action:()=>{ emitSyncEvent({type:"HAZARD_REPORT",employeeId:"EMP-APP",employeeName:userName,zone:userZone,timestamp:Date.now(),data:{hazardType:"Environmental"}}); autoBroadcastHazard(userName,userZone,"Environmental"); toast.warning(isAr ? "تم الإبلاغ عن الخطر" : "Hazard reported"); }},
    { icon:MapPin, labelAr: isAr ? "منطقتي" : "My Zone", color:"#00C853", action:()=>{ emitSyncEvent({type:"LOCATION_UPDATE",employeeId:"EMP-APP",employeeName:userName,zone:userZone,timestamp:Date.now()}); }},
    { icon:Phone, labelAr: isAr ? "اتصال" : "Call", color:"#AF52DE", action:onEmergencyContacts },
  ];
  const visibleActions = hybridMode ? quickActions : quickActions.filter(a=>a.labelAr!=="منطقتي");

  const S = { fontFamily:"'Tajawal','Outfit',sans-serif" };

  return (
    <div className="app-screen" style={{background:"#05070E",...S}}>
      {/* Ambient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{width:"min(120vw,450px)",height:"min(80vw,350px)",background:"radial-gradient(ellipse,rgba(0,200,224,.04) 0%,transparent 65%)"}}/>

      {/* Content */}
      <div className="scroll-area" style={{paddingBottom:80}}>
        <div style={{paddingTop:"max(14px,env(safe-area-inset-top))"}}>

          {activeTab==="home" && (
            <>
              {/* Top bar */}
              <div className="flex items-center justify-between px-5 mb-4">
                <div className="flex items-center gap-2.5">
                  <Shield size={22} color="#00C8E0"/>
                  <div>
                    <p style={{fontSize:16,fontWeight:700,color:"#fff",letterSpacing:"-.3px"}}>SOSphere</p>
                    <p style={{fontSize:10,color:"rgba(255,255,255,.3)",fontWeight:500,letterSpacing:".5px"}}>{companyName}</p>
                  </div>
                </div>
                <button onClick={onNotifications} className="relative touch-target" style={{width:40,height:40,borderRadius:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <Bell size={17} color="rgba(255,255,255,.5)"/>
                  {unreadCount>0&&<span className="absolute" style={{top:7,right:7,width:8,height:8,borderRadius:"50%",background:"#FF2D55",boxShadow:"0 0 8px rgba(255,45,85,.6)"}}/>}
                </button>
              </div>

              {/* Monitoring banner */}
              {monitoringMode&&monitoringData&&(
                <div className="px-5"><MonitoringModeBanner checkInInterval={monitoringData.checkInInterval} nextCheckInTime={monitoringData.nextCheckIn} monitorUntil={monitoringData.monitorUntil} onCheckIn={handleMonitoringCheckIn}/></div>
              )}

              {/* Status card */}
              <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="mx-5 p-5 mb-4" style={{borderRadius:22,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",boxShadow:"0 4px 24px rgba(0,0,0,.1)"}}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3" style={{direction:"rtl"}}>
                    <div style={{width:44,height:44,borderRadius:14,overflow:"hidden",border:"1.5px solid rgba(255,150,0,.2)",flexShrink:0}}>
                      <ImageWithFallback src={avatarUrl} alt="Profile" className="w-full h-full object-cover"/>
                    </div>
                    <div>
                      <p style={{fontSize:17,fontWeight:700,color:"#fff",letterSpacing:"-.3px"}}>{userName}</p>
                      <p style={{fontSize:12,color:"rgba(255,255,255,.35)",marginTop:2}}>
                        {employeeProfile.role || prefilledRole}
                      </p>
                    </div>
                  </div>
                  <motion.button whileTap={{scale:.95}} onClick={()=>{ setOnDuty(!onDuty); emitSyncEvent({type:"STATUS_CHANGE",employeeId:"EMP-APP",employeeName:userName,timestamp:Date.now(),data:{status:!onDuty?"on-duty":"off-duty"}}); }} style={{display:"flex",alignItems:"center",gap:6,paddingInline:12,height:32,borderRadius:12,background:onDuty?"rgba(0,200,83,.12)":"rgba(255,255,255,.04)",border:onDuty?"1px solid rgba(0,200,83,.2)":"1px solid rgba(255,255,255,.07)",fontSize:12,fontWeight:700,color:onDuty?"#00C853":"rgba(255,255,255,.3)",transition:"all .4s"}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:onDuty?"#00C853":"rgba(255,255,255,.2)",boxShadow:onDuty?"0 0 8px rgba(0,200,83,.6)":"none",transition:"all .4s"}}/>
                    {isAr ? (onDuty ? "في الخدمة" : "خارج الخدمة") : (onDuty ? "On Duty" : "Off Duty")}
                  </motion.button>
                </div>
                <div className="flex items-center gap-5 pt-4" style={{borderTop:"1px solid rgba(255,255,255,.05)",direction:"rtl"}}>
                  <div className="flex items-center gap-1.5"><MapPin size={13} color="rgba(0,200,224,.7)"/><span style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>{userZone}</span></div>
                  <div className="flex items-center gap-1.5"><Clock size={13} color="rgba(0,200,224,.7)"/><span style={{fontSize:12,color:"rgba(255,255,255,.4)",fontFamily:"'Outfit',sans-serif"}}>06:00 — 14:00</span></div>
                </div>
              </motion.div>

              {/* Mission banner */}
              <div className="px-5"><MissionNotificationBanner employeeId="EMP-001" onOpen={()=>onMissionTracker?.()}/></div>

              {/* SOS Button */}
              <SOSButton onSOSTrigger={onSOSTrigger}/>

              {/* Attendance */}
              {hybridMode&&onDuty&&nearZone&&!attended&&(
                <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="mx-5 mb-4 p-4" style={{borderRadius:18,background:"rgba(0,200,83,.06)",border:"1px solid rgba(0,200,83,.2)"}}>
                  <div className="flex items-center justify-between" style={{direction:"rtl"}}>
                    <div>
                      <p style={{fontSize:14,fontWeight:700,color:"#00C853"}}>{isAr ? `أنت قريب من ${userZone}` : `Near ${userZone}`}</p>
                      <p style={{fontSize:11,color:"rgba(255,255,255,.35)",marginTop:2}}>{isAr ? "سجّل حضورك الآن" : "Register attendance now"}</p>
                    </div>
                    <motion.button whileTap={{scale:.96}} onClick={handleAttend} style={{paddingInline:18,height:38,borderRadius:12,background:"rgba(0,200,83,.15)",border:"1px solid rgba(0,200,83,.3)",fontSize:13,fontWeight:700,color:"#00C853",flexShrink:0}}>
                      {isAr ? "تسجيل" : "Check In"}
                    </motion.button>
                  </div>
                  <AnimatePresence>{showAttendConfirm&&<motion.p initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} style={{fontSize:11,color:"#00C853",marginTop:6,textAlign:"right"}}>{isAr ? "✓ تم تسجيل الحضور بنجاح" : "✓ Attendance registered"}</motion.p>}</AnimatePresence>
                </motion.div>
              )}

              {/* Quick actions */}
              <div className="flex gap-3 px-5 mb-4">
                {visibleActions.map((action,i)=>(
                  <motion.button key={action.labelAr} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:.3+i*.07}} whileTap={{scale:.93}} onClick={()=>action.action?.()} className="flex-1 flex flex-col items-center gap-2 py-4" style={{borderRadius:18,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
                    <div style={{width:38,height:38,borderRadius:12,background:`${action.color}0D`,border:`1px solid ${action.color}18`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <action.icon size={17} color={action.color}/>
                    </div>
                    <span style={{fontSize:11,color:"rgba(255,255,255,.5)",fontWeight:600}}>{action.labelAr}</span>
                  </motion.button>
                ))}
              </div>

              {/* Safety actions */}
              <div className="px-5">
                <p style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.25)",letterSpacing:"1.5px",marginBottom:12,direction:"rtl"}}>خدمات الطوارئ</p>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    { icon:Timer, labelAr: isAr ? "مؤقت تسجيل الحضور" : "Check-in Timer", color:"#FF9500", action:onCheckinTimer, badge:timerActive?(isAr?"نشط":"Active"):null },
                    { icon:Heart, labelAr: isAr ? "معرّف الطوارئ الطبية" : "Medical ID", color:"#FF2D55", action:onMedicalID },
                    { icon:Navigation, labelAr: isAr ? "وضع المشي الآمن" : "Safe Walk", color:"#00C853", action:onSafeWalk },
                    { icon:Package, labelAr: isAr ? "حزمة الطوارئ" : "Emergency Packet", color:"#7B5EFF", action:onEmergencyPacket },
                    { icon:FileText, labelAr: isAr ? "سجل الحوادث" : "Incident History", color:"#00C8E0", action:onIncidentHistory },
                  ].map(({ icon: Icon, labelAr, color, action, badge }) => (
                    <motion.button key={labelAr} whileTap={{scale:.98}} onClick={action} className="w-full flex items-center gap-3" style={{padding:"13px 16px",borderRadius:16,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",direction:"rtl"}}>
                      <div style={{width:38,height:38,borderRadius:12,background:`${color}10`,border:`1px solid ${color}20`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon size={17} color={color}/></div>
                      <span className="flex-1" style={{fontSize:14,fontWeight:600,color:"rgba(255,255,255,.75)",textAlign:"right"}}>{labelAr}</span>
                      {badge&&<span style={{fontSize:10,fontWeight:700,color:color,padding:"2px 8px",borderRadius:999,background:`${color}15`,border:`1px solid ${color}25`}}>{badge}</span>}
                      <ChevronRight size={15} color="rgba(255,255,255,.2)"/>
                    </motion.button>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab==="alerts" && (
            <div className="px-5 pt-2">
              <div className="flex items-center justify-between mb-5" style={{direction:"rtl"}}>
                <h2 style={{fontSize:"clamp(18px,5vw,22px)",fontWeight:800,color:"#fff"}}>{isAr ? "التنبيهات" : "Alerts"}</h2>
                {unreadCount>0&&<span style={{fontSize:11,fontWeight:700,color:"#FF2D55",padding:"3px 10px",borderRadius:999,background:"rgba(255,45,85,.1)",border:"1px solid rgba(255,45,85,.2)"}}>{unreadCount} جديد</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {alerts.map(alert=>(
                  <motion.button key={alert.id} whileTap={{scale:.98}} onClick={()=>setSelectedAlert(alert.id)} className="w-full text-right" style={{padding:"14px 16px",borderRadius:18,background:alert.read?"rgba(255,255,255,.02)":"rgba(255,255,255,.04)",border:`1px solid ${alert.read?"rgba(255,255,255,.06)":alert.color+"28"}`,position:"relative",overflow:"hidden",direction:"rtl"}}>
                    {!alert.read&&<div className="absolute" style={{top:0,right:0,width:3,height:"100%",background:alert.color,borderRadius:"0 18px 18px 0"}}/>}
                    <div className="flex items-start gap-3">
                      <div style={{width:40,height:40,borderRadius:12,background:`${alert.iconColor}12`,border:`1px solid ${alert.iconColor}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <alert.icon size={17} color={alert.iconColor}/>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p style={{fontSize:14,fontWeight:alert.read?600:700,color:alert.read?"rgba(255,255,255,.65)":"#fff",flex:1}}>{alert.title}</p>
                          <span style={{fontSize:10,color:"rgba(255,255,255,.25)",flexShrink:0,fontFamily:"'Outfit',sans-serif"}}>{alert.time}</span>
                        </div>
                        <p style={{fontSize:12,color:"rgba(255,255,255,.35)",lineHeight:1.5}}>{alert.subtitle}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span style={{fontSize:10,fontWeight:700,color:alert.severityColor,padding:"2px 8px",borderRadius:999,background:`${alert.severityColor}12`,border:`1px solid ${alert.severityColor}22`}}>{alert.severity}</span>
                          <span style={{fontSize:10,color:"rgba(255,255,255,.25)"}}>{alert.zone}</span>
                        </div>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {activeTab==="map" && (
            <div className="px-5 pt-2 flex flex-col items-center">
              <h2 style={{fontSize:"clamp(18px,5vw,22px)",fontWeight:800,color:"#fff",marginBottom:16,width:"100%"}}>{isAr ? "خريطة المناطق" : "Zone Map"}</h2>
              <div style={{width:"100%",borderRadius:20,background:"rgba(0,200,224,.04)",border:"1px solid rgba(0,200,224,.12)",padding:40,display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                <Map size={44} color="rgba(0,200,224,.4)"/>
                <p style={{fontSize:14,color:"rgba(255,255,255,.35)",textAlign:"center",fontFamily:"'Tajawal',sans-serif"}}>الخريطة التفاعلية ستكون متاحة قريباً</p>
              </div>
            </div>
          )}

          {activeTab==="profile" && (
            <div className="px-5 pt-2">
              <h2 style={{fontSize:"clamp(18px,5vw,22px)",fontWeight:800,color:"#fff",marginBottom:16}}>{isAr ? "الملف الشخصي" : "Profile"}</h2>
              <div className="flex flex-col items-center mb-6">
                <div style={{width:72,height:72,borderRadius:22,overflow:"hidden",border:"2px solid rgba(0,200,224,.2)",marginBottom:12}}>
                  <ImageWithFallback src={avatarUrl} alt={userName} className="w-full h-full object-cover"/>
                </div>
                <p style={{fontSize:18,fontWeight:700,color:"#fff",...S}}>{userName}</p>
                <p style={{fontSize:13,color:"rgba(255,255,255,.35)",marginTop:4,...S}}>{companyName} · {userZone}</p>
              </div>
              <motion.button whileTap={{scale:.97}} onClick={onLogout} className="w-full flex items-center justify-center gap-2" style={{height:50,borderRadius:16,background:"rgba(255,45,85,.08)",border:"1px solid rgba(255,45,85,.18)",color:"#FF2D55",fontSize:14,fontWeight:700,...S}}>
                <LogOut size={16}/>{isAr ? "تسجيل الخروج" : "Sign Out"}
              </motion.button>
            </div>
          )}

          <div style={{height:"max(80px,env(safe-area-inset-bottom))"}}/>
        </div>
      </div>

      {/* Alert detail sheet */}
      <AnimatePresence>
        {activeAlert&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 z-40" style={{background:"rgba(0,0,0,.75)",backdropFilter:"blur(8px)"}} onClick={()=>setSelectedAlert(null)}>
            <motion.div initial={{y:"100%"}} animate={{y:0}} exit={{y:"100%"}} transition={{type:"spring",stiffness:380,damping:36}} onClick={e=>e.stopPropagation()} className="absolute bottom-0 left-0 right-0" style={{borderRadius:"24px 24px 0 0",background:"rgba(8,14,28,.98)",border:"1px solid rgba(255,255,255,.08)",padding:24,paddingBottom:"max(32px,env(safe-area-inset-bottom))"}}>
              <div className="flex items-center justify-between mb-5" style={{direction:"rtl"}}>
                <div className="flex items-center gap-3">
                  <div style={{width:42,height:42,borderRadius:13,background:`${activeAlert.iconColor}12`,border:`1px solid ${activeAlert.iconColor}22`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <activeAlert.icon size={18} color={activeAlert.iconColor}/>
                  </div>
                  <div>
                    <p style={{fontSize:15,fontWeight:700,color:"#fff",...S}}>{activeAlert.title}</p>
                    <p style={{fontSize:11,color:"rgba(255,255,255,.3)",...S}}>{activeAlert.zone} · {activeAlert.time}</p>
                  </div>
                </div>
                <button onClick={()=>setSelectedAlert(null)} style={{width:32,height:32,borderRadius:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"center"}}><X size={14} color="rgba(255,255,255,.5)"/></button>
              </div>
              <p style={{fontSize:14,color:"rgba(255,255,255,.6)",lineHeight:1.8,marginBottom:20,...S}}>{activeAlert.desc}</p>
              <motion.button whileTap={{scale:.97}} onClick={()=>markAsRead(activeAlert.id)} style={{width:"100%",height:50,borderRadius:14,background:`linear-gradient(135deg,${activeAlert.color},${activeAlert.color}CC)`,color:"#fff",fontSize:14,fontWeight:700,...S}}>
                تم الفهم
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{paddingBottom:"max(16px,env(safe-area-inset-bottom))"}}>
        <div className="mx-4 flex items-center justify-around py-2" style={{borderRadius:22,background:"rgba(6,10,22,.95)",border:"1px solid rgba(255,255,255,.07)",backdropFilter:"blur(24px)"}}>
          {TABS.map(({id,icon:Icon,labelAr,badge})=>(
            <button key={id} onClick={()=>setActiveTab(id)} className="flex-1 flex flex-col items-center gap-1 py-2 relative touch-target" style={{minHeight:52}}>
              {badge&&badge>0&&<span className="absolute" style={{top:4,right:"50%",transform:"translateX(12px)",width:16,height:16,borderRadius:"50%",background:"#FF2D55",fontSize:9,fontWeight:700,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Outfit',sans-serif"}}>{badge}</span>}
              <Icon size={20} color={activeTab===id?"#00C8E0":"rgba(255,255,255,.3)"}/>
              <span style={{fontSize:10,fontWeight:activeTab===id?700:500,color:activeTab===id?"#00C8E0":"rgba(255,255,255,.3)",...S}}>{labelAr}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
