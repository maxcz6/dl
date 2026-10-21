"use client";

import { useEffect, useRef } from "react";

export type EventHandlers = {
  onMessageNew?: (data: { conversationId: string; message: unknown }) => void;
  onMessageStatus?: (data: {
    conversationId: string;
    messageId: string;
    status: string;
    /** Motivo, presente solo cuando status = "failed". */
    error?: string | null;
  }) => void;
  onConversationUpdated?: (data: { conversation: unknown }) => void;
  /** 026 */
  onConversationDeleted?: (data: {
    conversationId: string;
    contactId: string;
    contactDeleted: boolean;
  }) => void;
  onLabRun?: (data: {
    runId: string;
    status: string;
    progress: { done: number; total: number };
    score?: number | null;
  }) => void;
  /** 015 — Algo cambió en la agenda (también cuando agenda la IA). */
  onBookingUpdated?: (data: { bookingId: string }) => void;
  /** Se llama tras RECONECTAR (no en la conexión inicial): catch-up con refetch. */
  onReconnect?: () => void;
};

/**
 * Suscripción SSE de la bandeja (contrato sse.md). EventSource reconecta
 * solo; el servidor no garantiza replay, así que al reconectar el consumidor
 * debe refetch con `since=` (onReconnect).
 */
export function useEvents(handlers: EventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const source = new EventSource("/api/events");
    let hadError = false;

    const listen = <T,>(type: string, handler: (data: T) => void) => {
      source.addEventListener(type, (ev) => {
        try {
          handler(JSON.parse((ev as MessageEvent).data) as T);
        } catch {
          // evento malformado: ignorar
        }
      });
    };

    listen("message.new", (d) => handlersRef.current.onMessageNew?.(d as never));
    listen("message.status", (d) =>
      handlersRef.current.onMessageStatus?.(d as never)
    );
    listen("conversation.updated", (d) =>
      handlersRef.current.onConversationUpdated?.(d as never)
    );
    listen("conversation.deleted", (d) =>
      handlersRef.current.onConversationDeleted?.(d as never)
    );
    listen("lab.run", (d) => handlersRef.current.onLabRun?.(d as never));
    listen("booking.updated", (d) =>
      handlersRef.current.onBookingUpdated?.(d as never)
    );

    source.onerror = () => {
      hadError = true;
    };
    source.onopen = () => {
      if (hadError) {
        hadError = false;
        handlersRef.current.onReconnect?.();
      }
    };

    return () => source.close();
  }, []);
}
