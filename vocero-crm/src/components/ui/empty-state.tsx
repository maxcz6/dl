import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * #87 — Un solo estado vacío para todas las pantallas: icono en un círculo
 * del acento, título, una línea que dice qué va a pasar aquí y, si hay algo
 * que hacer ahora mismo, el botón para hacerlo.
 *
 * Centra en el espacio que le den (la Bandeja le da la columna entera; las
 * Plantillas, una tarjeta punteada): el contenedor lo pone quien lo usa por
 * `className`.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-6 text-center",
        className
      )}
    >
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand">
        <Icon className="h-6 w-6" strokeWidth={1.6} aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-text-3">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
