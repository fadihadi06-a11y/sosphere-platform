import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sosphere.app',
  appName: 'SOSphere',
  webDir: 'dist',
  server: {
    // ─── STANDALONE MODE (default) ───────────────────────────
    // App loads from bundled assets inside the APK.
    // This is what you want for testing without a PC connection.
    androidScheme: 'https',

    // ─── DEV MODE (uncomment for live reload during development) ──
    // Replace with your PC's local IP. Find it with: ipconfig (Windows) or ifconfig (Mac/Linux)
    // url: 'http://192.168.1.XXX:5173',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      signingType: 'apksigner',
    },
    // Allow mixed content for development (Supabase uses HTTPS, local dev uses HTTP)
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#05070E',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
