import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

/**
 * Serves api/*.ts during `vite dev`, so no Vercel CLI is needed locally.
 * With MOCK=1 it serves time-shifted fixtures instead (for offline work and screenshots).
 */
function devApi(): Plugin {
  const handle = async (server: ViteDevServer, req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", "http://localhost");
    const name = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    if (!/^[a-z]+$/.test(name)) { res.statusCode = 404; res.end(); return; }
    const modulePath = process.env.MOCK ? "/dev/mock-api.ts" : `/api/${name}.ts`;
    const mod = await server.ssrLoadModule(modulePath);
    const handler = process.env.MOCK ? mod.handlers[name] : mod.default;
    if (!handler) { res.statusCode = 404; res.end(); return; }
    const response: Response = await handler.fetch(new Request(url));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: "route27-dev-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        handle(server, req, res).catch(error => {
          server.config.logger.error(String(error));
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
