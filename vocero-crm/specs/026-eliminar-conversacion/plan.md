# Plan — 026 Eliminar una conversación

Spec: [spec.md](spec.md).

## De dónde sale cada pieza

| Pieza | Cloud (`fdf3c17`) | Raíz |
|---|---|---|
| Borrado transaccional | `src/server/inbox/eliminar.ts` | Mismo módulo, sin cuota (`mediaUsedBytes`), sin cotizaciones y sin la prueba de activación, que el raíz no tiene |
| Ruta | `DELETE /api/conversations/[id]`, permiso `configure` | Misma ruta; el permiso es `canConfigure(session.role)` |
| Evento | `construirEventoOlvido`, `avisarOlvido` | `construirEventoOlvido` idéntico; `avisarOlvido` contra el único destino del raíz (`leerConfigDespacho`) |
| Ficha | `vaciarFicha` | Igual (`contact.ficha`) |
| Archivos | `borrarMedia` (S3 o disco) | `deleteMediaFile` (disco, `MEDIA_DIR`) |
| SSE | `conversation.deleted` | Igual |
| Interfaz | Diálogo y entrada en Detalles | Igual, sin la frase de cotizaciones |
| Guion | `scripts/e2e-eliminar.mjs` con `brain-mock` | Guion nuevo que levanta su propio cerebro, como `e2e-despacho.mjs` |

## Modelo de datos

Sin migración. Lo que ya hace el esquema al borrar:

| Se borra | Cae en cascada | Queda con la referencia en NULL |
|---|---|---|
| `conversation` | `message`, `offered_slot`, `ad_attribution`, `conversion_event`, `dispatch` | `booking.conversation_id`, `agent_test_case.conversation_id` |
| `contact` | `conversation` (y lo de arriba), `lead`, `lead_stage_event`, `booking`, `ad_attribution` | — |

Lo que una cascada no hace, y hace el módulo:

1. **`media_asset`**: `message.media_asset_id` y `ad_attribution.image_asset_id`
   son `SET NULL`, así que al borrar el hilo sus adjuntos quedarían huérfanos.
   Se anotan antes de borrar y se eliminan los que ya nadie referencia.
2. **Archivos** en `MEDIA_DIR/<org>/<asset>`: después del commit.
3. **Ficha**: `contact.ficha = null` en el alcance `hilo`.
4. **Cita por venir**: se consulta antes y detiene el borrado.

## Orden dentro de la transacción

1. Conversación y contacto, por organización (`scoped`). `is_test` → no
   encontrada.
2. Con `contacto`: todas las conversaciones de esa persona (en el raíz es una
   real como mucho, más las de prueba, que no se tocan aquí porque no cuelgan
   de un contacto real).
3. Cita `agendada` por venir (`is_test = false`): del contacto o de la
   conversación, según el alcance.
4. Ids de adjuntos de sus mensajes y de sus anuncios.
5. `DELETE` de `contact` o de `conversation`; con `hilo`, vaciar la ficha.
6. `DELETE` de `media_asset` de la lista que ya no tenga quién lo use.

Después del commit: archivos, aviso al cerebro, SSE y la línea del log.

## Contrato

`specs/021-despacho-estandar/contracts/despacho.md` gana la sección «Eventos
que no son un turno» con `conversation.deleted` (cuerpo, cabeceras, un intento,
qué contestar) y la regla de la red de seguridad. `CABECERA_EVENTO` ya estaba
reservada en `src/server/brains/contract.ts` para esto.

El id del evento es `olv_<nanoid>` (`newId("olvido")`).

## Pruebas

- `tests/unit/olvido-contrato.test.ts`: el cuerpo y la firma gemelos de
  `nea-agent/tests/test_olvido.py` (`CUERPO_GEMELO`, `FIRMA_GEMELA`,
  `SECRETO_GEMELO`), byte a byte; el orden de las claves; `avisarOlvido` con un
  `fetch` de mentira (200 → avisado, 500 o sin respuesta → sin confirmar, sin
  despacho → no aplica, y que manda las cabeceras de D6 y un solo intento).
- `scripts/e2e-eliminar.mjs`, dos modos como `e2e-despacho.mjs`: con cerebro
  (AC1–AC5, AC7–AC9, y AC6 si `AGENDA=on`) y con el agente incluido (AC8 «no
  aplica»).
- Interfaz en local: la entrada al fondo de Detalles, el diálogo en claro y
  oscuro, y que un miembro no la ve.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Borrar un adjunto que otra fila todavía usa | Se borran solo los que no referencia ningún `message` ni `ad_attribution`, dentro de la transacción |
| Un turno en vuelo para la conversación borrada | El despacho cae en cascada; un `POST /api/bot/messages` tardío responde 404; el agente incluido no encuentra la conversación y termina |
| El aviso no llega | La red de seguridad del contrato (id nuevo = conversación nueva). La respuesta lo dice (`sin_confirmar`) |
| Borrado por error | Rol de configuración, confirmación explícita con el nombre de la persona y sin atajos de teclado |
