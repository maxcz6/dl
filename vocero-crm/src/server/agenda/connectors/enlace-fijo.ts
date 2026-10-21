import type { AgendaConnector, MeetingResult } from "@/server/agenda/connectors/types";

/**
 * 015 — El conector soberano: la sala de siempre.
 *
 * No habla con nadie. Es el default y la razón de que encender la agenda no
 * exija credenciales de terceros — y, en términos constitucionales, el "camino
 * sin dependencia externa" que hace admisibles a los demás (Principio II,
 * 1.4.0).
 */

export type EnlaceFijoCreds = { meetingLink: string | null };

export const enlaceFijoConnector: AgendaConnector<EnlaceFijoCreds> = {
  id: "enlace-fijo",
  requiresCredentials: false,

  async createMeeting(creds): Promise<MeetingResult> {
    // Sin sala configurada la cita se crea igual, sin link: nadie debe
    // prometerle al cliente un enlace que no existe.
    return { externalId: null, joinUrl: creds.meetingLink };
  },

  // La sala fija no se mueve ni se borra: es la misma todos los días.
  async updateMeeting() {},
  async deleteMeeting() {},

  async testConnection() {
    return { ok: true, detail: "El enlace fijo no requiere conexión" };
  },
};
