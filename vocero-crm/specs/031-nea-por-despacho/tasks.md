# 031 — Tareas

## CRM (`vocero-crm`)

- [ ] T1 `adOrigen` en `GET /api/bot/context` (`src/app/api/bot/context/route.ts`), con prueba
- [ ] T2 `fileName`, `location`, `contacts` en el mensaje del despacho (`src/server/brains/contract.ts`, `deliver.ts`)
- [ ] T3 Pruebas unitarias de las llaves nuevas; el cuerpo gemelo sin cambios
- [ ] T4 Sección nueva en `scripts/e2e-despacho.mjs` (ubicación, tarjeta, PDF)
- [ ] T5 Enmienda del contrato `specs/021-despacho-estandar/contracts/despacho.md`
- [ ] T6 Gates: `pnpm typecheck`, `lint`, `test`, `build`

## Nea (`nea-agent`)

- [ ] T7 Entrada única: `dispatch.py` montado siempre, firma por modo, llaves nuevas, canal
- [ ] T8 Cola durable en los dos modos; `CrmClient.registrar` y contexto por `conversationId`
- [ ] T9 Turno sin relay ni coalesce; dedup por mensaje en los dos modos; canal al prompt
- [ ] T10 Prompt con el canal
- [ ] T11 `/webhook` → 503 con aviso; `/health` con `webhookDeMeta`, sin `relay`
- [ ] T12 `DATABASE_SCHEMA`
- [ ] T13 Fuera `webhook.py`, `relay.py`, `coalesce.py` y sus pruebas; variables de D2
- [ ] T14 Prueba gemela del despacho de la raíz (`tests/test_despacho_raiz.py`)
- [ ] T15 `pytest` en verde
- [ ] T16 Docs: README, `.env.example`, `AGENTS.md`, `CLAUDE.md`, CHANGELOG, versión 2.0.0

## Juntos

- [ ] T17 `scripts/e2e_contra_raiz.py` con la topología nueva: 9/9
- [ ] T18 En vivo local con túnel: WhatsApp (línea cliente) e Instagram (DM de Kevin)
- [ ] T19 En vivo en Coolify (`vocero-16`)
- [ ] T20 Bitácora, PRs y tres líneas en el chat
