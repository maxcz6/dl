# Responsividad — el CRM se usa desde el teléfono

Guion de comportamiento (2026-08-14). Automatizado en
`scripts/e2e-responsive.mjs`.

Origen: la app se diseñó para escritorio (lateral fijo de 224 px + Bandeja de
tres columnas). Debajo de ~1000 px el lateral se comía media pantalla, el hilo
quedaba en una franja de unos 100 px y el compositor caía fuera del área
visible del navegador móvil.

## Preparación

App corriendo con mocks (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` →
wa-mock) y BD con migraciones aplicadas. Un contacto entrante de prueba con
conversación abierta.

Tres tamaños: teléfono 390×844, tableta 820×1180, escritorio 1440×900.

## AC-1 — Ninguna pantalla recorta contenido a lo ancho

Recorre Bandeja, Pipeline, Contactos, Agente, Laboratorio y
Ajustes → WhatsApp en los tres tamaños.

Esperado: en cada una, el contenido de `main` cabe en su ancho visible
(`scrollWidth == clientWidth`) y el documento no genera scroll horizontal. El
tablero del Pipeline sí se arrastra en horizontal, pero **dentro** de su propio
contenedor, con las columnas ancladas (snap).

## AC-2 — El lateral se vuelve cajón en el teléfono

1. Abre cualquier pantalla en 390×844.

Esperado: se ve la barra superior con la hamburguesa y la marca; los enlaces
del lateral **no** son alcanzables (están fuera del orden de tabulación).

2. Toca la hamburguesa.

Esperado: el cajón entra desde la izquierda **encima** del contenido (no lo
empuja: `main` sigue empezando en x=0), con velo detrás.

3. Toca "Bandeja".

Esperado: navega y el cajón se cierra solo. También cierra con Escape, con el
velo y con su propia ✕.

## AC-3 — La Bandeja es maestro-detalle en el teléfono

1. Abre la Bandeja sin conversación elegida.

Esperado: la lista ocupa el ancho completo (390 px), no una columna de 360 px
con el hilo aplastado al lado.

2. Toca una conversación.

Esperado: el hilo ocupa toda la pantalla, la lista desaparece y aparece un
botón "Volver a las conversaciones" que la regresa.

3. Mira el compositor.

Esperado: queda **dentro** de la pantalla (la altura del cascarón es `100dvh`,
no `100vh`) y su tipografía mide ≥16 px, que es lo que evita que Safari en iOS
haga zoom al enfocar y deje el CRM descuadrado. Lo mismo aplica a todo campo de
texto por debajo de `md`.

## AC-4 — Los detalles del contacto flotan sobre el hilo

1. Con el hilo abierto en el teléfono, toca "Mostrar detalles".

Esperado: el panel arranca **cerrado** (la preferencia guardada solo manda en
escritorio) y entra como cajón pegado al borde derecho, encima del hilo, sin
robarle ancho ni provocar scroll horizontal. Cierra con su ✕ o con el velo.

Debajo de `xl` (1280 px) el panel siempre es cajón; a partir de ahí vuelve a ser
la tercera columna.

## AC-5 — En tableta conviven lista e hilo

En 820×1180 la Bandeja muestra dos columnas (lista ~300 px + hilo), y el panel
de detalles sigue siendo cajón.

## AC-6 — En escritorio nada cambió

En 1440×900: lateral fijo de 224 px sin hamburguesa, Bandeja de tres columnas
(lista 360 px + hilo + detalles 320 px) y la preferencia de "panel abierto"
persistida como siempre.

## AC-7 — Barra bicolor e interruptores

1. Con el tema claro, mira la barra lateral.

Esperado: azul marino con texto claro, aunque la página sea blanca. La app es
bicolor en los dos temas; el acento de la barra es el white-label calculado
para fondo oscuro.

2. Alterna «IA en esta conversación» (Bandeja) y el interruptor del Agente.

Esperado: en los dos estados el pomo queda **dentro** de la pista, pegado al
extremo que le toca (#53: el del Agente arrancaba del centro y, encendido,
quedaba afuera). Un clic lo cambia y Espacio, con el foco en él, también. Sin
proveedor de IA el del Agente se ve atenuado y no reacciona.
