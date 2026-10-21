# 024 — Texto del agente en redes y ventana de atención humana

**Feature Branch**: `feat/024-texto-social`

**Created**: 2026-10-13

**Status**: Especificada antes de escribir código. Implementada; gates y
guiones E2E en verde. En vivo con la imagen `1.6.0-rc.2` (bitácora).
Verificado por Kevin el 2026-10-14 (imagen `rc.4`): sus DMs con una pregunta a
Instagram y a la página recibieron respuesta del agente, sin asteriscos.

**Input**: cuarta spec de la 1.6.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13). Puerto de las specs 110 y 115 de megaparty-crm
(`src/lib/social-text.ts`, `src/lib/messaging-window.ts`, `assertReplyWindow`),
generalizadas a las capacidades por canal del raíz.

**Carril**: ligero (Principio VI). No toca el modelo de datos. Los contratos
publicados no cambian de forma: `/api/bot/messages` ya responde 409
`window_closed`, y el despacho ya dice que la ventana es la del canal. Lo que
cambia es que el CRM pasa a cumplirlo también en Instagram y Messenger (D3).

## Problema

1. **El agente escribe como si todo fuera WhatsApp.** El agente incluido y Nea
   marcan negritas con asteriscos y a veces devuelven Markdown. WhatsApp lo
   dibuja; Instagram, Messenger y TikTok enseñan los asteriscos tal cual.
2. **Pasadas 24 horas, la bandeja trata Instagram y Messenger como WhatsApp.**
   Esconde el cuadro de texto y pide «una plantilla aprobada», que esos canales
   no tienen. Meta sí deja contestar hasta 7 días con la etiqueta de agente
   humano, y el envío ya la sabe poner: solo que el operador no puede escribir.
3. **Esa etiqueta no tiene tope ni dueño.** Hoy el envío la pone a cualquier
   mensaje fuera de las 24 horas: también a los de la IA (Meta la reserva a
   personas) y también pasados los 7 días (Meta lo rechaza, con un error que
   el operador no entiende).

## Decisiones

**D1 — En redes, el texto de la IA sale plano.** Cada canal declara su formato
de texto (`textFormat`: `whatsapp` o `plain`). Cuando un mensaje **generado
por IA** —del agente incluido o de un cerebro por `/api/bot/messages`— va a un
canal `plain` (Instagram, Messenger, TikTok), se le quita el formato antes de
medirlo, enviarlo y guardarlo:

