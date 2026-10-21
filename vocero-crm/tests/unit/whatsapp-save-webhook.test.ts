import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las rutas de la conexión (issue #84), con todo lo de abajo falso:
 *
 *   - `PUT /api/settings/whatsapp` guarda y registra la URL FIJA de esta
 *     instancia en el número; si Meta dice que no, la conexión queda guardada
 *     y la respuesta lo cuenta en `webhook`.
 *   - `DELETE /api/settings/whatsapp` quita el override ANTES de borrar el
 *     token (sin él no se podría) y no toca nada más.
 *   - `POST /api/settings/webhook` reintenta con la conexión guardada: 409 sin
 *     conexión, 422/503 con el motivo de Meta, 200 con el resultado.
 */

const env = vi.hoisted(() => ({
  APP_BASE_URL: "https://crm.ejemplo.test",
  META_WEBHOOK_VERIFY_TOKEN: "verify-abc",
  META_APP_SECRET: undefined as string | undefined,
}));
const register = vi.hoisted(() => vi.fn());
const unregister = vi.hoisted(() => vi.fn(async () => {}));
const save = vi.hoisted(() => vi.fn(async () => {}));
const disconnect = vi.hoisted(() => vi.fn(async () => {}));
const creds = vi.hoisted(() => ({
  current: null as null | {
    wabaId: string;
    phoneNumberId: string;
    token: string;
    status: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  },
}));

vi.mock("@/lib/env", () => ({ getEnv: () => env }));
const sesion = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_a", role: sesion.role }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_a", role: sesion.role }),
}));
vi.mock("@/server/channels/enabled", () => ({ isChannelEnabled: () => false }));
vi.mock("@/server/whatsapp/credentials", () => ({
  desconectarCanal: disconnect,
  getCredentialsByOrg: async () => creds.current,
  saveCredentials: save,
  tokenLast4: (t: string) => t.slice(-4),
}));
vi.mock("@/server/whatsapp/connect", () => ({
  testConnection: async () => ({
    ok: true,
    displayPhoneNumber: "+52 55 0000 0000",
    verifiedName: "Negocio",
  }),
  registerWebhookForNumber: register,
  unregisterWebhookForNumber: unregister,
}));

import { DELETE, PUT } from "@/app/api/settings/whatsapp/route";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/settings/webhook/route";

/** 035 — La ruta lee el cuerpo (`recuperar`); sin cuerpo, el registro de siempre. */
const peticion = (cuerpo?: unknown) =>
  new Request("http://crm.test/api/settings/webhook", {
    method: "POST",
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }),
  });

const URL_FIJA = "https://crm.ejemplo.test/api/webhooks/wa/verify-abc";

const put = () =>
  PUT(
    new Request("https://crm.ejemplo.test/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId: "111", phoneNumberId: "222", token: "EAAG-token" }),
    })
  );

beforeEach(() => {
  register.mockReset();
  unregister.mockClear();
  save.mockClear();
  disconnect.mockClear();
  creds.current = null;
});

