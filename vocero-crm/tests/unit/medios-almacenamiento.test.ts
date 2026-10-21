import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 037 — Adjuntos en disco o en bucket (puerto de la spec 200 de la edición
 * cloud; conector opcional del Principio II.3).
 *
 * Lo que se prueba aquí es lo que puede perder el archivo de un cliente: que
 * la firma sea válida, que la bandera no escriba donde no debe, que la
 * LECTURA mire en los dos sitios —lo que permite mover la bandera sin ventana
 * de corte— y, propio de la raíz, que un bucket caído no pierda el archivo.
 */

const BASE = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://t:t@localhost:5432/t",
  BETTER_AUTH_SECRET: "secret-de-test-suficiente",
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "verify-test",
};

const CREDS = {
  MEDIA_BUCKET_ENDPOINT: "https://cuenta123.r2.cloudflarestorage.com",
  MEDIA_BUCKET_NAME: "vocero-media",
  MEDIA_BUCKET_KEY_ID: "AKIAEJEMPLO",
  MEDIA_BUCKET_SECRET: "secretoDeEjemplo1234567890",
  MEDIA_BUCKET_REGION: "auto",
};

let dirTemporal: string;

async function montar(extra: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of Object.keys({ ...CREDS, MEDIA_STORE: "" })) delete process.env[k];
  Object.assign(process.env, BASE, { MEDIA_DIR: dirTemporal });
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/lib/storage/medios");
}

beforeEach(async () => {
  dirTemporal = await mkdtemp(path.join(tmpdir(), "vocero-medios-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("firma SigV4 del bucket", () => {
  it("produce la MISMA firma que botocore para la misma petición", async () => {
    const { firmarSolicitud } = await import("@/lib/storage/objetos");
    const r = firmarSolicitud({
      cfg: {
        endpoint: "https://cuenta123.r2.cloudflarestorage.com",
        bucket: "vocero-media",
        accessKeyId: "AKIAEJEMPLO",
        secretAccessKey: "secretoDeEjemplo1234567890",
        region: "auto",
      },
      metodo: "PUT",
      llave: "org_abc/asset_def",
      hashDelCuerpo: createHash("sha256").update("hola").digest("hex"),
      contentType: "text/plain",
      ahora: new Date("2026-09-08T04:30:00.000Z"),
    });

    // Valor de referencia calculado con botocore (AWS oficial) para estas
    // mismas entradas. Si esta firma cambia, la culpa es nuestra.
    expect(r.headers.Authorization).toContain(
      "Signature=fe58228394eb5897a000e946894026e0bc343e2363eb5aab4d11546437633304"
    );
    expect(r.headers.Authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"
    );
    expect(r.url).toBe(
      "https://cuenta123.r2.cloudflarestorage.com/vocero-media/org_abc/asset_def"
    );
  });
});

describe("llave del objeto", () => {
  it("es la ruta relativa de siempre, para que la BD no cambie", async () => {
    const { llaveDeMedia } = await montar({});
    expect(llaveDeMedia("org_1", "asset_2")).toBe("org_1/asset_2");
  });

  it("rechaza segmentos que se salgan del prefijo de la organización", async () => {
    const { llaveDeMedia } = await montar({});
    expect(() => llaveDeMedia("../otra", "asset_2")).toThrow();
    expect(() => llaveDeMedia("org_1", "a/b")).toThrow();
  });
});

describe("dónde se escribe", () => {
  it("sin bandera, escribe en disco (una instancia que no pidió bucket)", async () => {
    const m = await montar({});
    expect(m.almacenActivo()).toBe("disco");
    await m.guardarMedia("org_1", "asset_1", Buffer.from("contenido"));
    expect(await readFile(path.join(dirTemporal, "org_1", "asset_1"), "utf8")).toBe(
      "contenido"
    );
  });

  it("con la bandera pero SIN credenciales, avisa y NO pierde el archivo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await montar({ MEDIA_STORE: "bucket" });
    expect(m.almacenActivo()).toBe("disco");
    await m.guardarMedia("org_1", "asset_1", Buffer.from("contenido"));
    expect(await readFile(path.join(dirTemporal, "org_1", "asset_1"), "utf8")).toBe(
      "contenido"
    );
    expect(aviso).toHaveBeenCalled();
  });

  it("con bandera y credenciales, hace PUT al bucket y no toca el disco", async () => {
    const fetchFalso = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchFalso);
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });

    const ruta = await m.guardarMedia("org_1", "asset_1", Buffer.from("contenido"));

    expect(ruta).toBe("org_1/asset_1");
    expect(fetchFalso).toHaveBeenCalledOnce();
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://cuenta123.r2.cloudflarestorage.com/vocero-media/org_1/asset_1"
    );
    expect(init.method).toBe("PUT");
    await expect(
      readFile(path.join(dirTemporal, "org_1", "asset_1"))
    ).rejects.toThrow();
  });
});

