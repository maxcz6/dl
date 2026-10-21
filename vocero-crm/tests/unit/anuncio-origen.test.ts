import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COTAS,
  anuncioDeWhatsapp,
  sinIdentificadorDeClic,
} from "@/server/attribution/referral";
import {
  CREATIVO_MAX_BYTES,
  descargarConReintento,
  descargarCreativo,
  urlDeCreativoPermitida,
} from "@/server/attribution/creativo";
import {
  REPARAR_CADA_MS,
  anuncioParaGuardar,
  crearFreno,
  serializarAnuncio,
} from "@/server/attribution/store";
import { effectiveSource } from "@/server/contact-source";
import {
  cuentaComoAnuncio,
  etiquetaDeOrigen,
  titularDeOrigen,
} from "@/lib/anuncios";

/**
 * 018 — De qué anuncio llegó cada conversación.
 *
 * Lo que se prueba aquí es la única puerta por la que un payload externo llega
 * a una columna (la normalización), la única por la que ese payload hace que el
 * servidor descargue algo (la URL del creativo y la descarga), y lo que decide
 * la bandera ATRIBUCION: el identificador de clic, nada más.
 */

const REFERRAL_CTWA = {
  source_url: "https://fb.me/2ZXjQ0aB1",
  source_id: "120212345678900001",
  source_type: "ad",
  headline: "Diagnóstico gratis para tu negocio",
  body: "Escríbenos y agenda tu llamada",
  media_type: "image",
  image_url: "https://scontent.xx.fbcdn.net/v/t45.1600-4/creativo.jpg?oe=66F0",
  ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO",
};

describe("anuncioDeWhatsapp", () => {
  it("normaliza el referral completo de un anuncio Click-to-WhatsApp", () => {
    const a = anuncioDeWhatsapp(REFERRAL_CTWA);
    expect(a).toMatchObject({
      sourceId: "120212345678900001",
      sourceType: "ad",
      sourceUrl: "https://fb.me/2ZXjQ0aB1",
      headline: "Diagnóstico gratis para tu negocio",
      body: "Escríbenos y agenda tu llamada",
      mediaType: "image",
      ctwaClid: REFERRAL_CTWA.ctwa_clid,
      imageUrl: REFERRAL_CTWA.image_url,
    });
    expect(a?.raw).toMatchObject({ source_id: "120212345678900001" });
  });

  it("prefiere la miniatura al creativo completo", () => {
    const a = anuncioDeWhatsapp({
      ...REFERRAL_CTWA,
      media_type: "video",
      video_url: "https://video.xx.fbcdn.net/v.mp4",
      thumbnail_url: "https://scontent.xx.fbcdn.net/thumb.jpg",
    });
    expect(a?.imageUrl).toBe("https://scontent.xx.fbcdn.net/thumb.jpg");
  });

  it("sin nada que identifique el anuncio no hay anuncio", () => {
    expect(anuncioDeWhatsapp(undefined)).toBeNull();
    expect(anuncioDeWhatsapp(null)).toBeNull();
    expect(anuncioDeWhatsapp("ad")).toBeNull();
    expect(anuncioDeWhatsapp([REFERRAL_CTWA])).toBeNull();
    expect(anuncioDeWhatsapp({})).toBeNull();
    expect(anuncioDeWhatsapp({ body: "solo texto", media_type: "image" })).toBeNull();
    expect(anuncioDeWhatsapp({ source_id: "   ", headline: "" })).toBeNull();
  });

  it("basta uno de los campos útiles, aunque falte el id del anuncio", () => {
    expect(anuncioDeWhatsapp({ ctwa_clid: "clid-1" })?.ctwaClid).toBe("clid-1");
    expect(anuncioDeWhatsapp({ headline: "Promo" })?.headline).toBe("Promo");
  });

  it("ignora tipos equivocados en vez de guardarlos", () => {
    const a = anuncioDeWhatsapp({ source_id: 12345, headline: { x: 1 }, ctwa_clid: "c" });
    expect(a?.sourceId).toBeNull();
    expect(a?.headline).toBeNull();
    expect(a?.ctwaClid).toBe("c");
  });

  it("solo acepta enlaces http(s): un javascript: jamás llega a un href", () => {
    const a = anuncioDeWhatsapp({
      ...REFERRAL_CTWA,
      source_url: "javascript:alert(1)",
      image_url: "data:image/png;base64,AAAA",
    });
    expect(a?.sourceUrl).toBeNull();
    expect(a?.imageUrl).toBeNull();
  });

  it("recorta cadenas gigantes y acota el raw", () => {
    const enorme = "x".repeat(50_000);
    const a = anuncioDeWhatsapp({
      source_id: enorme,
      headline: enorme,
      body: enorme,
      ctwa_clid: enorme,
      campo_nuevo_de_meta: enorme,
    });
    expect(a?.sourceId?.length).toBe(COTAS.id);
    expect(a?.headline?.length).toBe(COTAS.titular);
    expect(a?.body?.length).toBe(COTAS.texto);
    expect(JSON.stringify(a?.raw).length).toBeLessThanOrEqual(COTAS.raw);
    // Las claves que no conoce no llegan al raw.
    expect(a?.raw).not.toHaveProperty("campo_nuevo_de_meta");
  });
});

