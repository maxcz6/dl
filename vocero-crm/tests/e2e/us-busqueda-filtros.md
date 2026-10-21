# Guion E2E — Búsqueda de la Bandeja y filtro por etapa del embudo

> Automatizado en `scripts/e2e-search-filters.mjs` (26 checks, Playwright
> contra `pnpm dev` con wa-mock). Nace del reporte de Kevin del 2026-08-05:
> «escribo Kevin en el buscador y no me da los resultados».

## El fallo original: teclear mientras la página aún carga

La caja de búsqueda se pinta en el HTML del servidor, así que se puede
escribir en ella antes de que hidrate React. Al montar, React la dejaba vacía
y esas pulsaciones se perdían **en silencio**: el usuario veía la bandeja
entera sin filtrar. Por eso el input es NO controlado (`defaultValue` + ref) y
al montar se adopta lo que ya haya en el DOM.

1. Abrir `/inbox` y escribir en el buscador **antes** de que aparezcan las
   conversaciones (`waitUntil: "commit"`).
   ✅ El texto sigue en la caja tras hidratar.
   ✅ La lista queda filtrada a esa persona.

## Búsqueda tolerante (Bandeja, cliente — `matchesQuery`)

2. `jose` encuentra a «Josué Ramírez»; `RAMÍREZ` también.
   ✅ Acentos y mayúsculas indistintos en ambos sentidos.
3. Teléfono **como se ve en pantalla**: `+52 462 555 0101`, `462 555`,
   `462-555-0101`.
   ✅ Coinciden — la comparación es por dígitos (la BD guarda `524625550101`).
4. `vi su anuncio` (texto del último mensaje) → **no** coincide.
   ✅ El buscador mira nombre y teléfono, nada más. Incluir el preview hacía
   que buscar el nombre del dueño devolviera 17 de 32 chats, porque el agente
   lo escribe en sus propios mensajes. Y era una búsqueda de mensajes a
   medias: solo el último de cada hilo.
5. `zzz-no-existe` → lista vacía; el botón ✕ limpia y devuelve todo.
6. `46` (dos dígitos) **no** empareja teléfonos.
   ✅ Mínimo 3 dígitos: si no, un dígito suelto barre el directorio.

## Filtro por etapa del embudo

7. Bandeja: selector junto a «Todas / No leídas», con las etapas presentes.
   ✅ Filtrar deja solo esa etapa; «Toda etapa» restaura.
   ✅ Búsqueda + etapa se combinan (nunca se contradicen).
8. Contactos: selector con las etapas del pipeline **completo** (orden real,
   vía `GET /api/pipeline/stages`), y la etapa pintada en cada ficha.
   ✅ Filtrar por etapa consulta al servidor (`?stage=`), aplicado ANTES del
   corte de 200 para que nadie de esa etapa quede fuera.
9. Camino infeliz: una etapa sin contactos no rompe la pantalla.
   ✅ Estado vacío honesto («Sin resultados», no «Sin contactos»).

## Búsqueda del servidor (Contactos)

10. `jose` → «Josué Ramírez»; `+52 462 555 0101` → el contacto con ese número.
    ✅ Espejo en SQL de `matchesQuery`: `translate()` para los acentos (sin
    depender de la extensión `unaccent`) y `regexp_replace` para los dígitos.
    ✅ Los comodines de LIKE (`%`, `_`) van escapados: teclear `%` no lista todo.
