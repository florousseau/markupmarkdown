import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4720,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4721",
        changeOrigin: true,
      },
      // MCP server (agents, and the reply-suggestions E2E spec).
      "/mcp": {
        target: "http://localhost:4721",
        changeOrigin: true,
      },
    },
  },
});
