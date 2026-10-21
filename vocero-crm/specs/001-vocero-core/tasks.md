# Tasks: Vocero CRM — Núcleo v1

**Input**: Design documents from `/specs/001-vocero-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: La spec exige tests unitarios enumerados (FR-080s / Definición de Hecho) y
self-test E2E conducido con Playwright → SÍ se generan tareas de test, colocadas dentro
de la fase de su historia. Los E2E son guiones en `tests/e2e/` que el agente conduce vía
Playwright MCP (checkpoint de cada fase).

**Organization**: Fases por user story en orden de prioridad de la spec:
US1, US2 (MVP gate) → US3, US4, US5, US8 (núcleo P1) → US6 (P2) → US7 (P3) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1..US8 según spec.md

## Phase 1: Setup

**Purpose**: Proyecto Next.js 15 inicializado con el stack fijado (DV-VC-14)

- [X] T001 Scaffold Next.js 15 App Router + React 19: package.json (pnpm pinneado, `"type":"module"`, versiones DV-VC-14), tsconfig.json (`strict` + `noUncheckedIndexedAccess`), next.config.ts (`output: 'standalone'`), src/app/layout.tsx + page.tsx mínimos
- [X] T002 [P] Tailwind CSS + shadcn/ui: tailwind.config.ts, src/app/globals.css con tema oscuro premium propio (acento `#25D366`), components.json, primitivas base en src/components/ui/
- [X] T003 [P] ESLint + scripts `typecheck`/`lint`/`build`/`test` en package.json, eslint.config.mjs
- [X] T004 [P] docker-compose.dev.yml con Postgres 16 local (puerto 5432, volumen)
- [X] T005 [P] Vitest: vitest.config.ts + tests/unit/smoke.test.ts
- [X] T006 .env.example con placeholders `REEMPLAZA_...` + guía inline por bloque (SIN `WA_MOCK_ENABLED`); verificar `.env` en .gitignore
- [X] T007 [P] src/lib/env.ts — getEnv() lazy+memoizada con Zod, BUILD_PLACEHOLDERS si `NEXT_PHASE === 'phase-production-build'` (DV-VC-10)
- [X] T008 [P] src/lib/db/ids.ts — nanoid con prefijos (ct_, cv_, msg_, ld_, stg_, cred_, agp_, kb_, tpl_, run_, case_)

**Checkpoint**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde en esqueleto

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: BD, auth, cifrado, cliente Graph, credenciales, bus SSE — nada de US puede empezar sin esto

**⚠️ CRITICAL**: bloquea todas las user stories

- [X] T009 Schema Drizzle completo en src/lib/db/schema.ts según data-model.md (~15 tablas, `organization_id` NOT NULL + índices org-first, UNIQUEs: contact(org,phone), lead(contact_id), conversation parcial (org,contact) WHERE is_test=false, message(wa_message_id), meta_credentials(org / phone_number_id), agent_test_run parcial (org) WHERE status='running', template(org,name,language))
- [X] T010 drizzle.config.ts + migración inicial generada en drizzle/ (`pnpm db:generate`, `pnpm db:migrate` con drizzle-kit para dev)
- [X] T011 src/lib/db/index.ts (cliente postgres-js) + src/lib/db/tenant.ts (helpers de scope por organización, obligatorios en toda query de dominio)
- [X] T012 Better Auth + plugin organization: src/lib/auth/index.ts, src/lib/auth/session.ts (helper requireSession → org activa), src/app/api/auth/[...all]/route.ts
- [X] T013 Registro crea org + owner + etapas semilla del pipeline (Nuevo→En conversación→Interesado→Cliente[won]→Perdido[lost]) en src/server/auth/on-signup.ts
- [X] T014 Páginas (auth): src/app/(auth)/login/page.tsx + src/app/(auth)/register/page.tsx
- [X] T015 Shell autenticado src/app/(app)/layout.tsx: nav lateral (Bandeja, Pipeline, Contactos, Agente, Laboratorio, Configuración), guard de sesión, tema oscuro
- [X] T016 [P] src/lib/crypto/index.ts — AES-256-GCM (clave 32B desde ENCRYPTION_KEY base64, IV 12B, cipher/iv/tag separados) (DV-VC-05)
- [X] T017 [P] tests/unit/crypto.test.ts — roundtrip, tag inválido lanza, clave mal formada lanza
- [X] T018 [P] src/lib/meta/client.ts — graphRequest tipado sobre `META_GRAPH_BASE_URL`/versión, MetaApiError, detección 401/code 190/OAuthException → reconnect_required (DV-VC-13), normalizeRecipient MX 521→52 (DV-VC-12)
- [X] T019 [P] tests/unit/meta-client.test.ts — normalizeRecipient (521..13díg → 52+10, otros intactos) y mapeo error 190
- [X] T020 src/server/whatsapp/credentials.ts — guardar cifrado, getByPhoneNumberId, getByOrg, estado (connected / reconnect_required / none), last4
- [X] T021 src/server/events/bus.ts (EventEmitter in-process por org, publish tras commit) + src/app/api/events/route.ts (SSE contrato sse.md: headers exactos, heartbeat 25s, force-dynamic) (DV-VC-01)
- [X] T022 [P] src/app/api/health/route.ts — `{ ok: true }` + check de BD
- [X] T023 src/lib/dev-guard.ts — gate mocks (`WA_MOCK_ENABLED==='true' && NODE_ENV !== 'production'` → si no 404) + tests/unit/dev-guard.test.ts (mocks en prod → 404)

