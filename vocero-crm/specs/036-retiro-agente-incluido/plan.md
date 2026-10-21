# Plan — 036 Retiro del agente incluido

## CRM (vocero-crm)

1. **Proxy** `src/app/api/bot/llm/[...ruta]/route.ts` + `src/server/bot/llm-proxy.ts`
   (puerto de cloud sin lista de modelos). `requireBotKey` acepta también
   `Authorization: Bearer`.
2. **Perfil**: `serializeBotProfile` gana `llm` (`{path, model}` | `null`).
3. **Despacho**: la ingesta llama a `despacharAlCerebro` cuando
   `despachoActivo()`; el encolado exige `agent_profile.enabled`.
4. **Interruptor**: `PUT /api/agent/profile {enabled:true}` → 409 `sin_cerebro`
   sin despacho o sin `/health`.
5. **Borrar** el turno del proceso (D1) y sus pruebas; recortar `prompts.ts` y
   el ai-mock; quitar `eval-silencios`.
6. **Laboratorio**: el runner solo despacha; `POST /api/lab/runs` → 409
   `sin_cerebro` sin despacho.
7. **«Quién responde»**: DTO sin `embedded`, con `enabled`; avisos
   `sin_cerebro` y `apagado`; tarjeta y panel.
8. **Guía de inicio**: paso `brain`; tarjeta final según haya cerebro.
9. **Ajustes → IA**: el texto de para qué es la llave.
10. **OpenAPI**: `/api/bot/llm/{ruta}`, `llm` en `Perfil`.
11. **Compose / .env.example / docs**: Nea sin `LLM_API_KEY`; guía de
    migración (quien venía con el incluido); CHANGELOG; README; AGENTS.md y
    CLAUDE.md (el mapa del código).
12. **E2E**: las secciones del arnés que encendían el agente incluido pasan a
    una Nea falsa (`levantarNeaFalsa`) o se van; e2e nuevo del proxy y del
    interruptor (`e2e-sin-agente.mjs`).

## Nea (nea-agent)

1. `LLM_API_KEY` vacía → `OpenAiLlm` contra `{CRM_BASE_URL}/api/bot/llm` con
   `CRM_BOT_API_KEY`; el modelo del perfil (`llm.model`) o `LLM_MODEL`.
2. `/health`: `llm: "crm" | "propia"`.
3. Pruebas (respx) y la prueba gemela del perfil con `llm`.

## Prueba en vivo

`vocero20`: imagen CRM y Nea `rc.7`; se borra `LLM_API_KEY` del servicio
(deja de existir la excepción de `coolify-env.mjs` para ella: solo se borra);
un WhatsApp real por el relevo y una corrida corta del Laboratorio.
