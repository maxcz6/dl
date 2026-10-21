# Vocero CRM & Nea Agent — Guía Completa de Despliegue y Arquitectura

Este documento contiene la guía paso a paso para levantar el sistema en cualquier máquina (Windows, Linux, macOS), la explicación detallada de cada variable de entorno, de dónde obtener las credenciales/API keys de WhatsApp y de Inteligencia Artificial, la arquitectura del sistema y sus endpoints clave.

---

## 📋 Tabla de Contenidos
1. [Requisitos Previos](#1-requisitos-previos)
2. [Paso a Paso: Despliegue en Cualquier Máquina](#2-paso-a-paso-despliegue-en-cualquier-máquina)
3. [Variables de Entorno y Configuración (.env)](#3-variables-de-entorno-y-configuración-env)
4. [¿De Dónde Sacar las API Keys y Credenciales?](#4-de-dónde-sacar-las-api-keys-y-credenciales)
   - [WhatsApp Cloud API (Meta Developers)](#a-whatsapp-cloud-api-meta)
   - [Inteligencia Artificial (OpenRouter / OpenAI / Anthropic)](#b-inteligencia-artificial)
5. [Contenedores Docker y Servicios](#5-contenedores-docker-y-servicios)
6. [Arquitectura del Proyecto](#6-arquitectura-del-proyecto)
7. [Endpoints Clave del Sistema](#7-endpoints-clave-del-sistema)
8. [Archivos y Directorios Importantes](#8-archivos-y-directorios-importantes)

---

## 1. Requisitos Previos

En cualquier máquina donde quieras desplegar el sistema, asegúrate de tener instalado:
* **Docker & Docker Compose** (Docker Desktop en Windows/Mac o docker engine en Linux).
* **Git** (para clonar el repositorio).
* *(Opcional para desarrollo local sin Docker)*: **Node.js 20+** y **pnpm** (`npm install -g pnpm`).

---

## 2. Paso a Paso: Despliegue en Cualquier Máquina

### ¿Dónde ejecutar los comandos?
Todos los comandos descritos a continuación se deben ejecutar en una terminal (PowerShell, CMD, Bash o WSL) **posicionado dentro de la carpeta `vocero-crm`** (donde se encuentran `docker-compose.yml` y `package.json`).

---

### Paso 1: Clonar el repositorio
Abre una terminal o consola y descarga el proyecto:
```bash
git clone <URL_DEL_REPOSITORIO> vocero-crm
cd vocero-crm
```
*(Asegúrate de que tu terminal muestre que estás dentro de la ruta `.../vocero-crm`)*.

---

### Paso 2: Crear y configurar el archivo de entorno `.env`
Copia la plantilla `.env.example`:
- **En Windows (PowerShell / CMD):**
  ```powershell
  copy .env.example .env
  ```
- **En Linux / macOS:**
  ```bash
  cp .env.example .env
  ```

> 💡 **Opción Rápida con Node.js:** Si tienes `pnpm` instalado en tu máquina:
> ```bash
> pnpm install
> pnpm init-env
> ```
> El script `init-env` generará automáticamente claves seguras (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `BOT_API_KEY`) y rellenará el archivo `.env`.

---

### Paso 3: Comandos para iniciar el servidor

Tienes dos modalidades según cómo quieras correr el sistema:

#### Modalidad A: Con Docker (Recomendada y más fácil)
> **Dónde ejecutar:** Dentro de `vocero-crm/`  
> **Requisito:** Docker Desktop abierto y corriendo.

1. **Iniciar todo el sistema en segundo plano:**
   ```bash
   docker compose up -d
   ```
   *Este comando descarga y levanta los 4 servicios automáticamente: la Base de Datos Postgres, el Agente Nea, la App Web Vocero CRM y el proxy Caddy.*

2. **Verificar que todos los servicios estén listos y saludables:**
   ```bash
   docker compose ps
   ```
   *(Todos deben figurar en estado `Up` o `Up (healthy)`)*.

3. **Ver los registros (logs) en tiempo real para confirmar el arranque:**
   ```bash
   docker compose logs -f app
   ```
   *(Presiona `Ctrl + C` para salir de la vista de logs)*.

---

#### Modalidad B: Modo Desarrollo con Node.js local (`pnpm dev`)
Si estás editando código en vivo de la aplicación web y prefieres correr Next.js en tu máquina mientras la base de datos y Nea corren en Docker:

1. **Levantar solo la base de datos y el agente en Docker:**
   ```bash
   docker compose up -d postgres nea
   ```
2. **Instalar dependencias de Node.js:**
   ```bash
   pnpm install
   ```
3. **Aplicar migraciones de la base de datos:**
   ```bash
   pnpm db:migrate
   ```
4. **Iniciar el servidor de desarrollo de Next.js:**
   ```bash
   pnpm dev
   ```
   *Acceso en modo desarrollo: `http://localhost:3000` (o `3001` si el 3000 está ocupado).*

---

### Paso 4: Ingresar al sistema y crear tu cuenta de Administrador
1. Abre tu navegador web e ingresa a:  
   👉 **[https://localhost](https://localhost)** *(o `http://localhost`)*
2. Si el navegador muestra advertencia de certificado no seguro (por ser SSL local de Caddy), haz clic en **"Avanzado"** y luego en **"Continuar a localhost (no seguro)"**.
3. El sistema te redirigirá a la pantalla de login. Haz clic en **Registrarse** (`/register`) e ingresa tu nombre, correo y contraseña. El primer usuario registrado asume automáticamente el rol de Administrador.

---

### Paso 5: Comandos para detener o reiniciar el servidor
> **Dónde ejecutar:** Dentro de la carpeta `vocero-crm/`

* **Detener el sistema (sin perder tus datos):**
  ```bash
  docker compose down
  ```
* **Reiniciar el sistema:**
  ```bash
  docker compose restart
  ```
* **Reiniciar solo un contenedor específico (por ejemplo, el CRM):**
  ```bash
  docker compose restart app
  ```
* **Reconstruir los contenedores tras actualizar código o hacer git pull:**
  ```bash
  docker compose up -d --build
  ```

---

## 3. Variables de Entorno y Configuración (.env)

El archivo `.env` controla los secretos y conexiones del sistema:

| Variable | Descripción | Valor en Local | Valor en Producción |
| :--- | :--- | :--- | :--- |
| `APP_BASE_URL` | URL pública de la aplicación | `https://localhost` | `https://crm.tudominio.com` |
| `DOMAIN` | Dominio que administra Caddy para el SSL | `localhost` | `crm.tudominio.com` |
| `POSTGRES_PASSWORD` | Contraseña interna del contenedor PostgreSQL | Cadena secreta | Cadena secreta de alta entropía |
| `DATABASE_URL` | URL de conexión interna a Postgres | `postgresql://postgres:<PASSWORD>@postgres:5432/vocero` | Igual con el host de BD |
| `BETTER_AUTH_SECRET` | Clave de firma de sesiones de usuario | 32+ caracteres aleatorios | Generada con `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Clave maestra AES-256 para tokens de WhatsApp | Exactamente 32 bytes base64 (44 chars) | Generada con `openssl rand -base64 32` |
| `BOT_API_KEY` | Token de comunicación entre CRM y Nea Agent | Cadena segura (32+ caracteres) | Generada aleatoriamente |
| `META_WEBHOOK_VERIFY_TOKEN` | Token para validar el Webhook de Meta | Cadena segura definida por ti | Igual en panel de Meta |
| `META_APP_SECRET` | App Secret de tu app de Meta | Opcional en pruebas | De Meta Developers |
| `ALLOW_SIGNUP` | Permite el registro de usuarios en `/register` | `true` | `false` (tras crear el admin) |
| `BRAIN_DISPATCH_URL` | Enlace interno donde el CRM envía cada mensaje a Nea | `http://nea:8000/vocero/dispatch` | `http://nea:8000/vocero/dispatch` |
| `BRAIN_HEALTH_URL` | Endpoint de salud de Nea | `http://nea:8000/health` | `http://nea:8000/health` |

---

## 4. ¿De Dónde Sacar las API Keys y Credenciales?

### A. WhatsApp Cloud API (Meta)

Para que el CRM reciba y envíe mensajes reales por WhatsApp:

1. **Crear una cuenta de desarrollador:**
   - Entra a [Meta for Developers](https://developers.facebook.com/) con tu cuenta de Facebook.
2. **Crear la Aplicación:**
   - Haz clic en **Mis apps** → **Crear app**.
   - Selecciona el caso de uso **Otro** → Tipo de app: **Negocio** (Business).
   - Asigna un nombre a la app y vincúlala a tu Administrador Comercial (Meta Business Manager).
3. **Agregar el producto WhatsApp:**
   - En el panel de control de tu app, busca **WhatsApp** y dale a **Configurar**.
4. **Obtener las credenciales:**
   - **Identificador de número de teléfono (Phone Number ID):** Ve a *WhatsApp → Primeros pasos*. Copia el número ID del teléfono de prueba (o de tu número oficial registrado).
   - **Identificador de cuenta de WhatsApp Business (WABA ID):** También figura en la misma pantalla.
   - **Token de acceso permanente (System User Token):**
     1. Ve a tu *Configuración del Negocio* en `business.facebook.com`.
     2. Ve a *Usuarios del sistema* → Agrega un nuevo usuario del sistema con rol Administrador.
     3. Asigna el activo de tu App de WhatsApp con control total.
     4. Haz clic en **Generar nuevo token**, selecciona los permisos:
        - `whatsapp_business_messaging`
        - `whatsapp_business_management`
     5. Guarda ese token.
5. **Configurar el Webhook en Meta:**
   - En tu app de Meta, ve a *WhatsApp → Configuración*.
   - **URL de devolución de llamada (Callback URL):**
     `https://tu-dominio-o-ngrok.com/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>`
   - **Identificador de verificación (Verify Token):**
     El mismo texto que configuraste en `META_WEBHOOK_VERIFY_TOKEN` en tu `.env`.
   - **Suscripciones de campos:** Suscríbete a `messages`.
6. **Pegar credenciales en el CRM:**
   - Entra a tu panel web del CRM → **Ajustes** → **WhatsApp** y guarda tu Phone Number ID, WABA ID y Token.

---

### B. Inteligencia Artificial

El sistema utiliza modelos compatibles con la API de OpenAI (OpenRouter, OpenAI, Groq, etc.):

1. **Recomendado: OpenRouter (Permite usar Claude, GPT-4o, Llama 3, DeepSeek, GLM, etc.):**
   - Entra a [openrouter.ai](https://openrouter.ai/) y regístrate.
   - Ve a **Keys** (`openrouter.ai/keys`) y haz clic en **Create Key**.
   - Añade saldo a tu cuenta en *Credits* (puedes empezar con $5 USD).
   - Copia tu clave API (empieza por `sk-or-v1-...`).
2. **Configurarlo en el CRM:**
   - Entra al CRM en tu navegador a: **Ajustes** → **IA** (`/settings/ai`).
   - Proveedor: `OpenRouter`
   - URL Base: `https://openrouter.ai/api`
   - API Key: Pega tu clave de OpenRouter.
   - Modelo: Haz clic en **"Traer modelos"** o escribe el modelo deseado (ej. `anthropic/claude-3.5-sonnet` o `openai/gpt-4o-mini`).
   - Haz clic en **"Probar conexión"** y luego en **"Guardar"**.

---

## 5. Contenedores Docker y Servicios

Cuando ejecutas `docker compose up -d`, se crean 4 contenedores en la red interna:

```
[Cliente / WhatsApp / Navegador]
              │
              ▼ :80 / :443
        ┌───────────┐
        │   Caddy   │ (Reverse Proxy, SSL automático)
        └─────┬─────┘
              │ :3000
        ┌─────▼─────┐
        │    App    │ (Next.js 15: Frontend UI, Webhooks, API de servicio)
        └──┬──────┬─┘
           │      │ :8000
           │      └──────────────┐
           │                     ▼
           │               ┌───────────┐
           │               │ Nea Agent │ (Python uvicorn: Cerebro IA, tools, RAG)
           │               └─────┬─────┘
           │ :5432               │ :5432
           ▼                     ▼
     ┌─────────────────────────────────┐
     │      PostgreSQL 16 Alpine       │ (Tablas: crm en public, memoria en nea)
     └─────────────────────────────────┘
```

1. **`app` (`vocero-crm`):**
   - Servidor Next.js 15 (Node.js). Proporciona la interfaz gráfica, la gestión de sesiones (Better Auth), recepción de webhooks de Meta y orquestación general.
2. **`nea` (`nea-agent`):**
   - Agente inteligente autónomo en Python FastAPI. Lee la información del cliente, califica leads, consulta la base de conocimiento y responde de forma natural.
3. **`postgres`:**
   - Base de datos relacional PostgreSQL. Almacena contactos, mensajes, fichas, pipeline, y en el esquema `nea` almacena el estado de los turnos.
4. **`caddy`:**
   - Servidor web ligero que actúa como proxy inverso hacia `app` y gestiona certificados HTTPS automáticamente.

---

## 6. Arquitectura del Proyecto

- **Monorepo / Fullstack:** Desarrollado con **Next.js 15 App Router**, **React 19**, **Tailwind CSS** y **TypeScript**.
- **ORM & Base de Datos:** **Drizzle ORM** conectado a PostgreSQL. Esquemas tipados con migraciones automáticas en el arranque.
- **Autenticación:** **Better-Auth** para autenticación segura basada en sesiones cookies HTTP-only y contraseñas hasheadas.
- **Manejo de Mensajería y Coalescing:** Agrupamiento de ráfagas de mensajes (`AGENT_COALESCE_MS`) para que cuando un cliente envía 3 o 4 mensajes seguidos por WhatsApp, la IA espere unos segundos y responda a toda la idea junta en vez de contestar mensaje por mensaje.
- **Cerebro Desacoplado:** El CRM no depende rígidamente de un único agente. El CRM le despacha turnos a `BRAIN_DISPATCH_URL` mediante POST firmado con HMAC (`BOT_API_KEY`), y el agente le contesta de vuelta consumiendo la API interna del CRM.

---

## 7. Endpoints Clave del Sistema

### Rutas Web (Páginas del Panel):
- `/login` y `/register`: Acceso y registro de usuarios.
- `/inbox`: Bandeja de entrada omnicanal en tiempo real.
- `/pipeline`: Tablero Kanban de etapas de ventas y leads.
- `/contacts`: Directorio y fichas de clientes.
- `/agent`: Configuración del Asistente (nombre, tono, instrucciones, reglas de escalado y Knowledge Base).
- `/settings/ai`: Conexión de llaves de IA (OpenRouter/OpenAI) y selector de modelo.
- `/settings/whatsapp`: Configuración de credenciales de WhatsApp Business Cloud API.
- `/lab`: Laboratorio de auto-evaluación con casos de prueba para el agente.

### Rutas de API y Webhooks:
- `POST /api/webhooks/wa/:token`: Endpoint de recepción de mensajes entrantes desde Meta WhatsApp Cloud API.
- `GET /api/webhooks/wa/:token`: Verificación inicial del Webhook por parte de los servidores de Meta.
- `GET /api/health`: Healthcheck general del CRM y estado de base de datos.
- `POST /api/bot/messages`: Endpoint utilizado por Nea Agent para enviar mensajes de respuesta a la conversación.
- `POST /api/bot/llm`: Proxy seguro interno donde Nea solicita inferencias LLM usando la clave configurada en el CRM.
- `GET /api/agent/profile`: Obtiene y actualiza el comportamiento e instrucciones del agente.
- `POST /api/kb`: Inserción de preguntas frecuentes (Q&A) o bloques de conocimiento para el RAG.

---

## 8. Archivos y Directorios Importantes

```
vocero-crm/
├── docker-compose.yml         # Definición de servicios (app, postgres, nea, caddy)
├── Dockerfile                 # Construcción de la imagen de producción de la app Next.js
├── Caddyfile                  # Configuración de proxy y certificados de Caddy
├── .env.example               # Plantilla exhaustiva y documentada de variables de entorno
├── drizzle.config.ts          # Configuración de Drizzle ORM
├── drizzle/                   # Archivos SQL de migraciones de la base de datos
├── src/
│   ├── app/                   # Rutas de Next.js App Router
│   │   ├── (app)/             # Rutas protegidas (inbox, pipeline, contacts, agent, settings)
│   │   ├── (auth)/            # Login y registro
│   │   └── api/               # Controladores de API (webhooks, bot, agent, kb, health)
│   ├── components/            # Componentes React (shadcn/ui, chat, tablas, modales)
│   ├── lib/                   # Utilidades de base de datos, cifrado, roles, helpers
│   └── server/                # Lógica del servidor (despacho al agente, webhook handlers)
```

---

## 9. Comandos Útiles de Mantenimiento

```bash
# Ver logs en tiempo real de todos los contenedores:
docker compose logs -f

# Ver logs únicamente del agente Nea:
docker compose logs -f nea

# Ver logs del CRM:
docker compose logs -f app

# Detener todos los contenedores sin borrar datos:
docker compose down

# Reiniciar los contenedores:
docker compose restart
```