**Checkpoint**: registro→login→shell navegable; /api/health ok; gate verde

---

## Phase 3: User Story 1 — Bandeja WhatsApp en tiempo real (Priority: P1) 🎯 MVP

**Goal**: mensajes entrantes visibles ≤2s vía SSE; responder dentro de ventana 24h; dedup idempotente

**Independent Test**: con número conectado (mock), `POST wa-mock/inbound` → mensaje visible en bandeja abierta ≤2s sin refrescar; responder → aparece en outbox del mock; mismo waMessageId 2 veces → un solo mensaje; ventana cerrada → input bloqueado con oferta de plantilla

- [X] T024 [US1] src/app/api/webhooks/wa/[webhookToken]/route.ts — GET handshake (hub.mode/verify_token/challenge; segmento timing-safe vs META_WEBHOOK_VERIFY_TOKEN, si no → 404 sin efectos) (contrato webhook.md)
- [X] T025 [US1] Webhook POST en la misma ruta: leer body CRUDO, capa 2 firma `x-hub-signature-256` solo si META_APP_SECRET (inválida → 401), responder 200 siempre, procesar en `after()`, enrutar por `metadata.phone_number_id` / `entry[].id` (DV-VC-02/03)
- [X] T026 [P] [US1] tests/unit/webhook.test.ts — firma válida/ inválida/ sin secret, segmento incorrecto → 404 sin side effects
- [X] T027 [US1] src/server/inbox/ingest.ts — resolver org por phone_number_id, getOrCreateContact (UPSERT org+phone, coalesce nombre), getOrCreateConversation (no-test), insertar message `.onConflictDoNothing({target: wa_message_id}).returning()` → isNew gate, unread_count+last_inbound_at/last_message_at, media entrante = chip por tipo, publish SSE `message.new`/`conversation.updated`
- [X] T028 [US1] src/server/inbox/status.ts — statuses del webhook con upgrades monotónicos (pending<sent<delivered<read; failed siempre) + SSE `message.status`
- [X] T029 [P] [US1] tests/unit/ingest.test.ts — dedup por wa_message_id (2ª ingesta no re-dispara) y monotonicidad de status
- [X] T030 [US1] src/server/inbox/window.ts — ventana 24h desde last_inbound_at (isOpen, remaining) + tests/unit/window.test.ts (borde exacto 24h)
- [X] T031 [US1] src/server/inbox/send.ts — **aserción dura: conversación `is_test` → throw antes de cualquier llamada Graph**; check ventana; enviar texto vía lib/meta; persistir out+pending con wa_message_id devuelto; SSE
- [X] T032 [P] [US1] tests/unit/send-sandbox.test.ts — send con is_test lanza y NO invoca el cliente Graph (spy)
- [X] T033 [US1] APIs: GET /api/conversations?since= (excluye is_test), GET/POST /api/conversations/[id]/messages (POST texto → 409 ventana cerrada), PATCH /api/conversations/[id] ({aiEnabled, reactivate}) en src/app/api/conversations/
- [X] T034 [US1] wa-mock completo bajo src/app/api/dev/wa-mock/ — inbound (payload real firmado con META_APP_SECRET, POST loopback 127.0.0.1, overrides waMessageId/timestamp), status, template-status, graph/[...path] (messages→outbox+wamid.mock, GET número con token `-invalid`→401 code 190, message_templates→PENDING), outbox GET/DELETE (contrato mocks.md)
- [X] T035 [US1] UI bandeja 3 columnas en src/app/(app)/inbox/ — lista conversaciones (avatar iniciales color estable, badge no-leídos, hora), hilo (burbujas in/out, estados ✓, chips de media, marca `ai_generated`), panel contacto (datos, etapa, toggle IA, notas)
- [X] T036 [US1] src/components/use-events.ts — hook EventSource: suscripción tipada, en `open` tras reconexión refetch con `since=` (catch-up del contrato sse.md)
- [X] T037 [US1] Ventana en UI: indicador de tiempo restante; cerrada → composer bloqueado ofreciendo plantillas aprobadas (estado vacío si no hay) en src/app/(app)/inbox/
- [X] T038 [US1] Guion E2E tests/e2e/us1-inbox.md + ejecutarlo con Playwright: registro→conectar mock→inbound visible ≤2s→responder→outbox→dedup→ventana vieja (timestamp override) → 409 + composer bloqueado

