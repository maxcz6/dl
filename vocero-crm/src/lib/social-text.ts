/**
 * 024 — El texto de la IA, sin formato, para los canales que no lo dibujan.
 *
 * Los cerebros (Nea u otro) escriben como si todo fuera
 * WhatsApp: `*negrita*`, `_cursiva_`, y a veces Markdown entero. WhatsApp lo
 * dibuja; Instagram, Messenger y TikTok enseñan los asteriscos tal cual. Aquí
 * se quitan las marcas y se deja el contenido.
 *
 * Puro y sin dependencias: lo usa el servidor al enviar. Es idempotente
 * (aplicarlo dos veces da lo mismo que una), que es lo que deja reintentar un
 * envío sin miedo.
 *
 * Qué NO es: un intérprete de Markdown. Es conservador a propósito: una marca
 * solo se quita si abre pegada a una palabra y cierra pegada a otra, que es
 * como las escribe un modelo. `2 * 3 * 4`, `mi_variable` o `5*3` no son
 * formato y se quedan como están.
 */

// Marcadores de un solo carácter (WhatsApp y Markdown): *x*, _x_, ~x~, `x`.
// Abre al inicio, tras un espacio o tras un signo de apertura; cierra antes de
// un espacio, un signo de puntuación o el final.
const SIMPLE =
  /(^|[\s(¿¡"'«])([*_~`])(?=\S)([^\n]*?\S)\2(?=$|[\s.,!?;:)"'»…])/gm;

export function plainSocialText(text: string): string {
  // Las URLs se apartan primero: sus guiones bajos no son cursivas y sus
  // asteriscos no son negritas.
  const urls: string[] = [];
  const guardar = (url: string) => {
    urls.push(url);
    return `\u0000${urls.length - 1}\u0000`;
  };

  let out = text
    // [texto](https://…) → texto: https://…  (si el texto ES la URL, solo la URL)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
      label.trim() === url ? guardar(url) : `${label}: ${guardar(url)}`
    )
    .replace(/https?:\/\/[^\s<>]+/g, guardar)
    // Bloques entre ``` → su contenido.
    .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_m, code: string) => code.replace(/\n$/, ""))
    // # Título → Título
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "$1")
    // - uno · * uno · + uno → • uno
    .replace(/^([ \t]*)[-*+][ \t]+(?=\S)/gm, "$1• ")
    // Marcadores dobles de Markdown.
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "$1")
    .replace(/__(?=\S)([^\n]*?\S)__/g, "$1")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "$1");

  // Los simples pueden venir anidados (`*_hola_*`): se repite hasta que no
  // quede ninguno. El tope evita un bucle con una entrada rara.
  for (let i = 0; i < 4; i++) {
    const next = out.replace(SIMPLE, "$1$3");
    if (next === out) break;
    out = next;
  }

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => urls[Number(i)] ?? "");
}
