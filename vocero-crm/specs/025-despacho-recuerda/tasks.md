# Tasks — 025 El despacho recuerda qué debe

## Datos

- [x] T001 Columna `dispatch.messageIds` en `schema.ts`
- [x] T002 `pnpm db:generate` → `0017_dispatch_message_ids`
- [x] T003 Migrar una base vacía y una en `0016` con un despacho pendiente

## Despacho

- [x] T004 `ingest.ts` → `trigger.ts` → `encolar.ts`: el id del entrante llega al outbox
- [x] T005 `outbox.ts`: `encolarDespacho` anota ids (fila viva, en vuelo, carrera del índice) y `mensajesAnotados`
- [x] T006 `deliver.ts`: `rafagaDe` con debidos, `sinDespachar`, `construirEvento` sin mensajes
- [x] T007 `worker.ts`: descartar el despacho vacío y releer lo anotado tras entregar

## Agente incluido

- [x] T008 `orden-turno.ts`: `ordenarParaElTurno`, `debidosVigentes`, `atendidoPorPersona` y `quedanDebidos`
- [x] T009 `pipeline.ts`: debidos en el coalesce, `runAgentTurn` devuelve lo que leyó

## Pruebas y documentación

- [x] T010 Unitarias: `sinDespachar` y las cuatro puras de `orden-turno.ts`
- [x] T011 Mock de IA: demora y registro de peticiones
- [x] T012 Arnés y guion: «mientras piensa», «persona en la ventana», «agente incluido», y la espera del #116
- [x] T013 Contrato del despacho, `AGENTS.md`, `specs/README.md`, CHANGELOG
- [x] T014 Gate técnico y E2E en los dos modos; `pnpm test:e2e` sin la variable
- [x] T015 Prueba en vivo (local con túnel y Coolify) y bitácora

## Verificación (2026-10-13)

Gates, E2E en los dos modos, migración y las dos pruebas en vivo: ver
[`docs/bitacora-2.0.md`](../../docs/bitacora-2.0.md).