**Checkpoint**: US1 funcional E2E contra wa-mock

---

## Phase 4: User Story 2 — Contactos y pipeline kanban (Priority: P1) 🎯 MVP

**Goal**: contacto+lead auto-registrados al primer mensaje; kanban drag&drop persistente

**Independent Test**: inbound de número nuevo → aparece en Contactos y como card en "Nuevo"; arrastrar a otra etapa → persiste tras recargar

- [X] T039 [US2] Auto-registro de lead en primera conversación (etapa "Nuevo", position al final) integrado en src/server/inbox/ingest.ts
- [X] T040 [US2] APIs contactos: GET (?q= busca nombre/teléfono) / POST / PATCH (notas, archivar) en src/app/api/contacts/
- [X] T041 [US2] APIs pipeline: CRUD etapas (DELETE exige moveTo; anclas won/lost no borrables), PATCH /api/pipeline/leads/[id] {stageId, position} en src/app/api/pipeline/
- [X] T042 [P] [US2] UI contactos src/app/(app)/contacts/ — tabla con búsqueda, edición de notas, archivar, link a conversación
- [X] T043 [US2] UI kanban src/app/(app)/pipeline/ con @dnd-kit — columnas por etapa, cards (nombre, último mensaje, tiempo), drag&drop persiste vía PATCH, gestión de etapas
- [X] T044 [P] [US2] tests/unit/tenant.test.ts — queries de contactos/conversaciones/leads jamás cruzan organization_id
- [X] T045 [US2] Guion E2E tests/e2e/us2-pipeline.md + ejecutarlo: auto-registro, drag persiste tras reload, búsqueda

**Checkpoint 🎯 GATE MVP**: US1+US2 E2E verdes ANTES de cualquier línea de US3+

---

## Phase 5: User Story 3 — Agente de IA con acciones tipadas (Priority: P1)

**Goal**: agente responde con KB, una acción tipada por turno, handoff confiable

**Independent Test**: con ai-mock, inbound → respuesta del agente marcada IA; "quiero hablar con un humano" → handoff (IA off + conversación destacada); intención de compra → lead a "Interesado"

