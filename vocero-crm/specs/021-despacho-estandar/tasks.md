# Tasks — 021 Despacho estándar

## Datos

- [x] T001 Tabla `dispatch` en `schema.ts` y prefijo `dsp_` en `ids.ts`
- [x] T002 `pnpm db:generate` → `0016_despacho_al_cerebro`
- [x] T003 Migrar una base vacía y una base en `0015` con datos

## Servidor

- [x] T004 `brains/contract.ts`: evento, cabeceras, firma y clasificación de la respuesta
- [x] T005 `brains/config.ts`: despacho activo o el problema de configuración; `BRAIN_DISPATCH_URL` en `env.ts`
- [x] T006 `dispatch/outbox.ts`: encolar, tomar con lease, entregar, reintentar o caducar, descartar
- [x] T007 `brains/deliver.ts`: la ráfaga, el evento con adjuntos y el POST firmado
- [x] T008 `dispatch/worker.ts`: barrido, cita, procesar, caída a humano, mensaje que llega en vuelo
- [x] T009 `ai/trigger.ts` + `dispatch/encolar.ts`: despacho o agente incluido; `instrumentation-node.ts` reanuda
- [x] T010 `dispatch/estado.ts` + `bot/status.ts` + `brain-status`: la llave `dispatch`

## UI

- [x] T011 Tarjeta «Quién responde»: fila «Despacho al cerebro» y el agente incluido en silencio

## Pruebas y documentación

- [x] T012 Unitarias: contrato (firma byte a byte), configuración, cálculo de la tarjeta, doctor
- [x] T013 Guion `tests/e2e/us-despacho.md` y arnés `scripts/e2e-despacho.mjs`
- [x] T014 `pnpm doctor`, `.env.example`, `AGENTS.md`, README, CHANGELOG
- [x] T015 Gate técnico y E2E (despacho, y el selftest sin la variable para AC12)

## Verificación (2026-10-08, local, Postgres 16 en Docker y `next dev`)

- Gate: `typecheck`, `lint`, `test` (90 archivos, 994 pruebas; 57 nuevas: 29 en
  `despacho-contrato`, 23 en `despacho-config` y 5 en `brain-status`) y
  `build`, en verde.
- Migración `0016`: desde una base vacía y desde una base en `0015` con una
  organización, un contacto, una conversación y un mensaje (intactos);
  re-ejecutarla no hace nada; el índice único parcial rechaza un segundo
  despacho vivo y deja entrar otro tras entregar el primero. Con 50,000 filas
  entregadas, la consulta de la tarjeta sale por
  `Index Only Scan Backward using dispatch_org_status_updated_idx`.
- `scripts/e2e-despacho.mjs` contra `next dev` con `CHANNELS` completo,
  `AGENDA` y `ATRIBUCION` encendidas y `AGENT_COALESCE_MS=1500`, sobre una base
  nueva: **75/75**. Messenger entró por Meta e Instagram por Zernio.
- AC9 a mano: fila `pendiente` insertada con la app detenida; al arrancar, el
  cerebro recibió ese `dispatchId` firmado sin que entrara ningún mensaje y la
  fila quedó `entregado`.
- AC16 a mano: con `BRAIN_DISPATCH_URL` y sin `BOT_API_KEY`, el arranque lo
  registra, `pnpm doctor` lo marca con `!`, `brain-status` devuelve
  `problem: "sin_llave"`, el agente incluido contestó el mensaje de prueba y
  no se creó ninguna fila en `dispatch`.
- La tarjeta, en el navegador: «Activo · host · Último turno entregado…», el
  agente incluido «En silencio», y en ámbar con el motivo tras un turno que no
  llegó.
- AC12: `pnpm test:e2e` sin `BRAIN_DISPATCH_URL` sobre una base nueva:
  279/280, con `dispatch` vacía al terminar. El fallo («abre la ventana de
  24 h» de la sección #78) es una carrera del arnés que no toca este cambio:
  afirma sobre la primera foto de la conversación, tomada antes de que la
  ingesta escriba `last_inbound_at`; el check siguiente, que exige la ventana
  abierta, pasa.
