import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  kindFromMime,
  MediaValidationError,
  validateOutgoing,
} from "@/server/whatsapp/media";

/**
 * 008 — Validación previa de adjuntos salientes (FR-007): tipo y tamaño se
 * rechazan ANTES de tocar disco o la API; y el sandbox del Laboratorio
 * sigue siendo infranqueable también para adjuntos (FR-014).
 */

const MB = 1024 * 1024;

describe("validateOutgoing (límites de la Cloud API)", () => {
  it("imagen jpeg de 1 MB → image", () => {
    expect(validateOutgoing("image/jpeg", 1 * MB)).toBe("image");
  });

  it("imagen de 6 MB → too_large (límite 5 MB)", () => {
    expect(() => validateOutgoing("image/png", 6 * MB)).toThrowError(
      expect.objectContaining({ code: "too_large" })
    );
  });

  it("imagen bmp (no nativa) → va como documento, igual que en WhatsApp", () => {
    expect(validateOutgoing("image/bmp", 1 * MB)).toBe("document");
  });

  it("MIME malformado → unsupported_type", () => {
    expect(() => validateOutgoing("nada", 1 * MB)).toThrowError(
      expect.objectContaining({ code: "unsupported_type" })
    );
  });

  it("HTML y SVG no se envían ni como documento (#78), con un mensaje que explica", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/xhtml+xml"]) {
      expect(() => validateOutgoing(mime, 1024), mime).toThrowError(
        expect.objectContaining({
          code: "unsupported_type",
          message: expect.stringContaining("HTML y SVG"),
        })
      );
    }
  });

  it("pdf de 10 MB → document; de 101 MB → too_large", () => {
    expect(validateOutgoing("application/pdf", 10 * MB)).toBe("document");
    expect(() => validateOutgoing("application/pdf", 101 * MB)).toThrowError(
      MediaValidationError
    );
  });

  it("video mp4 de 20 MB → too_large (límite 16 MB)", () => {
    expect(() => validateOutgoing("video/mp4", 20 * MB)).toThrowError(
      expect.objectContaining({ code: "too_large" })
    );
  });

  it("clasificación por MIME", () => {
    expect(kindFromMime("audio/ogg")).toBe("audio");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("application/zip")).toBe("document");
  });
});

/* ---------- Sandbox del Laboratorio en el envío de adjuntos ---------- */

const { graphRequest, uploadGraphMedia, saveMediaFile } = vi.hoisted(() => ({
  graphRequest: vi.fn(),
  uploadGraphMedia: vi.fn(),
  saveMediaFile: vi.fn(),
}));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/media")>();
  return { ...original, uploadGraphMedia, saveMediaFile };
});

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id" },
    contact: { id: "id" },
    message: {},
    mediaAsset: {},
  },
}));

describe("sandbox del Laboratorio en el envío de adjuntos", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    uploadGraphMedia.mockReset();
    saveMediaFile.mockReset();
    selectRows.length = 0;
  });

  it("conversación is_test → sandbox_violation sin tocar disco ni Graph", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_test",
          organizationId: "org_1",
          isTest: true,
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_1", phone: "5215511111111" },
      },
    ]);
    const { sendMediaMessage } = await import("@/server/inbox/send");

    await expect(
      sendMediaMessage({
        conversationId: "cv_test",
        organizationId: "org_1",
        file: { data: Buffer.from("x"), mimeType: "image/jpeg" },
      })
    ).rejects.toMatchObject({ code: "sandbox_violation" });

    expect(saveMediaFile).not.toHaveBeenCalled();
    expect(uploadGraphMedia).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
  });
});
