import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // -- Performance: target modern browsers for smaller output --
    target: "es2020",
    // -- Chunk splitting strategy --
    // R-69 (MOBILE_AUDIT_FINDINGS, 2026-05-19): finer-grained vendor splits
    // so a change to one library does not bust the cache of all others.
    // Sizes from the 2026-05-19 production build are noted next to each
    // chunk for reference - if any vendor chunk passes 200 KB we revisit.
    rollupOptions: {
      output: {
        manualChunks: {
          // React core (~96 KB raw / ~33 KB gz)
          "vendor-react": ["react", "react-dom", "react-router"],
          // Motion animations (~127 KB raw / ~42 KB gz) - used on every
          // screen transition, worth caching independently.
          "vendor-motion": ["motion/react"],
          // R-69: lucide-react was previously bundled with sonner in
          // vendor-ui (~260 KB raw). Split them so a sonner update
          // does not invalidate every icon either way.
          "vendor-icons": ["lucide-react"],
          "vendor-sonner": ["sonner"],
          // Supabase JS client (~194 KB raw / ~51 KB gz)
          "vendor-supabase": ["@supabase/supabase-js"],
          // R-69: explicitly group Capacitor plugins so a single plugin
          // upgrade only invalidates this chunk, not the app shell.
          "vendor-capacitor": [
            "@capacitor/core",
            "@capacitor/app",
            "@capacitor/camera",
            "@capacitor/device",
            "@capacitor/geolocation",
            "@capacitor/haptics",
            "@capacitor/network",
            "@capacitor/push-notifications",
            "@capacitor/status-bar",
          ],
        },
      },
    },
    // -- Warning threshold --
    chunkSizeWarningLimit: 600,
    // -- Minification --
    minify: "esbuild",
    // -- CSS code splitting --
    cssCodeSplit: true,
    // O-H6: hidden source maps for Sentry upload, not shipped to browsers
    sourcemap: "hidden",
  },
});
