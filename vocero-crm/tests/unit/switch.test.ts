import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "@/components/ui/switch";

/**
 * El interruptor compartido (#53).
 *
 * El del Agente y el de «IA en esta conversación» eran dos copias a mano y
 * divergieron dos veces: primero el pomo perdió su sombra; después el del
 * Agente quedó `absolute` sin `left`, arrancaba del CENTRO de la pista y
 * encendido se salía. Aquí se fija la geometría —con las clases de Tailwind,
 * una unidad son 4 px— y que no vuelva a aparecer otra copia.
 *
 * Si estás leyendo esto porque se puso rojo: no copies el interruptor,
 * extiende `components/ui/switch.tsx`.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const UNICO = path.join(SRC, "components", "ui", "switch.tsx");

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivos(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

type Props = Parameters<typeof Switch>[0];

function dibujar(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(Switch, {
      checked: false,
      onCheckedChange: () => {},
      label: "Prueba",
      ...props,
    })
  );
}

/** Clases de la pista (el `<button>`) y del pomo (su `<span>`). */
function clases(html: string): { pista: string[]; pomo: string[] } {
  const de = (re: RegExp) => re.exec(html)?.[1]?.split(/\s+/) ?? [];
  return {
    pista: de(/<button[^>]*class="([^"]*)"/),
    pomo: de(/<span[^>]*class="([^"]*)"/),
  };
}

/** `w-11` → 44 px, `px-0.5` → 2 px, `translate-x-5` → 20 px; sin la clase, 0. */
function px(lista: string[], prefijo: string): number {
  const c = lista.find((x) => x.startsWith(prefijo));
  return c ? Number(c.slice(prefijo.length)) * 4 : 0;
}

describe("interruptor: el pomo no se sale de la pista (#53)", () => {
  for (const size of ["md", "sm"] as const) {
    it(`${size}: apagado pegado al borde izquierdo, encendido al derecho`, () => {
      const apagado = clases(dibujar({ size, checked: false }));
      const encendido = clases(dibujar({ size, checked: true }));

      // El pomo se acomoda con flex desde el borde interior izquierdo. Uno
      // `absolute` dentro de un <button> sin `left` arranca del centro: es
      // exactamente el bug que se reportó.
      expect(apagado.pista).toEqual(expect.arrayContaining(["inline-flex", "items-center"]));
      expect(apagado.pomo).not.toContain("absolute");

      const pista = px(apagado.pista, "w-");
      const margen = px(apagado.pista, "px-");
      const pomo = px(apagado.pomo, "w-");
      expect(pista).toBeGreaterThan(0);
      expect(margen).toBeGreaterThan(0);

      // Apagado: sin desplazamiento, el pomo queda a `margen` del borde.
      expect(px(apagado.pomo, "translate-x-")).toBe(0);
      // Encendido: se desplaza justo lo que le sobra a la pista y queda a
      // `margen` del borde derecho. Ni un píxel afuera.
      expect(margen + pomo + px(encendido.pomo, "translate-x-") + margen).toBe(pista);

      // Y cabe a lo alto.
      expect(px(apagado.pomo, "h-")).toBeLessThan(px(apagado.pista, "h-"));
    });
  }
});

describe("interruptor: accesible", () => {
  it("es un switch con nombre y estado, y no envía formularios", () => {
    const html = dibujar({ checked: true, label: "Agente encendido" });
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Agente encendido"');
    expect(html).toContain('type="button"');
    expect(dibujar({ checked: false })).toContain('aria-checked="false"');
  });

  it("deshabilitado se ve atenuado y no se puede operar", () => {
    const { pista } = clases(dibujar({ disabled: true }));
    expect(dibujar({ disabled: true })).toMatch(/<button[^>]*disabled=""/);
    expect(pista).toContain("disabled:opacity-40");
  });

  it("tiene anillo de foco visible para quien usa el teclado", () => {
    // El acento sólido, que por construcción contrasta ≥ 3:1 con el fondo en
    // los dos temas (ver resolveAccentSet), separado de la pista: encendida
    // ya es del color del acento. El suave (`ring-brand-soft`) no llega.
    const { pista } = clases(dibujar({ checked: true }));
    expect(pista).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-ring",
        "focus-visible:ring-offset-2",
      ])
    );
    expect(pista).not.toContain("focus-visible:ring-brand-soft");
  });
});

describe("interruptor: uno solo en todo el producto", () => {
  it("nadie más dibuja un `role=\"switch\"` a mano", () => {
    const copias = archivos(SRC).filter(
      (f) =>
        path.resolve(f) !== path.resolve(UNICO) &&
        readFileSync(f, "utf8").includes('role="switch"')
    );
    expect(copias.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("el Agente y la IA de la conversación usan el compartido", () => {
    for (const rel of ["components/agent/agent-client.tsx", "components/inbox/contact-panel.tsx"]) {
      const code = readFileSync(path.join(SRC, rel), "utf8");
      expect(code, rel).toContain('from "@/components/ui/switch"');
      expect(code, rel).toMatch(/<Switch\b/);
    }
  });
});