- [X] T046 [US3] src/lib/ai/index.ts — adaptador OpenRouter-compatible: chatJson<T> (3 intentos, instrucción STRICT al reintentar, extractJson fence/llaves balanceadas, Zod, error tipado, jamás loguear key), envs con defaults (JUDGE_MODEL = MODEL); sin token → capability off (DV-VC-06)
- [X] T047 [P] [US3] tests/unit/ai-adapter.test.ts — extractJson (fence, texto alrededor, JSON sucio), reintento ante inválido, salida error tipada sin excepción
- [X] T048 [US3] APIs: GET/PUT /api/agent/profile, CRUD /api/kb + GET /api/kb/size en src/app/api/agent/ y src/app/api/kb/
- [X] T049 [US3] UI src/app/(app)/agent/ — sección Comportamiento (nombre, tono, instrucciones, toggle global) + sección Knowledge base (entradas qa/block, contador tamaño); estado vacío claro sin OPENROUTER_API_TOKEN
- [X] T050 [US3] src/server/ai/prompts.ts — builder de system prompt (comportamiento + KB + etapas + reglas de acción JSON) y prompt del juez con marcador `[JUEZ]`
- [X] T051 [US3] src/server/ai/actions.ts — AgentAction (contrato ai.md), ejecución server-side: move_stage fuzzy contra etapas de la org (sin match → degradar reply/none), update_lead → nota, handoff → flags conversación
- [X] T052 [US3] src/server/ai/handoff.ts — regex de respaldo ANTES del LLM + tests/unit/handoff.test.ts (matches positivos + **"somos 4 personas" NO matchea**)
- [X] T053 [US3] src/server/ai/pipeline.ts — coalesce Map {timer,running,pending} por conversación (AGENT_COALESCE_MS, 6s prod / 0 lab), lock, re-run si pending, condiciones (IA global+conversación on, sin handoff), ventana cerrada/error persistente → handoff automático (reason ventana|error), mensajes salientes ai_generated, SSE (DV-VC-07)
- [X] T054 [US3] ai-mock src/app/api/dev/ai-mock/chat/completions/route.ts — despacho por contenido (contrato mocks.md: [JUEZ]→veredictos fijos, frase humano→handoff, compra→move_stage Interesado, default reply eco), shape OpenRouter, gated por dev-guard
- [X] T055 [US3] Guion E2E tests/e2e/us3-agent.md + ejecutarlo contra ai-mock: reply IA, handoff por frase (+ badge y toggle off), move_stage refleja en kanban, sin token → estados vacíos

**Checkpoint**: agente E2E verde con ai-mock

---

## Phase 6: User Story 4 — Laboratorio de auto-evaluación (Priority: P1) ⭐

**Goal**: 6 personas guionadas contra el pipeline REAL en sandbox, juez LLM, reporte accionable con sugerencias 1-click

**Independent Test**: lanzar corrida con ai-mock → 6 casos con progreso en vivo → reporte con score + hallazgo `fuera_de_kb` rojo → aplicar sugerencia → re-run → score sube; wa-mock outbox permanece VACÍO

- [X] T056 [US4] src/server/lab/personas.ts — 6 personas fijas guionadas (comprador_decidido, pregunton_precios, cliente_enojado, fuera_de_kb, pide_humano, errores_modismos; 4–5 mensajes c/u, sin LLM)
- [X] T057 [US4] src/server/lab/runner.ts — corrida in-process fire-and-forget: crear run+6 cases, por caso crear conversación `is_test=true` + contacto sintético, turnos secuenciales (mensaje → pipeline real debounce 0 → esperar respuesta), fin de guion o handoff → juez; progreso SSE `lab.run`; timeout 10 min → failed (DV-VC-08)
- [X] T058 [US4] src/server/lab/judge.ts — UNA llamada por conversación vía chatJson (Verdict de ai.md), reintentos del adaptador, inválido final → case judge_failed (visible, excluido del score); score = round(100*(verdes+0.5*amarillos)/casos_con_veredicto)
- [X] T059 [US4] src/instrumentation.ts — al boot marcar runs `running` huérfanos → failed
- [X] T060 [US4] APIs: POST /api/lab/runs (409 si running por índice parcial UNIQUE), GET /api/lab/runs (historial + delta score), GET /api/lab/runs/[id] (detalle+progreso), POST /api/lab/suggestions/apply ({caseId,hallazgoIndex,pregunta,respuesta} → kb_entry) en src/app/api/lab/
- [X] T061 [US4] UI src/app/(app)/lab/ — botón lanzar + subtítulo "Sandbox interno — no envía mensajes reales", progreso en vivo (SSE), reporte (score 0-100, cards de hallazgo por tipo con evidencia, botón "Agregar al conocimiento" 1-click), transcripts por persona, historial con delta
- [X] T062 [P] [US4] tests/unit/judge.test.ts — salida inválida del juez → reintento → judge_failed excluido del denominador del score
- [X] T063 [P] [US4] tests/unit/lab-sandbox.test.ts — la corrida completa jamás invoca el cliente Graph (spy sobre lib/meta)
- [X] T064 [US4] Guion E2E tests/e2e/us4-lab.md + ejecutarlo (SIEMPRE ai-mock): corrida→reporte→aplicar sugerencia→re-run cierra el loop con score mayor; outbox del wa-mock vacío al final

