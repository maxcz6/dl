# Feature Specification: Despacho estándar — el CRM empuja cada turno al cerebro

**Feature Branch**: `feat/despacho-estandar`

**Created**: 2026-10-08

**Status**: Especificada antes de escribir código.

**Input**: issue #89 del hito 2.0.0 y la sección 2.0.0 de
[`docs/plan-1.5-y-2.0.md`](../../docs/plan-1.5-y-2.0.md). Decisión del dueño el
2026-10-08: el CRM es el producto y el agente es un servicio aparte.

**Carril**: ciclo completo (Principio VI). Añade una tabla (migración `0016`) y
publica un contrato nuevo que consume algo fuera de este repo: el evento de
despacho ([contracts/despacho.md](contracts/despacho.md)).

## Contexto

Hoy, para que un cerebro externo conteste, tiene que ponerse **delante** del
CRM: Nea se queda con el webhook de Meta, guarda una copia del secreto de la
app y le releva cada mensaje al CRM con una cola. De ahí salen los incidentes
del par (el relay que se cae en silencio, el override que se pierde), y por eso
Instagram y Messenger se quedan sin agente: a Nea solo le llega WhatsApp.

La edición cloud ya lo hace al revés: el webhook nunca sale del CRM, el mensaje
entra primero a la bandeja y el CRM le **despacha** la ráfaga al cerebro,
firmada. Esta spec trae ese camino a la raíz con la misma forma de evento, la
misma firma y la misma tabla, para que los dos repos lo compartan.

## Decisiones

- **D1 — Bandeja primero, cerebro después.** Cuando existe un despacho, el
  mensaje ya está guardado. Si el cerebro falla, no se pierde nada.
- **D2 — El mismo evento y la misma firma que cloud.** Un cerebro que ya recibe
  despachos de Vocero Cloud entiende los de la raíz sin cambios. El secreto es
  `BOT_API_KEY`: la misma llave firma el despacho y autentica la vuelta por
  `/api/bot/*`.
- **D3 — El despacho está activo con dos cosas**: `BRAIN_DISPATCH_URL` con una
  URL http(s) y `BOT_API_KEY` configurada. Activo, **silencia al agente
  incluido**: los dos caminos son excluyentes. Mal configurado no está activo,
  todo se comporta como en 1.5 y la tarjeta «Quién responde» lo avisa.
- **D4 — No depende del interruptor de la pantalla Agente.** Ese interruptor
  gobierna hoy solo al agente incluido, y quien ya usa un cerebro externo lo
  tiene apagado para no contestar dos veces. Atar el despacho a él los dejaría
  mudos al actualizar. Lo redefine #106.
- **D5 — La URL va por entorno**, como `BOT_API_KEY` y `BRAIN_HEALTH_URL`.
  Editarla desde la interfaz llega con #106, junto con la llave y la prueba de
  conexión del paso «conecta tu agente».
- **D6 — Caer a un humano es el traspaso que ya existe**: IA en pausa en esa
  conversación con motivo `error`, el mismo que usa Nea cuando no puede
  contestar. Sin columnas nuevas en `conversation`.
- **D7 — Sin cortacircuitos en esta entrega.** Cloud lo lleva por organización
  en una tabla que la raíz no tiene. Con el cerebro caído, cada conversación
  agota sus tres intentos (unos 5 s de esperas, más lo que tarde cada intento
  en fallar) y cae a un humano.
- **D8 — El cerebro de prueba vive en el arnés**, en otro proceso, como la Nea
  falsa de «Quién responde». El despacho cruza HTTP de verdad y la firma se
  comprueba desde fuera; el producto no gana rutas `/api/dev` nuevas.
- **D9 — `mediaId` es el que acepta `/api/bot/media/{mediaId}`** (el de Graph),
  no el id interno del adjunto. Es la única diferencia con el evento de cloud,
  y viene de que la vuelta aquí es `/api/bot/*` y no `/api/brains/*`.

## Alcance

**Entra**:

- Outbox de despacho en Postgres: un despacho vivo por conversación, ventana de
  agrupado, lease, tres intentos con espera creciente y caída a humano.
- Evento normalizado y firmado, igual para WhatsApp, Instagram y Messenger.
- Exclusión del agente incluido mientras el despacho esté activo.
- «Quién responde»: estado del despacho (a quién, último entregado, último
  fallo, pendientes, problema de configuración).
