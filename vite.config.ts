import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "client"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Bump the warning threshold but also split big libs into their own vendor
    // chunks so the initial JS payload is dominated by app code, not deps.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](recharts|d3-[^/\\]+|victory-vendor)[\\/]/.test(id)) return "vendor-recharts";
          if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return "vendor-markdown";
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return "vendor-radix";
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "vendor-tanstack";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
