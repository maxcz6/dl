# 022 — Canal de TikTok en la bandeja

**Feature Branch**: `feat/022-canal-tiktok`

**Created**: 2026-10-13

**Status**: Especificada antes de escribir código. Implementada y verde con
simuladores. **Prueba en vivo pendiente de verificación humana**: TikTok solo
entrega mensajes por API a cuentas Business y la del dueño está en revisión
(2026-10-13). El canal va apagado por defecto.

**Input**: segunda spec de la 1.6.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13). Moldes: [014](../014-canal-instagram/spec.md) y
[017](../017-canal-messenger/spec.md). Los límites del canal salen de la
documentación de Zernio (plataforma TikTok, «Direct messages», y el webhook
`message.received`), leída el 2026-10-13.

**Carril**: ciclo completo (Principio VI). Toca el modelo de datos (tabla
`tiktok_credentials`, migración `0018`, y un valor nuevo de `channel`) y dos
contratos publicados: `/api/bot/messages` gana un 409 tipado y el evento de
despacho gana un valor de `conversation.channel`. Plan en [plan.md](plan.md),
tareas en [tasks.md](tasks.md).

## Problema

Un negocio que atiende por WhatsApp, Instagram y Messenger recibe también
mensajes directos en TikTok, y hoy los contesta desde el teléfono: fuera del
pipeline, de la ficha del lead y del agente. TikTok no tiene una API de
mensajes abierta a una app propia como la de Meta; llega por la API unificada
de Zernio, que la raíz ya usa para Instagram y Messenger.

## Lo que TikTok impone

No son decisiones nuestras; el producto tiene que decirlas claro en vez de
dejar que el operador las descubra con un error de la plataforma.

- Solo cuentas **TikTok Business**, registradas fuera de la UE, Suiza y Reino
  Unido, con los mensajes directos abiertos.
- **El negocio no inicia.** Solo se contesta.
- Tras el último mensaje del cliente se aceptan **hasta 10 mensajes en 48
  horas**. No hay plantillas ni etiquetas para reabrir.
- Un mensaje es **texto (hasta 6,000 caracteres) o una imagen**, nunca los dos.
- No hay acuses de entrega ni de lectura.

## Decisiones

- **D1 — Una sola fuente: Zernio.** `tiktok_credentials.source` existe y vale
  `zernio`, con el patrón de `messenger_credentials`, para que una fuente
  futura no pida otra migración.
- **D2 — Conector opcional, como los otros canales** (ADR-001): apagado por
  defecto, se enciende con `tiktok` en `CHANNELS`, superficie en 404 si no, la
  migración se aplica igual y el CI lo prueba apagado y encendido.
- **D3 — Identidad `tt:<id>`**, el id del remitente que entrega Zernio, en la
  familia de `bsuid:`, `ig:` y `fb:`.
- **D4 — Los límites se declaran en las capacidades del canal**, no en el
  camino de envío: ventana de 48 h, `outsideWindow: none`, tope de 10 salientes
  desde el último entrante, 6,000 caracteres. El núcleo los pregunta.
- **D5 — La ventana deja de ser «24 h» en el núcleo.** Lo que enseña la
  bandeja, lo que lee un cerebro por `/api/bot/context` y lo que viaja en el
  despacho (`windowOpen`, `windowExpiresAt`) se calcula con la ventana del
  canal de esa conversación. Para WhatsApp, Instagram y Messenger el resultado
  es el de siempre.
- **D6 — El tope se cuenta en el CRM antes de llamar a Zernio.** El undécimo
  mensaje no sale: falla con un error propio (`message_limit`, HTTP 409) que
  dice qué pasa y qué lo arregla (que el cliente vuelva a escribir). Cuenta lo
  que salió —de una persona o del agente— desde el último entrante; un envío
  fallido no cuenta.
- **D7 — Si el agente topa con el límite, calla; no traspasa.** Un traspaso
  dejaría la IA en pausa para siempre por algo que se arregla solo cuando el
  cliente escribe.
