import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const vadRuntimeModuleUrl = "/vad/ort-wasm-simd-threaded.mjs";
const vadRuntimeModulePath = fileURLToPath(
  new URL(`./public${vadRuntimeModuleUrl}`, import.meta.url),
);

const serveVadRuntimeModule: Plugin = {
  name: "serve-vad-runtime-module",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.split("?", 1)[0] !== vadRuntimeModuleUrl) {
        next();
        return;
      }
      try {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(await readFile(vadRuntimeModulePath));
      } catch {
        next();
      }
    });
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [serveVadRuntimeModule, react()],
  assetsInclude: ["**/*.onnx", "**/*.wasm"],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react/jsx-runtime"],
          state: ["xstate", "@xstate/react"],
          validation: ["zod"],
          tauri: [
            "@tauri-apps/api",
            "@tauri-apps/plugin-log",
            "@tauri-apps/plugin-sql",
          ],
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
