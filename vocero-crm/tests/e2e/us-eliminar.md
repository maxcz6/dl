# E2E — Eliminar una conversación (026)

Arnés: `scripts/e2e-eliminar.mjs`. Spec:
[`specs/026-eliminar-conversacion/spec.md`](../../specs/026-eliminar-conversacion/spec.md).

Precondición: app corriendo (`next dev`) sobre una base migrada, con
`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock y `MEDIA_DIR`.

Dos modos, según cómo arrancó la app; el gate completo son las dos corridas:

- **Con cerebro**: `BRAIN_DISPATCH_URL=http://127.0.0.1:<puerto>/vocero/dispatch`
  y `BOT_API_KEY`. El arnés levanta ese cerebro en su propio proceso, verifica
  la firma sobre el cuerpo crudo y guarda lo que recibe.
- **Sin despacho**: no hay a quién avisar (`agente: "no_aplica"`).

Con `AGENDA=on` corre además la cita por venir.

```bash
node --env-file=.env scripts/e2e-eliminar.mjs
```

## Quién puede (AC5)

1. Un miembro del equipo → 403, con y sin `?contacto=1`.
2. Una conversación que no existe → 404.
3. La conversación sigue en la bandeja, con su mensaje.

## El hilo (AC1, AC2, AC3, AC10)

4. La conversación tiene un mensaje con imagen: se puede abrir
   (`/api/media/{assetId}` → 200) y su archivo está en `MEDIA_DIR`. El contacto
   tiene notas, ficha y etapa.
5. `DELETE /api/conversations/{id}` → 200 `{ ok, alcance: "hilo", agente }`.
   Ya no sale en la bandeja y sus mensajes no existen.
6. El contacto sigue, con su nota, en la misma etapa y con el mismo lead; su
   ficha quedó vacía.
7. El adjunto responde 404 y su archivo ya no está en el volumen.
8. Por el SSE llega `conversation.deleted` con `conversationId`, `contactId` y
   `contactDeleted: false`, y nada más.
9. Eliminarla otra vez → 404.

## El aviso al cerebro (AC7, con cerebro)

10. Llega **un** `conversation.deleted`, firmado como un turno, con
    `x-vocero-event: conversation.deleted`, `x-vocero-organization` y sin
    `x-vocero-dispatch-id`. Las claves van en el orden del contrato; dice la
    conversación, el canal, el contacto y su identidad, con un `eventId`
    propio y la hora. No lleva nada de lo borrado.

## Si vuelve a escribir (AC9)

11. La misma persona escribe: conversación nueva del mismo contacto, con otro
    id y un solo mensaje. Al cerebro le llega como una conversación nueva.

## El contacto (AC4)

12. `DELETE …?contacto=1` → 200 `alcance: "contacto"`. El contacto responde
    404 y no sale en Contactos ni en el Pipeline. Si la persona vuelve a
    escribir, es otro contacto y otra conversación.

## El cerebro no confirma (AC8, con cerebro)

13. El cerebro contesta 500 → se elimina igual, `agente: "sin_confirmar"`, y no
    se reintenta. Con el cerebro apagado → lo mismo, en menos de 10 segundos.

## Una cita por venir (AC6, con `AGENDA=on`)

14. Con una cita agendada por venir, eliminar el hilo o el contacto → 409
    `cita_pendiente` que dice la fecha y manda a Citas. No se borra nada.
15. Cancelada la cita, se elimina; la cita cancelada se queda en el historial
    del contacto, sin conversación.

## Interfaz (a mano, claro y oscuro)

- En Detalles, al fondo: «Eliminar conversación…». Un miembro del equipo no la
  ve.
- El diálogo dice qué se va y qué se queda, y cambia con la casilla «Borrar
  también el contacto y su lead». Escape cancela; Enter no confirma.
