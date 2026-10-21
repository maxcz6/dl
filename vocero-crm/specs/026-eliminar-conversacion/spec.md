# 026 — Eliminar una conversación

**Feature Branch**: `feat/026-eliminar-conversacion`

**Created**: 2026-10-13

**Status**: Especificada antes de escribir código. Implementada; gates y
guiones E2E en verde. Probada en vivo con la imagen `1.6.0-rc.3` (bitácora).

**Input**: quinta spec de la 1.6.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13). Puerto de Vocero Cloud #106 (`fdf3c17`): `DELETE
/api/conversations/{id}`, `src/server/inbox/eliminar.ts`, el evento
`conversation.deleted` y su diálogo. Sin lo que es de cloud: cuotas de
almacenamiento, cotizaciones, cerebros compartidos y la prueba de activación.

**Carril**: ciclo completo (Principio VI). No toca el modelo de datos —las
foráneas del raíz ya caen en cascada donde hace falta—, pero **cambia un
contrato publicado**: el despacho al cerebro gana un evento que no es un turno
(`conversation.deleted`). Plan en [plan.md](plan.md), tareas en
[tasks.md](tasks.md); el contrato se enmienda en
[`021/contracts/despacho.md`](../021-despacho-estandar/contracts/despacho.md).

## Problema

Una conversación no se puede borrar. Las de prueba que deja quien instala, las
de un número equivocado y las de alguien que pide que se borren sus datos se
quedan para siempre en la bandeja y en los números de Resultados. Y aunque se
borrara la fila, el cerebro externo seguiría recordando lo que esa persona le
dijo: la siguiente vez que escribiera, el agente retomaría una plática que para
el negocio ya no existe.

## Historias

**H1 — Quien administra el negocio elimina una conversación.** Desde Detalles,
al fondo, «Eliminar conversación…» abre una confirmación que dice qué se va y
qué se queda. Al confirmar, la conversación desaparece de la bandeja de todos.

**H2 — Elige si se va también la persona.** Una casilla, sin marcar por
defecto: «Borrar también el contacto y su lead».

**H3 — El agente la olvida.** Si esa persona vuelve a escribir, el agente
empieza de cero: no recuerda nada de lo borrado.

## Decisiones

**D1 — Dos alcances, porque son dos intenciones.**

| | `hilo` (por defecto) | `contacto` (`?contacto=1`) |
|---|---|---|
| Mensajes y sus adjuntos (fila y archivo) | Se van | Se van |
| Ficha (lo que el agente fue aprendiendo) | Se vacía | Se va |
| Contacto, notas, etapa en el pipeline e historial de etapas | Se quedan | Se van |
| Citas pasadas, canceladas o realizadas | Se quedan, sin conversación | Se van |
| De qué anuncio llegó y sus eventos de conversión | Se van | Se van |
| Despachos pendientes de esa conversación | Se van | Se van |
| Resultados | No cambian los de ventas; el hilo deja de contar | La persona deja de contar |

Con `hilo`, si la persona vuelve a escribir es una conversación nueva del mismo
contacto, en la etapa donde estaba.

**D2 — Es irreversible y lo hace quien administra.** Propietario o
administrador (`canConfigure`). Un miembro del equipo recibe 403 y no ve la
opción. No hay papelera; queda una línea en el log con quién, cuándo y qué id.
Ningún contenido.

**D3 — Una cita por venir detiene el borrado**, en los dos alcances: 409
`cita_pendiente` con la fecha. La cita sobreviviría al hilo, pero su
recordatorio sale POR la conversación; y borrar el contacto se llevaría la cita
de la base dejando viva la reunión en Google o Zoom. Cancelar es el camino que
avisa a quien hay que avisar.

**D4 — Los adjuntos se van de verdad.** Las filas de `media_asset` que ya nadie
usa se borran en la misma transacción; sus archivos, después del commit (si la
transacción se revierte, los archivos siguen ahí). Un adjunto que otra
conversación todavía usa —la imagen de un anuncio— se queda.

**D5 — Las conversaciones del Laboratorio no se borran por aquí.** Una
conversación `is_test` responde 404: no vive en la bandeja.

**D6 — Al cerebro se le pide que olvide.** Con el despacho activo
(`BRAIN_DISPATCH_URL`), después de borrar el CRM manda un evento
`conversation.deleted` a la misma URL y con la misma firma que un turno:

```json
{
  "type": "conversation.deleted",
  "eventId": "olv_…",
  "organization": { "id": "org_…", "slug": null },
  "conversation": { "id": "cv_…", "channel": "whatsapp" },
  "contact": { "id": "ct_…", "identity": "5215550001111" },
  "deletedAt": "2026-10-13T12:00:00.000Z"
}
```

- Cabeceras: `x-vocero-signature` (igual que un turno), `x-vocero-event:
  conversation.deleted` y `x-vocero-organization`. No lleva
  `x-vocero-dispatch-id`: no es un despacho.
- **Un intento, sin cola y con 8 segundos de espera.** El borrado ya ocurrió y
  no depende de esto. La respuesta de `DELETE` dice qué pasó: `agente:
  "avisado"`, `"sin_confirmar"` o `"no_aplica"` (sin despacho: el agente
  incluido no guarda nada aparte, su memoria eran los mensajes).
- **La red de seguridad es del contrato, no del aviso:** un `conversation.id`
  nuevo para una identidad que el cerebro ya conocía es una conversación
  nueva, y lo anterior se olvida. Así un aviso perdido no deja memoria en uso.
- No lleva nada de lo borrado, solo con qué encontrarlo.
- Es el mismo cuerpo, byte a byte, que manda Vocero Cloud y que Nea ya sabe
  recibir: una prueba gemela lo fija en los dos repositorios.

**D7 — La bandeja se entera sola.** Un evento `conversation.deleted` por el
SSE quita la conversación de las pestañas abiertas de todo el equipo.

## Fuera de alcance

| Qué | Por qué |
|---|---|
| Borrar varias a la vez, o desde Contactos | Otra spec si alguien lo pide |
| Papelera o deshacer | Es un borrado por petición explícita |
| Borrar solo un mensaje | No es esta historia |
| Pedirle a Meta o a Zernio que borren su copia | No hay API para eso; el aviso de la pantalla no lo promete |

## Criterios de aceptación

- **AC1** `DELETE /api/conversations/{id}` de un propietario → 200 `{ ok,
  alcance: "hilo", agente }`. La conversación ya no sale en la bandeja y sus
  mensajes responden 404.
- **AC2** El contacto sigue en Contactos, en su etapa, con sus notas; su ficha
  quedó vacía.
- **AC3** El adjunto de un mensaje borrado responde 404 y su archivo ya no
  está en el volumen.
- **AC4** Con `?contacto=1` se van el contacto y su lead: no salen en
  Contactos ni en el Pipeline.
- **AC5** Un miembro del equipo → 403. Una conversación de otra organización,
  una que no existe o una del Laboratorio → 404. Nada cambia.
- **AC6** Con una cita agendada por venir → 409 `cita_pendiente` que dice la
  fecha. Nada cambia.
- **AC7** Con el despacho activo, el cerebro recibe `conversation.deleted` con
  firma válida, las cabeceras de D6 y el cuerpo exacto; la respuesta dice
  `agente: "avisado"`.
- **AC8** Con el cerebro caído, el borrado ocurre igual y la respuesta dice
  `agente: "sin_confirmar"`. Sin despacho, `"no_aplica"`.
- **AC9** La misma persona vuelve a escribir: conversación nueva, con otro id
  y sin historial; con `hilo`, del mismo contacto.
- **AC10** Otra pestaña abierta deja de mostrar la conversación sin recargar.
- **AC11** El evento firmado coincide byte a byte con el de la prueba gemela
  de `nea-agent` (`tests/test_olvido.py`).

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I · Seguridad | El borrado exige rol de configuración. El evento va firmado y no lleva contenido. Los archivos se borran, no solo las filas. El log guarda ids, no texto |
| II · Soberanía | Sin dependencias nuevas; el aviso al cerebro es opcional y su fallo no bloquea nada |
| III · Multi-tenancy | Toda lectura y borrado pasa por `scoped()` con la organización de la sesión |
| IV · Idempotencia | Borrar dos veces: la segunda es 404. El evento lleva `eventId` para que el cerebro deduplique |
| V · Calidad | Cuatro gates, unitarias, prueba gemela del contrato y guion E2E en los dos modos |
| VI · Specs | Ciclo completo: este documento, plan, tareas y enmienda del contrato, antes del código |
| VII · Trazabilidad | Decisiones D1 a D7; bitácora al cerrar |
| VIII · Foco | Es gestión de conversaciones y leads |
| IX · En vivo | Una conversación real creada para la prueba se elimina desde la instancia desplegada y deja de existir; se anota qué se usó |
