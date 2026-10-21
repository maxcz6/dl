/**
 * 015 — Estado del mock de Google Calendar (solo entorno de pruebas).
 *
 * Imita la parte que más cuesta creer hasta que se ve: la conferencia de Meet
 * NO viene en la respuesta de crear el evento. Aquí el primer `GET` del evento
 * todavía la da como pendiente y el siguiente ya trae el enlace — así el
 * self-test ejercita el camino real, no uno cómodo.
 */

export type MockEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  /** Cuántas veces se ha leído: la conferencia "termina" tras la primera. */
  reads: number;
  meetLink: string | null;
  updates: number;
};

type MockState = {
  events: Map<string, MockEvent>;
  deleted: string[];
  nextId: number;
  /** Lecturas que tarda la conferencia en estar lista. */
  conferenceDelayReads: number;
};

const globalForMock = globalThis as unknown as { __googleMock?: MockState };

export function googleMockState(): MockState {
  if (!globalForMock.__googleMock) {
    globalForMock.__googleMock = {
      events: new Map(),
      deleted: [],
      nextId: 1,
      conferenceDelayReads: 1,
    };
  }
  return globalForMock.__googleMock;
}

export function resetGoogleMock(): void {
  const s = googleMockState();
  s.events.clear();
  s.deleted.length = 0;
  s.nextId = 1;
  s.conferenceDelayReads = 1;
}

export function googleMockSnapshot() {
  const s = googleMockState();
  return {
    events: [...s.events.values()],
    deleted: [...s.deleted],
  };
}

/**
 * Camino infeliz determinista: un refresh token terminado en `-invalid` hace
 * que Google responda `invalid_grant` — exactamente lo que pasa cuando la app
 * OAuth sigue en modo prueba y caducó a los 7 días.
 */
export function mockRefreshTokenIsBad(body: string): boolean {
  return new URLSearchParams(body).get("refresh_token")?.endsWith("-invalid") ?? true;
}
