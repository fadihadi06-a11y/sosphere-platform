// =============================================================
//  SOSphere – Drone Agent (وكيل الدرون)
//  وكيل واحد يعمل بمصدرين قابلين للتبديل:
//    - SimulatedDroneSource : يحاكي الطيران (للتطوير والعرض)
//    - MavlinkDroneSource   : الدرون الحقيقي عبر MAVLink (مُهيّأ كهيكل)
//
//  الجوهر: المنصة لا تعرف أيّهما يعمل. الوكيل يراقب جدول missions،
//  وعند الموافقة يطير إلى الهدف ويكتب telemetry. التبديل من محاكٍ إلى
//  حقيقي = تغيير سطر واحد (DRONE_SOURCE)، بلا أي تعديل على المنصة.
//
//  التشغيل:
//    npm i @supabase/supabase-js
//    SUPABASE_URL=https://rtfhkbskgrasamhjraul.supabase.co \
//    SUPABASE_SERVICE_KEY=... DRONE_ID=... node drone-agent.mjs
// =============================================================

import { createClient } from '@supabase/supabase-js';

// ---------- الإعدادات (من متغيرات البيئة) ----------
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY; // مفتاح الخدمة — للوكيل فقط، لا يوضع في الواجهة
const DRONE_ID      = process.env.DRONE_ID;             // معرّف الدرون من جدول drones
const DRONE_SOURCE  = process.env.DRONE_SOURCE || 'simulator'; // 'simulator' | 'mavlink'

if (!SUPABASE_URL || !SERVICE_KEY || !DRONE_ID) {
  console.error('مفقود: SUPABASE_URL أو SUPABASE_SERVICE_KEY أو DRONE_ID');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// =============================================================
//  العقد الموحّد: كل مصدر درون يطبّق هذه الواجهة فقط.
//  المنطق العام (مراقبة المهام + كتابة telemetry) لا يتغيّر أبداً.
// =============================================================
//  source.connect()                 -> يهيّئ الاتصال ويعيد آخر موقع
//  source.flyTo(target, onTick)     -> يطير للهدف، يستدعي onTick(state) كل ثانية
//                                       state = { lat, lng, altitude, battery, heading, speed, status }
// =============================================================

// ---------- المصدر (1): المُحاكي ----------
class SimulatedDroneSource {
  constructor() {
    // موقع انطلاق افتراضي (بغداد) — استبدله بموقع قاعدة الدرون
    this.pos = { lat: 33.3152, lng: 44.3661, altitude: 0, battery: 100, heading: 0 };
  }

  async connect() {
    return { lat: this.pos.lat, lng: this.pos.lng, battery: this.pos.battery };
  }

  // يطير خطّياً من الموقع الحالي إلى الهدف، خطوة كل ثانية
  async flyTo(target, onTick) {
    const start = { ...this.pos };
    const distM = haversine(start.lat, start.lng, target.lat, target.lng);
    const speed = 15;                                  // م/ث (سرعة طيران واقعية)
    const steps = Math.max(5, Math.ceil(distM / speed)); // عدد الثواني للوصول
    const cruiseAlt = 60;                              // متر — ارتفاع آمن فوق المباني
    this.pos.heading = bearing(start.lat, start.lng, target.lat, target.lng);

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;                             // النسبة المقطوعة 0..1
      this.pos.lat = lerp(start.lat, target.lat, f);
      this.pos.lng = lerp(start.lng, target.lng, f);
      this.pos.altitude = i < 3 ? cruiseAlt * (i / 3)  // إقلاع تدريجي
                         : f > 0.9 ? cruiseAlt * (1 - (f - 0.9) * 5) // هبوط عند الهدف
                         : cruiseAlt;
      this.pos.battery = Math.max(0, this.pos.battery - 0.4); // استهلاك تقريبي
      const status = i < 3 ? 'takeoff' : f >= 1 ? 'onsite' : 'enroute';

      await onTick({ ...this.pos, speed, status });
      await sleep(1000);                               // محاكاة الزمن الحقيقي
    }
  }
}