describe("una llave fija (el icono) no queda tapada al mover la bandera", () => {
  it("al escribir en el bucket, se quita la copia vieja del disco", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });
    await mkdir(path.join(dirTemporal, "org_1"), { recursive: true });
    await writeFile(path.join(dirTemporal, "org_1", "favicon"), "icono viejo");

    await m.guardarMedia("org_1", "favicon", Buffer.from("icono nuevo"));

    await expect(readFile(path.join(dirTemporal, "org_1", "favicon"))).rejects.toThrow();
  });

  it("al escribir en disco con el bucket configurado, se borra la copia del bucket", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init?: RequestInit) => {
        llamadas.push(`${init?.method} ${u}`);
        return new Response("", { status: 204 });
      })
    );
    const m = await montar({ MEDIA_STORE: "disco", ...CREDS });
    await m.guardarMedia("org_1", "favicon", Buffer.from("icono nuevo"));
    expect(await readFile(path.join(dirTemporal, "org_1", "favicon"), "utf8")).toBe("icono nuevo");
    expect(llamadas).toEqual(["DELETE https://cuenta123.r2.cloudflarestorage.com/vocero-media/org_1/favicon"]);
  });
});

describe("la lectura mira en los DOS sitios", () => {
  it("con el bucket encendido, un archivo viejo del disco se sigue leyendo", async () => {
    // 404 en el bucket: el archivo es de antes de migrar.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });

    await mkdir(path.join(dirTemporal, "org_1"), { recursive: true });
    await writeFile(path.join(dirTemporal, "org_1", "viejo"), "de antes");

    expect((await m.leerMedia("org_1", "viejo")).toString()).toBe("de antes");
  });

  it("con el bucket apagado, un archivo que ya estaba en el bucket se recupera", async () => {
    // El caso de volver atrás: la bandera regresó a `disco` y hay objetos
    // escritos en el bucket. Sin esta rama, se perderían de vista.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("desde el bucket", { status: 200 }))
    );
    const m = await montar({ MEDIA_STORE: "disco", ...CREDS });

    expect((await m.leerMedia("org_1", "nuevo")).toString()).toBe("desde el bucket");
  });

  it("si no está en ninguno de los dos, falla como siempre falló", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });
    await expect(m.leerMedia("org_1", "fantasma")).rejects.toThrow();
  });
});

describe("037 — un bucket caído no pierde el archivo (D4)", () => {
  it("si el bucket rechaza el PUT, se guarda en disco, se avisa y se puede leer", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) =>
        init?.method === "PUT" ? new Response("AccessDenied", { status: 403 }) : new Response("", { status: 404 })
      )
    );
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });
    expect(await m.guardarMedia("org_1", "asset_1", Buffer.from("del cliente"))).toBe("org_1/asset_1");
    expect(await readFile(path.join(dirTemporal, "org_1", "asset_1"), "utf8")).toBe("del cliente");
    expect((await m.leerMedia("org_1", "asset_1")).toString()).toBe("del cliente");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("si el bucket no contesta (red), igual: al disco, y la lectura tampoco revienta", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });
    await m.guardarMedia("org_1", "asset_2", Buffer.from("x"));
    expect(await readFile(path.join(dirTemporal, "org_1", "asset_2"), "utf8")).toBe("x");
    expect((await m.leerMedia("org_1", "asset_2")).toString()).toBe("x");
    aviso.mockRestore();
  });

  it("los avisos no llevan la firma ni la llave", async () => {
    const vistos: string[] = [];
    const aviso = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      vistos.push(a.map(String).join(" "));
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error>Forbidden</Error>", { status: 403 })));
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS });
    await m.guardarMedia("org_1", "asset_3", Buffer.from("x"));
    await m.borrarMedia("org_1", "asset_3");
    expect(vistos.length).toBeGreaterThan(0);
    for (const v of vistos) {
      expect(v).not.toContain(CREDS.MEDIA_BUCKET_SECRET);
      expect(v).not.toContain("Credential=");
    }
    aviso.mockRestore();
  });

  it("borrar borra en los dos sitios", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init?: RequestInit) => {
        llamadas.push(`${init?.method} ${u}`);
        return new Response("", { status: 204 });
      })
    );
    const m = await montar({ MEDIA_STORE: "disco", ...CREDS });
    await mkdir(path.join(dirTemporal, "org_1"), { recursive: true });
    await writeFile(path.join(dirTemporal, "org_1", "asset_4"), "x");
    await m.borrarMedia("org_1", "asset_4");
    await expect(readFile(path.join(dirTemporal, "org_1", "asset_4"))).rejects.toThrow();
    expect(llamadas).toEqual(["DELETE https://cuenta123.r2.cloudflarestorage.com/vocero-media/org_1/asset_4"]);
  });

  it("un endpoint que no es http(s) cuenta como bucket mal configurado", async () => {
    const m = await montar({ MEDIA_STORE: "bucket", ...CREDS, MEDIA_BUCKET_ENDPOINT: "ftp://algo" });
    expect(m.leerConfigDelBucket()).toMatchObject({ cfg: null, problema: "endpoint" });
    expect(m.almacenActivo()).toBe("disco");
  });
});

