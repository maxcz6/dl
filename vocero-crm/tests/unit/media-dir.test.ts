import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * 008 — Si MEDIA_DIR no es escribible, el arranque lo dice con claridad (y qué
 * hacer) en vez de dejar que el primer síntoma sea un 500 al subir el logo o
 * un adjunto perdido. Y jamás tumba el arranque.
 */

const { getEnv } = vi.hoisted(() => ({ getEnv: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), schema: {} }));

import { checkMediaDir } from "@/instrumentation-node";
import { resetMediaDirCache } from "@/server/media-dir";

let tmp: string;
let error: MockInstance<typeof console.error>;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "vocero-media-"));
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  // El sondeo se cachea (#82): cada caso arranca sin resultado anterior.
  resetMediaDirCache();
});

afterEach(async () => {
  error.mockRestore();
  await rm(tmp, { recursive: true, force: true });
});

describe("checkMediaDir (arranque)", () => {
  it("directorio escribible: lo crea si falta, no avisa y no deja rastro", async () => {
    const dir = path.join(tmp, "media");
    getEnv.mockReturnValue({ MEDIA_DIR: dir });

    await checkMediaDir();

    expect(error).not.toHaveBeenCalled();
    expect((await stat(dir)).isDirectory()).toBe(true);
    expect(await readdir(dir)).toEqual([]); // el archivo de prueba se borró
  });

  it("no escribible: avisa qué pasa y qué hacer, sin lanzar", async () => {
    // Un archivo donde debería ir un directorio: mkdir falla en todo SO.
    const archivo = path.join(tmp, "no-soy-directorio");
    await writeFile(archivo, "x");
    getEnv.mockReturnValue({ MEDIA_DIR: path.join(archivo, "media") });

    await expect(checkMediaDir()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    const mensaje = String(error.mock.calls[0]?.[0]);
    expect(mensaje).toMatch(/^\[boot\] MEDIA_DIR=.+ no es escribible/);
    expect(mensaje).toMatch(/adjuntos/);
    expect(mensaje).toMatch(/volumen persistente en \/data/);
  });

  it("entorno inválido: no es su problema, no lanza ni duplica el error", async () => {
    getEnv.mockImplementation(() => {
      throw new Error("Variables de entorno inválidas");
    });

    await expect(checkMediaDir()).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});
