/**
 * Server-side Message Synchronization Lifecycle Diagnostic Logger
 * 
 * Complies with strict Zero-Knowledge principles:
 * NEVER logs plaintext message contents or private keys.
 * Tracks message lifecycle metadata: clientMessageId, conversationId, 
 * device IDs, sequence numbers, database linkage, and delivery states.
 */

export interface ServerDiagnosticEvent {
  phase: 'INGESTION' | 'CONVERSATION_LINK' | 'STORED_DB' | 'WS_FORWARD' | 'LOGIN_SYNC_PULL' | 'DELIVERY_RECEIPT';
  clientMessageId: string;
  conversationId: string;
  messageId?: string;
  senderDeviceId?: string;
  recipientDeviceId?: string;
  serverSequence?: number;
  details?: Record<string, any>;
  timestamp: string;
}

class ServerSyncDiagnosticLogger {
  private logBuffer: ServerDiagnosticEvent[] = [];
  private maxBufferSize = 200;

  log(phase: ServerDiagnosticEvent['phase'], event: Omit<ServerDiagnosticEvent, 'phase' | 'timestamp'>) {
    const entry: ServerDiagnosticEvent = {
      phase,
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
      `senderDev=${entry.senderDeviceId || 'N/A'} recipDev=${entry.recipientDeviceId || 'N/A'}` +
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
}

export const serverSyncDiagnostic = new ServerSyncDiagnosticLogger();