- Reanudar los pendientes al arrancar el proceso.
- `pnpm doctor`: avisa de `BRAIN_DISPATCH_URL` sin `BOT_API_KEY` o mal escrita.

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| Quitar el agente incluido | #106, y solo después de #91. |
| Laboratorio contra el cerebro | #91. El Laboratorio sigue probando al agente incluido. |
| URL del cerebro editable en la interfaz | D5; llega con #106. |
| OpenAPI del contrato | #92. Aquí queda el contrato en Markdown y una prueba que fija la firma byte a byte. |
| Cortacircuitos | D7. |
| Avisar si el cerebro recibió el turno y nunca contestó | El 2xx significa «recibido»; vigilar la respuesta es otra feature. |
| El evento `conversation.deleted` | La raíz no elimina conversaciones. La cabecera `x-vocero-event` queda reservada. |

## Comportamiento observable

### Historia 1 — Un mensaje llega al cerebro (P1)

Con el despacho activo, cada mensaje entrante real de cualquier canal produce
un `POST` firmado al cerebro, y lo que el cerebro conteste por
`POST /api/bot/messages` sale al cliente por el canal de la conversación.

- **AC1** Un WhatsApp entrante produce un despacho con `dispatchId`,
  `conversation.channel = "whatsapp"`, la identidad del contacto y el mensaje.
  La firma `x-vocero-signature` valida contra el cuerpo crudo con `BOT_API_KEY`.
- **AC2** Cinco mensajes dentro de la ventana (`AGENT_COALESCE_MS`) producen
  **un** despacho con los cinco, en orden.
- **AC3** Un mensaje de Instagram y uno de Messenger se despachan igual, con su
  `channel` y su identidad (`ig:…`, `fb:…`).
- **AC4** Un adjunto viaja como `mediaId` + `mimeType`, y ese `mediaId` se
  descarga por `GET /api/bot/media/{mediaId}`.
- **AC5** Un mensaje que llega mientras el despacho de su conversación está en
  vuelo no se pierde: produce otro despacho en cuanto el primero se entrega.

### Historia 2 — El cerebro falla (P1)

- **AC6** Si el cerebro responde 5xx, 429, no contesta o no acepta la conexión,
  el mensaje sigue en la bandeja y el CRM reintenta: tres intentos en total.
- **AC7** Agotados los intentos, la conversación queda en manos de un humano
  (IA en pausa, motivo `error`), la bandeja lo ve en vivo y el despacho queda
  `caducado_a_humano` con el motivo.
- **AC8** Un 4xx distinto de 429 no se reintenta: cae a un humano al primer
  intento.
- **AC9** Tras un reinicio del CRM, un despacho pendiente se entrega sin
  esperar a que llegue otro mensaje.

### Historia 3 — Quién contesta (P1)

- **AC10** Con el despacho activo, el agente incluido no contesta aunque tenga
  proveedor de IA y el interruptor encendido.
- **AC11** Una conversación con la IA en pausa o traspasada no se despacha. Si
  se pausa durante la ventana, el despacho se descarta sin caer a humano.
- **AC12** Sin `BRAIN_DISPATCH_URL`, nada cambia respecto de 1.5: el agente
  incluido contesta como antes y no se crea ninguna fila.
- **AC13** Las conversaciones del Laboratorio nunca se despachan.

### Historia 4 — Se ve en «Quién responde» (P2)

- **AC14** `GET /api/agent/brain-status` gana `dispatch`: a qué host se
  despacha, cuándo fue el último entregado, el último fallo con su motivo y
  cuántos hay pendientes. Las llaves que ya existían no cambian.
- **AC15** Con el despacho activo, la fila del agente incluido dice que está en
  silencio porque contesta el cerebro, y no hay aviso de doble respuesta.
- **AC16** `BRAIN_DISPATCH_URL` mal escrita o sin `BOT_API_KEY` sale como
  problema de configuración, con qué corregir. Nunca se muestra la ruta ni
  credenciales de la URL: solo el host.

## Requisitos no funcionales

- La ingesta no espera al cerebro: encolar es un `INSERT` o un `UPDATE`.
- El token de WhatsApp y las credenciales de canal no viajan en el evento.
- La firma se compara en tiempo constante del lado que la verifique; el CRM
  nunca registra el cuerpo firmado ni la llave.
- Una instalación 1.5 actualiza redesplegando: la migración es aditiva y, sin
  la variable nueva, el comportamiento es idéntico.