- **D8 — Un webhook propio, y además el reparto de siempre.** Entra por
  `/api/webhooks/tiktok/<token>`, y como Zernio entrega todas las plataformas
  por un mismo webhook, un evento de TikTok que llegue a la URL de Instagram o
  de Messenger se reparte igual por `platform`.
- **D9 — Adjuntos salientes fuera de esta entrega.** *Diferencia con la fila
  del plan*, que enumeraba la imagen entre las capacidades. Zernio la acepta
  como URL pública o como `multipart`, y la raíz guarda los adjuntos tras
  sesión (no hay URL pública que darle) y su documentación no nombra el campo
  del `multipart`: implementarlo sería adivinar contra una API de pago. Ningún
  canal social de la raíz manda adjuntos todavía (014 y 017 los dejaron
  fuera). El canal declara `outboundMedia: false` y el compositor lo dice.
- **D11 — El límite de longitud deja de ser uno para todos.** La API del CRM
  cortaba cualquier texto en 4,096 caracteres, que es el límite de WhatsApp:
  con eso, los 6,000 de TikTok no se podían alcanzar. Ahora cada canal declara
  el suyo (WhatsApp 4,096; TikTok 6,000; Instagram y Messenger siguen en
  bytes), la API acepta hasta el mayor y el envío comprueba el del canal de
  esa conversación. Un texto largo por WhatsApp sigue respondiendo 422.
  *Añadida durante la implementación*: salió al probar AC9.
- **D10 — El texto del agente sale como hoy.** Quitar Markdown y formato de
  WhatsApp en los canales sociales es la spec 024.

## Alcance

**Entra**: catálogo y capacidades; tabla y credenciales cifradas; ingesta por
Zernio con firma; salida con ventana, tope y longitud; webhook; reparto por
plataforma; Ajustes → TikTok; distintivo en bandeja y pipeline; filtro de la
bandeja; el agente incluido y el despacho al cerebro atienden el canal;
arnés `scripts/e2e-tiktok.mjs` contra el mock de Zernio.

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| Imagen saliente | D9. |
| Descargar adjuntos entrantes | Zernio los entrega como URL temporal, igual que en 017: entran con su tipo para que la bandeja enseñe qué llegó. |
| Comentarios de TikTok | Otro producto (`comment.received`). |
| Texto social sin Markdown | Spec 024. |
| Una pantalla con el estado de todos los canales, y el secreto de Zernio compartido | Spec 023. |
| Que Nea lea el canal | nea-agent#37 (2.0). En 1.6 contesta el agente incluido, o un cerebro por despacho que ya trate `channel` como informativo. |

## Comportamiento observable

### Historia 1 — Recibir (P1)

- **AC1** Un `message.received` de Zernio con `platform: tiktok`, firmado con
  el secreto de esa cuenta, entra a la bandeja como conversación de TikTok,
  con su distintivo, creando el contacto (`tt:<id>`) con el nombre o el
  `@usuario` que trae el evento.
- **AC2** Firma inválida → 401 y nada se guarda. Segmento de la URL
  equivocado → 404. Sin secreto configurado, protege solo el segmento.
- **AC3** El mismo mensaje entregado dos veces no se duplica.
- **AC4** Un evento de otra plataforma, de una cuenta que no es la conectada,
  saliente o que no es `message.received` se descarta sin efectos.
- **AC5** El mismo evento entregado a la URL de Instagram o de Messenger entra
  igual a TikTok.
- **AC6** Un adjunto sin texto entra con su tipo.

### Historia 2 — Responder (P1)

- **AC7** El operador contesta desde la bandeja y Zernio recibe el texto en la
  conversación de ese cliente (`conversationId` opaco, `accountId`).
- **AC8** El agente incluido contesta un mensaje de TikTok; con
  `BRAIN_DISPATCH_URL`, el turno se despacha con `channel: "tiktok"`.
