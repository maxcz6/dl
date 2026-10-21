# 038 — El cerebro mueve la etapa

**Feature Branch**: `feat/038-cerebro-mueve-etapa` (en `vocero-crm`; en
`nea-agent`, su propia rama y su propio PR)

**Created**: 2026-10-20

**Status**: Especificada antes de escribir código.

**Input**: la bitácora de la 036 (2026-10-20) dejó anotado un cambio de
producto: con el agente incluido se fue la acción `move_stage`, y ningún
endpoint de `/api/bot/*` permite mover un lead de etapa. Hoy ningún cerebro
puede hacerlo. La 037 queda para la #93 (almacenamiento).

**Carril**: ciclo completo (Principio VI). Cambia un contrato publicado
(`/api/bot/*`: ruta nueva, llave nueva en el contexto, clave nueva en el
catálogo de herramientas), todo de forma aditiva. Sin migración. Plan en
[plan.md](plan.md), tareas en [tasks.md](tasks.md).

## Problema

El agente incluido (borrado en la 036) podía decir «mueve a este lead a
Calificado» y el CRM lo hacía por la puerta única
(`src/server/leads/stage-history.ts`, `source = "bot"`). Nea nunca tuvo esa
acción, y la 034 (D1) supuso que «el CRM mueve la etapa cuando la ficha lo
pide»; el código no lo hace: `upsertFicha` solo guarda la ficha. Resultado: en
la 2.0 el pipeline solo avanza a mano o al agendar (`advanceLeadStage`). Un
negocio sin agenda ve todos sus leads en la primera columna aunque el agente
ya los haya calificado.

## Historias

**H1 — El agente avanza al lead.** Cuando el cliente ya dijo qué busca y para
cuándo, el agente lo pasa de «Nuevo» a «Calificado». El dueño lo ve en el
Pipeline en vivo, y la bitácora de etapas dice que lo movió el bot.

**H2 — Quien administra lo apaga.** En la pantalla Agente, «Mover de etapa»
es una herramienta más del rol. Apagada, el cerebro no puede mover a nadie.

## Decisiones

**D1 — Ruta nueva: `POST /api/bot/stage`**, no un campo en `/api/bot/ficha`.
La ficha es un merge flojo de claves libres que nunca falla por el contenido;
mover de etapa es una acción con reglas (a dónde se puede, quién la tiene
encendida) y errores tipados. Mezclarlas obligaría a la ficha a devolver
errores que hoy no tiene. Cuerpo: `{ conversationId, stage }`, donde `stage`
es el **nombre** de la etapa (sin distinguir mayúsculas ni espacios de los
lados) o su id. El nombre es lo que el modelo ve y repite; el id sirve a un
cerebro determinista. Respuesta 200:
`{ ok: true, changed, lead: { id, stageName } }`.

**D2 — Qué etapas puede elegir: las abiertas que van después de la actual.**
Solo hacia adelante y nunca a una etapa ganada o perdida:

- **Ganada** dispara la conversión `Purchase` a Meta (016) y cuenta como venta
  en Resultados. Declarar una venta es decisión de una persona.
- **Perdida** exige motivo (`loss_reason_required`), y el agente incluido
  tampoco clasificaba pérdidas. Para quien no califica ya está `salida`.
- **Hacia atrás** haría que el embudo mienta: un lead que el dueño adelantó a
  mano no debe regresar porque el modelo se confundió.

Pedir una etapa fuera de esa lista es 409 `etapa_no_permitida`; una que no
existe, 422 `etapa_desconocida`. Los dos traen en el mensaje las etapas
válidas, para que el modelo se corrija en el mismo turno.

**D3 — La lista viaja en el contexto, no en el perfil.** `GET
/api/bot/context` gana `lead.nextStages: [{ id, name }]` (en el orden del
Pipeline; vacía si el lead ya está en la última abierta o en una de cierre).
El contexto se pide en cada turno; el perfil, cada 5 minutos
(`PROFILE_TTL_SECONDS` de Nea). La lista depende de la etapa actual del lead,
que cambia de un turno a otro, así que en el perfil estaría vieja. Y un
cerebro que no la conozca la ignora (regla de versión del OpenAPI).

**D4 — Detrás de una herramienta del rol: `etapa`, «Mover de etapa».** Clave
nueva en `HERRAMIENTAS` (`src/lib/agent-roles.ts`), no fija y sin bandera. La
pantalla Agente la enseña sola (pinta el catálogo). El CRM la **hace cumplir**:
con la herramienta apagada, `POST /api/bot/stage` responde 409
`herramienta_apagada`. Así un cerebro viejo o descuidado no puede saltarse la
decisión del dueño.

