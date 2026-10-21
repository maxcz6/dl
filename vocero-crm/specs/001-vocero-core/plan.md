# Implementation Plan: Vocero CRM — Núcleo v1

**Branch**: `001-vocero-core` | **Date**: 2026-07-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-vocero-core/spec.md`

## Summary

Vocero CRM es un monolito Next.js self-hosted que implementa: bandeja de WhatsApp en
tiempo real (SSE), contactos + pipeline kanban, agente de IA con knowledge base y
acciones tipadas, Laboratorio de auto-evaluación (6 personas guionadas + juez LLM),
wizard de conexión del número (modo directo o modo agencia/Tech Provider), plantillas
acotadas, multi-usuario mínimo e instalación en 15 minutos (Coolify o docker compose +
Caddy). Los patrones difíciles (webhook firmado, ingesta idempotente, cifrado de tokens,
coalesce+lock del agente, mock harness) se portan de un proyecto de referencia privado en
producción, simplificados hacia menos código. Todo input externo se valida con Zod; el
LLM se accede solo por un adaptador OpenRouter-compatible; el entorno de pruebas interno
(wa-mock + ai-mock) permite el self-test E2E completo sin tocar la API real.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: Next.js 15 (App Router, output standalone) + React 19 ·
Tailwind CSS + shadcn/ui · Drizzle ORM (migraciones versionadas) · Better Auth + plugin
organization · Zod · nanoid (IDs con prefijo)

**Storage**: PostgreSQL 16 (self-hosted; servicio separado en Coolify / servicio compose)

**Testing**: Vitest (unit) + Playwright vía MCP (self-test E2E conducido por el agente)

**Target Platform**: VPS Linux con Coolify (Ruta A) o Docker Compose + Caddy (Ruta B);
desarrollo en Windows/macOS/Linux con Docker

**Project Type**: Aplicación web monolítica (un solo paquete, sin workspaces)

**Performance Goals**: mensaje entrante visible en bandeja abierta ≤2s (SSE, también
detrás de Caddy); instalación completa ~15 min; corrida del Laboratorio ≤10 min (timeout)

**Constraints**: SSE con heartbeat `: ping` ~25s, `Cache-Control: no-cache,
no-transform`, `X-Accel-Buffering: no`, `Content-Type: text/event-stream` exacto, ruta
`force-dynamic`, catch-up al reconectar · sin WebSocket ni servidor custom (rompe el
standalone) · sin colas externas (background in-process) · dependencias runtime SOLO
Meta Cloud API + LLM opcional (Constitución II endurecida) · repo público: cero
secretos/nombres privados

**Scale/Scope**: una instancia = un negocio; ~15 tablas; 8 user stories; equipo de
operación pequeño (<10 usuarios); volumen WhatsApp de PyME (miles de mensajes/mes)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad de Datos | Token Meta cifrado AES-256-GCM en reposo; `ENCRYPTION_KEY` solo por env; secretos jamás al cliente/logs; aislamiento por `organization_id` en toda query | ✅ |
| II. Soberanía (endurecida) | Runtime deps: solo Meta Cloud API + adaptador OpenRouter opcional. Sin S3/email/Stripe/Google. Auth (Better Auth) y Postgres self-hosted. Adaptadores dedicados (`lib/meta`, `lib/ai`) | ✅ |
| III. Multi-Tenancy Real | `organization_id` NOT NULL + índice org-first en toda tabla de dominio; helpers de scope obligatorios (`lib/db/tenant`) | ✅ |
| IV. Idempotencia | `wa_message_id` UNIQUE + dedup en ingesta; estados y template-status idempotentes; seed y migraciones idempotentes | ✅ |
| V. Calidad Verificable | Gate typecheck+lint+build+Vitest; lo no verificable → lista "pendiente de verificación humana" | ✅ |
| VI. Specs Antes de Código | Este flujo (spec → plan → tasks → implement); artefactos committeados y públicos | ✅ |
| VII. Trazabilidad | Decisiones DV-VC-n en research.md; supuestos explícitos en spec | ✅ |
| VIII. Foco Vertical | Alcance v1 rechaza broadcast/flujos visuales/scraping/Instagram (Out of Scope de la spec) | ✅ |
| IX. Verificación en Vivo | Self-test E2E con Playwright contra wa-mock + ai-mock (camino feliz + infeliz), local primero; smoke real condicional a credenciales | ✅ |

**Post-diseño (Fase 1)**: re-evaluado tras data-model y contratos — sin violaciones; no
hay entradas en Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-vocero-core/
├── plan.md              # Este archivo
├── research.md          # Fase 0 — decisiones DV-VC-n
├── data-model.md        # Fase 1 — ~15 tablas
├── quickstart.md        # Fase 1 — correr local + self-test
├── contracts/           # Fase 1 — API interna, webhook, SSE, mocks, juez
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (auth)/                    # login, registro (cerrado tras 1ª org)
│   ├── (app)/                     # shell autenticado
│   │   ├── inbox/                 # US1 bandeja 3 columnas
│   │   ├── pipeline/              # US2 kanban
│   │   ├── contacts/              # US2 lista/búsqueda
│   │   ├── agent/                 # US3 comportamiento + KB
│   │   ├── lab/                   # US4 Laboratorio (corridas, reporte)
│   │   └── settings/              # US5 wizard WhatsApp · US6 plantillas · US7 equipo
│   └── api/
│       ├── health/                # healthcheck deploy
│       ├── auth/[...all]/         # Better Auth
│       ├── webhooks/wa/[webhookToken]/   # US5 webhook (GET verify + POST eventos)
│       ├── events/                # SSE (force-dynamic, heartbeat, catch-up)
│       ├── conversations/         # mensajes, envío, plantilla, toggle IA
│       ├── contacts/ · pipeline/ · agent/ · kb/ · lab/ · templates/ · settings/
│       └── dev/
│           ├── wa-mock/           # harness Cloud API (404 en prod)
│           └── ai-mock/           # completions deterministas (404 en prod)
├── components/                    # shadcn/ui + componentes de producto
├── lib/
│   ├── env.ts                     # validación Zod de variables
│   ├── crypto/                    # AES-256-GCM
│   ├── meta/                      # cliente Graph API propio (+ plantillas)
│   ├── ai/                        # adaptador OpenRouter-compatible (chatJson<T>)
│   ├── db/                        # drizzle schema, cliente, tenant scope
│   └── auth/                      # Better Auth config + organization
└── server/
    ├── inbox/                     # ingest idempotente, send (guard is_test), window
    ├── ai/                        # agent pipeline, coalesce+lock, prompts, handoff
    ├── lab/                       # runner de corridas, personas, juez
    ├── whatsapp/                  # credenciales, plantillas (sync estados)
    └── events/                    # bus SSE in-process

scripts/
├── migrate.mjs                    # migraciones al boot (esbuild)
└── seed/demo.mjs                  # seed Ferretería El Martillo (idempotente)

tests/
├── unit/                          # crypto, firma, tenant, ventana, parser, regex,
│                                  # mocks-prod-404, registro cerrado, lab-sandbox, juez
└── e2e/                           # guiones del self-test (conducidos vía Playwright)

Dockerfile · docker-compose.yml · Caddyfile · INSTALL-IA.md · README.md · .env.example
```

**Structure Decision**: Monolito Next.js de un solo paquete. Fronteras de modificación
para agencias: `src/lib/ai/` (cambiar cerebro), `src/lib/meta/` (canal), `src/lib/db/schema`
(campos), `src/server/ai/prompts.ts` (comportamiento). Los mocks viven bajo `src/app/api/dev/`
con guard de producción único.

## Complexity Tracking

Sin violaciones constitucionales que justificar.
