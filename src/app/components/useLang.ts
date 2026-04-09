// SOSphere — Central Language Hook
// Reads sosphere_lang from localStorage (set by welcome-onboarding.tsx)
// Returns { lang, isAr } — use in any component

export function useLang(): { lang: "ar" | "en"; isAr: boolean } {
  try {
    const saved = localStorage.getItem("sosphere_lang");
    const lang = (saved === "en" ? "en" : "ar") as "ar" | "en";
    return { lang, isAr: lang === "ar" };
  } catch {
    return { lang: "ar", isAr: true };
  }
}
