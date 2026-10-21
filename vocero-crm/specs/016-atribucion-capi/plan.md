# Implementation Plan: Atribución de anuncios y Conversions API

**Branch**: `016-atribucion-capi` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Carril declarado**: **ciclo completo** (Principio VI) — toca el modelo de datos
(tres tablas nuevas) y publica un contrato (`/api/settings/capi`).

## Summary

Se agrega al core la atribución de anuncios CTWA y el reporte de conversiones a
Meta, detrás de la bandera `ATRIBUCION` (apagada por defecto, criterios ADR-001).
Tres piezas: **capturar** el `ctwa_clid` del primer mensaje que viene de un
anuncio; **reportar** `QualifiedLead` y `Purchase` desde la puerta única de
etapas, con dedup en base y best-effort absoluto; y una **pantalla** para
conectar el dataset, elegir qué etapa significa "calificado" y ver qué se le
reportó a Meta.

Lo que sube es el mecanismo, no la operación de nadie: la etapa calificada la
elige cada negocio, la venta cuelga del `kind = "won"` que ya existe, y quedan
fuera el backfill, el laboratorio de eventos y el espejo de venta del fork.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: **ninguna nueva**. Salida por `graphRequest`
(`src/lib/meta/client.ts`), cifrado por `lib/crypto`, validación con Zod — todo
ya presente.

**Storage**: PostgreSQL + Drizzle. Tres tablas (`ad_attribution`,
`conversion_event`, `capi_settings`) en `drizzle/0010_atribucion_capi.sql`,
aditiva y aplicada siempre.

**Testing**: Vitest para lo puro (payload, catálogo, centavos→unidades, bandera,
traducción de filas de actividad) + `pnpm test:e2e` extendido, corrido en las
**dos** configuraciones. El mock de Graph aprende `POST {dataset}/events` (D10).

**Target Platform**: el mismo monolito self-hosted; sin procesos ni servicios nuevos.

**Performance Goals**: la emisión agrega una llamada HTTP a Meta al movimiento de
etapa que dispara (timeout del cliente Graph), fuera de la transacción. Ningún
otro camino se toca.

**Constraints**: `organization_id` vía `scoped()`; secretos cifrados y solo
`last4` hacia afuera; `is_test` sin efectos externos; bandera apagada ⇒ 404 en
toda la superficie, sin captura y con el prompt del agente intacto.

**Scale/Scope**: dos eventos por lead como máximo, uno por cambio de etapa
relevante. La actividad es un panel de 25–50 filas.

## Constitution Check

*GATE: evaluado antes de la Fase 0 y re-evaluado tras el diseño.*

| Principio | Cómo lo cumple |
|---|---|
| **I. Seguridad** | Token del dataset cifrado AES-256-GCM con `lib/crypto` (mismo mecanismo que WhatsApp); hacia el cliente solo `last4` y estado; nunca a logs. El `ctwa_clid` es un identificador de clic, no un dato personal del contacto: hacia Meta **no viaja teléfono ni nombre**. |
| **II. Soberanía (1.4.0)** | ✅ No introduce un tercero nuevo: es **la misma Meta Graph API** del canal permitido, igual que el canal de Instagram (014). Aun así se entrega con el traje completo de conector opcional: apagado por defecto tras `ATRIBUCION`, aislado en `lib/meta/capi.ts` con contrato público, degradación definida (su fallo jamás bloquea la operación), credenciales del propio negocio cifradas, y CI apagado/encendido. Cero dependencias de runtime nuevas. |
| **III. Multi-tenancy** | `organization_id NOT NULL` en las tres tablas; todo acceso por `scoped()`; configuración única por organización. |
| **IV. Idempotencia** | El dedup **es** un UNIQUE con `ON CONFLICT DO NOTHING`, no un chequeo previo: dos webhooks o dos movimientos simultáneos no duplican. Migración re-ejecutable. |
| **V. Calidad verificable** | Gate técnico + unit de las piezas puras + arnés E2E en las dos configuraciones, incluido el camino infeliz (Meta rechazando). |
| **VI. Specs antes de código** | Carril ciclo completo declarado; spec, research, data-model y contratos preceden al código. |
| **VII. Trazabilidad** | Cada decisión no obvia queda en `research.md` con su evidencia de producción; la reversión de "esto no sube" (evaluación 2026-08-15) se argumenta por escrito en el spec. |
| **VIII. Foco vertical** | El CRM ya sabe de dónde vino el lead y cómo terminó; esto solo lo devuelve a quien cobra por traerlo. No es una suite de analítica: dos eventos, una pantalla, cero dashboards. |
| **IX. Verificación en vivo** | `quickstart.md` define el self-test contra la app viva con mocks; nada se declara Hecho sin ese loop en verde. |

**Guardrail del Laboratorio**: una conversación `is_test` jamás emite un evento —
aserción antes de salir, hermana de la del sender y de la de los conectores de
agenda.

**Resultado del gate**: PASA sin violaciones. No requiere enmienda
constitucional: a diferencia de la 015, aquí no entra ningún proveedor nuevo.

## Project Structure

```
specs/016-atribucion-capi/
├── spec.md · plan.md · research.md · data-model.md
├── quickstart.md · checklist.md · tasks.md
└── contracts/
    ├── settings-capi.md      # el contrato interno (4 endpoints)
    └── evento-meta.md        # el contrato de salida (payload + acuse)

src/
├── lib/
│   ├── db/schema.ts                      # + 3 tablas
│   ├── db/ids.ts                         # + 3 prefijos
│   ├── env.ts                            # + ATRIBUCION (documentada)
│   └── meta/capi.ts                      # NUEVO — payload, catálogo, acuse
├── server/attribution/
│   ├── flag.ts                           # NUEVO — la bandera (patrón agenda/flag.ts)
│   ├── store.ts                          # NUEVO — captura del referral
│   ├── settings.ts                       # NUEVO — configuración cifrada
│   └── conversions.ts                    # NUEVO — emisión + actividad
├── server/inbox/{webhook,ingest}.ts      # + tipo referral y su paso
├── server/leads/stage-history.ts         # + emisión tras el commit
├── app/api/settings/capi/{route,events/route}.ts   # NUEVO
├── app/(app)/settings/ads/page.tsx       # NUEVO — pantalla tras la bandera
├── app/(app)/settings/layout.tsx         # + pestaña condicionada
├── components/settings/{settings-nav,ads-client}.tsx
└── app/api/dev/wa-mock/**                # + referral simulado y {dataset}/events

drizzle/0010_atribucion_capi.sql
docs/atribucion-capi.md                   # guía del dueño (incluye la receta del espejo)
tests/unit/{capi-payload,capi-flag,conversions}.test.ts
tests/e2e/us-atribucion.md + scripts/e2e-selftest.mjs
```

## Fases

**Fase 0 — Research** ✅ `research.md` (D1–D11).

**Fase 1 — Diseño** ✅ `data-model.md` + `contracts/`.

**Fase 2 — Tareas** → `tasks.md`, agrupadas por historia (US1…US6) con el
fundacional primero: sin esquema y sin bandera no hay nada que probar.

**Fase 3 — Implementación y verificación**: gate técnico + arnés en las dos
configuraciones. La feature no está Hecha hasta que el arnés pase **encendida y
apagada** (FR-016).

## Complexity Tracking

Ninguna violación que rastrear. La única complejidad que esta feature agrega
—una llamada de red colgada del movimiento de etapa— se acota con tres reglas
duras: fuera de la transacción, envuelta en `try/catch`, y con su desenlace
escrito en una fila que el dueño puede leer.