**Checkpoint**: Laboratorio E2E verde y determinista

---

## Phase 7: User Story 5 — Conexión del número (Priority: P1)

**Goal**: wizard directo/agencia con "probar conexión" antes de guardar; webhook autenticado en dos capas

**Independent Test**: wizard con IDs mock → probar conexión ok → guardar → estado conectado (last4); token `-invalid` → error claro SIN guardar; página muestra URL completa del webhook y estado de la capa de firma

- [X] T065 [US5] POST /api/settings/whatsapp/test — valida token↔número vía `GET {phoneNumberId}?fields=display_phone_number,verified_name` (NO persiste; MetaApiError → mensaje accionable) en src/app/api/settings/whatsapp/test/route.ts
- [X] T066 [US5] GET/PUT /api/settings/whatsapp — guardar (re-validar → cifrar → upsert; luego `POST {WABA_ID}/subscribed_apps` best-effort DV-VC-04) / estado (connected, display number, last4, reconnect_required) en src/app/api/settings/whatsapp/route.ts
- [X] T067 [US5] GET /api/settings/webhook — URL completa `{APP_BASE_URL}/api/webhooks/wa/{token}`, verify token, estado capa 2 (META_APP_SECRET configurado o aviso informativo) en src/app/api/settings/webhook/route.ts
- [X] T068 [US5] UI wizard src/app/(app)/settings/whatsapp/ — pasos: (1) origen del token explicado en ambos modos (directo: app propia de Meta; agencia: Tech Provider con override por WABA), (2) WABA ID + Phone Number ID + token, (3) probar conexión (gate), (4) guardar + datos del webhook para pegar en Meta; banner reconnect_required
- [X] T069 [US5] Manejo reconnect_required transversal: envíos bloqueados con error tipado + banner en Settings (tocar src/server/inbox/send.ts y settings UI)
- [X] T070 [P] [US5] tests/unit/credentials.test.ts — guardar cifra (no texto plano en fila), respuesta API solo last4, 190 en test → error mapeado sin persistir
- [X] T071 [US5] Guion E2E tests/e2e/us5-connect.md + ejecutarlo: camino feliz + token inválido + webhook info visible

**Checkpoint**: núcleo conectable E2E; agente+lab+bandeja operando sobre credenciales del wizard

---

## Phase 8: User Story 8 — Instalación en 15 minutos (Priority: P1)

**Goal**: Ruta A (Coolify+MCP guiada por INSTALL-IA.md) y Ruta B (compose+Caddy); seed demo; docs públicas

**Independent Test**: `DOMAIN=localhost docker compose up -d --build` → https://localhost sirve, registro→demo→bandeja funcional, SSE ≤2s a través de Caddy