Encendida por defecto donde «todas» es el valor: perfiles con `tools = null`
(lo que tiene una instalación que actualiza) y el preset Calificador. Un
perfil que ya eligió su lista a mano la conserva tal cual: la clave nueva no
está en ella, así que llega **apagada** hasta que alguien la encienda. Es lo
conservador: nadie que haya apagado algo a propósito ve aparecer una acción
nueva sin pedirla.

Esto corrige la 034 D1 («mover etapa va dentro de `ficha`»): se escribió
sobre un comportamiento que no existía.

**D5 — Idempotencia e historial.** Todo pasa por `moveLeadToStage` con
`source = "bot"` y `lastActivityAt` = ahora. Pedir la etapa en la que el lead
ya está es 200 con `changed: false` y no escribe evento (la puerta solo anota
cuando cambia). Reintentar el mismo movimiento es, por eso, inocuo. Con
`changed: true` se publica `conversation.updated`, igual que cuando el dueño
arrastra la tarjeta, y la bandeja y el Pipeline lo ven en vivo.

**D6 — Respeta la pausa.** Con handoff o `aiEnabled = false`, 409 `ai_paused`,
como `/api/bot/messages`: cuando una persona tomó la conversación, el cerebro
no mueve nada. Una conversación de pruebas (`is_test`) sí mueve: es dato del
CRM, no toca Meta, y la conversión ya excluye el Laboratorio
(`reportStageChange`). Sin lead para el contacto, 404 `sin_lead`.

**D7 — Nea: herramienta `move_stage`** (`app/tools.py`), clave `etapa` en
`CLAVE_DE_HERRAMIENTA`, argumento `etapa` (nombre). Se le enseña al modelo solo
si el perfil la tiene encendida **y** el contexto trae `lead.nextStages` con al
menos una etapa: contra un CRM que no la tiene (cloud o un raíz anterior) no
existe la llave y la herramienta no aparece. El prompt nombra las etapas a las
que puede mover. Los 409/422 vuelven al modelo como `{ok: false, error,
detalle}`; un fallo del CRM nunca tumba el turno.

## Criterios de aceptación

- **AC1** — `POST /api/bot/stage` a una etapa abierta siguiente: 200
  `changed: true`, el lead queda ahí, `lead_stage_event` con `source = "bot"`
  y `from/to` correctos. Por nombre en otra capitalización y por id.
- **AC2** — Repetirlo: 200 `changed: false`, sin evento nuevo.
- **AC3** — Hacia atrás, a ganada y a perdida: 409 `etapa_no_permitida`;
  nombre inexistente: 422 `etapa_desconocida`; conversación inexistente: 404;
  sin llave: 401; con handoff: 409 `ai_paused`; contacto sin lead: 404
  `sin_lead`.
- **AC4** — Con `etapa` apagada en el perfil: 409 `herramienta_apagada`, y el
  lead no se mueve. Encendida otra vez, se mueve.
- **AC5** — `GET /api/bot/context` trae `lead.nextStages` con las abiertas
  siguientes, y vacía en la última abierta.
- **AC6** — `GET /api/bot/profile` trae `etapa` en `tools` sin configurar;
  un perfil con lista explícita sin `etapa` no la trae.
- **AC7** — El OpenAPI documenta la ruta, sus códigos y `nextStages`
  (`openapi.test.ts` en verde, con el enum de herramientas al día).
- **AC8** — E2E con el cerebro falso (`scripts/e2e-etapa.mjs`): un mensaje
  real por el despacho llega al cerebro falso, que lee el contexto y mueve el
  lead; el Pipeline lo enseña en la etapa nueva y la bitácora dice «bot».
- **AC9** — Nea: pytest con respx de la herramienta (encendida, apagada, sin
  `nextStages`, 409 del CRM). Gates verdes en los dos repos.
- **AC10** — En vivo: pendiente de coordinar (otra sesión usa el número
  Soporte y `vocero20`). Queda «pendiente de verificación humana» hasta
  entonces.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | La ruta exige `BOT_API_KEY` como el resto de `/api/bot/*`; no expone secretos |
| II Soberanía | Sin terceros nuevos |
| III Multi-tenancy | Conversación, lead y etapas se buscan con la organización de la instancia (`scoped()`) |
| IV Idempotencia | Mismo destino = `changed: false` sin evento (D5) |
| V Calidad verificable | Unit, OpenAPI, E2E con el cerebro falso y pytest en Nea |
| VI Spec antes de código | Este documento |
| VII Trazabilidad | Cada movimiento queda en `lead_stage_event` con `source = "bot"`; D4 deja escrita la corrección a la 034 |
| VIII Foco vertical | Es pipeline de leads: el núcleo del CRM |
| IX Hecho = probado en vivo | AC10, pendiente de coordinar |
