# Guion E2E — US7: Multi-usuario mínimo

> Conducido con Playwright (MCP) contra `pnpm dev` (org ya creada).

1. **Registro cerrado (FR-060)**: POST público a sign-up con otra cuenta.
   ✅ 403 con mensaje claro (la UI lo muestra en /register).
2. **Escape**: `ALLOW_SIGNUP=true` reabre el registro (unit test
   registration.test.ts; requiere reinicio con la variable).
3. **Cuenta de equipo (FR-061)**: el owner crea una cuenta desde
   Configuración → Equipo (email + contraseña temporal mostrada una vez).
   ✅ El nuevo miembro puede iniciar sesión y ve la bandeja de la organización.
   ✅ Un miembro (no owner) NO puede crear cuentas (403).
4. **Rate limit (FR-062)**: >10 logins fallidos desde la misma IP en 10 min.
   ✅ 429 "Demasiados intentos".
