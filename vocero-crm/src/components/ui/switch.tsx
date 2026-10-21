"use client";

import { cn } from "@/lib/utils";

/**
 * El interruptor del CRM: el del Agente (Encendido/Apagado) y el de «IA en
 * esta conversación» son ESTE componente. Antes eran dos copias a mano y
 * divergieron dos veces, las dos en #53: primero el pomo perdió su sombra,
 * después el del Agente se salió de la pista. `tests/unit/switch.test.ts`
 * impide que vuelva a aparecer otra copia.
 *
 * Por qué `inline-flex` y no un pomo `absolute`: un `<button>` centra su
 * contenido por defecto, así que un hijo absoluto sin `left` arranca desde el
 * CENTRO de la pista y al desplazarse queda medio afuera. Con flex el pomo
 * parte del borde interior izquierdo (`px-0.5`) y se desplaza exactamente el
 * ancho que le sobra a la pista.
 */

const SIZES = {
  /** Cabeceras: la pista de 44 px que ya usaba el Agente. */
  md: { track: "h-6 w-11 px-0.5", knob: "h-5 w-5", on: "translate-x-5" },
  /** Paneles compactos: la de 36 px del panel de contacto. */
  sm: { track: "h-5 w-9 px-0.5", knob: "h-4 w-4", on: "translate-x-4" },
} as const;

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  size = "md",
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Nombre accesible: el interruptor no lleva texto propio. */
  label: string;
  disabled?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors",
        // El anillo de `ui/button`: el acento sólido, separado de la pista
        // (encendida ya es del color del acento). El suave (`ring-brand-soft`)
        // queda a ~1.3:1 del fondo y se veía menos que el del navegador.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-40",
        s.track,
        checked ? "bg-brand" : "bg-border-strong",
        className
      )}
    >
      {/* `shadow-sm` no es adorno: el pomo es `--knob` (blanco) y sobre el
          acento se perdía sin él. */}
      <span
        aria-hidden
        className={cn(
          "rounded-full bg-knob shadow-sm transition-transform",
          s.knob,
          checked ? s.on : "translate-x-0"
        )}
      />
    </button>
  );
}