- **AC9** Un texto de más de 6,000 caracteres se rechaza con un error que dice
  el límite, sin llamar a Zernio.

### Historia 3 — Los límites de TikTok (P1)

- **AC10** Tras un entrante salen diez mensajes. El **undécimo** se rechaza
  con **409 `message_limit`** y no llega a Zernio. Vale igual por
  `POST /api/conversations/{id}/messages` y por `POST /api/bot/messages`.
- **AC11** Cuando el cliente vuelve a escribir, la cuenta empieza de nuevo.
- **AC12** Pasadas 48 horas del último entrante, el envío se rechaza con 409
  `window_closed` y un texto que dice que TikTok no permite reabrir. La
  bandeja y `/api/bot/context` dan la ventana por cerrada a las 48 h, no a
  las 24.
- **AC13** Si el agente incluido topa con el tope, no envía y la conversación
  **no** queda traspasada.

### Historia 4 — Conectar (P1)

- **AC14** Ajustes → TikTok: el dueño pega el `accountId` de la cuenta en
  Zernio, su API key y, opcional, el secreto del webhook. La llave se prueba
  contra Zernio antes de guardar; una llave mala no se guarda. Hacia fuera
  solo viajan sus últimos 4.
- **AC15** La pantalla enseña la URL del webhook de TikTok y qué exige TikTok
  de la cuenta. Solo el dueño puede conectar.
- **AC16** Con el canal apagado, la pantalla, la API de ajustes y el webhook
  responden 404, y `/api/health` no lo lista.

### Historia 5 — Convivir (P1)

- **AC17** WhatsApp, Instagram y Messenger entran y salen igual que antes; su
  ventana sigue siendo de 24 h.
- **AC18** El Laboratorio no toca ninguna API real, tampoco la de Zernio.
- **AC19** Una instalación 1.5 actualiza redesplegando: `0018` crea una tabla
  vacía.

## Requisitos no funcionales

- La llave de Zernio se cifra en reposo (AES-256-GCM) y no sale a logs.
- El webhook contesta 200 de inmediato y procesa fuera de la ruta: Zernio
  corta a los 5 segundos.
- La firma se compara en tiempo constante, con la única implementación que ya
  comparten Instagram y Messenger.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | Llave cifrada; segmento secreto + firma HMAC de Zernio por cuenta; solo el dueño conecta; nada de secretos en logs ni en respuestas. |
| II · Soberanía | Zernio es un tercero: entra como conector opcional tras `CHANNELS`, aislado en `src/server/tiktok/` + `src/server/zernio/`, con la llave del propio negocio. Apagado, el núcleo no lo ve. Su fallo no bloquea WhatsApp. Sin dependencias nuevas. |
| III · Multi-tenancy | `organization_id` NOT NULL en `tiktok_credentials`; el webhook enruta por `account_ref` a su organización. |
| IV · Idempotencia | Dedup por `tt_<id del mensaje en Zernio>` en el índice único de mensajes; migración aditiva y re-ejecutable. |
| V · Hecho | Unitarias del catálogo, la normalización, la firma, el tope y la ventana; arnés E2E con el mock de Zernio, camino feliz e infelices; CI apagado y encendido. |
| VI · Specs | Ciclo completo: tabla nueva y dos contratos tocados. |
| VIII · Foco | El producto sigue siendo WhatsApp directo con Meta; los canales sociales son opcionales (posicionamiento del plan). |
| IX · En vivo | Un DM real desde un TikTok personal a la cuenta de negocio de Kevin: entra, el agente contesta, el operador responde y el undécimo se rechaza. Requiere que una persona escriba desde TikTok. |
| Contratos públicos | `/api/bot/messages` gana un código 409 (`message_limit`); el despacho gana un valor de `channel`, que el contrato ya pedía tratar como informativo. Nada se quita ni se renombra. |
| Sandbox | La aserción de `is_test` sigue antes de la bifurcación por canal. |

Sin violaciones.
