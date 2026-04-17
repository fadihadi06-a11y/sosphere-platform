# O-C3: production-ready ProGuard rules for SOSphere
# Keep source line numbers for Sentry stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep Capacitor reflection surface
-keep public class com.getcapacitor.** { public *; }
-keep public class com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.PluginHandle { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }

# Keep Capacitor plugins used by this app
-keep public class com.codetrixstudio.capacitor.GoogleAuth.** { public *; }
-keep public class com.getcapacitor.community.** { public *; }
-keep public class capacitor.plugin.** { public *; }

# Keep WebView JS bridge callbacks
-keepclassmembers class * {
  @android.webkit.JavascriptInterface <methods>;
}

# Keep callback interfaces (reflection)
-keep interface * { *; }

# Twilio Voice SDK safety
-keep class com.twilio.voice.** { *; }
-keep class com.twilio.audioswitch.** { *; }

# Gson/JSON reflection (if used transitively)
-keep class com.google.gson.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Suppress noisy warnings from optional deps
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
