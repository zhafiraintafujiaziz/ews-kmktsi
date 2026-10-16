import { defineConfig, loadEnv, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin";
import proxyHandler from "./api/proxy.mjs";
import { createHandler, type Resource } from "./server/handlers.ts";
import { createIspuHandler } from "./server/ispuHandler.ts";
import { createIspuHistoryHandler } from "./server/ispuHistoryHandler.ts";
import { createFeedHandler } from "./server/feedHandler.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

function mountDatabaseRoutes(middlewares: { use: (route: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void }) {
  const feedHandler = createFeedHandler();
  middlewares.use('/api/feeds', (req, res) => { void feedHandler(req, res); });
  const historyHandler = createIspuHistoryHandler();
  middlewares.use('/api/ispu-history', (req, res) => { void historyHandler(req, res); });
  const ispuHandler = createIspuHandler();
  middlewares.use('/api/cron/ispu', (req, res) => { void ispuHandler(req, res); });
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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const dataMode = process.env.VITE_DATA_MODE || env.VITE_DATA_MODE || (process.env.VERCEL ? 'browser' : 'local');
  if (!['browser', 'local'].includes(dataMode)) throw new Error('VITE_DATA_MODE must be browser or local');
  return {
    define: { '__EWS_DATA_MODE__': JSON.stringify(dataMode) },
    plugins: [react(), powerApps(), tailwindcss(), localProxyPlugin()],
    optimizeDeps: {
      include: ['html2canvas-pro'],
    },
  };
});

