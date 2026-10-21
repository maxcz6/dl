# Quickstart — probar el motor de agenda universal de punta a punta

Feature: `015-motor-agenda-universal`. Cómo se ejercita TODO el alcance en
localhost con los mocks, sin tocar proveedores reales (Constitución IX: local
primero, nube después).

## 1. Entorno

```bash
# .env (además de lo habitual: DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY…)
AGENDA=on                                   # la bandera de esta feature
CHANNELS=whatsapp                           # (o whatsapp,instagram para la config "todo encendido")
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
BOT_API_KEY=una-llave-de-al-menos-16-chars
ZOOM_BASE_URL=http://localhost:3000/api/dev/zoom-mock
ZOOM_OAUTH_BASE_URL=http://localhost:3000/api/dev/zoom-mock
GOOGLE_CAL_BASE_URL=http://localhost:3000/api/dev/google-mock
GOOGLE_OAUTH_BASE_URL=http://localhost:3000/api/dev/google-mock
```

App viva con BD migrada (`pnpm db:migrate` en dev; en contenedor migra al
arranque).

## 2. La bandera, primero apagada

1. Arranca SIN `AGENDA` → `GET /api/calendar/settings`, `GET /api/bookings`,
   `GET /api/bot/availability` y `POST /api/bot/bookings` responden **404**;
   la navegación no muestra "Citas"; Ajustes no muestra "Agenda"; el prompt del
   agente (Laboratorio) no menciona agendar.
2. Arranca con `AGENDA=on` → todo lo anterior existe; la migración no cambió
   (ya estaba aplicada: es inerte apagada).

## 3. Camino feliz sin terceros (conector `enlace-fijo`)

1. Ajustes → Agenda: horario L-V 09:00-18:00, cita 30 min, zona
   `America/Mexico_City`, link `https://meet.ejemplo.com/mi-sala`.
2. `GET /api/bot/availability?conversationId=cv_…&limit=12&perDay=3&days=5` →
   huecos repartidos entre días, etiquetas con día en palabras, y `query`
   con hasta dónde se revisó. Con `&date=` (mañana) → las horas de ese día,
   tarde incluida, con `query.status: "available"`.
3. `POST /api/bot/bookings` con un `startUtc` ofrecido → **`201`** con
   `meetingLink` = la sala fija y `linkPending: false`.
4. La cita aparece en "Citas"; el hueco desapareció de la disponibilidad; el
   lead avanzó de etapa (bitácora registra el movimiento).

## 4. Las dos garantías (contra la app viva, no con mocks unitarios)

- **No ofrecido**: `POST /api/bot/bookings` con un instante libre pero jamás
  ofrecido → `409` con `error.code = "slot_not_offered"` y `slots` = lo que sí
  se ofreció.
- **La carrera**: ofrece a dos conversaciones el mismo hueco; reserva con la
  primera (201); reserva con la segunda → `409 slot_taken` con alternativas
  frescas, y `GET /api/bookings` muestra UNA sola cita en ese instante.
  Reservar la alternativa de inmediato → 201 (ya estaba registrada como
  oferta).
- **Códigos exactos**: los checks comparan `status === 201` / `=== 409` y la
  forma anidada del sobre — nunca `res.ok`.

## 5. Conector Zoom (mock)

1. Ajustes → Agenda → conector Zoom: pega Account ID / Client ID / Client
   Secret cualquiera → **Probar** pega al zoom-mock y pasa; con secret
   terminado en `-invalid` → 422 y NO se guarda.
2. Agenda una cita → `201` con `meetingLink` `https://zoom.mock/j/…`;
   `GET /api/dev/zoom-mock/_state` muestra la reunión creada con tema, inicio y
   duración.
3. Reprograma (`PATCH /api/bot/bookings`) → 200, mismo link; el `_state`
   muestra el PATCH con el mismo id.
4. Cancela desde "Citas" → el `_state` muestra el DELETE; cancelar de nuevo →
   200 sin cambios.

## 6. Fallo del proveedor ⇒ link pendiente ⇒ reintento

1. Con el mock en modo fallo (o credenciales rotas a propósito), agenda →
   **`201` igualmente**, con `meetingLink: null` y `linkPending: true` — la
   conversión no se pierde.
2. "Citas" muestra la cita marcada "sin enlace" con **Reintentar enlace**.
3. Repara el mock y reintenta → el link aparece y `linkPending` vuelve a
   `false`.
4. Si el fallo fue 401: Ajustes muestra la tarjeta de reconexión
   (`status: "error"`).

## 7. Conector Google (mock)

Igual que Zoom con el google-mock: conectar valida antes de guardar; agendar
crea el evento con petición de Meet; reprogramar mueve el evento; cancelar lo
borra; refresh token inválido → error claro + estado de reconexión.

## 8. Sandbox del Laboratorio

Corre una conversación del Laboratorio hasta agendar: la cita nace `is_test`,
visible marcada de prueba, y los `_state` de los mocks de conectores quedan
**vacíos** — ni crear, ni reprogramar, ni cancelar tocan proveedor alguno para
citas de prueba (y la app real, jamás: los mocks solo existen con
`WA_MOCK_ENABLED=true` fuera de producción).

## 9. Gate y arnés

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test   # el piso
pnpm test:e2e                                            # el arnés, con la app viva
```

`pnpm test:e2e` incluye la sección de agenda (guion `tests/e2e/us-agenda.md`):
bandera apagada/encendida, camino feliz, las dos garantías con códigos exactos,
la carrera, link pendiente + reintento, y sandbox. Sale distinto de cero si
algo falla. En CI, los gates corren en la matriz de dos configuraciones: todo
apagado (default) y todo encendido (`AGENDA=on` + canales) — FR-021.
