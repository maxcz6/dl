import { type ConnectorId } from "@/lib/agenda-connectors";
import type { CalendarSettings } from "@/server/agenda/settings";
import {
  ConnectorError,
  type AgendaConnector,
  type MeetingRequest,
  type MeetingResult,
  type TestConnectionResult,
} from "@/server/agenda/connectors/types";
import { enlaceFijoConnector } from "@/server/agenda/connectors/enlace-fijo";
import { zoomConnector } from "@/server/agenda/connectors/zoom";
import {
  getZoomCredentials,
  markZoomError,
} from "@/server/agenda/connectors/zoom-credentials";
import { googleConnector } from "@/server/agenda/connectors/google";
import {
  getGoogleCredentials,
  markGoogleError,
} from "@/server/agenda/connectors/google-credentials";

/**
 * 015 — El catálogo de conectores y la ÚNICA puerta por la que el motor habla
 * con un proveedor.
 *
 * El servicio de citas no conoce credenciales ni proveedores: pide "entrega
 * esta reunión" y aquí se resuelve con qué y con qué llaves. Por eso agregar un
 * conector en un fork no toca ni una línea del motor: se escribe su adaptador,
 * su tabla de credenciales y una rama de este `switch`.
 */

/** Un conector con sus credenciales ya resueltas: el genérico queda borrado. */
export type BoundConnector = {
  id: ConnectorId;
  createMeeting(req: MeetingRequest): Promise<MeetingResult>;
  updateMeeting(
    externalId: string,
    req: Pick<MeetingRequest, "startUtc" | "durationMinutes" | "timezone">
  ): Promise<void>;
  deleteMeeting(externalId: string): Promise<void>;
  testConnection(): Promise<TestConnectionResult>;
  /** Solo si el conector la implementa (enlaces asíncronos). */
  refreshMeeting?: (externalId: string) => Promise<MeetingResult>;
};

function bind<C>(conn: AgendaConnector<C>, creds: C): BoundConnector {
  const refresh = conn.refreshMeeting;
  return {
    id: conn.id,
    createMeeting: (req) => conn.createMeeting(creds, req),
    updateMeeting: (externalId, req) =>
      conn.updateMeeting(creds, externalId, req),
    deleteMeeting: (externalId) => conn.deleteMeeting(creds, externalId),
    testConnection: () => conn.testConnection(creds),
    refreshMeeting: refresh
      ? (externalId) => refresh.call(conn, creds, externalId)
      : undefined,
  };
}

/**
 * Resuelve el conector pedido con las credenciales de esta organización.
 *
 * Lanza `ConnectorError` si el conector no está disponible o le faltan
 * credenciales. El motor traduce esa excepción a "cita creada con enlace
 * pendiente", que es honesto — en vez de entregar en silencio el enlace de
 * otro conector.
 */
export async function bindConnector(
  organizationId: string,
  connectorId: ConnectorId,
  settings: CalendarSettings
): Promise<BoundConnector> {
  switch (connectorId) {
    case "enlace-fijo":
      return bind(enlaceFijoConnector, { meetingLink: settings.meetingLink });

    case "zoom": {
      const creds = await getZoomCredentials(organizationId);
      if (!creds) {
        throw new ConnectorError(
          "zoom",
          "Zoom no está conectado: faltan las credenciales"
        );
      }
      return bind(zoomConnector, creds);
    }

    case "google": {
      const creds = await getGoogleCredentials(organizationId);
      if (!creds) {
        throw new ConnectorError(
          "google",
          "Google no está conectado: faltan las credenciales"
        );
      }
      return bind(googleConnector, creds);
    }
  }
}

/**
 * Marca la credencial del conector como rota tras un error de autenticación,
 * para que Ajustes muestre la tarjeta de reconexión. `enlace-fijo` no tiene
 * credenciales que marcar.
 *
 * Es lo que evita el fallo silencioso del fork, donde el estado `error` existe
 * como enum y nadie lo escribe: el dueño se entera de que su conexión murió
 * por el cliente que no recibió su enlace.
 */
export async function markConnectorAuthError(
  organizationId: string,
  connectorId: ConnectorId
): Promise<void> {
  switch (connectorId) {
    case "enlace-fijo":
      return;
    case "zoom":
      await markZoomError(organizationId);
      return;
    case "google":
      await markGoogleError(organizationId);
      return;
  }
}
