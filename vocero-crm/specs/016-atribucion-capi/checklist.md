# Checklist de calidad — 016 Atribución y Conversions API

Se marca contra el código, no contra la intención.

## La bandera (ADR-001)

- [x] Sin `ATRIBUCION`: pantalla y rutas en **404** (no 403, no 401).
- [x] Sin la bandera, la ingesta **no** guarda atribución aunque llegue referral.
- [x] Sin la bandera, la pestaña de Ajustes no se pinta.
- [x] La migración se aplica igual en ambos casos.
- [x] El prompt del agente no cambia con la bandera.

## Seguridad

- [x] El token del dataset se guarda cifrado con `lib/crypto` (no en claro, no
      con un segundo mecanismo).
- [x] Hacia el cliente solo viajan `last4` y estado.
- [x] Hacia Meta no viaja teléfono, nombre ni texto del contacto: solo el
      `ctwa_clid` y el id del WABA.
- [x] Ningún token aparece en logs ni en mensajes de error.

## Corrección del reporte

- [x] `events_received < 1` ⇒ `failed`, nunca `sent`.
- [x] Nombre fuera del catálogo ⇒ error con motivo legible antes de salir.
- [x] `custom_data.lead_stage` viaja en los dos eventos.
- [x] `value` en unidades de la moneda, nunca centavos; sin monto, sin `value`.
- [x] Dedup por UNIQUE en base (no un `select` previo).
- [x] Conversaciones `is_test` no emiten.

## Robustez

- [x] Un fallo de Meta no impide mover el lead (probado en el arnés).
- [x] La llamada a Meta ocurre **fuera** de la transacción de etapas.
- [x] Sin dataset configurado, la fila queda `skipped` con motivo.
- [x] Reintento del webhook no duplica atribución.

## Multi-tenancy

- [x] Toda query pasa por `scoped()`.
- [x] `qualifiedStageId` se valida contra las etapas de la propia organización.

## Verificación

- [x] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` en verde.
- [x] Arnés E2E en verde **encendida** y **apagada**.
- [x] `docs/atribucion-capi.md` explica los gotchas de Meta que costaron días.