describe("guardar la conexión registra el webhook", () => {
  it("registra la URL fija de esta instancia en el número y lo devuelve", async () => {
    register.mockResolvedValueOnce({ ok: true, appWithoutWebhook: false });
    const res = await put();
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      wabaId: "111",
      phoneNumberId: "222",
      token: "EAAG-token",
      webhookUrl: URL_FIJA,
      verifyToken: "verify-abc",
    });
    expect(await res.json()).toEqual({
      ok: true,
      displayPhoneNumber: "+52 55 0000 0000",
      webhook: { ok: true, appWithoutWebhook: false },
    });
  });

  it("si Meta rechaza el webhook, la conexión queda guardada y se avisa (200)", async () => {
    register.mockResolvedValueOnce({
      ok: false,
      code: "missing_permission",
      message: "sin permiso",
    });
    const res = await put();
    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await res.json()).webhook).toMatchObject({ ok: false, code: "missing_permission" });
  });

  it("registra DESPUÉS de guardar: el número ya enruta por la conexión guardada", async () => {
    register.mockImplementationOnce(async () => {
      expect(save).toHaveBeenCalledTimes(1);
      return { ok: true, appWithoutWebhook: false };
    });
    await put();
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe("desconectar quita el webhook que puso el guardado", () => {
  beforeEach(() => {
    creds.current = {
      wabaId: "111",
      phoneNumberId: "222",
      token: "EAAG-token",
      status: "connected",
      displayPhoneNumber: "+52 55 0000 0000",
      verifiedName: "Negocio",
    };
  });

  it("lo quita ANTES de borrar el token, comparando por la ruta fija", async () => {
    unregister.mockImplementationOnce(async () => {
      expect(disconnect).not.toHaveBeenCalled();
    });
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(unregister).toHaveBeenCalledWith({
      phoneNumberId: "222",
      token: "EAAG-token",
      webhookPath: "/api/webhooks/wa/verify-abc",
    });
    expect(disconnect).toHaveBeenCalledWith("org_a");
  });

  it("sin conexión no llama a Meta y responde 200 igual (idempotente)", async () => {
    creds.current = null;
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(unregister).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith("org_a");
  });
});

describe("«Registrar en Meta» con la conexión guardada", () => {
  it("sin conexión → 409", async () => {
    const res = await webhookPost(peticion());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("sin_conexion");
    expect(register).not.toHaveBeenCalled();
  });

  it("con conexión → registra con el token guardado y la URL fija", async () => {
    creds.current = {
      wabaId: "111",
      phoneNumberId: "222",
      token: "EAAG-guardado",
      status: "connected",
      displayPhoneNumber: null,
      verifiedName: null,
    };
    register.mockResolvedValueOnce({ ok: true, appWithoutWebhook: true });
    const res = await webhookPost(peticion());
    expect(res.status).toBe(200);
    expect(register).toHaveBeenCalledWith({
      wabaId: "111",
      phoneNumberId: "222",
      token: "EAAG-guardado",
      webhookUrl: URL_FIJA,
      verifyToken: "verify-abc",
      forzar: false,
    });
    expect(await res.json()).toEqual({ ok: true, appWithoutWebhook: true });
  });

  it("si Meta dice que no, devuelve el motivo con 422 (503 si Meta está caída)", async () => {
    creds.current = {
      wabaId: "111",
      phoneNumberId: "222",
      token: "EAAG-guardado",
      status: "connected",
      displayPhoneNumber: null,
      verifiedName: null,
    };
    register.mockResolvedValueOnce({ ok: false, code: "missing_permission", message: "sin permiso" });
    const rechazo = await webhookPost(peticion());
    expect(rechazo.status).toBe(422);
    expect((await rechazo.json()).error).toEqual({ code: "missing_permission", message: "sin permiso" });

    register.mockResolvedValueOnce({ ok: false, code: "meta_unavailable", message: "caída" });
    expect((await webhookPost(peticion())).status).toBe(503);
  });

  it("GET sigue enseñando la URL fija y el verify token para el respaldo manual", async () => {
    const res = await webhookGet();
    expect(await res.json()).toMatchObject({
      url: URL_FIJA,
      verifyToken: "verify-abc",
      isHttps: true,
      signatureLayer: false,
      instagramUrl: null,
      messengerUrl: null,
    });
  });
});

describe("035 — «Recuperar el webhook»", () => {
  const conectada = {
    wabaId: "111",
    phoneNumberId: "222",
    token: "EAAG-guardado",
    status: "connected" as const,
    displayPhoneNumber: null,
    verifiedName: null,
  };

  it("con recuperar: true registra forzando, aunque la WABA tenga override ajeno", async () => {
    creds.current = conectada;
    register.mockResolvedValueOnce({ ok: true, appWithoutWebhook: false });
    const res = await webhookPost(peticion({ recuperar: true }));
    expect(res.status).toBe(200);
    expect(register).toHaveBeenLastCalledWith(expect.objectContaining({ forzar: true }));
  });

  it("solo quien administra", async () => {
    creds.current = conectada;
    sesion.role = "member";
    try {
      const res = await webhookPost(peticion({ recuperar: true }));
      expect(res.status).toBe(403);
    } finally {
      sesion.role = "owner";
    }
  });
});
