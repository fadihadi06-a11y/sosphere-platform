import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: ["@capacitor/app", "@twilio/voice-sdk"],
      output: {
        globals: {
          "@capacitor/app": "CapacitorApp",
          "@twilio/voice-sdk": "TwilioVoice",
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