- [X] T072 [US8] scripts/migrate.mjs (drizzle migrator, max:1, onnotice silencioso, MIGRATIONS_DIR relativo) + bundle esbuild en build de Docker + script pnpm `db:migrate:prod` (DV-VC-11)
- [X] T073 [US8] Dockerfile multi-stage node:22-alpine — corepack pnpm, build standalone, `CMD ["sh","-c","node migrate.mjs && node server.js"]`, HEALTHCHECK /api/health start-period 40s
- [X] T074 [US8] docker-compose.yml (app + postgres16 + caddy con `{$DOMAIN}`, healthchecks, depends_on condition) + Caddyfile (reverse_proxy, sin buffering extra)
- [X] T075 [US8] Seed "Ferretería El Martillo": scripts/seed/demo.mjs + POST /api/seed/demo + botón en UI (solo BD de dominio vacía) — ~8 contactos MX, conversaciones con cotizaciones MXN, pipeline poblado, KB llena con huecos INTENCIONALES (garantías y devoluciones), 1 corrida de Laboratorio de ejemplo guardada; idempotente (DELETE org demo por orden de FKs)
- [X] T076 [US8] INSTALL-IA.md — guía para que una IA (Claude Code + Coolify MCP) instale sola: pregunta SOLO dominio, token OpenRouter (opcional) y ruta A/B; genera secretos con openssl; crea app+Postgres en Coolify; termina indicando que WhatsApp se conecta en Settings
- [X] T077 [US8] README.md completo — pitch, features (Laboratorio PRIMERO), instalación A/B, conexión del número (modo directo y **checklist de 5 pasos del modo agencia con diagrama de texto** + limitación de plantillas y su sync), cumplimiento Meta (5 puntos), FAQ, roadmap, licencia MIT, placeholders `[LINKS-KEVIN]`
- [X] T078 [P] [US8] LICENSE (MIT) + revisión de metadata pública de package.json (name vocero-crm, license MIT)
- [X] T079 [US8] Reescribir CLAUDE.md del repo para el usuario final (agencia que modifica con Claude Code): stack real sin corchetes, fronteras de modificación (lib/ai, lib/meta, schema, prompts), reglas de constitución II endurecida (sin regla S3), envs con ejemplo OPENROUTER_JUDGE_MODEL, metodología de verificación
- [X] T080 [US8] Checkpoint E2E compose: build+up, https://localhost, registro→seed→inbound mock→**SSE ≤2s a través de Caddy**, healthchecks verdes, logs sin secretos

**Checkpoint**: NÚCLEO NO NEGOCIABLE completo (US1–US5 + US8) — candidato a merge

---

## Phase 9: User Story 6 — Plantillas (Priority: P2)

**Goal**: crear plantilla con `{{1}}`, aprobación Meta (webhook + sync), enviar con ventana cerrada

**Independent Test**: crear plantilla → pending; wa-mock template-status APPROVED → badge aprobado; conversación con ventana cerrada → enviar plantilla con variable → aparece en outbox con components

- [X] T081 [US6] src/server/whatsapp/templates.ts — create en Meta (`POST {WABA_ID}/message_templates`), countVariables (`/\{\{\s*(\d+)\s*\}\}/g`, máx 1), renderBody, buildSendComponents, syncTemplates pull (`GET {WABA_ID}/message_templates`, match por waTemplateId o name+language), errores tipados → HTTP (DV-VC-15)
- [X] T082 [US6] APIs GET/POST /api/templates + POST /api/templates/sync; routing de `message_template_status_update` por `entry[].id` en el webhook (upsert estado) en src/app/api/templates/ y webhook route
- [X] T083 [US6] UI plantillas en src/app/(app)/settings/templates/ — form (nombre, idioma, categoría, body con una `{{1}}`), lista con badges de estado, botón Sincronizar (cubre modo agencia), nota de la limitación
- [X] T084 [US6] POST /api/conversations/[id]/messages/template ({templateId, variable}; solo approved, valida variable) + integración en composer de ventana cerrada (T037) en src/app/api/conversations/ e inbox UI
- [X] T085 [P] [US6] tests/unit/templates.test.ts — countVariables (0, 1, {{2}} inválida, espacios), validación de envío (no aprobada → error, variable faltante → error)
- [X] T086 [US6] Guion E2E tests/e2e/us6-templates.md + ejecutarlo: ciclo completo crear→aprobar (mock)→enviar en ventana cerrada→outbox con components

**Checkpoint**: SEGUNDO ANILLO completo

---

## Phase 10: User Story 7 — Multi-usuario mínimo (Priority: P3)

**Goal**: registro cerrado tras la 1ª org; owner crea cuentas de equipo; rate limit de auth

**Independent Test**: 2º registro → bloqueado con mensaje claro; con ALLOW_SIGNUP=true → permitido; owner crea miembro (email+password temporal) y este entra; 11 logins fallidos seguidos → 429

