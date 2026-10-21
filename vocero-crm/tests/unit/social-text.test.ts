import { describe, expect, it } from "vitest";
import { plainSocialText } from "@/lib/social-text";

describe("024 · texto de la IA sin formato para redes", () => {
  it("quita el formato de WhatsApp y deja el contenido", () => {
    expect(plainSocialText("*Precio:* $120 por pieza")).toBe("Precio: $120 por pieza");
    expect(plainSocialText("Es _muy_ resistente")).toBe("Es muy resistente");
    expect(plainSocialText("Antes ~$200~, ahora $150")).toBe("Antes $200, ahora $150");
    expect(plainSocialText("El código es `ABC-123`.")).toBe("El código es ABC-123.");
  });

  it("quita el formato de Markdown", () => {
    expect(plainSocialText("**Hola** y __gracias__ por ~~nada~~ todo")).toBe(
      "Hola y gracias por nada todo"
    );
    expect(plainSocialText("# Horarios\n## Entre semana\nDe 9 a 6")).toBe(
      "Horarios\nEntre semana\nDe 9 a 6"
    );
  });

  it("las listas quedan con viñeta", () => {
    expect(plainSocialText("Tenemos:\n- Martillos\n* Clavos\n+ Tornillos")).toBe(
      "Tenemos:\n• Martillos\n• Clavos\n• Tornillos"
    );
    // Una lista numerada ya se lee bien.
    expect(plainSocialText("1. Uno\n2. Dos")).toBe("1. Uno\n2. Dos");
  });

  it("una viñeta con negrita: las dos cosas", () => {
    expect(plainSocialText("- *Martillo:* $120\n- **Clavos:** $30")).toBe(
      "• Martillo: $120\n• Clavos: $30"
    );
  });

  it("un enlace de Markdown queda como texto y dirección", () => {
    expect(plainSocialText("Mira el [catálogo](https://tienda.mx/catalogo_2026).")).toBe(
      "Mira el catálogo: https://tienda.mx/catalogo_2026."
    );
    expect(plainSocialText("[https://tienda.mx](https://tienda.mx)")).toBe("https://tienda.mx");
  });

  it("una URL sale intacta, con sus guiones bajos y asteriscos", () => {
    const url = "https://tienda.mx/p/martillo_de_bola_16oz?ref=ig_dm&x=*a*";
    expect(plainSocialText(`Aquí está: ${url}`)).toBe(`Aquí está: ${url}`);
    expect(plainSocialText(`_Nuevo_ ${url} _hoy_`)).toBe(`Nuevo ${url} hoy`);
  });

  it("un bloque de código queda como su contenido", () => {
    expect(plainSocialText("Tu pedido:\n```\n2 martillos\n1 caja\n```\nGracias")).toBe(
      "Tu pedido:\n2 martillos\n1 caja\nGracias"
    );
  });

  it("no toca lo que no es formato", () => {
    for (const texto of [
      "2 * 3 * 4 = 24",
      "5*3=15",
      "la variable mi_variable_larga",
      "archivo_final_v2.pdf",
      "Cuesta $100 * unidad",
      "¿Te sirve? :) *",
      "a_b y c_d",
      "Hola, ¿en qué te ayudo?",
      "1. Uno\n2. Dos",
    ]) {
      expect(plainSocialText(texto)).toBe(texto);
    }
  });

  it("formato anidado y con signos alrededor", () => {
    expect(plainSocialText("*_Oferta_*")).toBe("Oferta");
    expect(plainSocialText("¡*Hola*! ¿_Todo bien_?")).toBe("¡Hola! ¿Todo bien?");
    expect(plainSocialText("(*nota*)")).toBe("(nota)");
    expect(plainSocialText("«*cita*»")).toBe("«cita»");
  });

  it("varias marcas en la misma línea no se comen el texto de en medio", () => {
    expect(plainSocialText("*uno* y *dos* y *tres*")).toBe("uno y dos y tres");
    expect(plainSocialText("**a** b **c**")).toBe("a b c");
  });

  it("los emojis y los saltos de línea se conservan", () => {
    const texto = "¡Listo! 🎉\n\nTu cita quedó para el *martes* 📅";
    expect(plainSocialText(texto)).toBe("¡Listo! 🎉\n\nTu cita quedó para el martes 📅");
  });

  it("es idempotente", () => {
    for (const texto of [
      "*Precio:* $120\n- **Martillo**\n[ver](https://x.mx/a_b)",
      "# Título\n```\ncódigo\n```",
      "• ya plano",
      "",
    ]) {
      const una = plainSocialText(texto);
      expect(plainSocialText(una)).toBe(una);
    }
  });
});
