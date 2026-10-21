import { describe, expect, it } from "vitest";
import {
  baseMime,
  contentDisposition,
  contentTypeFor,
  isForbiddenUploadMime,
  isPreviewable,
  mediaResponseHeaders,
} from "@/server/whatsapp/media-headers";

/**
 * #78 — Un adjunto es contenido ajeno servido desde el origen del CRM. Estas
 * pruebas fijan QUÉ se previsualiza y con qué cabeceras se sirve TODO.
 */

describe("isPreviewable (lista cerrada)", () => {
  it("imagen, audio, video y PDF se muestran en el navegador", () => {
    for (const mime of [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "audio/ogg",
      "audio/mpeg",
      "audio/mp4",
      "audio/aac",
      "audio/amr",
      "video/mp4",
      "video/3gpp",
      "application/pdf",
    ]) {
      expect(isPreviewable(mime), mime).toBe(true);
    }
  });

  it("el códec de las notas de voz de Meta no estorba", () => {
    expect(isPreviewable("audio/ogg; codecs=opus")).toBe(true);
    expect(baseMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
  });

  it("sin distinguir mayúsculas", () => {
    expect(isPreviewable("IMAGE/JPEG")).toBe(true);
    expect(baseMime("Application/PDF")).toBe("application/pdf");
  });

  it("todo lo demás se descarga, sea peligroso o solo desconocido", () => {
    for (const mime of [
      "text/html",
      "image/svg+xml",
      "application/xhtml+xml",
      "text/plain",
      "text/csv",
      "application/zip",
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/bmp",
      "video/x-msvideo",
      "",
      "nada",
    ]) {
      expect(isPreviewable(mime), mime || "(vacío)").toBe(false);
    }
    expect(isPreviewable(null)).toBe(false);
    expect(isPreviewable(undefined)).toBe(false);
  });
});

describe("isForbiddenUploadMime (lo que no se envía ni como documento)", () => {
  it("HTML, XHTML y SVG, con o sin parámetros", () => {
    expect(isForbiddenUploadMime("text/html")).toBe(true);
    expect(isForbiddenUploadMime("text/html; charset=utf-8")).toBe(true);
    expect(isForbiddenUploadMime("application/xhtml+xml")).toBe(true);
    expect(isForbiddenUploadMime("image/svg+xml")).toBe(true);
    expect(isForbiddenUploadMime("Image/SVG+XML")).toBe(true);
  });

  it("el resto de documentos sigue pasando", () => {
    expect(isForbiddenUploadMime("application/pdf")).toBe(false);
    expect(isForbiddenUploadMime("image/png")).toBe(false);
    expect(isForbiddenUploadMime("text/plain")).toBe(false);
    expect(isForbiddenUploadMime(null)).toBe(false);
  });
});

describe("contentTypeFor (lo que se declara)", () => {
  it("conserva un MIME bien formado, con sus parámetros", () => {
    expect(contentTypeFor("image/jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("audio/ogg; codecs=opus")).toBe("audio/ogg; codecs=opus");
    expect(contentTypeFor(" Application/PDF ")).toBe("application/pdf");
  });

  it("sin tipo o con basura → octet-stream (con nosniff: «descárgalo»)", () => {
    expect(contentTypeFor(null)).toBe("application/octet-stream");
    expect(contentTypeFor("")).toBe("application/octet-stream");
    expect(contentTypeFor("nada")).toBe("application/octet-stream");
    expect(contentTypeFor("text/html\r\nx-inyectada: 1")).toBe(
      "application/octet-stream"
    );
  });
});

describe("contentDisposition (el nombre del archivo)", () => {
  it("sin nombre, solo el modo", () => {
    expect(contentDisposition("inline", null)).toBe("inline");
    expect(contentDisposition("attachment", "")).toBe("attachment");
  });

  it("conserva acentos en filename* y deja un respaldo ASCII", () => {
    expect(contentDisposition("inline", "cotización.pdf")).toBe(
      "inline; filename=\"cotizaci_n.pdf\"; filename*=UTF-8''cotizaci%C3%B3n.pdf"
    );
  });

  it("ni comillas, ni saltos de línea, ni rutas", () => {
    const cd = contentDisposition("attachment", 'a"b\r\nc/..\\d.txt');
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).toContain('filename="a_b__c_.._d.txt"');
    expect(cd).not.toContain("/");
  });
});

describe("mediaResponseHeaders (lo que ve el navegador)", () => {
  const siempre = (h: Record<string, string>) => {
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(h["cache-control"]).toBe("private, max-age=86400");
  };

  it("una imagen va inline, con nosniff y CSP sandbox", () => {
    const h = mediaResponseHeaders({ mimeType: "image/jpeg", fileName: null }, 1234);
    siempre(h);
    expect(h["content-type"]).toBe("image/jpeg");
    expect(h["content-length"]).toBe("1234");
    expect(h["content-disposition"]).toBe("inline");
  });

  it("un PDF con nombre va inline y conserva el nombre", () => {
    const h = mediaResponseHeaders(
      { mimeType: "application/pdf", fileName: "cotizacion.pdf" },
      10
    );
    siempre(h);
    expect(h["content-disposition"]).toMatch(/^inline; filename="cotizacion\.pdf"/);
  });

  it("un .docx se descarga (attachment) con su nombre", () => {
    const h = mediaResponseHeaders(
      {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "contrato.docx",
      },
      10
    );
    siempre(h);
    expect(h["content-disposition"]).toMatch(/^attachment; filename="contrato\.docx"/);
  });

  it("un HTML que entró como «documento» desde WhatsApp jamás se abre como página", () => {
    const h = mediaResponseHeaders({ mimeType: "text/html", fileName: "factura.html" }, 10);
    siempre(h);
    expect(h["content-disposition"]).toMatch(/^attachment;/);
  });

  it("un asset sin tipo se descarga como octet-stream", () => {
    const h = mediaResponseHeaders({ mimeType: null, fileName: null }, 10);
    siempre(h);
    expect(h["content-type"]).toBe("application/octet-stream");
    expect(h["content-disposition"]).toBe("attachment");
  });
});
