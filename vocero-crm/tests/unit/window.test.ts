import { describe, expect, it } from "vitest";
import { isWindowOpen, WINDOW_MS, windowRemainingMs } from "@/server/inbox/window";

describe("ventana de 24 horas (FR-005)", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("entrante hace 1 hora → abierta", () => {
    const last = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isWindowOpen(last, now)).toBe(true);
  });

  it("entrante hace 25 horas → cerrada", () => {
    const last = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isWindowOpen(last, now)).toBe(false);
  });

  it("borde exacto de 24h → cerrada (estricto)", () => {
    const last = new Date(now.getTime() - WINDOW_MS);
    expect(isWindowOpen(last, now)).toBe(false);
  });

  it("un milisegundo antes del borde → abierta", () => {
    const last = new Date(now.getTime() - WINDOW_MS + 1);
    expect(isWindowOpen(last, now)).toBe(true);
  });

  it("conversación sin ningún entrante (iniciada por plantilla) → cerrada", () => {
    expect(isWindowOpen(null, now)).toBe(false);
    expect(windowRemainingMs(null, now)).toBe(0);
  });

  it("remaining decrece y nunca es negativo", () => {
    const last = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    const remaining = windowRemainingMs(last, now);
    expect(remaining).toBe(60 * 60 * 1000);
    const old = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    expect(windowRemainingMs(old, now)).toBe(0);
  });
});
