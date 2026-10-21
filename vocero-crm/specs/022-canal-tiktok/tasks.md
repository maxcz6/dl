# Tasks — 022 Canal de TikTok

## Datos

- [x] T001 `tiktok` en `Channel`; tabla `tiktokCredentials` en `schema.ts`
- [x] T002 `pnpm db:generate` → `0018_canal_tiktok`; migrar una base en `0017`

## Núcleo

- [x] T003 Capacidades: `maxTextChars`, `maxOutboundPerWindow`, ventana de 48 h
- [x] T004 La ventana se pregunta por canal (`window.ts` y quienes la usan)
- [x] T005 `outbound-cap.ts`: salientes desde el último entrante

## Adaptador

- [x] T006 `tiktok/credentials.ts`
- [x] T007 `tiktok/ingest.ts`: normalizar el evento de Zernio e ingerir
- [x] T008 `tiktok/send.ts` y la rama de TikTok en `inbox/send.ts` (`message_limit`)
- [x] T009 `zernio/`: reparto y secreto por plataforma; `data.messageId`
- [x] T010 El agente incluido calla ante `message_limit`; el despacho lleva el canal

## Superficie

- [x] T011 Webhook `/api/webhooks/tiktok/[token]`
- [x] T012 `/api/settings/tiktok` y `tiktokUrl`
- [x] T013 Ajustes → TikTok, distintivo, compositor

## Pruebas y documentación

- [x] T014 Unitarias (`tests/unit/tiktok.test.ts`, nav, contrato)
- [x] T015 Guion `tests/e2e/us-tiktok.md` y arnés `scripts/e2e-tiktok.mjs`
- [x] T016 `AGENTS.md`, README, `.env.example`, CHANGELOG, `specs/README.md`, `ci.yml`
- [x] T017 Gates en las dos configuraciones y E2E (tiktok, messenger, despacho, selftest)
- [ ] T018 Prueba en vivo y bitácora