describe("la bandera ATRIBUCION decide el identificador de clic, no el origen", () => {
  const original = process.env.ATRIBUCION;
  afterEach(() => {
    if (original === undefined) delete process.env.ATRIBUCION;
    else process.env.ATRIBUCION = original;
  });
  const anuncio = anuncioDeWhatsapp(REFERRAL_CTWA)!;

  it("apagada: se guarda el anuncio sin ctwa_clid, ni en la columna ni en el raw", () => {
    delete process.env.ATRIBUCION;
    const a = anuncioParaGuardar(anuncio);
    expect(a.ctwaClid).toBeNull();
    expect(a.raw).not.toHaveProperty("ctwa_clid");
    expect(JSON.stringify(a)).not.toContain(REFERRAL_CTWA.ctwa_clid);
    // El resto del anuncio queda intacto: el origen se ve igual.
    expect(a).toMatchObject({
      sourceId: anuncio.sourceId,
      headline: anuncio.headline,
      imageUrl: anuncio.imageUrl,
    });
    expect(a.raw).toMatchObject({ image_url: REFERRAL_CTWA.image_url });
  });

  it("encendida: se guarda con su ctwa_clid", () => {
    process.env.ATRIBUCION = "on";
    const a = anuncioParaGuardar(anuncio);
    expect(a.ctwaClid).toBe(REFERRAL_CTWA.ctwa_clid);
    expect(a.raw).toHaveProperty("ctwa_clid", REFERRAL_CTWA.ctwa_clid);
  });

  it("quitar el clic no toca el objeto original", () => {
    sinIdentificadorDeClic(anuncio);
    expect(anuncio.ctwaClid).toBe(REFERRAL_CTWA.ctwa_clid);
    expect(anuncio.raw).toHaveProperty("ctwa_clid");
  });

  const fila = {
    id: "att_1",
    organizationId: "org_1",
    contactId: "ct_1",
    conversationId: "cv_1",
    ctwaClid: "clid-secreto",
    sourceId: "1202",
    sourceType: "ad",
    sourceUrl: "https://fb.me/x",
    headline: "Promo",
    body: "Texto",
    mediaType: "video",
    imageAssetId: null,
    raw: { ctwa_clid: "clid-secreto" },
    createdAt: new Date("2026-09-21T15:00:00Z"),
  };

  it("la tarjeta dice «Meta identificó el clic» solo con la bandera, y nunca el valor", () => {
    const encendida = serializarAnuncio(fila, true);
    const apagada = serializarAnuncio(fila, false);
    expect(encendida.hasCtwaClid).toBe(true);
    expect(apagada.hasCtwaClid).toBe(false);
    expect(serializarAnuncio({ ...fila, ctwaClid: null }, true).hasCtwaClid).toBe(false);
    for (const dto of [encendida, apagada]) {
      expect(JSON.stringify(dto)).not.toContain("clid-secreto");
    }
    process.env.ATRIBUCION = "on";
    expect(serializarAnuncio(fila).hasCtwaClid).toBe(true);
    delete process.env.ATRIBUCION;
    expect(serializarAnuncio(fila).hasCtwaClid).toBe(false);
  });

  it("el enlace «Ver anuncio» solo sale si es https", () => {
    expect(serializarAnuncio(fila, false).sourceUrl).toBe("https://fb.me/x");
    expect(serializarAnuncio({ ...fila, sourceUrl: "http://fb.me/x" }, false).sourceUrl).toBeNull();
  });
});

