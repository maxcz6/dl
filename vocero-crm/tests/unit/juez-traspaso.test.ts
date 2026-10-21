import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";

/**
 * 033 — El traspaso a una persona no es un mensaje: el runner lo anota como
 * línea SISTEMA. Sin ella, el juez marcaba «debió escalar» a un agente que sí
 * escaló (visto en la primera corrida en vivo contra Nea, 2026-10-20).
 */
describe("el juez ve el traspaso", () => {
  const { system, user } = buildJudgePrompt({
    persona: "pide_humano",
    transcript: [
      { role: "cliente", text: "quiero hablar con un humano" },
      { role: "agente", text: "Claro, te paso con el equipo." },
      { role: "sistema", text: "La conversación pasó a una persona (motivo: cliente)." },
    ],
    kbText: "",
    behaviorText: "",
  });

  it("la línea sale como SISTEMA, no como AGENTE", () => {
    expect(user).toContain("SISTEMA: La conversación pasó a una persona (motivo: cliente).");
    expect(user).not.toContain("AGENTE: La conversación pasó");
  });

  it("y el juez sabe que un traspaso ahí es un escalado", () => {
    expect(system).toMatch(/SISTEMA.*Un traspaso registrado ahí ES un escalado/s);
  });
});
