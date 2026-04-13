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
    // ── Performance: Target modern browsers for smaller output ──
    target: "es2020",
    // ── Chunk splitting strategy ──
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor: heavy libraries in separate cacheable chunks
          "vendor-react": ["react", "react-dom", "react-router"],
          "vendor-motion": ["motion/react"],
          "vendor-ui": ["lucide-react", "sonner"],
          // Supabase in its own chunk (loaded async)
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
    // ── Increase warning threshold (we'll optimize further) ──
    chunkSizeWarningLimit: 600,
    // ── Minification ──
    minify: "esbuild",
    // ── CSS code splitting ──
    cssCodeSplit: true,
    // ── Source maps off in production for smaller bundles ──
    sourcemap: false,
  },
});
