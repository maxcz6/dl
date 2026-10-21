/** Utilidades de presentación de la bandeja. */

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** 024 — Lo mismo, para plazos de días: «5 días», «1 día 3h», «7h 20m». */
export function formatRemainingLong(ms: number): string {
  const totalH = Math.floor(ms / 3_600_000);
  const d = Math.floor(totalH / 24);
  if (d >= 2) return `${d} días`;
  if (d === 1) return `1 día ${totalH - 24}h`;
  return formatRemaining(ms);
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  template: "Plantilla",
};

export function mediaLabel(type: string): string {
  return MEDIA_LABELS[type] ?? "Contenido";
}

/** 008 — Tamaño humano de un adjunto. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 028 — Los canales en una frase: «WhatsApp», «WhatsApp o Instagram»,
 * «WhatsApp, Instagram o Messenger».
 */
export function channelList(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} o ${labels[labels.length - 1]}`;
}

/** 028 — El texto de la bandeja vacía, con los canales encendidos. */
export function emptyInboxDescription(labels: readonly string[]): string {
  if (labels.length <= 1) {
    return "Cuando alguien escriba a tu número de WhatsApp, su conversación aparecerá aquí en tiempo real.";
  }
  return `Cuando alguien te escriba por ${channelList(labels)}, su conversación aparecerá aquí en tiempo real.`;
}

export function previewText(preview: string | null): string {
  if (!preview) return "";
  return MEDIA_LABELS[preview] ? `📎 ${MEDIA_LABELS[preview]}` : preview;
}
