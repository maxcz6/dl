import { describe, expect, it } from "vitest";
import { destinatarioMeta, esBsuid } from "@/lib/meta/destinatario";

/**
 * A quién va un mensaje de la Cloud API.
 *
 * Meta pide el teléfono y el BSUID en campos DISTINTOS:
 *
 *   teléfono → `{ to }`
 *   BSUID    → `{ recipient_type: "individual", recipient }`
 *
 * Se mandaba el BSUID en `to`, donde Meta espera un número, y respondía
 * 131026 — «el destinatario no puede recibir mensajes de WhatsApp (número
 * inexistente, sin cuenta o que no acepta mensajes de empresas)». O sea: el
 * CRM le echaba la culpa al cliente del miembro por un campo mal puesto.
 *
 * Se veía solo con algunos contactos porque Meta omite el teléfono cuando
 * coinciden TRES condiciones: el usuario activó su nombre de usuario, no ha
 * habido interacción con ese número de empresa en 30 días, y no está en la
 * agenda. Por eso parecía aleatorio.
 */

describe("destinatarioMeta", () => {
  it("un teléfono va en `to`", () => {
    expect(destinatarioMeta("5214627015001", null)).toEqual({
      to: "5214627015001",
    });
  });

  it("un BSUID va en `recipient`, con su `recipient_type`", () => {
    expect(destinatarioMeta(null, "CO.1502852711544066")).toEqual({
      recipient_type: "individual",
      recipient: "CO.1502852711544066",
    });
  });

  /**
   * La documentación dice que si van los dos, el teléfono tiene precedencia.
   * Mandar ambos solo añadiría un campo que Meta ignora.
   */
  it("con los dos, gana el teléfono y el BSUID no viaja", () => {
    const d = destinatarioMeta("5214627015001", "CO.150285");
    expect(d).toEqual({ to: "5214627015001" });
    expect(JSON.stringify(d)).not.toContain("CO.150285");
  });

  it("sin ninguno de los dos no hay destinatario", () => {
    expect(destinatarioMeta(null, null)).toBeNull();
  });

  /**
   * La invariante que impide el fallo original: el BSUID NUNCA puede acabar
   * en `to`. Si alguien invierte la condición, esto lo dice.
   */
  it("el BSUID jamás aparece en `to`", () => {
    const d = destinatarioMeta(null, "CO.1502852711544066")!;
    expect("to" in d).toBe(false);
    expect(esBsuid(d)).toBe(true);
    expect(esBsuid({ to: "521462" })).toBe(false);
  });
});