| Entra | Sale |
|---|---|
| `*negrita*`, `**negrita**`, `_cursiva_`, `__x__`, `~tachado~`, `~~x~~`, `` `código` `` | el texto, sin marcas |
| `# Título` | `Título` |
| `- uno` · `* uno` · `+ uno` | `• uno` |
| `[catálogo](https://…)` | `catálogo: https://…` |
| bloque entre ``` | su contenido |
| Una URL, con sus guiones bajos | intacta |

Lo que escribe una persona en la bandeja no se toca: es lo que quiso escribir.
WhatsApp no cambia. Quitar el formato dos veces da lo mismo que una.

**D2 — La extensión humana es una capacidad del canal.** Instagram y Messenger
declaran `humanAgentWindowMs` (7 días). WhatsApp y TikTok no la tienen.

**D3 — Una sola puerta decide quién puede escribir.** Antes de cualquier envío
a un canal con extensión humana:

| Desde el último mensaje del cliente | Persona | IA |
|---|---|---|
| Menos de 24 h | Sale normal | Sale normal |
| De 24 h a menos de 7 días | Sale con la etiqueta de agente humano | 409 `window_closed` |
| 7 días o más, o sin ningún mensaje del cliente | 409 `window_closed` | 409 `window_closed` |

Los mensajes que manda el negocio no alargan nada: cuenta el último del
cliente. El agente incluido, al topar con `window_closed`, pasa la
conversación a una persona como ya hace en WhatsApp (motivo «ventana»).

**D4 — La bandeja lo enseña.** En Instagram y Messenger, entre 24 horas y 7
días el cuadro de texto sigue ahí, con un aviso de que solo puede contestar
una persona y el tiempo que queda; el encabezado dice «ventana humana» en vez
de «ventana abierta». Pasados los 7 días se explica que hay que esperar al
cliente, sin ofrecer plantillas (no existen en ese canal).

Se llama «ventana humana» y no «atención humana», que es como el plan la
nombraba: en la bandeja «Atención humana» ya es otra cosa (el traspaso a una
persona, con la IA en pausa), y dos estados distintos con el mismo nombre se
confunden.

## Fuera de alcance

| Qué | Dónde |
|---|---|
| Recordarle al operador que la ventana está por cerrarse | No se porta (spec 126 de megaparty: envío sin que el cliente escriba, Principio VIII) |
| Adjuntos salientes en redes | Otra spec |
| Que el agente escriba distinto según el canal (tono, emojis) | 2.0: el cerebro lee `conversation.channel` (nea-agent#37) |
| Formato del texto del operador | No: escribe lo que quiere |

## Código

| Archivo | Qué |
|---|---|
| `src/lib/social-text.ts` (nuevo) | `plainSocialText`, puro |
| `src/server/channels/capabilities.ts` | `textFormat`, `humanAgentWindowMs`; mensajes de ventana cerrada |
| `src/server/inbox/window.ts` | `replyWindow(channel, lastInboundAt, now)`: quién puede escribir y con qué etiqueta (puro) |
| `src/server/inbox/send.ts` | `assertReplyWindow` en el pre-vuelo; D1 en `sendText`; Instagram y Messenger dejan de calcular la etiqueta por su cuenta |
| `src/lib/types.ts` · `src/server/inbox/queries.ts` | `ConversationDto.humanWindow` |
| `src/components/inbox/composer.tsx` · `inbox-client.tsx` | D4 |

## Pruebas

- **Unitarias**: `plainSocialText` (cada fila de D1, URLs con guiones bajos,
  operaciones como `2 * 3`, identificadores `con_guiones`, idempotencia);
  `replyWindow` en los bordes (24 h y 7 días exactos, un milisegundo antes,
  sin fecha, fecha futura) para los cuatro canales.
- **Guion `scripts/e2e-ventana-social.mjs`** con simuladores: texto de la IA
  con formato por Instagram, Messenger y TikTok → llega plano y se guarda
  plano; por WhatsApp → intacto; texto del operador con asteriscos → intacto;
  el agente incluido contesta plano; a las 30 horas una persona envía con la
  etiqueta y la IA recibe 409; a los 8 días nadie envía; el DTO de la
  conversación trae la ventana humana.
- Los guiones existentes siguen en verde.
- **Interfaz**: el aviso de atención humana y el de ventana cerrada, en claro
  y oscuro.
- **En vivo** (Principio IX): en `vocero-clase`, un turno real del agente por
  WhatsApp sigue saliendo con su formato. Lo de Instagram y Messenger necesita
  que una persona escriba desde su cuenta: queda pendiente de verificación
  humana.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I · Seguridad | Sin secretos nuevos. La etiqueta de agente humano deja de ponerse a mensajes automáticos |
| II · Soberanía | Sin dependencias nuevas |
| III · Multi-tenancy | El pre-vuelo ya carga la conversación por organización; no cambia |
| IV · Idempotencia | Quitar el formato es idempotente; el guardado sigue deduplicando igual |
| V · Calidad | Cuatro gates, unitarias y guion E2E |
| VI · Specs | Este documento, antes del código; carril ligero declarado |
| VII · Trazabilidad | Decisiones D1 a D4; bitácora al cerrar |
| VIII · Foco | Es cómo se contesta una conversación; nada se envía sin que el cliente escriba |
| IX · En vivo | Lo descrito arriba; lo que requiere a una persona queda marcado |
