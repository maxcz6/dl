# Guion E2E — Un envío fallido debe decir POR QUÉ

> Automatizado en `scripts/e2e-send-failure.mjs` (15 checks, Playwright contra
> `pnpm dev` con wa-mock). Nace de un caso real en producción.

## El fallo original

Se mandó una plantilla **aprobada** a un número real y el operador solo vio un
triángulo rojo, sin explicación. Meta sí había dicho el motivo en el webhook
de estado:

```json
{ "code": 130472, "title": "User's number is part of an experiment" }
```

El CRM lo guardaba en `message.error` desde el principio… y no lo exponía en
ninguna parte: ni en `MessageDto`, ni en el evento SSE `message.status`, ni en
el hilo. El operador no tenía forma de saber si el problema era suyo o de Meta.

## Camino verificado

1. Enviar un mensaje a una conversación con la ventana abierta.
   ✅ Queda `pending` y el DTO ya trae el campo `error` (en `null`).
2. Meta responde `failed` con `errors[0].code = 130472`
   (`POST /api/dev/wa-mock/status` con `errorCode`/`errorMessage`).
   ✅ El mensaje pasa a `failed`.
   ✅ `error` explica el motivo **en español** ("…está en un experimento…"),
   sugiere la salida (usar una plantilla **UTILITY**) y conserva el código
   `(Meta 130472)` para rastrearlo en la documentación.
3. Abrir el hilo en la Bandeja.
   ✅ Bajo la burbuja aparece «**No se entregó.** …», no un triángulo mudo.
4. Un segundo envío falla con 131049 mientras el hilo está abierto.
   ✅ El motivo aparece **sin recargar**: el evento SSE `message.status` ahora
   viaja con `error`.

## Reglas del traductor (`lib/meta/send-errors.ts`)

- Código conocido → frase accionable en español + `(Meta <código>)`.
- Código desconocido → texto crudo de Meta + código, nunca se pierde.
- Sin código ni texto (o texto en blanco) → "Meta rechazó el envío".
  ⚠️ Con `??` en vez de `||` esto devolvía cadena vacía: un error tan mudo
  como el triángulo. Cubierto en `tests/unit/send-errors.test.ts`.

## Gotcha del harness

El wa-mock numeraba sus salientes `wamid.mock.out.<n>` con un contador que
reinicia con el proceso, mientras la BD conserva los mensajes de corridas
anteriores → el UNIQUE de `wa_message_id` reventaba con 500 al enviar. Ahora
el id lleva un sello por arranque y el outbox expone el `waMessageId`, para no
adivinar su formato desde los tests.
