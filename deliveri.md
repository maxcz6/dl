# Especificación y Arquitectura del Módulo de Delivery & Pedidos para Restaurantes (Tipo Rappi)

Este documento detalla la arquitectura, el diseño de base de datos, el flujo de usuario móvil (PWA/Web), la integración con WhatsApp y el agente de IA para transformar **Vocero CRM** en un sistema integral de **gestión de pedidos y delivery para restaurantes y comida rápida**.

---

## 📱 1. Visión General del Producto

El objetivo es permitir a restaurantes gestionar pedidos a domicilio y recojo en tienda de forma rápida y sin comisiones abusivas (0% comisiones a terceros), utilizando como canal principal **WhatsApp** y un **Menú Móvil Interactivo (Web App / PWA)**.

### Experiencia del Cliente:
1. El cliente escribe por WhatsApp al restaurante: *"Hola, quiero ver la carta"* o *"Quiero hacer un pedido"*.
2. El Agente de IA (**Nea**) o un bot de bienvenida le envía inmediatamente el enlace a su menú interactivo:
   `https://crm.tudominio.com/menu`
3. El cliente ingresa al menú desde su celular sin descargar ninguna app pesada:
   - Navega por categorías (Hamburguesas, Pollos, Pizzas, Bebidas, Promos).
   - Elige términos, salsas, adicionales y cantidades.
   - Pasa al Checkout: Ingresa su Nombre, WhatsApp, Dirección / Ubicación GPS y Método de Pago (**Yape**, **Plin**, **Efectivo contra entrega**, **Tarjeta**).
4. El cliente confirma el pedido:
   - Se crea la orden `#ORD-XXXX` en la base de datos.
   - WhatsApp le envía su ticket digital de confirmación con enlace de rastreo en vivo: `https://crm.tudominio.com/pedido/:id`.

---

## 🗄️ 2. Modelo de Base de Datos (Drizzle ORM / PostgreSQL)

Para implementar el sistema dentro del mismo monorepo (`vocero-crm/src/lib/db/schema.ts`), se añaden las siguientes tablas con multi-tenancy (`organizationId`):

