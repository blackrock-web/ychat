/**
 * Client-Side Message Synchronization Lifecycle Diagnostic Logger
 * 
 * Complies with strict Zero-Knowledge principles:
 * Tracks cryptographic state machine and transport lifecycle
 * WITHOUT logging plaintext message text, secret keys, or private key material.
 */

export type SyncLifecyclePhase =
  | 'SENDER_PREPARE'
  | 'SENDER_DISPATCH'
  | 'SENDER_ACKNOWLEDGED'
  | 'RECIPIENT_LOGIN_SYNC_PULL'
  | 'RECIPIENT_ENVELOPE_RECEIVED'
  | 'RECIPIENT_HANDSHAKE_ESTABLISHED'
  | 'RECIPIENT_DECRYPTED_VERIFIED'
  | 'RECIPIENT_DB_SAVED'
  | 'RECIPIENT_RECEIPT_SENT'
  | 'DELIVERY_CONFIRMED';

export interface SyncDiagnosticLog {
  id: string;
  phase: SyncLifecyclePhase;
  clientMessageId: string;
  conversationId: string;
  senderDeviceId?: string;
  recipientDeviceId?: string;
  sequence?: number;
  serverSequence?: number;
  transport?: 'websocket' | 'rest';
  details?: Record<string, any>;
  timestamp: number;
}

type DiagnosticSubscriber = (logs: SyncDiagnosticLog[]) => void;

class SyncDiagnosticLogger {
  private logs: SyncDiagnosticLog[] = [];
  private maxLogs = 300;
  private subscribers = new Set<DiagnosticSubscriber>();

  record(phase: SyncLifecyclePhase, data: Omit<SyncDiagnosticLog, 'id' | 'phase' | 'timestamp'>) {
    const entry: SyncDiagnosticLog = {
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      phase,
      ...data,
      timestamp: Date.now()
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // Console output for terminal / developer tool inspection
    const color = phase.startsWith('SENDER') ? 'color: #818cf8; font-weight: bold' : 'color: #34d399; font-weight: bold';
    console.log(
      `%c[SyncDiagnostic] [${phase}]%c msgId=${data.clientMessageId} convId=${data.conversationId} sender=${data.senderDeviceId || 'N/A'} recip=${data.recipientDeviceId || 'N/A'}`,
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
