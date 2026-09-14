import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Los tests importan con el alias `@/` de tsconfig y las routes importan
// "server-only" (que lanza fuera de Next): aqui se resuelven ambos.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./lib/server-only.stub.ts", import.meta.url)),
    },
  },
  test: { include: ["**/*.test.ts"], exclude: ["node_modules", ".next"] },
});
