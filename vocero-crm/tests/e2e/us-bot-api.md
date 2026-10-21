# E2E — API de servicio para un cerebro externo (`/api/bot/*`)

Precondición: app corriendo con mocks (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock), organización creada, conexión WhatsApp
guardada y `BOT_API_KEY` configurada (≥16 caracteres).

Esta superficie NO la usa el navegador: la usa el cerebro (Nea o un bot propio
del operador), que conduce la conversación sin que el token de WhatsApp salga
del CRM. Desde la 036 es la única forma de que alguien conteste solo: el CRM no
trae agente.

## Autorización

1. `GET /api/bot/media/media123` SIN header `X-API-Key` → **401** `unauthorized`.
2. Lo mismo con una key equivocada → **401** (mismo cuerpo: no filtra si la key
   existe o no).

## Presencia: marcar leído + "escribiendo…"

3. Provocar un inbound (`POST /api/dev/wa-mock/inbound`) y tomar el
   `conversationId` de `GET /api/conversations`.
4. `POST /api/bot/typing {conversationId}` con la key → **200** `{ok: true}`.
5. `GET /api/dev/wa-mock/outbox` → el conteo NO cambió: marcar leído y el
   indicador no son mensajes salientes y no contaminan la bandeja.
6. Pausar la IA de esa conversación (toggle del panel, o
   `PATCH /api/conversations/{id} {aiEnabled:false}`) y repetir typing →
   **200** `{ok:false, reason:"ai_paused"}` y Meta ni se toca: con un humano
   atendiendo, "escribiendo…" le mentiría al cliente.
7. Conversación del Laboratorio (`is_test`) → `{ok:false, reason:"sandbox"}`.

## Media proxy

8. `GET /api/bot/media/media123` con la key → **200**, `content-type: image/*`
   y cuerpo no vacío. El token de WhatsApp nunca viajó al bot.
9. `GET /api/bot/media/media-inexistente` cuando Graph responde 404 → **404**
   `media_meta_failed` (no 500).

## Reinicio de la conversación de pruebas

10. Con la conversación en handoff (`aiEnabled:false`), `POST /api/bot/reset
    {conversationId}` con la key → **200** `{ok:true}`.
11. `GET /api/conversations` → esa conversación vuelve con `aiEnabled: true` y
    sin `handoffAt`; el lead está en la PRIMERA etapa del pipeline.
12. El historial de mensajes del inbox sigue completo: el reset es de estado,
    no borra auditoría.
13. `POST /api/bot/reset` sin key → **401**.

## Perfil del agente y knowledge base

El bot externo no adivina el negocio: lo lee de las mismas dos pantallas que
edita el dueño (Agente y su knowledge base). Este endpoint es el contrato.

14. `GET /api/bot/profile` con la key → **200** con la forma exacta
    `{profile: {name, tone, instructions, escalationRules, greeting}, kb, resources}`.
    Los cinco campos del perfil coinciden con lo guardado en la pantalla Agente;
    los opcionales vacíos viajan como `null`, no como cadena vacía.
15. `kb` es el knowledge base ya renderizado (`P:`/`R:` para las preguntas,
    los bloques tal cual, en el orden de la pantalla). Con el KB vacío viaja
    la cadena canónica `(knowledge base vacío)`, no `null`: el bot puede
    inyectarla en su prompt sin ramificar.
16. `profile.enabled` NO viene, ni con el interruptor encendido ni apagado:
    ese flag decide si el CRM despacha (036), y el cerebro se pausa por
    conversación (`aiEnabled` y los handoffs).
    036 — `llm` viene con `{path: "/api/bot/llm", model: <el de Ajustes →
    IA>}`; sin IA configurada (ni en Ajustes → IA ni en el entorno), `llm:
    null`.
17. Editar el tono en la pantalla Agente y volver a pedir el perfil → el cambio
    ya está: la respuesta no se cachea.

## Contexto de la conversación

Lo que solo el CRM sabe: quién es la persona, si un humano tomó el control y si
la ventana de 24 h sigue abierta. El historial de mensajes NO viaja: esa memoria
es del bot.

18. `GET /api/bot/context?conversationId={id}` con la key → **200** con
    `contact` (id, name, waIdentity, phone), `conversation`
    (id, aiEnabled, handoffAt, windowOpen, windowRemainingMs) y `lead`
    (id, stageName).
19. `GET /api/bot/context?waIdentity={identidad}` → la MISMA conversación. Es el
    camino que usa el bot cuando le llega un mensaje y solo tiene el remitente.
20. Tras un entrante reciente, `windowOpen: true` y `windowRemainingMs` > 0.
21. Con la conversación en handoff, `aiEnabled` viene en **false** aunque el
    flag de la fila siga en true: para el bot hay una sola verdad.
22. Una conversación del Laboratorio no se resuelve nunca por `waIdentity`: el
    bot de producción no debe hablarle a un cliente simulado.

**Las citas del contacto (015).** Con `AGENDA=on` el contexto trae además
`booking`: `timezone`, `next` (la próxima agendada), `unresolved` (la que ya
empezó y nadie cerró, hasta 7 días) y `lastClosed` (la última cerrada en 7
días). Con la agenda apagada `booking` **no viene**, ni vacío. Es aditivo: un
bot que no lo lee no cambia. Las citas de prueba no aparecen nunca. La forma
completa está en
[`specs/015-motor-agenda-universal/contracts/agenda.md`](../../specs/015-motor-agenda-universal/contracts/agenda.md);
los casos con citas, en [`us-agenda.md`](us-agenda.md).

## Ficha de calificación

Lo que el bot va descubriendo del lead. Las claves las define el negocio: el
CRM no impone un cuestionario.

