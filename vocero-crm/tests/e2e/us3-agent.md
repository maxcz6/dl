# Guion E2E — US3: Agente (perfil, interruptor) y Ajustes → IA

> Conducido con Playwright (MCP) contra `pnpm dev` con ai-mock
> (`OPENROUTER_BASE_URL` → `/api/dev/ai-mock`), `BOT_API_KEY` y
> `AGENT_COALESCE_MS=2000`.
>
> **036 — el CRM no trae agente.** Lo que antes probaba este guion (respuesta
> con IA, agrupación, `move_stage`, handoff por frase) era el turno dentro del
> proceso, que se fue. Ese comportamiento es del cerebro: en Nea, con su
> propia suite. Aquí queda lo que el CRM sí hace: guardar el perfil y el
> conocimiento que el cerebro lee, decidir con el interruptor si se le
> despacha, y la llave de IA con la que piensa.

## Preparación

1. En `/agent`: agregar una entrada P/R al KB ("¿Hacen envíos?" → "Sí, a todo
   México en 2-5 días").
   ✅ El contador de tamaño del KB refleja la entrada.
   ✅ `GET /api/bot/profile` con la key trae la entrada en `kb` (`P:`/`R:`).

## El interruptor (036)

2. **Sin cerebro** (app sin `BRAIN_DISPATCH_URL`): encender el interruptor.
   ✅ `PUT /api/agent/profile {enabled:true}` → **409** `sin_cerebro`; la
   pantalla dice qué falta y el interruptor sigue apagado. La tarjeta «Quién
   responde» dice que Vocero funciona como bandeja manual, sin rojo.
3. Un inbound → aparece en la bandeja y nadie contesta solo; el operador
   contesta a mano.
4. **Con cerebro** (`BRAIN_DISPATCH_URL` + `BRAIN_HEALTH_URL` hacia un cerebro
   sano; el de `scripts/e2e-despacho.mjs` sirve): encender → 200. Un inbound
   se despacha (guion `us-despacho.md`). Apagar → 200 siempre, y el siguiente
   inbound se queda en la bandeja (`warning: "apagado"`).

## Caminos infelices

5. **Handoff**: con la conversación traspasada (`POST /api/bot/handoff` o
   pausa desde el panel), un inbound no se despacha. «Reactivar IA» desde el
   panel lo vuelve a permitir.
6. **Sin proveedor de IA (FR-026)**: Agente y Laboratorio muestran estado vacío
   explicativo con enlace a Ajustes → IA (verificado en el checkpoint de
   compose, donde el entorno arranca sin token); `GET /api/bot/profile` trae
   `llm: null` y `POST /api/bot/llm/chat/completions` → **402**
   `sin_credencial`.

## Ajustes → IA (#85, 036)

> Con el ai-mock: una llave con sufijo `-invalid` responde 401 y una con
> `-sin-saldo`, 402 (contrato mocks.md). Sin `OPENROUTER_API_TOKEN` en el
> entorno, para ver el camino sin respaldo. Las llamadas al modelo se hacen
> como las haría el cerebro: `POST /api/bot/llm/chat/completions` con la key.

7. **Configurar desde la interfaz**: en Ajustes → IA elegir «Otro compatible
   con OpenAI», base URL `http://localhost:3000/api/dev/ai-mock`, modelo
   `mock/agente` y una llave cualquiera (p. ej. `llave-de-prueba`).
   ✅ «Probar conexión» → «Conexión correcta (N ms)» sin guardar nada
   (`GET /api/settings/ai` sigue sin credencial).
   ✅ «Traer modelos» rellena la lista con `mock/agente` y `mock/juez`.
   ✅ «Guardar» → «Llave conectada ••••ueba · Activo»; el banner desaparece.
   La pantalla dice para qué es: con ella piensa tu agente (a través del CRM)
   y el juez del Laboratorio. `GET /api/bot/profile` → `llm.model:
   "mock/agente"`, y una llamada a `/api/bot/llm` usa la fila, no el entorno.
8. **Llave rechazada (401 → pausa)**: reemplazar la llave por `llave-invalid`
   y guardar (vuelve a «Activo»: guardar siempre reactiva). Llamar a
   `/api/bot/llm`.
   ✅ La llamada vuelve con el 401 del proveedor; `GET /api/settings/ai` →
   `estado: paused_invalid_token` con `motivo` del proveedor; la pestaña dice
   «Pausado: llave rechazada» y el banner lo avisa en toda la app.
   ✅ La siguiente llamada a `/api/bot/llm` → **402** `sin_credencial`, sin
   tocar al proveedor.
   ✅ «Probar conexión» con la llave guardada → 422 `invalid_token`.
9. **Sin saldo (402)**: igual con `llave-sin-saldo` → `paused_no_credit`,
   «Pausado: sin saldo», y el banner pide recargar y probar la conexión.
10. **Recuperación**: pegar una llave válida y guardar → `active`; o, con la
    guardada, «Probar conexión» cuando el proveedor vuelva a aceptarla →
    «Tu llave vuelve a estar activa».
11. **Quitar**: «Quitar» borra la fila. Con `OPENROUTER_API_TOKEN` en el
    entorno, la pantalla dice que hoy responde con las variables del entorno
    (••••last4) y `/api/bot/llm` sigue funcionando; sin él, vuelve el estado
    vacío y `llm: null`.
