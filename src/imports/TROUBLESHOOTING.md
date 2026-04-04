# 🔧 دليل استكشاف الأخطاء | Troubleshooting Guide

## ❓ المشكلة: لا أستطيع الدخول للتطبيق

### الحل 1: تفعيل وضع الاختبار

إذا كنت لا ترى أي شيء، افتح ملف `/src/main.tsx` وغيّر:

```typescript
const USE_TEST = false;
```

إلى:

```typescript
const USE_TEST = true;
```

هذا سيعرض شاشة اختبار بسيطة جداً للتأكد من أن التطبيق يعمل.

---

### الحل 2: تحقق من Console

افتح Developer Tools في المتصفح (F12) وتحقق من وجود أخطاء في تبويب Console.

**الأخطاء الشائعة:**
- ❌ Import errors - تأكد من وجود جميع الملفات
- ❌ CSS errors - تأكد من تحميل ملفات CSS
- ❌ React errors - تحقق من بناء المكونات

---

### الحل 3: تحقق من الملفات الأساسية

تأكد من وجود هذه الملفات:

```
✅ /index.html
✅ /src/main.tsx
✅ /src/app/App.tsx
✅ /src/app/AppTest.tsx
✅ /src/styles/index.css
✅ /src/styles/fonts.css
✅ /src/styles/tailwind.css
✅ /src/styles/theme.css
```

---

### الحل 4: تبسيط App.tsx

إذا استمرت المشكلة، استبدل محتوى `/src/app/App.tsx` بهذا الكود البسيط:

```typescript
export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#05070E',
      color: '#FFFFFF',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <h1 style={{ fontSize: '48px' }}>World SOS Works!</h1>
    </div>
  );
}
```

---

### الحل 5: تحقق من البناء

تأكد من أن Vite يعمل بشكل صحيح:

1. تحقق من وجود `node_modules`
2. تحقق من صحة `package.json`
3. حاول إعادة التشغيل

---

## 📋 قائمة التحقق السريعة | Quick Checklist

| الخطوة | Status |
|--------|--------|
| ✅ index.html موجود | Check |
| ✅ main.tsx موجود | Check |
| ✅ App.tsx موجود | Check |
| ✅ CSS files موجودة | Check |
| ✅ لا توجد أخطاء في Console | Check |
| ✅ الشاشة تظهر background داكن | Check |

---

## 🎯 الملفات التي تم إنشاؤها/تحديثها

### ملفات جديدة:
1. ✅ `/index.html` - نقطة الدخول
2. ✅ `/src/main.tsx` - ملف التشغيل
3. ✅ `/src/app/AppTest.tsx` - شاشة اختبار بسيطة

### ملفات محدثة:
1. ✅ `/src/app/App.tsx` - إصلاح minor
2. ✅ `/src/app/screens/HomeScreen.tsx` - إصلاح useRef

---

## 🔍 كيف تعرف أن التطبيق يعمل؟

### إذا كان يعمل بنجاح:
1. ✅ سترى شاشة Splash مع animation
2. ✅ Logo "SOS" في دائرة حمراء
3. ✅ نص بالعربية والإنجليزية
4. ✅ Spinner يدور في الأسفل
5. ✅ بعد 2.5 ثانية ينتقل لشاشة Login

### إذا استخدمت وضع الاختبار (USE_TEST = true):
1. ✅ سترى شاشة داكنة (#05070E)
2. ✅ عنوان كبير "World SOS"
3. ✅ نص بالعربية والإنجليزية
4. ✅ صندوق معلومات في المنتصف

---

## 🆘 ما زالت المشكلة موجودة؟

أخبرني بالضبط ماذا ترى:
- [ ] شاشة بيضاء فارغة
- [ ] شاشة سوداء فارغة  
- [ ] رسالة خطأ (اذكر النص)
- [ ] التطبيق لا يفتح أصلاً
- [ ] شيء آخر (اذكر ماذا ترى)

---

**آخر تحديث:** 2026-02-24  
**الحالة:** جاهز للاختبار
