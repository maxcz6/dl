import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 030 — El secreto de firma de Zernio se guarda cifrado, como el token: la
 * fila nunca lo trae en claro, se lee igual que antes, y el arranque cifra lo
 * que una versión anterior dejó en claro sin pisar lo que se guardó después.
 */

type Fila = Record<string, unknown>;

const insertadas: Fila[] = [];
const actualizaciones: { tabla: unknown; set: Fila }[] = [];
/** Lo que devuelve cada `select … from(tabla)` del arranque. */
let enClaro = new Map<unknown, Fila[]>();
/** Si el `update` condicionado encuentra la fila (false = alguien la cambió). */
let encuentraLaFila = true;

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const db = {
    select: () => ({
      from: (tabla: unknown) => {
        const filas = enClaro.get(tabla) ?? [];
        // credenciales: select().from().where().limit(1) → sin fila previa
        const where = () => Object.assign(Promise.resolve(filas), { limit: () => Promise.resolve([]) });
        return { where };
      },
    }),
    insert: () => ({
      values: (v: Fila) => {
        insertadas.push(v);
        return Promise.resolve();
      },
    }),
    update: (tabla: unknown) => ({
      set: (set: Fila) => {
        actualizaciones.push({ tabla, set });
        return {
          where: () => ({
            returning: () => Promise.resolve(encuentraLaFila ? [{ id: "x" }] : []),
          }),
        };
      },
    }),
  };
  return { getDb: () => db, schema };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  insertadas.length = 0;
  actualizaciones.length = 0;
  enClaro = new Map();
  encuentraLaFila = true;
});

const SECRETO = "secreto-de-zernio-0123456789abcdef";
const LLAVE = "sk_zernio_llave_super_secreta_wxyz";

async function descifrar(fila: Fila): Promise<string> {
  const { decryptSecret } = await import("@/lib/crypto");
  return decryptSecret({
    cipher: fila.webhookSecretCipher as string,
    iv: fila.webhookSecretIv as string,
    tag: fila.webhookSecretTag as string,
  });
}

function sinNadaEnClaro(fila: Fila) {
  const serializada = JSON.stringify(fila);
  expect(serializada).not.toContain(SECRETO);
  expect(serializada).not.toContain(LLAVE);
  expect(fila.webhookSecret).toBeNull();
  expect(fila.webhookSecretCipher).toBeTruthy();
  expect(fila.webhookSecretIv).toBeTruthy();
  expect(fila.webhookSecretTag).toBeTruthy();
}

describe("guardar una conexión por Zernio", () => {
  it("Instagram: la fila no contiene el secreto en claro y se descifra igual", async () => {
    const { saveInstagramCredentials } = await import("@/server/instagram/credentials");
    await saveInstagramCredentials({
      organizationId: "org_1",
      source: "zernio",
      igUserId: "ig_1",
      accountRef: "acc_ig",
      username: "negocio",
      token: LLAVE,
      webhookSecret: SECRETO,
    });
    const fila = insertadas[0]!;
    sinNadaEnClaro(fila);
    expect(await descifrar(fila)).toBe(SECRETO);
  });

  it("Messenger: igual", async () => {
    const { saveMessengerCredentials } = await import("@/server/messenger/credentials");
    await saveMessengerCredentials({
      organizationId: "org_1",
      source: "zernio",
      pageId: null,
      pageName: "Negocio",
      accountRef: "acc_fb",
      token: LLAVE,
      webhookSecret: SECRETO,
    });
    const fila = insertadas[0]!;
    sinNadaEnClaro(fila);
    expect(await descifrar(fila)).toBe(SECRETO);
  });

  it("TikTok: igual", async () => {
    const { saveTiktokCredentials } = await import("@/server/tiktok/credentials");
    await saveTiktokCredentials({
      organizationId: "org_1",
      accountRef: "acc_tt",
      username: "negocio",
      token: LLAVE,
      webhookSecret: SECRETO,
    });
    const fila = insertadas[0]!;
    sinNadaEnClaro(fila);
    expect(await descifrar(fila)).toBe(SECRETO);
  });

  it("sin secreto (modo Meta) las cuatro columnas quedan nulas", async () => {
    const { columnasDelSecreto } = await import("@/server/zernio/secreto-guardado");
    expect(columnasDelSecreto(null)).toEqual({
      webhookSecret: null,
      webhookSecretCipher: null,
      webhookSecretIv: null,
      webhookSecretTag: null,
    });
    expect(columnasDelSecreto("").webhookSecretCipher).toBeNull();
  });

  it("dos guardados del mismo secreto no producen el mismo cifrado (iv nuevo)", async () => {
    const { columnasDelSecreto } = await import("@/server/zernio/secreto-guardado");
    const a = columnasDelSecreto(SECRETO);
    const b = columnasDelSecreto(SECRETO);
    expect(a.webhookSecretIv).not.toBe(b.webhookSecretIv);
    expect(a.webhookSecretCipher).not.toBe(b.webhookSecretCipher);
  });
});