// ---------- المصدر (2): الدرون الحقيقي (هيكل جاهز للتعبئة) ----------
// عند الحصول على درون وموافقة، عبّئ هذه الفئة بمكتبة MAVLink (مثل node-mavlink)
// واترك بقية الملف كما هو. المنصة لن تشعر بأي فرق.
class MavlinkDroneSource {
  async connect() {
    // TODO: افتح اتصال MAVLink (UDP/Serial)، اقرأ GLOBAL_POSITION_INT
    throw new Error('MAVLink غير مُفعّل بعد — استخدم DRONE_SOURCE=simulator حالياً');
  }
  async flyTo(target, onTick) {
    // TODO: أرسل أمر MAVLink (مثل MAV_CMD_NAV_WAYPOINT) ثم بثّ telemetry
    //       الحقيقي عبر onTick بنفس الشكل تماماً الذي يستخدمه المحاكي.
  }
}

const source = DRONE_SOURCE === 'mavlink'
  ? new MavlinkDroneSource()
  : new SimulatedDroneSource();

// =============================================================
//  المنطق العام (مشترك بين المحاكي والحقيقي — لا يتغيّر عند التبديل)
// =============================================================

async function writeTelemetry(missionId, s) {
  await db.from('drone_telemetry').insert({
    drone_id: DRONE_ID, mission_id: missionId,
    lat: s.lat, lng: s.lng, altitude: s.altitude,
    battery: Math.round(s.battery), heading: s.heading,
    speed: s.speed, status: s.status,
  });
  // نحدّث آخر موقع للدرون أيضاً (ليظهر "متصل" على الخريطة)
  await db.from('drones').update({
    last_lat: s.lat, last_lng: s.lng, battery: Math.round(s.battery),
    last_seen_at: new Date().toISOString(),
  }).eq('id', DRONE_ID);
}

// تنفيذ مهمة وافق عليها المشغّل
async function runMission(mission) {
  console.log(`▶ بدء المهمة ${mission.id} نحو (${mission.target_lat}, ${mission.target_lng})`);
  await db.from('drones').update({ status: 'busy' }).eq('id', DRONE_ID);
  await db.from('drone_missions').update({ status: 'enroute' }).eq('id', mission.id);

  await source.flyTo(
    { lat: mission.target_lat, lng: mission.target_lng },
    (state) => writeTelemetry(mission.id, state)   // كل ثانية أثناء الطيران
  );

  // وصل الدرون إلى الموقع
  await db.from('drone_missions').update({ status: 'onsite' }).eq('id', mission.id);
  await db.from('drones').update({ status: 'online' }).eq('id', DRONE_ID);
  console.log(`✔ وصل الدرون للموقع — المهمة ${mission.id} الآن onsite`);
}

// مراقبة الموافقات لحظياً عبر Realtime
function watchApprovedMissions() {
  db.channel('drone-agent')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'drone_missions',
        filter: `drone_id=eq.${DRONE_ID}` },
      (payload) => {
        const m = payload.new;
        if (m.status === 'approved') runMission(m).catch(console.error);
      })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('🛰  الوكيل يراقب الموافقات...');
    });
}

// نبضة "متصل" عندما يكون الدرون خاملاً
async function heartbeat() {
  const last = await source.connect().catch(() => null);
  if (!last) return;
  await db.from('drones').update({
    status: 'online', battery: Math.round(last.battery ?? 100),
    last_lat: last.lat, last_lng: last.lng,
    last_seen_at: new Date().toISOString(),
  }).eq('id', DRONE_ID);
}

// ---------- الأدوات الرياضية ----------
const lerp  = (a, b, f) => a + (b - a) * f;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversine(la1, lo1, la2, lo2) {       // المسافة بالمتر بين إحداثيتين
  const R = 6371000;
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 +
            Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearing(la1, lo1, la2, lo2) {          // الاتجاه بالدرجات
  const y = Math.sin(toRad(lo2 - lo1)) * Math.cos(toRad(la2));
  const x = Math.cos(toRad(la1)) * Math.sin(toRad(la2)) -
            Math.sin(toRad(la1)) * Math.cos(toRad(la2)) * Math.cos(toRad(lo2 - lo1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ---------- الإقلاع ----------
(async () => {
  await heartbeat();
  setInterval(heartbeat, 15000);   // كل 15 ثانية يبقى "متصلاً"
  watchApprovedMissions();
  console.log(`الوكيل يعمل | المصدر: ${DRONE_SOURCE} | الدرون: ${DRONE_ID}`);
})();
