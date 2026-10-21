# Guion E2E — 002: Rediseño Atlas + White-label

> Conducido con Playwright (script) contra `pnpm dev` con mocks.

## Regresión funcional sobre el rediseño (ejecutado ✅)

1. Inbound mock → visible en la bandeja SIN recargar (SSE). ✅
2. Abrir conversación → responder desde el composer nuevo (Enter envía). ✅
3. Colapsar el panel de detalles (chevron) → reabrir desde el header del chat;
   preferencia persistida en localStorage. ✅
4. Conversación con ventana cerrada → aviso + selector de plantilla aprobada. ✅
5. Stepper de etapas en el panel → clic en un paso mueve el lead (PATCH 200)
   y el kanban lo refleja. ✅
6. Filtros Todas/No leídas y búsqueda en la lista. ✅ (visual)

## White-label (ejecutado ✅)

7. PUT nombre "El Martillo" + acento Verde apagado →
   ✅ brand de la nav, `<title>` y variable CSS `--accent: #3f6b66` aplicados
   (SSR, `router.refresh()`); el login PÚBLICO muestra la marca; restaurar a
   defaults funciona.
8. Solo el owner puede cambiar la marca (PUT con rol member → 403).
9. Unit tests: presets exactos, derivación de color personalizado con ajuste
   de contraste, normalización (vacío→default, hex inválido→default). ✅

## Tema oscuro

Conducido con Playwright (MCP). La preferencia es **por dispositivo** (cookie),
no por cuenta: quien trabaja de noche en su portátil y de día en la oficina no
quiere arrastrar la misma elección a los dos sitios.

10. **Alternar desde la barra lateral** cambia el tema y persiste al recargar.
    ✅ Sin parpadeo: el layout raíz escribe `data-theme` en el HTML del
    servidor, así que el tema ya viene resuelto en el primer byte. Resolverlo en
    el cliente daría un destello blanco en cada carga, que en una app que se usa
    de noche es exactamente lo que se venía a evitar.
11. **El acento de la marca se aclara en oscuro.** Los presets están calculados
    para fondo claro y sobre el fondo oscuro se hunden.
    ✅ `resolveAccentSet(hex, "dark")` sube el color hasta **≥ 3.5:1** contra el
    fondo del tema, y las variantes soft/tint se mezclan hacia el fondo oscuro,
    no hacia blanco.
    ✅ Sobre un acento ya aclarado, la tinta encima deja de ser blanca cuando no
    se leería (`fg` cae a oscuro bajo 3:1).
12. **Los dos temas viajan en el mismo CSS.** El servidor no siempre sabe cuál
    se resolverá (preferencia "sistema"), así que emite ambos bloques.
    ✅ Texto y superficies usan tokens semánticos, no colores sueltos: cambiar
    de tema no deja ningún elemento con el color del otro.

## Versión visible

Automatizado en `tests/unit/version.test.ts`; la parte de despliegue se verifica
con un `curl`. Responde "¿ya se desplegó mi cambio?" sin entrar al servidor.

13. **Abajo en la barra lateral**: `v1.2.0 · 8e62d0b`.
    ✅ El nombre del tooltip sale de la **marca**, no cableado: una instancia
    rebautizada no debe decir "Vocero" justo ahí.
    ✅ Contraste ≥ 4.5:1 en claro y en oscuro — discreta, no ilegible.
14. **También en `/api/health`**, para confirmar un despliegue desde un script o
    desde la plataforma de hosting, sin abrir la app ni iniciar sesión.
    ✅ `{"ok":true,"version":"1.2.0","commit":"8e62d0b","commitVerified":true}`.
15. **El commit se resuelve por dos caminos, y solo uno está verificado.** El
    del build manda; si quien construyó no lo pasó, vale el que la plataforma
    anuncia en ejecución — pero marcado como NO verificado (#50).
    ✅ Construir SIN `SOURCE_COMMIT` y arrancar CON él en el entorno enseña el
    commit igual: sin este respaldo la insignia se quedaba solo con la versión,
    que no se mueve entre despliegues del mismo release.
    ✅ …y lo enseña como lo que es: «commit sin verificar» en la insignia y
    `"commitVerified":false` en `/api/health`. Una variable de entorno escrita a
    mano una vez se queda quieta mientras la app avanza; presentarla como si
    saliera del build es la insignia mintiendo (#50, punto 4).
    ✅ Sin ninguno de los dos, se ve solo la versión. Nunca rompe el build.

## Icono de la pestaña

Automatizado en `scripts/e2e-favicon.mjs`. Con cinco instancias abiertas en
pestañas, el icono genérico del navegador las vuelve indistinguibles.

16. **Toda instancia tiene icono sin configurar nada.**
    ✅ `GET /api/branding/favicon` devuelve un SVG con la inicial sobre el
    acento, y responde **sin sesión** — el login también tiene pestaña.
    ✅ Si el archivo subido se perdiera (volumen sin montar), cae al generado
    en vez de dejar la pestaña vacía: un 404 ahí se ve como instancia rota.
17. **El dueño sube su logo** en Ajustes → Marca (PNG, SVG, ICO, JPEG, WebP).
    ✅ Se sirve byte por byte con su tipo real.
    ✅ Se puede **quitar** y volver al generado.
    ✅ Guardar nombre o color **no** borra el logo: son formularios distintos.
18. **No se cuela un documento disfrazado de imagen.** El tipo sale de los
    BYTES, no del `content-type` que declare el cliente.
    ✅ Declarar `image/png` y mandar HTML → **422**, y el icono bueno intacto.
    ✅ Más de 256 KB → **413**. Cuerpo vacío → **422**.
    ✅ Todo icono se sirve con `Content-Security-Policy: default-src 'none'` y
    `nosniff`: un SVG subido no ejecuta nada si alguien navega a su URL.
19. **El navegador suelta el icono viejo.** La URL lleva `?v=`.
    ✅ Cambia al subir, al quitar y al cambiar nombre o acento.
    ✅ Quitar y volver a subir **no repite** una URL ya cacheada.

## Logo en la barra lateral

Automatizado en `scripts/e2e-favicon.mjs`, en la misma corrida que el icono.
El archivo que sube el dueño es UNO y sirve para las dos cosas: antes solo
cambiaba la pestaña, y la barra lateral seguía con la inicial.

20. **El logo subido se ve donde se ve la marca**: barra lateral, barra
    superior del teléfono, login y vista previa de Ajustes → Marca.
    ✅ El mosaico lo dibuja con la MISMA URL versionada que la pestaña
    (`?v=u<versión>`): al cambiarlo, la barra no se queda con el anterior.
    ✅ El login también lo muestra, sin sesión.
    ✅ Quitarlo devuelve la inicial en la barra, sin imagen rota.
    ✅ Gana aunque la instancia se llame Vocero: quien sube un archivo quiere
    verlo en lugar de la "v".
    ✅ La vista previa de Ajustes → Marca lo sigue al subir y al quitar, sin
    recargar (la marca llega por prop del servidor, que se refresca).
21. **Un logo que no es cuadrado no se deforma.** `object-contain` dentro del
    mosaico; lo que sobra lo rellena el degradado del acento. La tarjeta, que
    ahora se llama «Logo del negocio», lo advierte: cuadrado y con fondo
    transparente se ve mejor. (Capturas, no automatizado.)

## Fidelidad visual (juicio humano pendiente)

Capturas en `docs/screenshots/` comparadas contra el handoff: layout 4
columnas, tokens, burbujas, stepper, chips. Revisión estética final: Kevin.
