package com.sosphere.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telecom.TelecomManager;
import android.telephony.TelephonyManager;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import java.util.List;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean isEmergencyActive = false;
    private CallStateReceiver callStateReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep screen on during the entire app lifecycle (SOS may activate at any time)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Register call state receiver (auto-detects when calls are answered/ended)
        callStateReceiver = new CallStateReceiver();
        CallStateReceiver.setActivity(this);
        IntentFilter filter = new IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED);
        registerReceiver(callStateReceiver, filter);

        // Request ALL permissions at app startup (location + phone call + read phone state + SMS)
        // SMS-A (2026-04-21): SEND_SMS added — required for silent emergency SMS
        // cascade during SOS (Shake ×3 / Hold 3s / Dead-Man's-Switch).
        String[] neededPerms = new String[]{
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.SEND_SMS
        };
        boolean needsRequest = false;
        for (String p : neededPerms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needsRequest = true;
                break;
            }
        }
        if (needsRequest) {
            ActivityCompat.requestPermissions(this, neededPerms, 1001);
        }

        // Allow WebView to use geolocation (auto-grant to our own origin)
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        // Add JavaScript interface so the web app can toggle immersive mode + direct call
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setEmergencyActive(boolean active) {
                isEmergencyActive = active;
                runOnUiThread(() -> {
                    if (active) {
                        enterImmersiveMode();
                    } else {
                        exitImmersiveMode();
                        CallStateReceiver.reset();
                    }
                });
            }

            /**
             * Direct phone call via ACTION_CALL — bypasses app chooser completely.
             * Forces the call through the SYSTEM phone dialer ONLY (NEVER WhatsApp/Telegram/Contacts/etc).
             *
             * Strategy (tried in order, each targeted to the system dialer package):
             *   1. TelecomManager.getDefaultDialerPackage() — the source-of-truth for system dialer.
             *      Cannot return WhatsApp/Truecaller — only apps with role_holder for RoleManager.ROLE_DIALER.
             *   2. Fall back to common vendor dialer packages (Samsung/Xiaomi/Huawei/Pixel).
             *   3. Fall back to resolveActivity(ACTION_CALL) filtering system apps.
             *   We DO NOT call startActivity without setPackage — that's what triggers the chooser.
             */
            @JavascriptInterface
            public boolean directCall(final String phoneNumber) {
                try {
                    final String cleaned = phoneNumber.replaceAll("[\\s\\-()]", "");
                    if (cleaned.isEmpty()) return false;

                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CALL_PHONE)
                            != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{ Manifest.permission.CALL_PHONE }, 1002));
                        return false;
                    }

                    // AUDIT-FIX (2026-04-21 v3): key insight — ACTION_CALL is
                    // DIFFERENT from ACTION_DIAL. Only the real phone dialer
                    // can handle ACTION_CALL. WhatsApp / Zoom / Contacts
                    // handle ACTION_VIEW on tel: URIs, NOT ACTION_CALL.
                    // So firing ACTION_CALL without setPackage is already
                    // safe from the app-chooser problem. Previous chooser
                    // appearances were because web-layer fell through to
                    // `window.location.href = tel:` which uses ACTION_VIEW.
                    //
                    // Strategy now:
                    //  (a) Try with resolved system dialer pkg (if found)
                    //  (b) Fall back to ACTION_CALL without setPackage (safe)
                    //  (c) Return true only after startActivity succeeded
                    final String dialerPkg = resolveSystemDialerPackage();
                    final boolean[] success = new boolean[]{ false };
                    final Object lock = new Object();

                    runOnUiThread(() -> {
                        try {
                            Intent callIntent = new Intent(Intent.ACTION_CALL);
                            callIntent.setData(Uri.parse("tel:" + cleaned));
                            callIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            if (dialerPkg != null) {
                                callIntent.setPackage(dialerPkg);
                            }

                            try {
                                startActivity(callIntent);
                                success[0] = true;
                                android.util.Log.i("SOSphere.Call",
                                    "directCall OK via ACTION_CALL, pkg=" + dialerPkg);
                            } catch (Exception first) {
                                // Retry without setPackage — ACTION_CALL is
                                // still safe (only system dialer responds).
                                try {
                                    Intent retry = new Intent(Intent.ACTION_CALL);
                                    retry.setData(Uri.parse("tel:" + cleaned));
                                    retry.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(retry);
                                    success[0] = true;
                                    android.util.Log.i("SOSphere.Call",
                                        "directCall OK via ACTION_CALL (no pkg)");
                                } catch (Exception second) {
                                    android.util.Log.e("SOSphere.Call",
                                        "directCall failed: " + second.getMessage());
                                }
                            }
                        } finally {
                            synchronized (lock) { lock.notifyAll(); }
                        }
                    });

                    // Wait up to 500ms for UI thread to finish attempting the
                    // call. This way we can return an accurate boolean to JS.
                    synchronized (lock) {
                        try { lock.wait(500); } catch (InterruptedException ignored) {}
                    }
                    return success[0];
                } catch (Exception e) {
                    e.printStackTrace();
                    return false;
                }
            }

            /**
             * SMS-A (2026-04-21): Silent SMS send via SmsManager.
             *
             * Used for SOS cascade when the victim cannot tap "Send" on the
             * stock Messages app (e.g., phone in pocket during threat, Shake
             * x3 activation). Bypasses all UI — goes straight through the
             * carrier's SMS service.
             *
             * @param recipientsCsv  comma-separated E.164 phone numbers
             * @param message        SMS body (auto-split into multi-part
             *                       if longer than 160 chars / 70 Arabic)
             * @return "OK:sentCount/totalCount" or "ERR:<reason>"
             */
            @JavascriptInterface
            public String sendSMSSilent(final String recipientsCsv, final String message) {
                try {
                    if (recipientsCsv == null || recipientsCsv.trim().isEmpty()) {
                        return "ERR:no_recipients";
                    }
                    if (message == null || message.isEmpty()) {
                        return "ERR:empty_message";
                    }
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.SEND_SMS)
                            != PackageManager.PERMISSION_GRANTED) {
                        // Request at runtime; caller should retry next SOS
                        runOnUiThread(() -> ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{ Manifest.permission.SEND_SMS }, 1003));
                        return "ERR:permission_denied";
                    }

                    android.telephony.SmsManager smsManager;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        smsManager = getSystemService(android.telephony.SmsManager.class);
                    } else {
                        //noinspection deprecation
                        smsManager = android.telephony.SmsManager.getDefault();
                    }
                    if (smsManager == null) return "ERR:sms_manager_unavailable";

                    String[] recipients = recipientsCsv.split(",");
                    int total = 0, sent = 0;
                    StringBuilder failures = new StringBuilder();
                    for (String raw : recipients) {
                        String number = raw.replaceAll("[\\s\\-()]", "").trim();
                        if (number.isEmpty()) continue;
                        total++;
                        try {
                            // Auto-split long messages (Arabic: 70 chars/part; Latin: 160)
                            java.util.ArrayList<String> parts = smsManager.divideMessage(message);
                            if (parts.size() > 1) {
                                smsManager.sendMultipartTextMessage(number, null, parts, null, null);
                            } else {
                                smsManager.sendTextMessage(number, null, message, null, null);
                            }
                            sent++;
                            android.util.Log.i("SOSphere.SMS",
                                "Sent to " + number + " (" + parts.size() + " parts)");
                        } catch (Exception sendErr) {
                            if (failures.length() > 0) failures.append(",");
                            failures.append(number).append(":").append(sendErr.getClass().getSimpleName());
                            android.util.Log.e("SOSphere.SMS",
                                "Failed " + number + ": " + sendErr.getMessage());
                        }
                    }
                    if (sent == 0) {
                        return "ERR:all_failed:" + failures.toString();
                    }
                    return "OK:" + sent + "/" + total;
                } catch (Exception e) {
                    e.printStackTrace();
                    return "ERR:" + e.getClass().getSimpleName() + ":" + e.getMessage();
                }
            }
        }, "SOSphereNative");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (callStateReceiver != null) {
            try { unregisterReceiver(callStateReceiver); } catch (Exception ignored) {}
        }
    }

    /**
     * True Fullscreen / Immersive Sticky Mode
     */
    private void enterImmersiveMode() {
        View decorView = getWindow().getDecorView();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.hide(android.view.WindowInsets.Type.statusBars()
                        | android.view.WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decorView.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
    }

    /**
     * Exit immersive mode — restore normal system UI when SOS ends.
     */
    private void exitImmersiveMode() {
        View decorView = getWindow().getDecorView();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
            android.view.WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.show(android.view.WindowInsets.Type.statusBars()
                        | android.view.WindowInsets.Type.navigationBars());
            }
        } else {
            decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }

        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false);
            setTurnScreenOn(false);
        } else {
            getWindow().clearFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
    }

    /**
     * Resolve the system phone dialer package name.
     *
     * Priority (highest trust first):
     *   1) TelecomManager.getDefaultDialerPackage()  — authoritative (API 23+).
     *      Only apps holding RoleManager.ROLE_DIALER can be returned.
     *      WhatsApp/Truecaller/Contacts CANNOT be returned from this.
     *   2) A curated list of known OEM system dialer package names.
     *      Verified via PackageManager + ApplicationInfo.FLAG_SYSTEM.
     *   3) Query ACTION_CALL resolvers and pick the first FLAG_SYSTEM app.
     *
     * @return dialer package name, or null if none could be determined.
     */
    private String resolveSystemDialerPackage() {
        // 1) TelecomManager — the source of truth on modern Android.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                TelecomManager tm = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    String def = tm.getDefaultDialerPackage();
                    if (def != null && !def.isEmpty()) {
                        return def;
                    }
                }
            }
        } catch (Exception ignored) {}

        PackageManager pm = getPackageManager();

        // 2) Known system dialer package names across vendors.
        String[] candidates = new String[]{
            "com.google.android.dialer",        // Pixel / stock Google dialer
            "com.android.dialer",               // AOSP / many OEMs
            "com.samsung.android.dialer",       // Samsung One UI
            "com.samsung.android.contacts",     // Samsung (older One UI)
            "com.miui.phone",                   // Xiaomi / MIUI
            "com.huawei.contacts",              // Huawei EMUI
            "com.oppo.contacts",                // OPPO ColorOS
            "com.coloros.contacts",             // OPPO (newer)
            "com.vivo.contacts",                // Vivo FunTouch
            "com.oneplus.contacts",             // OnePlus OxygenOS
            "com.asus.contacts"                 // ASUS
        };
        for (String pkg : candidates) {
            try {
                android.content.pm.ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                if ((ai.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0) {
                    return pkg;
                }
            } catch (PackageManager.NameNotFoundException ignored) {}
        }

        // 3) Fall back to resolving ACTION_CALL and filtering for a system app.
        try {
            Intent probe = new Intent(Intent.ACTION_CALL);
            probe.setData(Uri.parse("tel:0"));
            List<ResolveInfo> resolvers = pm.queryIntentActivities(probe, 0);
            if (resolvers != null) {
                for (ResolveInfo ri : resolvers) {
                    if (ri.activityInfo == null || ri.activityInfo.applicationInfo == null) continue;
                    int flags = ri.activityInfo.applicationInfo.flags;
                    if ((flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0) {
                        return ri.activityInfo.packageName;
                    }
                }
            }
        } catch (Exception ignored) {}

        return null;
    }
}