describe("urlDeCreativoPermitida", () => {
  it("acepta los CDN de Meta por https", () => {
    for (const u of [
      "https://scontent.xx.fbcdn.net/v/t45/creativo.jpg?oe=1",
      "https://scontent-dfw5-1.xx.fbcdn.net/x.jpg",
      "https://scontent.xx.fbcdn.net:443/x.jpg",
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      "https://scontent.cdninstagram.com/foto.jpg",
      "https://www.facebook.com/ads/image/?d=1",
    ]) {
      expect(urlDeCreativoPermitida(u), u).toBe(true);
    }
  });

  it("rechaza lo que convertiría la ingesta en un proxy", () => {
    for (const u of [
      "http://scontent.xx.fbcdn.net/x.jpg", // sin TLS
      "https://evilfbcdn.net/x.jpg", // no es subdominio
      "https://fbcdn.net.atacante.com/x.jpg",
      "https://user:pass@scontent.xx.fbcdn.net/x.jpg",
      "https://scontent.xx.fbcdn.net@evil.example/x.jpg",
      "https://scontent.xx.fbcdn.net:8443/x.jpg", // puerto que no es de Meta
      "https://127.0.0.1/x.jpg",
      "https://[::1]/x.jpg",
      "http://localhost:3000/api/dev/wa-mock/media-file/creativo-1",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "https://example.com/creativo.png",
      "no es una url",
      "",
    ]) {
      expect(urlDeCreativoPermitida(u), u).toBe(false);
    }
  });

  it("el origen del mock solo vale cuando se pasa, y exacto", () => {
    const mock = "http://localhost:3500";
    const url = "http://localhost:3500/api/dev/wa-mock/media-file/creativo-1";
    expect(urlDeCreativoPermitida(url)).toBe(false);
    expect(urlDeCreativoPermitida(url, mock)).toBe(true);
    expect(urlDeCreativoPermitida("http://localhost:3501/api/x", mock)).toBe(false);
    expect(urlDeCreativoPermitida("http://127.0.0.1:3500/api/x", mock)).toBe(false);
  });
});

