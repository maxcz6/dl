# E2E — Importar contactos y «sin agente» (027)

Arnés: `scripts/e2e-importar.mjs`. Spec:
[`specs/027-importar-contactos/spec.md`](../../specs/027-importar-contactos/spec.md).

Precondición: app corriendo (`next dev`) sobre una base migrada, con
simuladores (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock con `OPENROUTER_API_TOKEN` y
`OPENROUTER_MODEL`), `BOT_API_KEY`, `AGENT_COALESCE_MS=1500` y
`BRAIN_DISPATCH_URL` hacia un cerebro que contesta (el del arnés de
`us-despacho.md`), con el interruptor del Agente encendido. 036 — el CRM no
trae agente: «el agente contesta» es «el CRM le despacha al cerebro y el
cerebro contesta»; «no le contesta» es «no se le despacha».

El arnés importa por la misma ruta que usa el diálogo (`POST
/api/contacts/import`), hace escribir a los importados por WhatsApp y mira qué
quedó en Contactos y en la bandeja.

```bash
node --env-file=.env scripts/e2e-importar.mjs
```

## Un archivo de 50 renglones

1. 50 renglones buenos, con los teléfonos como vienen en una hoja de cálculo
   (`+52 1…`, con espacios, sin el 1), más cuatro que no sirven → 200,
   `created: 50`, y los cuatro vuelven con su renglón y su motivo
   (`sin_codigo_pais`, `repetido`, `telefono_invalido`, `sin_telefono`).
2. Los 50 salen en Contactos, guardados como los guarda la ingesta (`52…` y
   diez dígitos), con agente y fuera del Pipeline. No nace ninguna conversación.
3. Importar otra vez el mismo archivo → `created: 0`, `existing: 50`. Siguen
   siendo 50.

## «El agente no les responde»

4. Alguien que ya escribía (conversación con agente, que le contestó) entra en
   un archivo importado con la casilla marcada, junto a una persona nueva y un
   renglón sin nombre → `created: 2`, `existing: 1`, `paused: 3`.
5. La persona nueva existe una sola vez, «sin agente», sin etapa y sin
   conversación. A quien ya existía no se le cambió el nombre, y su
   conversación quedó con la IA en pausa.
6. El importado escribe: su conversación nace con la IA en pausa, cae en su
   misma ficha, conserva el nombre del archivo (no el de su perfil de
   WhatsApp) y queda sin leer. No se le despacha al cerebro, ni a quien ya
   existía.
7. El renglón sin nombre entró con el teléfono como nombre, y toma el de
   WhatsApp en cuanto escribe.
8. Un desconocido sí se despacha y el cerebro le contesta.
9. `PATCH /api/contacts/{id}` con `aiPaused: false` → el contacto deja de
   estar «sin agente», su conversación vuelve a tener IA y su siguiente
   mensaje se despacha. Editar otra cosa del contacto no toca la pausa.

## Lo que no se importa

10. Ningún teléfono válido → 422 `nothing_to_import`. Lista vacía → 422. Más
    de 2,000 renglones → 422, sin importar ninguno. Sin sesión → 401.

## Interfaz (a mano, claro y oscuro)

- Contactos → «Importar»: un CSV como lo exporta Excel en español (BOM, punto y
  coma, «Teléfono» con acento, apellidos en su columna, un nombre con coma
  entre comillas). La vista previa dice cuántos entran, enseña los primeros y
  lista los que se quedan fuera con su motivo.
- Tras importar con la casilla marcada, la lista enseña «Sin agente».
- «Editar» de un contacto trae la casilla «El agente no le responde».
