import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin";
import proxyHandler from "./api/proxy.mjs";
import { createHandler, type Resource } from "./server/handlers.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

function mountDatabaseRoutes(middlewares: { use: (route: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void }) {
  for (const resource of ['reports', 'checklist', 'alerts', 'import', 'alert-cache'] as const satisfies readonly Resource[]) {
    const handler = createHandler(resource);
    middlewares.use(`/api/${resource}`, (req, res) => { void handler(req, res); });
  }
}

function localProxyPlugin(): Plugin {
  return {
    name: "local-api-proxy",
    configureServer(server) {
      mountDatabaseRoutes(server.middlewares);
      server.middlewares.use("/api/proxy", (req, res) => {
        proxyHandler(req, res);
      });
    },
    configurePreviewServer(server) {
      mountDatabaseRoutes(server.middlewares);
      server.middlewares.use("/api/proxy", (req, res) => {
        proxyHandler(req, res);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), powerApps(), tailwindcss(), localProxyPlugin()],
  optimizeDeps: {
    include: ['html2canvas-pro'],
  },
});