describe("descargarCreativo", () => {
  const META = "https://scontent.xx.fbcdn.net/v/creativo.jpg?oe=1";
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const imagen = (body: BodyInit = png, headers: Record<string, string> = {}) =>
    new Response(body, { headers: { "content-type": "image/png", ...headers } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Cada llamada a fetch toma la siguiente respuesta (o función) de la lista. */
  function stubFetch(...respuestas: (Response | (() => Promise<Response>))[]) {
    const fetchMock = vi.fn(async () => {
      const r = respuestas.shift();
      if (!r) throw new Error("fetch de más");
      return typeof r === "function" ? r() : r;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("baja una imagen de Meta, sin seguir redirecciones por su cuenta", async () => {
    const f = stubFetch(imagen());
    const d = await descargarCreativo(META);
    expect(d).toMatchObject({ ok: true, mimeType: "image/png" });
    expect(d.ok && d.data.byteLength).toBe(png.byteLength);
    expect(f).toHaveBeenCalledWith(META, expect.objectContaining({ redirect: "manual" }));
  });

  it("revalida cada salto: una redirección fuera de Meta ni se pide", async () => {
    const f = stubFetch(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } })
    );
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sigue una redirección dentro de Meta", async () => {
    const f = stubFetch(
      new Response(null, { status: 301, headers: { location: "/v/otra.jpg" } }),
      imagen()
    );
    expect((await descargarCreativo(META)).ok).toBe(true);
    expect(f).toHaveBeenLastCalledWith(
      "https://scontent.xx.fbcdn.net/v/otra.jpg",
      expect.anything()
    );
  });

  it("corta tras 3 redirecciones", async () => {
    const salto = () =>
      new Response(null, { status: 302, headers: { location: META } });
    const f = stubFetch(salto(), salto(), salto(), salto(), imagen());
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("solo JPEG, PNG, WebP o GIF: un SVG no pasa", async () => {
    stubFetch(imagen('<svg xmlns="http://www.w3.org/2000/svg"/>', { "content-type": "image/svg+xml" }));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
    stubFetch(imagen("<html>", { "content-type": "text/html" }));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
  });

  it("más de 300 KB no se descarga, lo declare o no", async () => {
    stubFetch(imagen(png, { "content-length": String(CREATIVO_MAX_BYTES + 1) }));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });

    // Sin content-length: se corta al pasar el tope, sin leer el resto.
    let emitidos = 0;
    const infinito = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitidos += 64_000;
        controller.enqueue(new Uint8Array(64_000));
      },
    });
    stubFetch(imagen(infinito));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
    expect(emitidos).toBeLessThan(CREATIVO_MAX_BYTES + 3 * 64_000);
  });

  it("distingue lo que vale reintentar de lo que no", async () => {
    stubFetch(new Response(null, { status: 503 }));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "transitoria" });
    stubFetch(new Response(null, { status: 429 }));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "transitoria" });
    stubFetch(() => Promise.reject(new DOMException("timeout", "TimeoutError")));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "transitoria" });
    stubFetch(new Response(null, { status: 404 }));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
    stubFetch(imagen(new Uint8Array(0)));
    expect(await descargarCreativo(META)).toEqual({ ok: false, falla: "permanente" });
  });

  it("un host no permitido no llega a pedirse", async () => {
    const f = stubFetch(imagen());
    expect(await descargarCreativo("https://example.com/x.png")).toEqual({
      ok: false,
      falla: "permanente",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("reintenta una vez un fallo transitorio, y ninguna uno permanente", async () => {
    let f = stubFetch(new Response(null, { status: 503 }), imagen());
    expect((await descargarConReintento(META, 0)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);

    f = stubFetch(new Response(null, { status: 503 }), new Response(null, { status: 503 }), imagen());
    expect((await descargarConReintento(META, 0)).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);

    f = stubFetch(new Response(null, { status: 404 }), imagen());
    expect((await descargarConReintento(META, 0)).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("freno de la reparación", () => {
  it("como mucho un intento por anuncio cada 10 minutos", () => {
    const freno = crearFreno();
    const t0 = 1_000_000;
    expect(freno.intentar("org:ad1", t0)).toBe(true);
    expect(freno.intentar("org:ad1", t0 + 1)).toBe(false);
    expect(freno.intentar("org:ad1", t0 + REPARAR_CADA_MS - 1)).toBe(false);
    // Otro anuncio no espera al primero.
    expect(freno.intentar("org:ad2", t0 + 1)).toBe(true);
    // Pasada la ventana, se vuelve a intentar.
    expect(freno.intentar("org:ad1", t0 + REPARAR_CADA_MS)).toBe(true);
  });

  it("purga las claves vencidas para no crecer sin fin", () => {
    const freno = crearFreno(1_000, 3);
    for (const k of ["a", "b", "c"]) freno.intentar(k, 0);
    expect(freno.claves).toBe(3);
    freno.intentar("d", 5_000);
    expect(freno.claves).toBe(1);
  });
});

describe("fuente y etiquetas", () => {
  it("lo capturado manda sobre el anuncio", () => {
    expect(effectiveSource("referido", true)).toEqual({
      value: "referido",
      source: "capturada",
    });
  });

  it("sin captura, un anuncio deduce la fuente", () => {
    expect(effectiveSource(null, true)).toEqual({ value: "anuncio", source: "deducida" });
    expect(effectiveSource(null)).toEqual({ value: "desconocida", source: "deducida" });
  });

  it("una publicación se enseña pero no cuenta como anuncio", () => {
    expect(cuentaComoAnuncio({ sourceType: "post" })).toBe(false);
    expect(cuentaComoAnuncio({ sourceType: "ad" })).toBe(true);
    expect(cuentaComoAnuncio({ sourceType: null })).toBe(true);
    expect(cuentaComoAnuncio(null)).toBe(false);
    expect(etiquetaDeOrigen("post")).toBe("Publicación");
    expect(etiquetaDeOrigen("ad")).toBe("Anuncio");
    expect(titularDeOrigen(null, "ad")).toBe("Anuncio sin título");
    expect(titularDeOrigen("Promo", "post")).toBe("Promo");
  });
});
