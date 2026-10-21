#!/bin/sh
# ============================================================
# Vocero CRM — entrypoint del contenedor
#
# Adjuntos, logo e icono se guardan en MEDIA_DIR (/data/media en la imagen) y
# la app corre como `vocero`. Las plataformas montan el volumen de /data con
# el dueño que quieren —Coolify y Railway, como root—, y entonces todo
# guardado fallaba con EACCES.
#
# - Arrancando como root (el default): crea MEDIA_DIR, le da a `vocero` SOLO
#   lo que todavía no es suyo —un volumen grande no se re-chownea entero en
#   cada arranque— y baja a `vocero` con su-exec antes de correr la app.
# - Arrancando sin root (`--user`, o una plataforma que fuerza el uid): no se
#   pueden cambiar dueños. Se arranca igual y, si MEDIA_DIR no es escribible,
#   se avisa qué hacer. Esto nunca tumba el contenedor: el resto del CRM
#   funciona sin adjuntos.
#
# Va DELANTE del entrypoint de la imagen de node (docker-entrypoint.sh, que
# antepone `node` si el primer argumento no es un comando) y le pasa la posta:
# no lo reemplaza.
# ============================================================
set -u

APP_USER=vocero

# Vacía cuenta como ausente, igual que en la app (src/lib/env.ts): un panel que
# inyecta MEDIA_DIR="" no debe mandar los archivos fuera del volumen.
: "${MEDIA_DIR:=/data/media}"
export MEDIA_DIR

warn() {
  echo "[entrypoint] AVISO: $*" >&2
}

# Da a APP_USER lo que no es suyo bajo $1. `chown -h` cambia el enlace y nunca
# su destino: un symlink dentro del volumen no sirve para adueñarse de nada
# fuera de él.
fix_owner() {
  [ -e "$1" ] || return 0
  find "$1" ! -user "$APP_USER" -exec chown -h "$APP_USER:$APP_USER" {} + ||
    warn "no se pudo dar $1 a $APP_USER; revisa los permisos del volumen"
}

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$MEDIA_DIR" || warn "no se pudo crear MEDIA_DIR=$MEDIA_DIR"
  fix_owner /data
  case "$MEDIA_DIR" in
    /data | /data/*) ;; # ya cubierto por /data
    /*)
      # Absoluto fuera de /data: solo un directorio propio de al menos dos
      # niveles (p. ej. /srv/media). Jamás la raíz ni un directorio de primer
      # nivel: un MEDIA_DIR mal escrito no puede adueñarse del sistema.
      case "${MEDIA_DIR#/}" in
        */?*) fix_owner "$MEDIA_DIR" ;;
        *) warn "MEDIA_DIR=$MEDIA_DIR es demasiado general: no se le cambia el dueño; usa /data/media" ;;
      esac
      ;;
    # Relativo a /app: p. ej. el ./.dev-media que traía el .env.example viejo
    # y alguien copió a su panel. Funciona, pero no persiste entre deploys.
    *) fix_owner "$MEDIA_DIR" ;;
  esac
  exec su-exec "$APP_USER" docker-entrypoint.sh "$@"
fi

if ! { mkdir -p "$MEDIA_DIR" 2>/dev/null && [ -w "$MEDIA_DIR" ]; }; then
  warn "MEDIA_DIR=$MEDIA_DIR no es escribible por el uid $(id -u): adjuntos, logo e icono no se podrán guardar."
  warn "Monta en /data un volumen que ese uid pueda escribir, o arranca el contenedor sin --user (como root, el default) para que este script le dé el volumen a $APP_USER."
fi
exec docker-entrypoint.sh "$@"
