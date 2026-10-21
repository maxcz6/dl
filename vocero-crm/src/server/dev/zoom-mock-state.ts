/**
 * 015 — Estado del mock de Zoom (solo entorno de pruebas).
 *
 * Existe para que el self-test pueda AFIRMAR sobre lo que el CRM le mandó al
 * proveedor —no solo que la petición no falló—: qué reunión se creó, que
 * moverla usó el mismo id, y que cancelarla la borró. Y para que el sandbox
 * del Laboratorio se pueda verificar por ausencia: tras una corrida de prueba,
 * este estado tiene que estar VACÍO.
 */

export type MockMeeting = {
  id: string;
  topic: string;
  startTime: string;
  duration: number;
  timezone: string;
  joinUrl: string;
  updates: number;
};

type MockState = {
  meetings: Map<string, MockMeeting>;
  deleted: string[];
  nextId: number;
};

const globalForMock = globalThis as unknown as { __zoomMock?: MockState };

export function zoomMockState(): MockState {
  if (!globalForMock.__zoomMock) {
    globalForMock.__zoomMock = { meetings: new Map(), deleted: [], nextId: 1 };
  }
  return globalForMock.__zoomMock;
}

export function resetZoomMock(): void {
  const s = zoomMockState();
  s.meetings.clear();
  s.deleted.length = 0;
  s.nextId = 1;
}

export function zoomMockSnapshot() {
  const s = zoomMockState();
  return {
    meetings: [...s.meetings.values()],
    deleted: [...s.deleted],
  };
}

/**
 * El camino infeliz, determinista: un secreto terminado en `-invalid` hace que
 * el mock rechace la autenticación. Sin esto, el self-test solo podría probar
 * que todo sale bien — y lo que hay que probar es que cuando el proveedor
 * falla, la cita se crea igual.
 */
export function mockCredentialsAreBad(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Basic ")) return true;
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  return decoded.endsWith("-invalid");
}
