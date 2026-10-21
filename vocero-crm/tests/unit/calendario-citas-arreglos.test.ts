import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blockStartUtc,
  calendarVisible,
  coalesce,
  groupSlotsByDay,
  type DaySlot,
} from "@/lib/time/calendar";

/**
 * 215 (raíz) — Los cuatro fallos que tenía la pantalla de Citas antes del
 * calendario, fijados para que no vuelvan. El cuarto (el tope de 200) se
 * prueba contra la consulta y la ruta en `bookings-rango-api.test.ts`.
 */

describe("fallo 1 · bloquear usa la hora del NEGOCIO, no la del navegador", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("las 15:00 de Ciudad de México son las 21:00 UTC", () => {
    expect(blockStartUtc("2026-09-24", "15:00", "America/Mexico_City")).toBe(
      "2026-09-24T21:00:00.000Z"
    );
  });

  it("la misma hora de pared en otra zona es otro instante", () => {
    expect(blockStartUtc("2026-09-24", "15:00", "Asia/Tokyo")).toBe("2026-09-24T06:00:00.000Z");
    expect(blockStartUtc("2026-09-24", "15:00", "Europe/Madrid")).toBe("2026-09-24T13:00:00.000Z");
  });

  it("no depende de la zona del proceso (el navegador de quien mira)", () => {
    const results = ["Asia/Tokyo", "Europe/Madrid", "America/Mexico_City", "UTC"].map((tz) => {
      process.env.TZ = tz;
      return blockStartUtc("2026-09-24", "15:00", "America/Mexico_City");
    });
    expect(new Set(results)).toEqual(new Set(["2026-09-24T21:00:00.000Z"]));
  });

  it("día u hora inexistentes no producen un instante", () => {
    expect(blockStartUtc("2026-02-31", "15:00", "America/Mexico_City")).toBeNull();
    expect(blockStartUtc("2026-09-24", "25:00", "America/Mexico_City")).toBeNull();
    expect(blockStartUtc("", "15:00", "America/Mexico_City")).toBeNull();
  });
});

describe("fallo 2 · reprogramar ofrece TODA la ventana, por día", () => {
  const day = (i: number) => `2026-09-${String(21 + i).padStart(2, "0")}`;
  // 5 días × 16 huecos de 30 min = 80: antes la pantalla mostraba 12.
  const slots: DaySlot[] = Array.from({ length: 5 }, (_, d) =>
    Array.from({ length: 16 }, (_, h) => {
      const minutes = 9 * 60 + h * 30;
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      return { startUtc: `${day(d)}T${time}:00.000Z`, dayIso: day(d), time };
    })
  ).flat();

  it("no recorta: los 80 huecos quedan disponibles", () => {
    const groups = groupSlotsByDay(slots);
    expect(groups).toHaveLength(5);
    expect(groups.reduce((n, [, list]) => n + list.length, 0)).toBe(80);
    expect(groups.map(([d, list]) => [d, list.length])).toEqual(
      [0, 1, 2, 3, 4].map((i) => [day(i), 16])
    );
  });

  it("agrupa en orden de día aunque lleguen revueltos, sin reordenar las horas", () => {
    const shuffled = [...slots].reverse();
    const groups = groupSlotsByDay(shuffled);
    expect(groups.map(([d]) => d)).toEqual([0, 1, 2, 3, 4].map(day));
    expect(groups[0]?.[1][0]?.time).toBe("16:30");
  });

  it("sin huecos, ningún día", () => {
    expect(groupSlotsByDay([])).toEqual([]);
  });
});

describe("fallo 3 · un evento SSE ya no recalcula la disponibilidad", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("una ráfaga de eventos se paga con UNA recarga", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const sse = coalesce(reload, 250);
    for (let i = 0; i < 5; i++) {
      sse.trigger();
      vi.advanceTimersByTime(100);
    }
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(reload).toHaveBeenCalledTimes(1);
    sse.trigger();
    vi.advanceTimersByTime(250);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("al desmontar, la recarga pendiente no corre", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const sse = coalesce(reload, 250);
    sse.trigger();
    sse.cancel();
    vi.advanceTimersByTime(1000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("la pantalla solo pide disponibilidad desde «Reprogramar»", () => {
    const dir = path.resolve(import.meta.dirname, "../../src/components/bookings");
    const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
    // El cliente del calendario (lo que corre en cada evento SSE) no la pide…
    expect(read("bookings-client.tsx")).not.toContain("/api/calendar/availability");
    // …y el panel de la cita la pide una sola vez, al montar «Mover a».
    const drawer = read("booking-drawer.tsx");
    expect(drawer.match(/\/api\/calendar\/availability/g)).toHaveLength(1);
    expect(drawer).toContain("function Reschedule(");
  });
});

describe("las citas del Laboratorio no ensucian el calendario", () => {
  const b = (id: string, status: string, isTest: boolean) => ({ id, status, isTest });
  const all = [
    b("real", "agendada", false),
    b("cancelada", "cancelada", false),
    b("prueba", "agendada", true),
    b("prueba-cancelada", "cancelada", true),
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("por defecto se ocultan las pruebas y las canceladas", () => {
    expect(ids(calendarVisible(all, { showCancelled: false, showTests: false }))).toEqual(["real"]);
  });

  it("cada interruptor muestra lo suyo", () => {
    expect(ids(calendarVisible(all, { showCancelled: false, showTests: true }))).toEqual([
      "real",
      "prueba",
    ]);
    expect(ids(calendarVisible(all, { showCancelled: true, showTests: false }))).toEqual([
      "real",
      "cancelada",
    ]);
    expect(calendarVisible(all, { showCancelled: true, showTests: true })).toHaveLength(4);
  });
});
