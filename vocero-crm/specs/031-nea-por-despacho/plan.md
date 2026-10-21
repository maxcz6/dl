# 031 — Plan

Spec: [spec.md](spec.md). Dos repos, dos PRs: `vocero-crm` (contrato aditivo)
y `nea-agent` (la entrada única). El del CRM va primero, porque Nea lee lo que
el CRM agrega; Nea tolera que falte, así que el orden no rompe nada.

## Constitution Check (antes de la Fase 0)

Sin violaciones. Lo único que se mira con cuidado es el contrato del despacho:
las llaves nuevas son opcionales y solo aparecen cuando aplican, así que el
cuerpo fijado byte a byte no cambia (Principio IV y regla de versión del
contrato: agregar cabe, quitar o renombrar no).

## Fase 0 — Lo que se investigó

| Pregunta | Respuesta |
|---|---|
| ¿Qué le daba el webhook a Nea que el despacho no trae? | `referral.headline`, `location`, `contacts[].name`, `document.filename` y `audio.voice` (`app/webhook.py`, `_parse_messages`). El resto (texto, botones, adjuntos con `mediaId`, nombre de perfil) ya viaja. |
| ¿Dónde guarda el CRM cada uno? | Anuncio: tabla `ad_attribution` (una por conversación). Ubicación y tarjetas: `media_asset.payload` con `kind` `location` o `contacts`. Nombre del archivo: `media_asset.file_name`. Voz: no se guarda. |
| ¿Nea ya lee `adOrigen`? | Sí: `app/prompt.py` cae a `context.adOrigen.headline` cuando el mensaje no trae `referral`. Vocero Cloud ya lo manda; la raíz no. |
| ¿Con qué firma la raíz? | `BOT_API_KEY`, la misma llave que Nea tiene como `CRM_BOT_API_KEY`. |
| ¿La raíz exige `dispatchId` al contestar? | No. `/api/bot/messages` pide `conversationId` y `text`, como siempre. |
| ¿Qué pasa en la raíz si Nea no contesta el despacho? | Tres intentos (1 s, 4 s), y la conversación pasa a humano con motivo `error` (021). |
| ¿Puede Nea vivir en otro esquema de la misma base? | Sí: sus migraciones no califican tablas. Con `search_path` en el pool y `CREATE SCHEMA IF NOT EXISTS` antes de migrar, todo cae en su esquema. Los candados de aviso (`pg_advisory_lock`) son por base, y su llave lleva el prefijo `nea:`, que el CRM no usa. |

## Fase 1 — Diseño

### CRM (`vocero-crm`)

1. **`/api/bot/context` gana `adOrigen`**: `{headline, body, sourceType,
   sourceUrl, hasCtwaClid}` de `ad_attribution` de esa conversación, o `null`.
   Mismo nombre y misma forma que Vocero Cloud (`hasCtwaClid` en vez del clid:
   el identificador no sale del CRM).
2. **El mensaje del despacho gana tres llaves opcionales**, después de las que
   ya tiene y en este orden:
   - `fileName`: con adjunto y nombre de archivo.
   - `location`: `{latitude, longitude, name, address}` cuando `type` es
     `location` (de `media_asset.payload`; sin `name` ni `address` si no
     vienen).
   - `contacts`: `[{name}]` cuando `type` es `contacts`.
   `deliver.ts` ya junta `media_asset`; se suman `fileName`, `kind` y
   `payload` a lo que lee.
3. **Contrato** (`021/contracts/despacho.md`): las tres llaves y `adOrigen`,
   marcados (031).
4. **Pruebas**: `despacho-contrato.test.ts` sigue verde sin tocar su cuerpo;
   casos nuevos para las tres llaves; `e2e-despacho.mjs` gana una sección
   con ubicación, tarjeta y PDF; una prueba de `adOrigen` en el contexto.

### Nea (`nea-agent`)

1. **Entrada** (`app/dispatch.py`): se monta siempre. La firma se valida con
   `CRM_BOT_API_KEY` en estándar y `CRM_BRAIN_SECRET` en cloud. La traducción
   del mensaje lee `fileName`, `location`, `contacts`, y la voz sale del tipo.
   `conversation.channel` viaja al turno.
2. **Cola durable** (`dispatch_worker`): corre en los dos modos. En estándar
   la cola se indexa con la organización vacía, como la de un solo negocio en
   cloud.
3. **Cliente de la raíz** (`app/crm.py`): `registrar(identity,
   conversation_id)` como el de cloud; `get_context` pide por
   `conversationId` cuando lo tiene.
4. **Turno** (`app/turn.py`): sin coalescer ni relay; `_anotar_leidos` en los
   dos modos; `_fetch_context` pierde la espera al relay; el canal llega a
   `build_system_prompt`.
5. **Prompt** (`app/prompt.py`): el canal en la presentación del agente y
   «mensajes cortos de chat» donde decía WhatsApp. Cambio de prompt ⇒ se
   corre la verificación de comportamiento (escenarios 1–6).
6. **Webhook viejo** (`app/main.py`): rutas `POST /webhook` y
   `POST /webhook/{x}` → 503 con el aviso de D4; `/health` con
   `webhookDeMeta`.
7. **Base** (`app/db.py`, `app/config.py`): `DATABASE_SCHEMA`.
8. **Sale**: `app/webhook.py`, `app/relay.py`, `app/coalesce.py`, lo del
   relay en `state.py` y `db.py`, sus pruebas y las variables de D2.
9. **Docs**: README (instalar contra la raíz), `.env.example`, `AGENTS.md`,
   `CLAUDE.md`, CHANGELOG con «Actualizar desde 1.x», versión 2.0.0.
10. **E2E** (`scripts/e2e_contra_raiz.py`): el cliente le escribe al webhook
    del CRM; el CRM con `BRAIN_DISPATCH_URL` hacia Nea; una sola base con
    `DATABASE_SCHEMA=nea`; escenarios 7–9 reescritos (AC9).

## Constitution Check (después del diseño)

Sin cambios respecto al de arriba. `adOrigen` no saca el `ctwa_clid` del CRM
(solo si existe). La caída de Nea sigue terminando en humano, nunca en
silencio.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Quien actualiza Nea antes de mover el webhook pierde mensajes | D4: 503 para que Meta reintente, error en el log y en `/health` |
| El coalesce del CRM (6 s) es más largo que el de Nea (4 s) | Se mide en el E2E; `AGENT_COALESCE_MS` se puede bajar en el CRM |
| Cambio de prompt que mueve la conducta | Escenarios 1–6 con modelo real y tope de gasto |
