# Estimación de Costos de Despliegue y Operación — Perú (PEN / Soles)

Este documento detalla **todos los costos necesarios** para poner en producción y mantener operativo **Vocero CRM + Agente de IA (Nea)** en el mercado peruano, incluyendo los **enlaces directos** de los proveedores con los mejores precios.

> **Tipo de cambio referencial:** 1 USD ≈ S/ 3.75 PEN.

---

## 📊 Resumen Ejecutivo: ¿Cuánto cuesta al mes?

| Nivel de Negocio | Volumen Mensual | Costo Fijo Mensual | Costo Variable (IA + Meta) | Costo Total Estimado / Mes |
| :--- | :--- | :--- | :--- | :--- |
| **Básico / Pruebas** | ~1,000 conversaciones | S/ 25.00 | S/ 10.00 – S/ 25.00 | **~S/ 35.00 – S/ 50.00** |
| **Pequeña Empresa (Pyme)** | ~3,000 conversaciones | S/ 45.00 | S/ 60.00 – S/ 120.00 | **~S/ 105.00 – S/ 165.00** |
| **Comercial / Crecimiento** | ~10,000 conversaciones | S/ 90.00 | S/ 220.00 – S/ 450.00 | **~S/ 310.00 – S/ 540.00** |

---

## 1. Costos de Infraestructura y Servidor (Fijos)

Para que el CRM, la base de datos PostgreSQL, Caddy y el agente de IA funcionen **24/7 sin depender de tener tu PC encendida**, se requiere un Servidor Privado Virtual (VPS).

### A. Servidores en la Nube (VPS)
*Requerimiento recomendado:* Mínimo 2 vCPU y 4 GB de RAM (para correr Docker con Next.js + Postgres + Python Nea de forma holgada).

