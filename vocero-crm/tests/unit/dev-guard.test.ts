import { afterEach, describe, expect, it, vi } from "vitest";
import { mockGuard } from "@/lib/dev-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockGuard (FR-080: mocks en producción → 404)", () => {
  it("producción con flag activo → 404 igualmente", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const res = mockGuard();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("desarrollo sin flag → 404", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockGuard()?.status).toBe(404);
  });

  it("desarrollo con flag → permitido (null)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockGuard()).toBeNull();
  });

  it("test con flag → permitido (null)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    expect(mockGuard()).toBeNull();
  });
});
