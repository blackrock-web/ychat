/**
 * Server-side Message Synchronization Lifecycle Diagnostic Logger
 * 
 * Complies with strict Zero-Knowledge principles:
 * NEVER logs plaintext message contents or private keys.
 * Tracks message lifecycle metadata: clientMessageId, conversationId, 
 * UUID routing, database membership checks, sequence numbers, and delivery states.
 * Specifically verifies that the database conversation membership check succeeds
 * when the recipient logs in and retrieves messages.
 */

export type ServerDiagnosticPhase =
  | 'INGESTION'
  | 'DB_MEMBERSHIP_CHECK'
  | 'DB_MEMBERSHIP_VERIFIED'
  | 'CONVERSATION_LINK'
  | 'STORED_DB'
  | 'WS_FORWARD'
  | 'OFFLINE_HOLD'
  | 'OFFLINE_HOLD_15MIN'
  | 'RECIPIENT_LOGIN_SYNC_PULL'
  | 'RECIPIENT_DB_MEMBERSHIP_CHECK'
  | 'RECIPIENT_DB_MEMBERSHIP_VERIFIED'
  | 'MESSAGE_DROPPED_INVALID_SIGNATURE'
  | 'MESSAGE_DROPPED_TAMPERED'
  | 'DELIVERY_RECEIPT'
  | 'DELIVERY_CONFIRMED';

export interface ServerDiagnosticEvent {
  phase: ServerDiagnosticPhase;
  stage: ServerDiagnosticPhase;
  clientMessageId: string;
  conversationId: string;
  messageId?: string;
  senderUserId?: string;
  recipientUserId?: string;
  senderDeviceId?: string;
  recipientDeviceId?: string;
  serverSequence?: number;
  details?: Record<string, any>;
  timestamp: string;
}

class ServerSyncDiagnosticLogger {
  private logBuffer: ServerDiagnosticEvent[] = [];
  private maxBufferSize = 500;

  log(phase: ServerDiagnosticPhase, event: Omit<ServerDiagnosticEvent, 'phase' | 'stage' | 'timestamp'>) {
    const entry: ServerDiagnosticEvent = {
      phase,
      stage: phase,
      ...event,
      timestamp: new Date().toISOString()
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    const detailsStr = entry.details ? ` | ${JSON.stringify(entry.details)}` : '';
    console.log(
      `\x1b[36m[SyncDiagnostic:Server]\x1b[0m \x1b[1m[${entry.phase}]\x1b[0m ` +
      `msgId=${entry.clientMessageId} convId=${entry.conversationId} ` +
      `sender=${entry.senderUserId || entry.senderDeviceId || 'N/A'} ` +
      `recipient=${entry.recipientUserId || entry.recipientDeviceId || 'N/A'}` +
      (entry.serverSequence !== undefined ? ` seq=${entry.serverSequence}` : '') +
      detailsStr
    );
  }

  getRecentLogs(limit?: number): ServerDiagnosticEvent[] {
    if (limit && limit > 0) {
      return this.logBuffer.slice(-limit);
    }
    return [...this.logBuffer];
  }

  getLogsForMessage(clientMessageId: string): ServerDiagnosticEvent[] {
    return this.logBuffer.filter(e => e.clientMessageId === clientMessageId);
  }

  clear() {
    this.logBuffer = [];
  }
}

export const serverSyncDiagnostic = new ServerSyncDiagnosticLogger();