23. `PUT /api/bot/ficha {conversationId, ficha}` con la key → **200** con la
    ficha COMPLETA resultante (no solo el parche), y esa misma ficha aparece en
    `contact.ficha` del contexto del siguiente turno.
24. Un segundo PUT con otras claves las **suma**: lo que no viene se conserva.
    Un `null` explícito **borra** esa clave.
25. Valores que el CRM no puede guardar —objetos, arreglos, cadenas vacías,
    números no finitos— se ignoran en silencio y el resto sí se guarda: un 422
    le tiraría al bot datos de calificación que ya costaron una conversación.
26. Conversación inexistente → **404**. Cuerpo sin `ficha` → **422**.

## El bot envía a través del CRM

27. `POST /api/bot/messages {conversationId, text}` con la key → **200**
    `{messageId}`, el mensaje aparece en la bandeja marcado como IA
    (`aiGenerated: true`, `origin: "ai"`) y sale por el canal de WhatsApp. El
    token de Meta nunca viajó al bot.
28. Con la IA pausada (handoff), el mismo envío → **409** `ai_paused` y el
    outbox NO cambia: el rechazo ocurre antes de tocar Meta.
29. Con la ventana de 24 h cerrada → **409** `window_closed`. El bot no puede
    esquivar la regla de Meta; para eso está el envío de plantilla desde la app.
30. En una conversación del Laboratorio → **409** `sandbox_violation`.

## El bot pide un humano

31. `POST /api/bot/handoff {conversationId, reason}` con la key → **200**, la
    conversación queda con `aiEnabled: false`, su `handoffAt` y el motivo. En la
    bandeja se ve al instante, sin recargar (mismo evento que el toggle).
32. Repetirlo es idempotente: no pisa la hora ni el motivo del primero.
33. Un `reason` que no está en el catálogo —o ausente— **no tira el handoff**:
    cae a `modelo` y la IA se pausa igual. Un 422 aquí dejaría al bot
    vendiéndole a alguien que acaba de pedir un humano.
34. Conversación inexistente → **404**.

## Camino infeliz

35. `GET /api/bot/profile` en una instancia sin perfil de agente → **404**
    `no_profile` (condición esperada, no un 500: el bot cae a su brief local).
36. `GET /api/bot/context` sin `waIdentity` ni `conversationId` → **422**;
    con un `conversationId` que no existe → **404**.
37. `POST /api/bot/messages` con texto vacío → **422**.
38. `POST /api/bot/typing` con un `conversationId` inexistente → **404**.
39. Con Meta caído (token `...-invalid` en el mock), typing → **200**
    `{ok:false, reason:"meta_error"}`: es best-effort por contrato, al bot
    jamás le vale reintentarlo.

## Quién responde a tus clientes

La tarjeta de arriba de la pantalla Agente (`GET /api/agent/brain-status`).
Para los pasos del `/health`, la app corre con `BRAIN_HEALTH_URL` apuntando a
un puerto local donde el guion levanta una Nea falsa (con credenciales y query
de prueba en la URL).

40. Sin sesión → **401**. Con sesión → `enabled`, `aiConfigured`, `external`,
    `dispatch` y `warning` (sin `embedded`: 036);
    `external.keyConfigured: true` (hay `BOT_API_KEY`).
41. Una llamada a `/api/bot/*` con key equivocada NO mueve
    `external.lastSeenAt`; `GET /api/bot/context` con la key sí, y el cerebro
    externo queda `active: true`.
42. Con la Nea falsa sana: `health.reachable: true` con `version`, `mode` y
    `relay.pendientes`; `health.host` es solo el host, y ni las credenciales
    ni la query de la URL aparecen en la respuesta (a Nea sí le llegan, como
    `Authorization: Basic`). Tres consultas seguidas = cero pedidos nuevos a
    Nea (caché de 15 s).
43. **036** `doble_respuesta` ya no existe. Sin despacho → `warning:
    "sin_cerebro"` y la tarjeta dice «bandeja manual», sin rojo. Con
    despacho y el interruptor apagado → `warning: "apagado"`; encenderlo lo
    quita.
44. Con la Nea falsa colgada: en ≤ 4 s la consulta vuelve con
    `reachable: false`, `problem: "timeout"`; la llamada reciente la sigue
    contando como activa.
45. En la bandeja, el panel del contacto dice quién contesta: con el cerebro
    activo y el interruptor encendido, «Responde tu cerebro externo (Nea)»;
    con el cerebro conectado y el interruptor apagado, «Tu agente está
    conectado pero apagado: contestas tú»; sin cerebro, «Bandeja manual: sin
    agente conectado, contestas tú». En ningún caso pide la clave de IA.

## Pensar por el CRM (`/api/bot/llm`, 036)

El cerebro apunta el `base_url` de su SDK de OpenAI a `/api/bot/llm` y el CRM
le pone la llave de Ajustes → IA. Con `OPENROUTER_BASE_URL` → ai-mock.

46. `POST /api/bot/llm/chat/completions` sin llave → **401**.
47. Con `X-API-Key` y, aparte, con `Authorization: Bearer <BOT_API_KEY>` → la
    respuesta del ai-mock tal cual, con su código. El mock recibió la llave de
    Ajustes → IA, no la `BOT_API_KEY`.
48. Con el proveedor respondiendo 401: la respuesta vuelve con 401 y Ajustes →
    IA queda pausada (el banner lo dice). Guardar la llave otra vez la
    reactiva.
49. Sin IA configurada (o pausada) → **402** `sin_credencial`.
50. La llave de IA no aparece en ninguna respuesta ni en el log de la app.
