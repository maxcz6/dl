import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiClient } from "@/components/settings/ai-client";
import { AvisoIaBanner } from "@/components/avisos/aviso-ia";

/**
 * #85 — Ajustes → IA y el banner, dibujados en el servidor (sin efectos):
 * la ayuda va plegada, la llave es un campo de contraseña y los dos botones
 * del proveedor existen antes de cargar nada.
 */
describe("Ajustes → IA", () => {
  it("ofrece la guía plegada, enlaza saldo y llaves, y pide la llave como contraseña", () => {
    const html = renderToStaticMarkup(React.createElement(AiClient));
    expect(html).toContain("¿Cómo consigo mi llave?");
    expect(html).not.toContain("<details open");
    expect(html).toContain('href="https://openrouter.ai/settings/credits"');
    expect(html).toContain('href="https://openrouter.ai/settings/keys"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Probar conexión");
    expect(html).toContain("Traer modelos");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Otro compatible con OpenAI");
    // El respaldo del entorno se explica sin mandar a editar el .env.
    expect(html).toContain("OPENROUTER_API_TOKEN");
    expect(html).not.toContain("reinic");
  });
});

describe("banner del agente sin IA", () => {
  it("manda a Ajustes → IA con la acción que toca; sin aviso no dibuja nada", () => {
    const html = renderToStaticMarkup(
      React.createElement(AvisoIaBanner, {
        aviso: { mensaje: "Tu agente está pausado.", accion: "Revisar mi conexión" },
      })
    );
    expect(html).toContain("Tu agente está pausado.");
    expect(html).toContain("Revisar mi conexión");
    expect(html).toContain('href="/settings/ai"');
    expect(renderToStaticMarkup(React.createElement(AvisoIaBanner, { aviso: null }))).toBe("");
  });
});
