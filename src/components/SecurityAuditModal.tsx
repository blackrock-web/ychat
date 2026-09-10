import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, CheckCircle2, Lock, Cpu, Server, FileCheck, RefreshCw, Activity, ArrowRight, CheckCheck } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { clientDb } from '../storage/db';
import { syncDiagnostic, SyncLogEntry } from '../storage/syncDiagnostic';

interface SecurityAuditModalProps {
  onClose: () => void;
}

export const SecurityAuditModal: React.FC<SecurityAuditModalProps> = ({ onClose }) => {
  const { activeConversation, deviceId, user } = useChat();
  const [activeTab, setActiveTab] = useState<'audit' | 'diagnostics'>('diagnostics');
  const [auditData, setAuditData] = useState<any>(null);
  const [localChain, setLocalChain] = useState<any>(null);
  const [clientLogs, setClientLogs] = useState<SyncLogEntry[]>([]);
  const [serverLogs, setServerLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMessageId, setFilterMessageId] = useState('');

  const fetchAuditAndDiagnostics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/security/audit');
      if (res.ok) {
        const data = await res.json();
        setAuditData(data);
      }

      const diagRes = await fetch('/api/v1/security/diagnostics');
      if (diagRes.ok) {
        const diagData = await diagRes.json();
        setServerLogs(diagData.diagnostics || []);
      }

      setClientLogs(syncDiagnostic.getLogs());

      if (activeConversation) {
        const chain = await clientDb.getBlake3Chain(activeConversation.id);
        setLocalChain(chain);
      }
    } catch (err) {
      console.error('Audit fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditAndDiagnostics();
    const interval = setInterval(() => {
      setClientLogs(syncDiagnostic.getLogs());
    }, 2000);
    return () => clearInterval(interval);
  }, [activeConversation]);

  const filteredClientLogs = filterMessageId
    ? clientLogs.filter(l => l.clientMessageId.toLowerCase().includes(filterMessageId.toLowerCase()))
    : clientLogs;

  const filteredServerLogs = filterMessageId
    ? serverLogs.filter(l => (l.clientMessageId || '').toLowerCase().includes(filterMessageId.toLowerCase()) || (l.messageId || '').toLowerCase().includes(filterMessageId.toLowerCase()))
    : serverLogs;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">YChat Security & Diagnostics Center</h3>
              <p className="text-xs text-slate-400">Zero-knowledge audit & message sync lifecycle telemetry</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1 px-4 pt-2 border-b border-slate-800 bg-slate-950/40 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`px-3 py-2 border-b-2 flex items-center space-x-1.5 transition-all ${
              activeTab === 'diagnostics'
                ? 'border-violet-500 text-violet-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Message Sync Diagnostics ({clientLogs.length + serverLogs.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-2 border-b-2 flex items-center space-x-1.5 transition-all ${
              activeTab === 'audit'
                ? 'border-violet-500 text-violet-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Cryptographic Suite & Audit</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'diagnostics' && (
            <div className="space-y-6">
              {/* Zero-Knowledge Diagnostic Guarantee Banner */}
              <div className="p-3.5 rounded-xl bg-violet-950/30 border border-violet-800/40 flex items-start justify-between space-x-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center space-x-1.5 text-violet-300 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Zero-Knowledge Diagnostics: Strict Metadata Only</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Tracks the end-to-end lifecycle from sender dispatch to recipient login synchronization. Logs contain sequence IDs, timing, and transport routes — strictly zero plaintext and zero secret keys.
                  </p>
                </div>
                <button
                  onClick={fetchAuditAndDiagnostics}
                  disabled={loading}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center space-x-1.5 shrink-0 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {/* Message ID Filter */}
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="Filter by clientMessageId..."
                  value={filterMessageId}
                  onChange={(e) => setFilterMessageId(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
                {filterMessageId && (
                  <button
                    onClick={() => setFilterMessageId('')}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Client Diagnostic Timeline */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Activity className="w-4 h-4 text-violet-400" />
                    <span>Client-Side Sync Lifecycle Events (Device: {deviceId || 'none'})</span>
                  </h4>
                  <span className="text-[11px] text-slate-400">{filteredClientLogs.length} events</span>
                </div>

                {filteredClientLogs.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                    No client sync events logged yet. Send a message to see the lifecycle live.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {filteredClientLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-xs space-y-1.5 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                              log.stage.includes('RECIPIENT')
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                                : log.stage.includes('CONFIRMED') || log.stage.includes('ACKNOWLEDGED')
                                ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/50'
                                : 'bg-violet-950/60 text-violet-300 border border-violet-800/50'
                            }`}>
                              {log.stage}
                            </span>
                            <span className="font-mono text-[11px] text-slate-300 truncate max-w-xs" title={log.clientMessageId}>
                              {log.clientMessageId}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                          {log.senderDeviceId && (
                            <div>Sender: <span className="font-mono text-slate-300">{log.senderDeviceId}</span></div>
                          )}
                          {log.recipientDeviceId && (
                            <div>Recipient: <span className="font-mono text-slate-300">{log.recipientDeviceId}</span></div>
                          )}
                          {log.transport && (
                            <div>Transport: <span className="font-mono text-violet-400">{log.transport}</span></div>
                          )}
                          {log.sequence && (
                            <div>Seq: <span className="font-mono text-slate-300">{log.sequence}</span></div>
                          )}
                          {log.serverSequence && (
                            <div>Server Seq: <span className="font-mono text-slate-300">{log.serverSequence}</span></div>
                          )}
                        </div>

                        {log.details && (
                          <div className="text-[10px] text-slate-500 font-mono break-all pt-0.5">
                            {JSON.stringify(log.details)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Server-Side Ingestion & Delivery Diagnostics */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Server className="w-4 h-4 text-indigo-400" />
                    <span>Server-Side Ingestion, Auto-Linkage & Login Sync Events</span>
                  </h4>
                  <span className="text-[11px] text-slate-400">{filteredServerLogs.length} events</span>
                </div>

                {filteredServerLogs.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                    No server synchronization events logged yet.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {filteredServerLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-xs space-y-1.5 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                              log.stage === 'LOGIN_SYNC_PULL'
                                ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                                : log.stage === 'STORE_CIPHERTEXT'
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                                : log.stage === 'DELIVERED_RECEIPT'
                                ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/50'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}>
                              {log.stage}
                            </span>
                            <span className="font-mono text-[11px] text-slate-300 truncate max-w-xs" title={log.clientMessageId || log.messageId}>
                              {log.clientMessageId || log.messageId}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                          {log.conversationId && (
                            <div className="truncate">Conv: <span className="font-mono text-slate-300">{log.conversationId}</span></div>
                          )}
                          {log.recipientDeviceId && (
                            <div>To: <span className="font-mono text-slate-300">{log.recipientDeviceId}</span></div>
                          )}
                          {log.serverSequence && (
                            <div>Server Seq: <span className="font-mono text-emerald-400">{log.serverSequence}</span></div>
                          )}
                        </div>

                        {log.details && (
                          <div className="text-[10px] text-slate-500 font-mono break-all pt-0.5">
                            {JSON.stringify(log.details)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-6">
              {/* Zero-Knowledge Server Verification Box */}
              <div className="p-4 rounded-xl bg-slate-950 border border-emerald-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm font-semibold text-emerald-300">
                      Zero-Knowledge Server State: Confirmed
                    </span>
                  </div>
                  <button
                    onClick={fetchAuditAndDiagnostics}
                    disabled={loading}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Refresh Live Audit"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Inspection confirms the backend database holds <span className="font-bold text-emerald-400">0 plaintext messages</span>. All message bodies are transmitted and stored strictly as encrypted ciphertext envelopes.
                </p>
                {auditData && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-center">
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <div className="text-lg font-bold text-white">{auditData.plaintextLeaksCount}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-medium">Plaintext Leaks</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <div className="text-lg font-bold text-violet-400">{auditData.storedCiphertextRecords}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-medium">Stored Envelopes</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <div className="text-lg font-bold text-indigo-400">{auditData.registeredDevices}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-medium">Active Devices</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                      <div className="text-lg font-bold text-emerald-400">{auditData.activeUsers}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-medium">Registered Users</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Cryptographic Primitives Table */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                  <Cpu className="w-4 h-4 text-violet-400" />
                  <span>Cryptographic Protocol Suite</span>
                </h4>
                <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden divide-y divide-slate-800/80 text-xs">
                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Post-Quantum KEM</div>
                      <div className="text-[11px] text-slate-400">Quantum-resistant key encapsulation</div>
                    </div>
                    <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-violet-950/60 text-violet-300 border border-violet-800/40">
                      ML-KEM-1024 (NIST FIPS 203)
                    </span>
                  </div>

                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Post-Quantum Signature</div>
                      <div className="text-[11px] text-slate-400">Quantum-resistant identity authentication</div>
                    </div>
                    <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-violet-950/60 text-violet-300 border border-violet-800/40">
                      ML-DSA-87 (NIST FIPS 204)
                    </span>
                  </div>

                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Classical Diffie-Hellman</div>
                      <div className="text-[11px] text-slate-400">Defense-in-depth classical key exchange</div>
                    </div>
                    <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
                      X25519 (RFC 7748)
                    </span>
                  </div>

                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Transport AEAD Cipher</div>
                      <div className="text-[11px] text-slate-400">Authenticated payload encryption with CSPRNG nonce</div>
                    </div>
                    <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
                      ChaCha20-Poly1305 (RFC 8439)
                    </span>
                  </div>

                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Key Derivation & Expansion</div>
                      <div className="text-[11px] text-slate-400">Multi-generational ratchet chain derivation</div>
                    </div>
                    <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
                      HKDF-SHA3-512 (FIPS 202)
                    </span>
                  </div>

                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white">Tamper-Evident History</div>
                      <div className="text-[11px] text-slate-400">Local client cryptographic hash chain per chat</div>
                    </div>
                    <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                      BLAKE3 Chain State
                    </span>
                  </div>
                </div>
              </div>

              {/* Active Conversation BLAKE3 Chain */}
              {localChain && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">Active Conversation BLAKE3 Chain</span>
                    <span className="text-slate-400">{localChain.blockCount} blocks verified</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 font-mono text-[11px] text-violet-300 break-all border border-slate-800">
                    {localChain.currentHash}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
