# Vocero CRM & Nea Agent — Quickstart

Consulta la guía completa de instalación detallada, arquitectura, comandos y obtención de credenciales en:
👉 **[vocero-crm/README.md](file:///c:/Users/SAM/Documents/max/dl/dl/vocero-crm/README.md)**

---

## ⚡ Comandos para Iniciar el Servidor (Resumen)

> **Ubicación:** Todos los comandos se ejecutan dentro del directorio `vocero-crm`.

### 1. Iniciar con Docker (Recomendado):
Abre una terminal en `vocero-crm` y ejecuta:
```bash
# Copiar las variables de entorno
copy .env.example .env

# Levantar los 4 contenedores (Postgres, App, Nea y Caddy) en segundo plano:
docker compose up -d

# Verificar estado:
docker compose ps
```
Luego accede en el navegador a: **[https://localhost](https://localhost)**

---

### 2. Iniciar en modo desarrollo local (Node.js + Docker):
```bash
# Levantar únicamente base de datos y el cerebro Nea:
docker compose up -d postgres nea

# Instalar dependencias:
pnpm install

# Aplicar migraciones:
pnpm db:migrate

# Iniciar servidor de desarrollo de Next.js:
pnpm dev
```
Luego accede en el navegador a: **[http://localhost:3000](http://localhost:3000)** (o 3001).

---

### 3. Comandos para apagar o reiniciar:
* **Apagar el sistema:** `docker compose down`
* **Reiniciar el sistema:** `docker compose restart`
* **Ver logs en vivo:** `docker compose logs -f app`
