import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin";
import proxyHandler from "./api/proxy.mjs";

function localProxyPlugin(): Plugin {
  return {
    name: "local-api-proxy",
    configureServer(server) {
      server.middlewares.use("/api/proxy", (req, res) => {
        proxyHandler(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/proxy", (req, res) => {
        proxyHandler(req, res);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), powerApps(), localProxyPlugin()],
});

