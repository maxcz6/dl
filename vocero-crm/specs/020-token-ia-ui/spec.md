# Feature Specification: Token de IA desde la interfaz, con prueba de conexión

**Feature Branch**: `feat/token-ia-ui`

**Created**: 2026-10-07

**Status**: Implementada en la rama; pendiente de revisión del dueño.

**Input**: issue #85 y el punto 3 de `docs/plan-1.5-y-2.0.md`: portar
`ai_credentials` de Vocero Cloud al raíz. Sin `isCloud()`, sin agencias ni
planes, sin el modelo fijo por plataforma (PR #102 de cloud).

**Carril**: ligero, con el modelo de datos dentro de esta spec. Toca el modelo
(una tabla nueva, migración aditiva `0015_token_de_ia`) pero no ningún
contrato publicado: `/api/bot/*` no cambia y `/api/settings/ai` es interno.

## Contexto

Hasta ahora el proveedor de IA solo se configuraba por entorno
(`OPENROUTER_API_TOKEN`, `OPENROUTER_MODEL`) y la pantalla Agente mandaba a
editar el `.env` y reiniciar. Para quien instala desde la imagen eso es la
única pieza del producto que obliga a tocar la plataforma después de
desplegar, y cuando la llave deja de servir (401) o la cuenta se queda sin
saldo (402) el agente calla sin que nada lo diga.

## Decisiones

- **D1 — La fila manda, el entorno es respaldo.** Lo guardado en Ajustes → IA
  decide; `OPENROUTER_*` se usa solo mientras no haya fila (instalaciones
  automatizadas, o quien ya las tenía). Una fila PAUSADA no cae al entorno: el
  dueño configuró su llave y debe ver el problema, no esconderlo detrás de
  otra llave.
- **D2 — Proveedor = base URL.** Dos presets en la UI: OpenRouter (base fija)
  y «Otro compatible con OpenAI» (base libre). Se acepta la base con o sin
  `/v1`. Un solo modelo: el juez del Laboratorio usa el mismo que el agente
  (con el entorno sigue valiendo `OPENROUTER_JUDGE_MODEL`).
- **D3 — El estado lo dicta quien cobra.** 401 → `paused_invalid_token`,
  402 → `paused_no_credit`; 429 y 5xx no pausan (hipos). Pausada, el adaptador
  no vuelve a llamar. Guardar una llave nueva reactiva; «Probar conexión» con
  la guardada, contra la misma base URL, también (el camino de «recargué
  saldo»). Cambiar solo el modelo no reactiva: no arregla una llave rechazada.
- **D4 — Probar no guarda.** «Probar conexión» es un turno mínimo
  (`max_tokens: 5`) con lo escrito; «Traer modelos» es `GET /v1/models`. Un
  proveedor sin esa lista no es un error: se dice y el modelo se escribe a mano.
- **D5 — El banner vive en el layout.** Agente encendido + IA no activa se
  avisa en toda la app, sin botón de cerrar; se va solo al arreglarse.
- **D6 — Fuera: el registro de llamadas (`ai_log`).** Proveedor, modelo, ms,
  tokens y ok por llamada quedan para un PR aparte, para mantener este
  manejable. La pestaña ya tiene sitio para una tarjeta «Actividad».

## Modelo de datos

`ai_credentials` (una fila por organización, `ai_credentials_org_uq`):

| Columna | Qué |
|---|---|
| `provider` | `openrouter` \| `openai_compatible` (el preset de la UI) |
| `base_url` | lo que identifica al proveedor |
| `model` | el modelo del agente (y del juez) |
| `token_cipher` / `token_iv` / `token_tag` | la llave, AES-256-GCM con `ENCRYPTION_KEY` (`lib/crypto`) |
| `token_last4` | lo único de la llave que sale a la UI |
| `status` | `active` \| `paused_invalid_token` \| `paused_no_credit` |
| `status_reason` / `status_changed_at` | lo que dijo el proveedor y cuándo |

## API interna (sesión)

| Endpoint | Qué |
|---|---|
| `GET /api/settings/ai` | credencial pública (sin llave), `activa`, `origen` (`org`/`env`), `mensaje`, `respaldoEntorno` |
| `PUT /api/settings/ai` | `{ provider, baseUrl?, model, token? }`; sin `token` cambia solo proveedor/modelo (422 `sin_token` si no hay fila) |
| `DELETE /api/settings/ai` | borra la fila; el entorno vuelve a aplicar si existe |
| `POST /api/settings/ai/test` | prueba con lo escrito (o la llave guardada); 422 con código tipado (`invalid_token`, `no_credit`, `model_not_found`…), 503 si el proveedor no contesta |
| `POST /api/settings/ai/models` | `{ soportado, modelos }`; 200 `soportado: false` si el proveedor no publica la lista |

## Código

- `lib/ai/presets.ts` (catálogo, URLs), `lib/ai/provider.ts` (resolución y
  estado; puras `interpretarCredencial`/`resolver`), `lib/ai/probe.ts`
  (sonda y modelos), `lib/ai/index.ts` (`chatJson` con `organizationId`; 401/402
  sobre la fila pausan y cortan los reintentos).
- `server/ai/credentials.ts` (fila cifrada, `estadoSegunRespuesta`),
  `server/ai/settings.ts` (Zod y vista), `server/ai/aviso.ts` (banner).
- `isAiConfigured()` del entorno pasa a `isAiConfiguredByEnv()`; los
  consumidores usan `isAiConfiguredFor(organizationId)`: brain-status, perfil
  del agente, Laboratorio, trigger y pipeline (la puerta baja hasta conocer la
  organización, antes de cualquier efecto).
- UI: `settings/ai` + `components/settings/ai-client.tsx`, pestaña «IA» en
  `settings-nav`, banner `components/avisos/aviso-ia.tsx` por `AppShell`;
  Agente, Laboratorio, «quién responde» y el panel de contacto enlazan a
  Ajustes → IA en vez de mandar al `.env`.
- Mock: `GET /api/dev/ai-mock/v1/models`; llave `-invalid` → 401,
  `-sin-saldo` → 402.

## Pruebas

Unitarias: `ai-config` (URLs, resolución fila > entorno, máquina de estados,
validación del PUT, respaldo del entorno), `ai-credentials` (cifrado, last4,
estado), `ai-probe` (clasificación de fallos, modelos), `ai-client` (ayuda
plegada, contraseña, banner) y `ai-adapter` (401/402 pausan y no reintentan,
429 no pausa, fila pausada no toca la red). Guion E2E: `tests/e2e/us3-agent.md`
§ «Ajustes → IA».
