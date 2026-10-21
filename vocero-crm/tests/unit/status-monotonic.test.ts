import { describe, expect, it } from "vitest";
import { isUpgrade } from "@/server/inbox/status";

describe("estados monotónicos del mensaje (FR-004)", () => {
  it("progresión normal: pending → sent → delivered → read", () => {
    expect(isUpgrade("pending", "sent")).toBe(true);
    expect(isUpgrade("sent", "delivered")).toBe(true);
    expect(isUpgrade("delivered", "read")).toBe(true);
  });

  it("nunca degrada: un delivered tardío no pisa read", () => {
    expect(isUpgrade("read", "delivered")).toBe(false);
    expect(isUpgrade("delivered", "sent")).toBe(false);
    expect(isUpgrade("sent", "pending")).toBe(false);
  });

  it("mismo estado no re-aplica", () => {
    expect(isUpgrade("delivered", "delivered")).toBe(false);
  });

  it("failed aplica desde cualquier estado (una sola vez)", () => {
    expect(isUpgrade("pending", "failed")).toBe(true);
    expect(isUpgrade("read", "failed")).toBe(true);
    expect(isUpgrade("failed", "failed")).toBe(false);
  });

  it("estados desconocidos se ignoran", () => {
    expect(isUpgrade("sent", "warning")).toBe(false);
  });
});
