# Tasks — 030 El secreto de firma de Zernio, cifrado en reposo

## Datos

- [x] T001 Columnas `webhookSecret{Cipher,Iv,Tag}` en las tres tablas de `schema.ts`; `webhookSecret` marcada obsoleta
- [x] T002 `pnpm db:generate` → `0020_secreto_zernio_cifrado`
- [x] T003 Actualización: base en `0019` con secretos en claro escritos por `main` → `0020` + arranque

## Código

- [x] T004 `zernio/secreto-guardado.ts`: `columnasDelSecreto`, `secretoDeLaFila`, `cifrarSecretosEnClaro`
- [x] T005 Credenciales de Instagram, Messenger y TikTok: guardar cifrado, leer con respaldo
- [x] T006 `zernio/conexiones.ts`: `update` cifra
- [x] T007 Paso de arranque en `instrumentation-node.ts` y `instrumentation.ts`

## Pruebas y documentación

- [x] T008 Unitarias: la fila no contiene el secreto; lectura cifrada y de respaldo; arranque re-ejecutable y sin pisar
- [x] T009 `e2e-canales`: la base no guarda el secreto en claro; guion `us-canales.md`
- [x] T010 Gates; `e2e-canales`, `e2e-messenger`, `e2e-tiktok`, `e2e-despacho` (dos modos)
- [x] T011 `AGENTS.md`, `specs/README.md`, CHANGELOG, bitácora
- [ ] T012 Prueba en vivo en `vocero-clase` — **espera autorización de Kevin**
