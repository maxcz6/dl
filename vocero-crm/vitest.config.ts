import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // El tsconfig dice `jsx: "preserve"` porque de JSX se encarga Next. Vitest
  // no es Next: sin esto compila el JSX al runtime clásico (`React.
  // createElement` sin importar React) y un componente no se puede dibujar
  // en una prueba (ver tests/unit/switch.test.ts).
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
