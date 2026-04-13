package com.sosphere.app;

import android.Manifest;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telephony.TelephonyManager;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

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

        // Request ALL permissions at app startup (location + phone call + read phone state)
        String[] neededPerms = new String[]{
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE
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
             * Forces the call through the native phone dialer ONLY (not WhatsApp/Zoom/etc).
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

                    runOnUiThread(() -> {
                        try {
                            Intent callIntent = new Intent(Intent.ACTION_CALL);
                            callIntent.setData(Uri.parse("tel:" + cleaned));
                            // KEY: Use FLAG_ACTIVITY_NEW_TASK and set the default dialer package
                            callIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                            // Try to resolve to the default phone dialer only
                            android.content.pm.ResolveInfo defaultDialer = getPackageManager().resolveActivity(
                                new Intent(Intent.ACTION_DIAL).setData(Uri.parse("tel:123")),
                                android.content.pm.PackageManager.MATCH_DEFAULT_ONLY
                            );
                            if (defaultDialer != null && defaultDialer.activityInfo != null) {
                                callIntent.setPackage(defaultDialer.activityInfo.packageName);
                            }

                            startActivity(callIntent);
                        } catch (Exception e) {
                            // Fallback: try without package restriction
                            try {
                                Intent fallback = new Intent(Intent.ACTION_CALL);
                                fallback.setData(Uri.parse("tel:" + cleaned));
                                fallback.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(fallback);
                            } catch (Exception e2) {
                                e2.printStackTrace();
                            }
                        }
                    });
                    return true;
                } catch (Exception e) {
                    e.printStackTrace();
                    return false;
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

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && isEmergencyActive) {
            enterImmersiveMode();
        }
    }
}