### A. Categorías de la Carta (`restaurant_category`)
```typescript
export const restaurantCategory = pgTable("restaurant_category", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),              // Ej: "Hamburguesas Clásicas", "Bebidas", "Combos"
  slug: text("slug").notNull(),
  description: text("description"),
  order: integer("order").notNull().default(0), // Para ordenar en la app móvil
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### B. Platos y Productos (`restaurant_item`)
```typescript
export const restaurantItem = pgTable("restaurant_item", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull().references(() => restaurantCategory.id, { onDelete: "cascade" }),
  name: text("name").notNull(),              // Ej: "Hamburguesa Royal con Papas"
  description: text("description"),          // Ej: "Carne artesanal de 150g, huevo, queso, papas fritas"
  priceCents: integer("price_cents").notNull(), // Precio en céntimos (ej. S/ 25.00 -> 2500)
  image: text("image"),                      // URL de la foto del plato
  isAvailable: boolean("is_available").notNull().default(true), // Control de agotado rápido
  options: jsonb("options"),                 // Opciones: salsas, adicionales, términos
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### C. Pedidos de Clientes (`restaurant_order`)
```typescript
export const restaurantOrder = pgTable("restaurant_order", {
  id: text("id").primaryKey(),               // Ej: ord_abc123
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull(), // Ej: "#ORD-1042"
  contactId: text("contact_id").references(() => contact.id), // Vinculado al CRM
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(), // Número de WhatsApp (+51...)
  deliveryType: text("delivery_type").notNull().default("delivery"), // "delivery" | "pickup" | "dine_in"
  deliveryAddress: text("delivery_address"),
  deliveryReference: text("delivery_reference"),
  deliveryNotes: text("delivery_notes"),     // Ej: "Tocar timbre blanco, no hay cambio de 100"
  paymentMethod: text("payment_method").notNull(), // "yape" | "plin" | "cash" | "card"
  paymentProofImage: text("payment_proof_image"), // Captura del voucher de Yape
  status: text("status").notNull().default("nuevo"), 
  // Estados: "nuevo" | "en_cocina" | "en_camino" | "entregado" | "cancelado"
  subtotalCents: integer("subtotal_cents").notNull(),
  deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  riderName: text("rider_name"),             // Nombre del motorizado
  riderPhone: text("rider_phone"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

### D. Detalle del Pedido (`restaurant_order_item`)
```typescript
export const restaurantOrderItem = pgTable("restaurant_order_item", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => restaurantOrder.id, { onDelete: "cascade" }),
  itemId: text("item_id").references(() => restaurantItem.id),
  name: text("name").notNull(),              // Se guarda copia del nombre histórico
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  selectedOptions: jsonb("selected_options"), // Salsas y agregados elegidos
  notes: text("notes"),                      // "Sin cebolla, por favor"
});
```

---

## 🖥️ 3. Módulos de la Aplicación y Vistas

### A. Vista Pública del Cliente (Móvil / PWA)
* **`/menu`**:
  * Barra superior con logo del restaurante, estado (Abierto / Cerrado) y tiempo estimado de entrega (30-45 min).
  * Selector horizontal de categorías deslizables estilo Instagram / Rappi.
  * Tarjetas de platos con foto, precio, descripción y botón `+ Agregar`.
  * Modal de personalización: selección de cremas, salsas, tamaño o extras con cobro adicional.
  * Barra flotante inferior de carrito: `"Ver Pedido (2 platos) — S/ 45.00"`.
* **`/checkout`**:
  * Formulario de entrega: Delivery o Recojo en local.
  * Dirección con botón: *"Usar mi ubicación actual (GPS)"*.
  * Opciones de pago peruanas:
    * **Yape / Plin:** Muestra QR dinámico y número celular. Opción para subir captura del voucher.
    * **Efectivo:** "¿Con cuánto pagarás?" para calcular el cambio del repartidor.
    * **Tarjeta:** POS móvil contra entrega o pasarela online.
* **`/pedido/[id]` (Tracking en Vivo):**
  * Barra de progreso animada con 4 pasos:
    1. ✅ *Pedido recibido*
    2. 👨‍🍳 *En preparación en cocina*
    3. 🛵 *En camino con el repartidor*
    4. 🍔 *¡Entregado! Buen provecho*
  * Botón directo: *"¿Tienes dudas? Escríbenos por WhatsApp"*.

---

### B. Panel Administrativo en Vocero CRM

Se añaden 2 opciones principales en el menú lateral del CRM:

1. **`Pedidos` (`/orders`):**
   * **Vista Comandera / KDS:**
     * Tarjetas grandes con los pedidos ordenados cronológicamente.
     * Alerta sonora (bip) cada vez que ingresa una nueva orden.
     * Botones de acción rápida en un clic: `Pasar a Cocina`, `Despachar / En camino`, `Marcar Entregado`.
     * Botón para imprimir ticket térmico (58mm / 80mm) con la orden para la cocina.
2. **`Carta / Menú` (`/menu-admin`):**
   * Editor de categorías y productos.
   * Interruptor de disponibilidad rápida: *"Agotado hoy"* para no ofrecer platos sin stock.
   * Carga de fotos de platos.

---

## 🤖 4. Integración con el Agente de IA (Nea) y WhatsApp

1. **Respuestas Automáticas con Menú:**
   * Cuando el cliente pregunta *"¿Qué venden?"* o *"Quiero hacer un pedido"*, el agente responde:
     > *"¡Hola! 🍔 Con gusto. Puedes armar tu pedido directamente en nuestra carta interactiva aquí:*  
     > *👉 https://crm.tudominio.com/menu*  
     > *Selecciona tus platos favoritos y te lo llevamos volando a tu puerta."*

2. **Notificaciones de Estado por WhatsApp:**
   * Cada vez que el restaurante cambia el estado en la comandera, se dispara un mensaje al WhatsApp del cliente:
     * **Aprobado:** *«¡Tu pedido #ORD-1042 ya está en la cocina! 👨‍🍳 Tiempo estimado: 35 min.»*
     * **En camino:** *«¡Tu comida va en camino! 🛵 El motorizado Carlos está a punto de llegar a tu dirección.»*

3. **Cierre de Venta y Calificación:**
   * Al marcar *Entregado*, el sistema avanza al contacto en el Pipeline a la etapa **"Venta Cerrada"** y calcula la métrica del ticket promedio en el CRM.

---

## 🚀 5. Roadmap de Implementación Técnica

- [ ] **Fase 1:** Crear esquemas de base de datos (`restaurant_*`) y migraciones Drizzle.
- [ ] **Fase 2:** Desarrollar la API de pedidos (`/api/restaurant/orders`, `/api/restaurant/menu`).
- [ ] **Fase 3:** Construir la interfaz pública del menú móvil `/menu` y checkout.
- [ ] **Fase 4:** Desarrollar la vista de comandera `/orders` dentro del panel de administración del CRM.
- [ ] **Fase 5:** Configurar webhooks para disparar notificaciones de WhatsApp ante cambios de estado.
