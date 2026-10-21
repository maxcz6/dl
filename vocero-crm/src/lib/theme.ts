/**
 * Tema claro/oscuro. La preferencia es POR DISPOSITIVO (cookie), no por
 * organización ni por usuario en BD: quien trabaja de noche no se lo impone a
 * su equipo, y no hace falta migración.
 *
 * Sin parpadeo y sin script de arranque: la preferencia SIEMPRE es explícita,
 * así que el layout raíz escribe `data-theme` en el HTML del servidor y el
 * primer pintado ya llega con el tema correcto.
 *
 * No hay opción "seguir al sistema" a propósito: el CRM se usa toda la jornada
 * y un cambio automático al anochecer sorprende en mitad de una conversación.
 */

export const THEME_COOKIE = "vocero-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemePreference = "light" | "dark";
/** El tema que de verdad está pintado en el DOM. Hoy coincide siempre con la
 *  preferencia; se nombra aparte porque quien lo lee (la vista previa del
 *  acento) pregunta por lo pintado, no por lo guardado. */
export type ResolvedTheme = ThemePreference;

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: "Claro",
  dark: "Oscuro",
};

/**
 * Cookie ausente o con cualquier otro valor → claro, que es el aspecto
 * histórico del CRM. Nunca lanza: una cookie manipulada no debe tumbar el
 * layout raíz, que es de donde cuelga toda la app.
 */
export function normalizeThemePreference(
  value: string | null | undefined
): ThemePreference {
  return value === "dark" ? "dark" : "light";
}

/** Siguiente valor del botón: Claro ⇄ Oscuro. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return current === "dark" ? "light" : "dark";
}