describe("leer el secreto de una fila", () => {
  it("prefiere el cifrado", async () => {
    const { columnasDelSecreto, secretoDeLaFila } = await import("@/server/zernio/secreto-guardado");
    const cols = columnasDelSecreto(SECRETO);
    expect(secretoDeLaFila({ ...cols, webhookSecret: "otro-en-claro" })).toBe(SECRETO);
  });

  it("una fila que el arranque aún no cifró sigue verificando con el de claro", async () => {
    const { secretoDeLaFila } = await import("@/server/zernio/secreto-guardado");
    expect(
      secretoDeLaFila({
        webhookSecret: SECRETO,
        webhookSecretCipher: null,
        webhookSecretIv: null,
        webhookSecretTag: null,
      })
    ).toBe(SECRETO);
  });

  it("sin nada guardado es null", async () => {
    const { secretoDeLaFila } = await import("@/server/zernio/secreto-guardado");
    expect(
      secretoDeLaFila({
        webhookSecret: null,
        webhookSecretCipher: null,
        webhookSecretIv: null,
        webhookSecretTag: null,
      })
    ).toBeNull();
  });

  it("un cifrado manipulado no se lee como bueno: lanza", async () => {
    const { columnasDelSecreto, secretoDeLaFila } = await import("@/server/zernio/secreto-guardado");
    const cols = columnasDelSecreto(SECRETO);
    const otro = columnasDelSecreto("otro-secreto-cualquiera-de-zernio");
    expect(() => secretoDeLaFila({ ...cols, webhookSecretTag: otro.webhookSecretTag })).toThrow();
  });
});

describe("el arranque cifra lo que quedó en claro", () => {
  it("cifra las filas de las tres tablas y deja la columna vieja en nulo", async () => {
    const { schema } = await import("@/lib/db");
    const { cifrarSecretosEnClaro } = await import("@/server/zernio/secreto-guardado");
    enClaro = new Map<unknown, Fila[]>([
      [schema.instagramCredentials, [{ id: "c_ig", secreto: SECRETO }]],
      [schema.messengerCredentials, [{ id: "c_fb", secreto: SECRETO }]],
      [schema.tiktokCredentials, [{ id: "c_tt", secreto: SECRETO }]],
    ]);
    expect(await cifrarSecretosEnClaro()).toBe(3);
    expect(actualizaciones.map((a) => a.tabla)).toEqual([
      schema.instagramCredentials,
      schema.messengerCredentials,
      schema.tiktokCredentials,
    ]);
    for (const { set } of actualizaciones) {
      expect(JSON.stringify(set)).not.toContain(SECRETO);
      expect(set.webhookSecret).toBeNull();
      expect(await descifrar(set)).toBe(SECRETO);
    }
  });

  it("sin filas en claro no escribe nada", async () => {
    const { cifrarSecretosEnClaro } = await import("@/server/zernio/secreto-guardado");
    expect(await cifrarSecretosEnClaro()).toBe(0);
    expect(actualizaciones).toHaveLength(0);
  });

  it("si la fila cambió entre la lectura y la escritura, no cuenta (no la pisó)", async () => {
    const { schema } = await import("@/lib/db");
    const { cifrarSecretosEnClaro } = await import("@/server/zernio/secreto-guardado");
    enClaro = new Map<unknown, Fila[]>([[schema.tiktokCredentials, [{ id: "c_tt", secreto: SECRETO }]]]);
    encuentraLaFila = false;
    expect(await cifrarSecretosEnClaro()).toBe(0);
  });

  it("un secreto vacío se limpia, pero no cuenta como cifrado", async () => {
    const { schema } = await import("@/lib/db");
    const { cifrarSecretosEnClaro } = await import("@/server/zernio/secreto-guardado");
    enClaro = new Map<unknown, Fila[]>([[schema.instagramCredentials, [{ id: "c_ig", secreto: "" }]]]);
    expect(await cifrarSecretosEnClaro()).toBe(0);
    expect(actualizaciones[0]?.set.webhookSecret).toBeNull();
    expect(actualizaciones[0]?.set.webhookSecretCipher).toBeNull();
  });
});
