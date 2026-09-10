/**
 * Client-Side Message Synchronization Lifecycle Diagnostic Logger
 * 
 * Complies with strict Zero-Knowledge principles:
 * Tracks cryptographic state machine and transport lifecycle
 * WITHOUT logging plaintext message text, secret keys, or private key material.
 * Specifically tracks that the database conversation membership check succeeds
 * when the recipient logs in and retrieves messages.
 */

export type SyncLifecyclePhase =
  | 'SENDER_PREPARE'
  | 'SENDER_DISPATCH'
  | 'SENDER_ACKNOWLEDGED'
  | 'INGESTION'
  | 'DB_MEMBERSHIP_CHECK'
  | 'DB_MEMBERSHIP_VERIFIED'
  | 'CONVERSATION_LINK'
  | 'STORED_DB'
  | 'WS_FORWARD'
  | 'OFFLINE_HOLD_15MIN'
  | 'RECIPIENT_LOGIN_SYNC_PULL'
  | 'RECIPIENT_DB_MEMBERSHIP_CHECK'
  | 'RECIPIENT_DB_MEMBERSHIP_VERIFIED'
  | 'RECIPIENT_ENVELOPE_RECEIVED'
  | 'RECIPIENT_HANDSHAKE_ESTABLISHED'
  | 'RECIPIENT_DECRYPTED_VERIFIED'
  | 'RECIPIENT_DB_SAVED'
  | 'RECIPIENT_RECEIPT_SENT'
  | 'MESSAGE_DROPPED_INVALID_SIGNATURE'
  | 'MESSAGE_DROPPED_TAMPERED'
  | 'DELIVERY_RECEIPT'
  | 'DELIVERY_CONFIRMED';

export interface SyncDiagnosticLog {
  id: string;
  phase: SyncLifecyclePhase;
  stage: SyncLifecyclePhase;
  clientMessageId: string;
  conversationId: string;
  senderUserId?: string;
  recipientUserId?: string;
  senderDeviceId?: string;
  recipientDeviceId?: string;
  sequence?: number;
  serverSequence?: number;
  transport?: 'websocket' | 'rest';
  details?: Record<string, any>;
  timestamp: number;
}

export type SyncLogEntry = SyncDiagnosticLog;

type DiagnosticSubscriber = (logs: SyncDiagnosticLog[]) => void;

class SyncDiagnosticLogger {
  private logs: SyncDiagnosticLog[] = [];
  private maxLogs = 500;
  private subscribers = new Set<DiagnosticSubscriber>();

  record(phase: SyncLifecyclePhase, data: Omit<SyncDiagnosticLog, 'id' | 'phase' | 'stage' | 'timestamp'>) {
    const entry: SyncDiagnosticLog = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      phase,
      stage: phase,
      ...data,
      timestamp: Date.now()
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    const color = phase.startsWith('SENDER')
      ? 'color: #818cf8; font-weight: bold'
      : phase.includes('VERIFIED')
      ? 'color: #10b981; font-weight: bold'
      : 'color: #34d399; font-weight: bold';

    console.log(
      `%c[SyncDiagnostic] [${phase}]%c msgId=${data.clientMessageId} convId=${data.conversationId} sender=${data.senderUserId || data.senderDeviceId || 'N/A'} recip=${data.recipientUserId || data.recipientDeviceId || 'N/A'}`,
      color,
      'color: inherit',
      data.details ? data.details : ''
    );

    this.notify();
  }

  subscribe(callback: DiagnosticSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.getLogs());
    return () => this.subscribers.delete(callback);
  }

  getLogs(): SyncDiagnosticLog[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.notify();
  }

  private notify() {
    const current = this.getLogs();
    this.subscribers.forEach(cb => {
      try {
        cb(current);
      } catch (err) {
        console.error('Error notifying diagnostic subscriber:', err);
      }
    });
  }
}

export const syncDiagnostic = new SyncDiagnosticLogger();
