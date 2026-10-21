# Quickstart — probar la atribución y el reporte a Meta de punta a punta

Feature: `016-atribucion-capi`. Todo el alcance se ejercita en localhost contra
el mock de Graph, **sin tocar Meta** (Constitución IX: local primero). Y no es
por comodidad: Meta valida el `ctwa_clid` contra un clic real, así que un evento
sintético contra la API real es imposible por diseño (research D10).

## 1. Entorno

```bash
# .env (además de lo habitual: DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY…)
ATRIBUCION=on                               # la bandera de esta feature
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
```

App viva con BD migrada (`pnpm db:migrate` en dev; en contenedor migra al
arranque).

## 2. La bandera, primero apagada

1. Arranca **sin** `ATRIBUCION` → `GET /api/settings/capi`,
   `PUT /api/settings/capi`, `GET /api/settings/capi/events` y la pantalla
   `/settings/ads` responden **404**; Ajustes no muestra la pestaña.
2. Manda un inbound **con anuncio** (abajo) → el mensaje entra normal y
   `GET /api/settings/capi/events` sigue en 404: no se capturó nada.
3. Arranca con `ATRIBUCION=on` → todo lo anterior existe y la migración no
   cambió (ya estaba aplicada: inerte apagada).

## 3. Conectar el dataset

1. Ajustes → **Anuncios**: pega un dataset (cualquier id sirve contra el mock) y
   **no** pegues token → guarda reusando el de WhatsApp.
   Comprueba: `GET /api/settings/capi` devuelve `tokenLast4`, nunca el token.
2. Sin conexión de WhatsApp y sin token → `409 sin_whatsapp`.
3. Elige la etapa que significa "lead calificado" (p. ej. *Interesado*).

## 4. Capturar el anuncio

```bash
curl -X POST localhost:3000/api/dev/wa-mock/inbound -H 'content-type: application/json' -d '{
  "phoneNumberId": "<el de tus credenciales>",
  "from": "5215500001111",
  "name": "Marina",
  "text": "vi su anuncio",
  "ctwaClid": "ARAaB_clic_de_prueba",
  "adHeadline": "Kit de verano"
}'
```

Reenvía el MISMO payload: no se duplica (el primer referral gana). Un segundo
mensaje del mismo contacto **sin** anuncio no borra el origen.

## 5. Reportar el lead calificado

1. Mueve el lead de Marina a la etapa marcada como calificada — arrástralo en el
   Pipeline, o `PATCH /api/pipeline/leads/{id}`, o desde un cerebro externo.
2. Ajustes → Anuncios → **Actividad**: fila `QualifiedLead`, estado **enviado**,
   con `fbtrace_id`.
3. `GET /api/dev/wa-mock/graph/_state` (o el log del mock) muestra el payload:
   `action_source: business_messaging`, `messaging_channel: whatsapp`,
   `user_data.ctwa_clid`, y `custom_data.lead_stage = "qualified"`.
4. Sácalo y vuélvelo a meter a esa etapa → **no** aparece una segunda fila.

## 6. Reportar la venta

1. Pon monto al trato (p. ej. $450.50) y muévelo a **Cliente** (etapa ganada).
2. Actividad: fila `Purchase` enviada; el payload lleva `value: 450.5` y
   `currency`. **Centavos → unidades**: si ves `45050`, está mal.
3. Un trato **sin** monto reporta la venta **sin** `value` (nunca `value: 0`).
4. Sácalo de Ganado y vuélvelo a ganar → sin fila nueva.

## 7. Los caminos infelices (los que de verdad importan)

- **Lead sin anuncio**: mueve a la etapa calificada un lead que llegó sin
  `ctwa_clid` → fila **omitida** con el motivo escrito. Nada falla.
- **Meta rechaza**: usa un dataset terminado en `-fail` (el mock responde 200 con
  `events_received: 0`) → el lead **se mueve igual**, y la fila queda **fallida**
  con el `fbtrace_id`. Repite con un token terminado en `-invalid` (401).
- **Sin dataset configurado**: desconecta y mueve un lead → fila omitida
  ("atribución no configurada"), nunca un error al usuario.

## 8. Sandbox del Laboratorio

Corre una conversación del Laboratorio hasta que su lead cambie de etapa: **no**
aparece ninguna fila hacia Meta y el `_state` del mock queda sin eventos. Igual
que el sender: `is_test` no toca el mundo real.

## 9. Gate y arnés

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test   # el piso
pnpm test:e2e                                            # el arnés, con la app viva
```

El arnés incluye la sección de atribución (guion `tests/e2e/us-atribucion.md`) y
**se corre dos veces**: con `ATRIBUCION=on` (camino completo) y sin ella (la
superficie no existe). Una feature opcional que solo se prueba encendida no está
probada.
