# E2E — Citas en calendario (215)

Guion de comportamiento observable. Automatizado en
`scripts/e2e-calendario.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e:calendario` lo conduce con Playwright y sale distinto de cero si
algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock y la BD migrada. El navegador corre en
`Asia/Tokyo` y el negocio en `America/Mexico_City` (15 h de diferencia): todo
lo que se pinta o se bloquea tiene que salir en la hora del NEGOCIO. La
bandera `AGENDA` decide qué mitad corre.

---

## Con `AGENDA` apagada

1. `GET /api/bookings`, con o sin `from`/`to` (también mal formados), es
   **404**.
2. La pantalla `/bookings` es 404 y la navegación no ofrece «Citas».

## La API por rango

1. Sin parámetros, `GET /api/bookings` responde **exactamente** `{ bookings }`
   (las últimas 200): es lo que lee el guion de 015.
2. Con `?from=AAAA-MM-DD&to=AAAA-MM-DD` trae todas las citas que tocan esos
   días del negocio, en orden, más `timezone`, `weeklyHours`, `range` y
   `truncated`.
3. Uno solo de los dos, una fecha inexistente, el rango al revés o más de 92
   días: **422** `invalid_range`. 92 días exactos sí caben.
4. **Fallo 4** (antes, las últimas 200): con 205 bloqueos en junio, sin rango
   siguen llegando 200 y el rango de junio trae los 205.

## El calendario

1. `/bookings?vista=semana&fecha=D` pinta la semana; la cita de las 10:00
   queda a la altura de las 10:00 del negocio (no de Tokio) y la esquina dice
   «GMT-6».
2. Una cita del Laboratorio (`is_test`) a la misma hora no se pinta; el
   interruptor «Mostrar pruebas» la muestra y apagarlo la oculta.
3. «Semana siguiente» mueve la fecha de la URL 7 días; «Hoy» vuelve al hoy del
   negocio; Día, Mes (cuadrícula con «Ver el día N») y Lista (`desde`/`hasta`)
   cambian la URL.
4. Tocar la cita abre su panel con «Abrir conversación» (→
   `/inbox?contact=…`), «Reprogramar», «Realizada», «No asistió» y «Cancelar
   cita». Abrirlo NO pide disponibilidad.
5. **Fallo 2** (antes, 12 huecos): «Reprogramar» pide la disponibilidad una
   sola vez y ofrece los huecos de toda la ventana por día (≥ 5 días, > 12
   huecos). Elegir uno mueve la cita, el panel dice la hora nueva y el
   calendario muestra ese día. Escape cierra el panel.
6. **Fallo 1** (antes, la hora del navegador): tocar el hueco vacío de las
   15:10 abre «Bloquear horario» con ese día y las 15:00; al confirmar, el
   bloqueo queda a las 15:00 de Ciudad de México (21:00 UTC), no a las 15:00
   de Tokio, y se pinta rayado.
7. **Fallo 3** (antes, cada evento recalculaba la disponibilidad): cinco
   bloqueos creados desde fuera aparecen solos por SSE, sin una sola petición
   de disponibilidad y con a lo más una consulta del rango por evento.
8. En un celular sin preferencia guardada abre en «Día» y la página no
   desborda a lo ancho.

Al terminar, cancela lo creado y borra la cita de prueba.
