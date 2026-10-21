# Implementation Plan: Despacho estándar

**Branch**: `feat/despacho-estandar` | **Spec**: [spec.md](spec.md) | **Datos**: [data-model.md](data-model.md) | **Contrato**: [contracts/despacho.md](contracts/despacho.md)

## Summary

La ingesta, tras guardar el mensaje, encola un despacho en vez de llamar al
agente incluido cuando hay un cerebro configurado. Un worker dentro del proceso
toma los despachos vencidos, arma el evento normalizado, lo firma con
`BOT_API_KEY` y lo entrega por HTTP. Es un puerto de `src/server/dispatch/` y
`src/server/brains/` de Vocero Cloud sin organizaciones múltiples, tipos de
cerebro, generación ni cortacircuitos.

## Technical Context

- **Stack**: Next.js 15, TypeScript estricto, Drizzle + PostgreSQL, Vitest,
  arnés `scripts/e2e-despacho.mjs`.
- **Dependencias nuevas**: ninguna (`node:crypto`, `fetch`).
- **Trabajo en segundo plano**: dentro del proceso, como el resto del repo. Lo
  que lo hace fiable es el outbox: lease que vence y reanudación al arrancar.
- **Rendimiento**: encolar es un `SELECT` + `INSERT`/`UPDATE` por mensaje. El
  barrido de fondo es una consulta por índice cada 2 s, y solo corre si el
  despacho está activo.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | El evento no lleva credenciales de canal. La firma es HMAC-SHA256 del cuerpo crudo. No se siguen redirecciones. `last_error` y los logs no llevan cuerpo ni llave; la tarjeta enseña solo el host. La URL la pone quien instala (entorno), no un tercero: una dirección de la red interna es válida y no hay superficie de SSRF nueva. |
| II · Soberanía | Sin dependencia ni tercero nuevo. Sin colas externas: el outbox es una tabla. El cerebro es opcional y va tras una variable; sin ella, el núcleo no cambia. |
| III · Multi-tenancy | `organization_id` NOT NULL en `dispatch`; las lecturas de la tarjeta pasan por `scoped()`. |
| IV · Idempotencia | Un despacho vivo por conversación (índice único parcial); `dispatchId` estable entre reintentos; reclamar una fila es un `UPDATE` condicionado a estado e intento. |
| V · Hecho | Unitarias del contrato, de la configuración y de la tarjeta; arnés E2E con un cerebro de prueba en otro proceso, camino feliz e infelices. |
| VI · Specs | Ciclo completo: tabla nueva y contrato publicado. |
| Contratos públicos | `/api/bot/*` no cambia. `brain-status` solo gana una llave. |
| Sandbox | Una conversación `is_test` nunca se despacha: no pasa por la ingesta, y el encolado lo comprueba igual. |

Sin violaciones.

## Project Structure

```text
src/lib/db/schema.ts                  tabla dispatch
src/lib/db/ids.ts                     prefijo dsp_
drizzle/0016_*.sql                    migración (+ snapshot y journal)
src/lib/env.ts                        BRAIN_DISPATCH_URL
src/server/brains/contract.ts         evento, cabeceras, firma, clasificación de la respuesta
src/server/brains/config.ts           ¿hay despacho? URL + llave, y el problema si no
src/server/brains/deliver.ts          armar el evento y el POST firmado
src/server/dispatch/outbox.ts         encolar, tomar, lease, reintentar, caducar, descartar
src/server/dispatch/worker.ts         barrido, cita al vencer la ventana, procesar
src/server/dispatch/estado.ts         lo que la tarjeta enseña del despacho
src/server/ai/trigger.ts              despacho o agente incluido, nunca los dos
src/instrumentation-node.ts           reanudar pendientes al arrancar
src/server/bot/status.ts, src/lib/brain-status.ts   la tarjeta
src/app/api/agent/brain-status/route.ts
src/components/agent/brain-status-card.tsx, inbox/contact-panel.tsx
src/server/doctor/checks.ts           aviso de configuración
tests/unit/despacho-*.test.ts, brain-status.test.ts
tests/e2e/us-despacho.md, scripts/e2e-despacho.mjs
.env.example, AGENTS.md, README.md, CHANGELOG.md
```

Mismas rutas que en Vocero Cloud a propósito: al sincronizar el fork, git
enfrenta archivo contra archivo en vez de dejar dos despachadores conviviendo.

## Riesgos

- **Dos procesos sobre el mismo outbox** (un despliegue con réplicas): cubierto
  por el lease y el `UPDATE` condicionado. La cita en memoria es solo una
  optimización; el barrido recoge lo que encoló otro proceso.
- **`next dev` evalúa los módulos varias veces**: el estado del worker vive en
  `globalThis`, como el bus de eventos.
- **Quien ya usa Nea 1.x delante del CRM** no debe poner `BRAIN_DISPATCH_URL`
  hasta que su cerebro reciba despachos (nea-agent#37): le llegaría cada
  mensaje por dos caminos.