describe("037 — el sondeo prueba donde se escribe", () => {
  it("con el bucket sano: PUT y DELETE del objeto de sondeo; solo enseña el host", async () => {
    const metodos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        metodos.push(init?.method ?? "");
        return new Response("", { status: 200 });
      })
    );
    await montar({ MEDIA_STORE: "bucket", ...CREDS });
    const { probeAlmacen } = await import("@/server/media-dir");
    expect(await probeAlmacen(dirTemporal)).toEqual({
      store: "bucket",
      dir: "cuenta123.r2.cloudflarestorage.com",
      writable: true,
    });
    expect(metodos).toEqual(["PUT", "DELETE"]);
  });

  it("con el bucket rechazando: no escribible, con el código", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await montar({ MEDIA_STORE: "bucket", ...CREDS });
    const { probeAlmacen } = await import("@/server/media-dir");
    expect(await probeAlmacen(dirTemporal)).toMatchObject({ store: "bucket", writable: false, code: "bucket_403" });
  });

  it("con la bandera y sin credenciales: no escribible (quien instala pidió el bucket)", async () => {
    await montar({ MEDIA_STORE: "bucket" });
    const { probeAlmacen } = await import("@/server/media-dir");
    expect(await probeAlmacen(dirTemporal)).toMatchObject({
      store: "bucket",
      writable: false,
      code: "bucket_incompleto",
    });
  });

  it("sin la bandera: el disco, como siempre, y nadie le habla al bucket", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await montar({ ...CREDS });
    const { probeAlmacen } = await import("@/server/media-dir");
    expect(await probeAlmacen(dirTemporal)).toMatchObject({ store: "disco", writable: true });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("037 — doctor y salud", () => {
  it("sin la bandera, el doctor no menciona el bucket", async () => {
    const { checkMediaBucket } = await import("@/server/doctor/checks");
    expect(await checkMediaBucket({ ...CREDS })).toBeNull();
  });

  it("con la bandera y variables faltantes, falla y dice cuáles", async () => {
    const { checkMediaBucket } = await import("@/server/doctor/checks");
    const r = await checkMediaBucket({ MEDIA_STORE: "bucket", MEDIA_BUCKET_ENDPOINT: CREDS.MEDIA_BUCKET_ENDPOINT });
    expect(r).toMatchObject({ status: "fail" });
    expect(r?.fix).toMatch(/MEDIA_BUCKET_SECRET/);
  });

  it("con el bucket sano, ok sin enseñar llaves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const { checkMediaBucket } = await import("@/server/doctor/checks");
    const r = await checkMediaBucket({ MEDIA_STORE: "bucket", ...CREDS });
    expect(r).toMatchObject({ status: "ok" });
    expect(JSON.stringify(r)).not.toContain(CREDS.MEDIA_BUCKET_SECRET);
    expect(JSON.stringify(r)).not.toContain(CREDS.MEDIA_BUCKET_KEY_ID);
  });

  it("/api/health dice el almacén pedido en features.media", async () => {
    const { healthFeatures } = await import("@/server/health");
    expect(healthFeatures({}).media).toBe("disco");
    expect(healthFeatures({ MEDIA_STORE: "bucket" }).media).toBe("bucket");
    expect(healthFeatures({ MEDIA_STORE: "s3" }).media).toBe("disco");
  });
});
