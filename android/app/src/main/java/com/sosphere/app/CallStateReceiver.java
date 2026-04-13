package com.sosphere.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;
import android.util.Log;

public class CallStateReceiver extends BroadcastReceiver {

    private static final String TAG = "SOSphere.CallState";
    private static String lastState = "IDLE";
    private static boolean callAnswered = false;
    private static MainActivity activityRef = null;

    public static void setActivity(MainActivity activity) {
        activityRef = activity;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;

        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (state == null) return;

        Log.d(TAG, "Phone state: " + lastState + " -> " + state);

        if (state.equals(TelephonyManager.EXTRA_STATE_OFFHOOK)) {
            if (lastState.equals("IDLE") || lastState.equals("RINGING")) {
                callAnswered = true;
                Log.d(TAG, "Call ANSWERED");
                notifyWebView("answered");
            }
        } else if (state.equals(TelephonyManager.EXTRA_STATE_IDLE)) {
            if (callAnswered) {
                Log.d(TAG, "Call ENDED (was answered)");
                notifyWebView("ended");
                callAnswered = false;
            } else if (lastState.equals("OFFHOOK")) {
                Log.d(TAG, "Call ENDED (no answer)");
                notifyWebView("no_answer");
            }
        }

        lastState = state;
    }

    private void notifyWebView(String callState) {
        if (activityRef == null) return;
        activityRef.runOnUiThread(() -> {
            try {
                activityRef.getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('sosphere-call-state',{detail:{state:'" + callState + "'}}))",
                    null
                );
                Log.d(TAG, "Notified WebView: " + callState);
            } catch (Exception e) {
                Log.e(TAG, "Failed to notify WebView", e);
            }
        });
    }

    public static void reset() {
  