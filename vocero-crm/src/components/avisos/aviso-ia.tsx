import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { AvisoIa } from "@/server/ai/aviso";

/**
 * La franja que dice que el agente no puede contestar (issue #85).
 *
 * Sin descartar. Un banner que se cierra es un banner que se cierra una vez y
 * nunca se vuelve a ver, y esto no es una novedad: es que el producto no está
 * haciendo lo que el dueño cree que hace. Se va solo cuando se arregla.
 */
export function AvisoIaBanner({ aviso }: { aviso: AvisoIa }) {
  if (!aviso) return null;
  return (
    <div
      role="status"
      data-aviso-ia
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning-soft bg-warning-tint px-4 py-2.5 text-[13px] text-warning-text"
    >
      <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.7} />
      <span className="min-w-0 flex-1">{aviso.mensaje}</span>
      <Link
        href="/settings/ai"
        className="shrink-0 font-medium underline underline-offset-2"
      >
        {aviso.accion} →
      </Link>
    </div>
  );
}
