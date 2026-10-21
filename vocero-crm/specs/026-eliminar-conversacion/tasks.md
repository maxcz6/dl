# Tareas — 026 Eliminar una conversación

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md).

## Contrato

- [x] T001 Enmendar `specs/021-despacho-estandar/contracts/despacho.md`: evento `conversation.deleted` y la red de seguridad
- [x] T002 `src/server/brains/contract.ts`: `EventoOlvido`, `TIPO_OLVIDO`, `construirEventoOlvido`
- [x] T003 `src/lib/db/ids.ts`: prefijo `olv`
- [x] T004 `tests/unit/olvido-contrato.test.ts`: cuerpo y firma gemelos de nea-agent

## Servidor

- [x] T005 `src/server/bot/ficha.ts`: `vaciarFicha` dentro de una transacción
- [x] T006 `src/server/inbox/eliminar.ts`: borrado transaccional, dos alcances, cita por venir, adjuntos y archivos
- [x] T007 `src/server/brains/deliver.ts`: `avisarOlvido` (un intento, 8 s, sin cola)
- [x] T008 `src/server/events/bus.ts` y `src/components/use-events.ts`: `conversation.deleted`
- [x] T009 `DELETE /api/conversations/[id]`: permiso, 404, 409, aviso, SSE, log

## Interfaz

- [x] T010 `src/components/inbox/delete-conversation-dialog.tsx`
- [x] T011 `contact-panel.tsx`: «Eliminar conversación…» al fondo de Detalles, solo con permiso
- [x] T012 `inbox-client.tsx` y la página: quitar la conversación al borrar y al recibir el evento

## Pruebas

- [x] T013 `scripts/e2e-eliminar.mjs` con cerebro propio; modo cerebro y modo agente incluido
- [x] T014 `tests/e2e/us-eliminar.md`
- [x] T015 Guiones existentes en verde
- [x] T016 Interfaz en local, claro y oscuro

## Cierre

- [x] T017 `AGENTS.md`, `CHANGELOG.md`, `README.md`, `specs/README.md`
- [x] T018 Prueba en vivo y bitácora