* **Hetzner Cloud (Opción más económica y de alto rendimiento):**
  - **Precio:** ~$5.50 a $8.00 USD/mes → **~S/ 21.00 – S/ 30.00 PEN / mes**.
  - **Especificaciones:** 2 vCPU AMD/Intel, 4 GB RAM, 40 GB NVMe, 20 TB tráfico.
  - 🔗 **Enlace de compra:** [https://www.hetzner.com/cloud/](https://www.hetzner.com/cloud/)
* **Hostinger VPS (Fácil de pagar con moneda local / Yape / tarjeta en Perú):**
  - **Precio:** Plan KVM 2 ~$6.99 USD/mes → **~S/ 26.50 PEN / mes**.
  - **Especificaciones:** 2 vCPU, 8 GB RAM, 100 GB NVMe.
  - 🔗 **Enlace de compra:** [https://www.hostinger.pe/vps-hosting](https://www.hostinger.pe/vps-hosting)
* **DigitalOcean (Alternativa popular para desarrolladores):**
  - **Precio:** Droplet Basic 4 GB RAM ~$24.00 USD/mes → **~S/ 90.00 PEN / mes**.
  - 🔗 **Enlace de compra:** [https://www.digitalocean.com/pricing/droplets](https://www.digitalocean.com/pricing/droplets)

---

### B. Dominio Web (.com o .pe)
Necesario para conectar Caddy con certificado SSL gratuito (HTTPS) y configurar el Webhook de Meta:

* **Dominio `.com` (Cloudflare Registrar — Al costo, sin comisiones ocultas):**
  - **Precio:** ~$9.77 USD/año → **~S/ 36.50 PEN / año** *(~S/ 3.00 PEN al mes)*.
  - 🔗 **Enlace de compra:** [https://www.cloudflare.com/products/registrar/](https://www.cloudflare.com/products/registrar/)
* **Dominio `.com` (Namecheap — Acepta PayPal y tarjetas peruanas):**
  - **Precio:** ~$10.28 USD/año → **~S/ 39.00 PEN / año**.
  - 🔗 **Enlace de compra:** [https://www.namecheap.com/domains/](https://www.namecheap.com/domains/)
* **Dominio `.pe` (Punto.pe — Registro oficial de dominios del Perú):**
  - **Precio:** S/ 110.00 PEN al año *(~S/ 9.20 PEN al mes)*.
  - 🔗 **Enlace de compra:** [https://www.punto.pe/](https://www.punto.pe/)

---

### C. Certificados SSL (HTTPS)
* **Costo:** **S/ 0.00 (Totalmente Gratis)**.
* El contenedor interno **Caddy** genera, valida y renueva automáticamente certificados válidos de Let's Encrypt de por vida sin costo adicional.

---

## 2. Costos de WhatsApp Cloud API (Meta)

Meta cobra por cada **conversación** (ventana de servicio de 24 horas desde que se abre el chat).

🔗 **Panel oficial de Meta Developers:** [https://developers.facebook.com/apps/](https://developers.facebook.com/apps/)  
🔗 **Tabla oficial de tarifas por país (Meta):** [https://developers.facebook.com/docs/whatsapp/pricing/](https://developers.facebook.com/docs/whatsapp/pricing/)

### Política de Precios de Meta para Perú (Código +51):
1. **Las primeras 1,000 conversaciones iniciadas por el usuario al mes son GRATIS.**
   - Si tu negocio recibe hasta 1,000 clientes al mes que te escriben primero (Servicio / Atención al cliente), el costo con Meta es **S/ 0.00**.
2. **Conversaciones iniciadas por el usuario (más allá de las 1,000 gratis):**
   - Tarifa Meta para Perú: ~$0.0125 USD por conversación.
   - En Soles: **~S/ 0.047 PEN por conversación de 24 horas**.
3. **Conversaciones iniciadas por la empresa (Plantillas de difusión / Notificaciones masivas):**
   - Tarifa Meta para Perú: ~$0.0712 USD por mensaje de plantilla.
   - En Soles: **~S/ 0.27 PEN por conversación**.
4. **Conversaciones por anuncios Click-to-WhatsApp:**
   - La ventana de conversación de 72 horas es **GRATIS** (no se cobra tarifa por mensaje en WhatsApp, solo el costo del anuncio de Meta Ads).

#### Ejemplo de costos de WhatsApp (Meta):
- **500 conversaciones/mes:** S/ 0.00 (Dentro de la cuota gratis).
- **2,000 conversaciones/mes:** 1,000 gratis + (1,000 × S/ 0.047) = **~S/ 47.00 PEN**.
- **5,000 conversaciones/mes:** 1,000 gratis + (4,000 × S/ 0.047) = **~S/ 188.00 PEN**.

---

## 3. Costos de la Inteligencia Artificial (Tokens LLM)

El agente inteligente (Nea) procesa cada mensaje del cliente con la Base de Conocimiento (RAG) mediante modelos compatibles con la API de OpenAI.

🔗 **Plataforma recomendada (OpenRouter):** [https://openrouter.ai/](https://openrouter.ai/)  
🔗 **Generación de API Keys en OpenRouter:** [https://openrouter.ai/keys](https://openrouter.ai/keys)  
🔗 **Cargar créditos en OpenRouter:** [https://openrouter.ai/credits](https://openrouter.ai/credits) *(recarga mínima $5.00 USD / ~S/ 19.00 PEN)*

### Comparativa de Modelos y Costos por cada 1,000 Mensajes:
| Modelo | Calidad / Velocidad | Costo Aprox. por 1,000 turnos (USD) | Costo en Soles (PEN) | Enlace de Modelo |
| :--- | :--- | :--- | :--- | :--- |
| **GLM-4 / GLM-5.3-flash** | Ultra rápido y económico | ~$0.30 – $0.50 USD | **S/ 1.15 – S/ 1.90 PEN** | [Ver modelo](https://openrouter.ai/models/z-ai/glm-5.3-flash) |
| **DeepSeek V3 / DeepSeek Chat** | Razonamiento superior y bajo costo | ~$0.40 – $0.80 USD | **S/ 1.50 – S/ 3.00 PEN** | [Ver modelo](https://openrouter.ai/models/deepseek/deepseek-chat) |
| **GPT-4o-mini (OpenAI)** | Excelente consistencia y atención | ~$0.60 – $1.20 USD | **S/ 2.25 – S/ 4.50 PEN** | [Ver modelo](https://openrouter.ai/models/openai/gpt-4o-mini) |
| **Claude 3.5 Haiku (Anthropic)** | Trato humano y muy fluido | ~$1.00 – $2.00 USD | **S/ 3.75 – S/ 7.50 PEN** | [Ver modelo](https://openrouter.ai/models/anthropic/claude-3.5-haiku) |
| **Claude 3.5 Sonnet (Anthropic)** | Capacidad experta para ventas | ~$5.00 – $10.00 USD | **S/ 18.75 – S/ 37.50 PEN** | [Ver modelo](https://openrouter.ai/models/anthropic/claude-3.5-sonnet) |

#### Estimación mensual típica:
Para un flujo de ~3,000 respuestas al mes con **GPT-4o-mini** o **DeepSeek Chat**:
- Gasto en OpenRouter: ~$3.00 a $5.00 USD al mes → **~S/ 11.25 a S/ 18.75 PEN al mes**.

---

## 4. Costos Opcionales (Almacenamiento de Adjuntos en la Nube)

Si tu negocio envía y recibe muchas imágenes, PDFs o audios por WhatsApp y prefieres no sobrecargar el disco del VPS:

* **Cloudflare R2 (Compatible con S3 sin costo de descarga):**
  - **Precio:** Primeros 10 GB al mes **GRATIS** ($0.00). Luego $0.015 USD por GB.
  - 🔗 **Enlace de activación:** [https://www.cloudflare.com/products/r2/](https://www.cloudflare.com/products/r2/)

---

## 5. Cuadro Comparativo: Vocero CRM vs. Soluciones SaaS del Mercado

| Concepto | Vocero CRM (Self-Hosted) | Plataformas SaaS (ManyChat, Kommo, Respond.io, Sirena) |
| :--- | :--- | :--- |
| **Licencia de Software** | **S/ 0.00** (Código abierto y libre) | S/ 150.00 a S/ 600.00 PEN al mes |
| **Límite de Agentes Humanos** | **Ilimitado** (sin costo por usuario) | Cobran $15 – $49 USD por cada usuario extra |
| **Límite de Contactos** | **Ilimitado** | Suben la tarifa por volumen de contactos |
| **Propiedad de los Datos** | **100% tuya** en tu servidor Postgres | En los servidores de terceros |
| **Gasto Mensual Promedio** | **S/ 35.00 a S/ 120.00 PEN** | **S/ 250.00 a S/ 900.00 PEN** |

---

## 6. Pasos para Comprar y Arrancar con la Menor Inversión

1. **Adquirir el VPS:** Contrata el plan en [Hetzner Cloud](https://www.hetzner.com/cloud/) (~S/ 25.00 PEN/mes) o [Hostinger VPS](https://www.hostinger.pe/vps-hosting) (~S/ 26.50 PEN/mes).
2. **Adquirir tu Dominio:** Compra tu nombre en [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (~S/ 36.50 PEN/año) o [Namecheap](https://www.namecheap.com/domains/).
3. **Cargar saldo de IA:** Recarga $5 USD (~S/ 19.00 PEN) en [OpenRouter Credits](https://openrouter.ai/credits) y crea tu clave en [OpenRouter Keys](https://openrouter.ai/keys).
4. **Vincular WhatsApp:** Configura tu cuenta gratuita en [Meta for Developers](https://developers.facebook.com/apps/) y aprovecha las 1,000 conversaciones mensuales sin costo.

👉 **Inversión inicial total para arrancar:** **Alrededor de S/ 70.00 a S/ 85.00 PEN.**
