import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-test";
});

describe("crypto AES-256-GCM", () => {
  it("cifra y descifra (roundtrip)", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
    const value = encryptSecret("EAAG-token-super-secreto");
    expect(value.cipher).not.toContain("token");
    expect(Buffer.from(value.iv, "base64")).toHaveLength(12);
    expect(decryptSecret(value)).toBe("EAAG-token-super-secreto");
  });

  it("dos cifrados del mismo texto producen ciphertexts distintos (IV aleatorio)", async () => {
    const { encryptSecret } = await import("@/lib/crypto");
    const a = encryptSecret("mismo-texto");
    const b = encryptSecret("mismo-texto");
    expect(a.cipher).not.toBe(b.cipher);
    expect(a.iv).not.toBe(b.iv);
  });

  it("tag manipulado lanza (integridad GCM)", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
    const value = encryptSecret("dato");
    const tampered = {
      ...value,
      tag: Buffer.alloc(16, 1).toString("base64"),
    };
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