- [X] T087 [US7] Gate de registro: existe una org → signup deshabilitado salvo `ALLOW_SIGNUP=true` (server-side en on-signup/route + UI del registro) + tests/unit/registration.test.ts
- [X] T088 [US7] GET/POST /api/settings/team — listar miembros; crear cuenta (owner only, email + password temporal, rol member) vía Better Auth admin API en src/app/api/settings/team/route.ts
- [X] T089 [P] [US7] UI equipo src/app/(app)/settings/team/ — lista, form de alta con password temporal mostrada una vez
- [X] T090 [US7] Rate limiter in-process por IP (ventana deslizante 10 intentos/10min → 429) aplicado a endpoints de auth en src/lib/rate-limit.ts + tests/unit/rate-limit.test.ts
- [X] T091 [US7] Guion E2E tests/e2e/us7-team.md + ejecutarlo: registro cerrado, escape ALLOW_SIGNUP, alta y login de miembro

**Checkpoint**: todas las user stories funcionales

---

## Phase 11: Polish, Verificación final y Entrega

**Purpose**: gate completo, self-test integral, smoke real condicional, higiene de repo público, merge

- [X] T092 Gate técnico completo verde: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` (todos los unit tests enumerados en la spec presentes y verdes)
- [X] T093 Corrida integral del self-test E2E: todos los guiones tests/e2e/us1..us7 contra `pnpm dev` Y verificación clave repetida contra compose+Caddy (SSE ≤2s, webhook, seed) — caminos infelices incluidos
- [X] T094 Smoke test real CONDICIONAL (hay credenciales Meta reales en .env): conexión real del número, webhook real (o override), 1 entrante/saliente real, 1 corrida de Laboratorio con modelo real vía OpenRouter — documentar evidencia
- [X] T095 Auditoría de fugas OBLIGATORIA: `git log -p` + working tree, grep por nombres privados, dominios internos y rutas de máquina local; hits en historial → reescribir historia antes de reportar; verificar .mcp.json/.claude sin datos privados
- [X] T096 [P] Capturas para README en docs/screenshots/ (bandeja, kanban, Laboratorio-reporte, wizard) — DIFERIBLE
- [X] T097 Lista "pendiente de verificación humana" + reporte final (verde con evidencia / diferido con instrucciones / roadmap) en el chat
- [X] T098 Merge `001-vocero-core` → `main` (merge normal, conservar rama — OK explícito ya dado), validar con /speckit-git-validate, dejar `main` activa

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → bloquea todo lo demás
- **US1 (3)** → **US2 (4)**: 🎯 GATE MVP — E2E verdes antes de US3+
- **US3 (5)** → **US4 (6)**: el Laboratorio consume el pipeline real del agente
- **US5 (7)**: independiente tras Foundational (T020 credenciales); su E2E usa wa-mock (T034)
- **US8 (8)**: requiere US1–US5 para el checkpoint compose completo; T072–T074 pueden empezar antes
- **US6 (9)**: requiere webhook (US1) y credenciales (US5); composer cerrado integra con T037
- **US7 (10)**: solo Foundational (auth)
- **Polish (11)**: todo lo anterior

### Story Dependencies notables

- T039 (lead auto-create) toca ingest.ts de US1 → secuencial tras T027
- T084 (enviar plantilla) completa el estado vacío dejado por T037
- T053 (pipeline agente) es la dependencia dura de T057 (runner del lab)

### Parallel Opportunities

- Setup: T002–T005, T007, T008 en paralelo tras T001
- Foundational: T016–T019, T022 en paralelo; T009→T010→T011 secuencial
- Unit tests marcados [P] en paralelo con la UI de su fase
- T042 (contactos UI) ∥ T043 (kanban); T072–T074 ∥ US6/US7

---

## Implementation Strategy

1. **MVP primero**: Fases 1–4 → gate US1+US2 E2E verde (parar y validar).
2. **Núcleo P1**: Fases 5–8 en orden (agente → lab → conexión → instalación); checkpoint E2E al final de cada una; commit atómico por fase.
3. **Anillos**: Fase 9 (US6), Fase 10 (US7) — diferibles solo si se agota presupuesto, reportando.
4. **Entrega**: Fase 11 completa; merge a main solo con núcleo verde verificado.

## Notes

- Todo texto de producto en español neutro; tema oscuro propio con acento #25D366.
- Mocks solo bajo src/app/api/dev/ con dev-guard; `WA_MOCK_ENABLED` jamás en .env.example.
- Repo público: cero secretos/nombres privados en código, seeds, docs y commits.
- E2E del Laboratorio SIEMPRE contra ai-mock (determinismo); smoke real aparte (T094).
