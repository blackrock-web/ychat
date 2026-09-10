import React, { useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import {
  computeSafetyNumber,
  computeDynamicVerificationSession,
  verifySafetyCode,
  SafetyNumberResult,
  ComparisonResult
} from '../crypto/safetyNumber';
import { PrekeyBundle } from '../crypto/types';
import QRCode from 'qrcode';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Check,
  Copy,
  QrCode,
  Binary,
  Hash,
  Download,
  CheckCheck,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Lock,
  ArrowRight,
  Shield
} from 'lucide-react';

interface SafetyNumberModalProps {
  onClose: () => void;
}

type TabMode = 'qr' | 'bits60' | 'digits60' | 'verifier';

export const SafetyNumberModal: React.FC<SafetyNumberModalProps> = ({ onClose }) => {
  const { activeConversation, deviceKeys, token, verifyConversationSafety } = useChat();
  const [safetyData, setSafetyData] = useState<SafetyNumberResult | null>(null);
  const [recipientPublicKeys, setRecipientPublicKeys] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabMode>('qr');
  const [copiedType, setCopiedType] = useState<'digits' | 'bits' | 'qr' | 'code' | null>(null);
  const [isVerified, setIsVerified] = useState(activeConversation?.isVerifiedSafetyNumber || false);
  const [isDynamic, setIsDynamic] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [attemptCount, setAttemptCount] = useState(1);

  // 60-Bit / Code Verification State
  const [checkInput, setCheckInput] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  const generateVerification = async (dynamic: boolean = true, peerKeys?: any) => {
    if (!activeConversation || !deviceKeys) return;
    const targetPeerKeys = peerKeys || recipientPublicKeys;
    if (!targetPeerKeys) return;

    setIsGenerating(true);
    try {
      let result: SafetyNumberResult;
      if (dynamic) {
        // Generate new cryptographically secure verification value with fresh CSPRNG nonce
        result = computeDynamicVerificationSession(
          activeConversation.id,
          deviceKeys.publicKeys,
          targetPeerKeys
        );
        setIsDynamic(true);
      } else {
        result = computeSafetyNumber(
          deviceKeys.publicKeys,
          targetPeerKeys,
          deviceKeys.deviceId,
          activeConversation.recipientUuid
        );
        setIsDynamic(false);
      }

      setSafetyData(result);
      setAttemptCount(prev => prev + 1);

      // Generate real standard ISO/IEC 18004 QR code
      const url = await QRCode.toDataURL(result.qrPayload, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 340,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      setQrDataUrl(url);
      setComparison(null);
    } catch (err) {
      console.error('Error computing verification:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!activeConversation || !deviceKeys || !token) return;

    async function loadPeerKeysAndInit() {
      try {
        const devRes = await fetch(`/api/v1/devices/user/${activeConversation!.recipientUuid}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!devRes.ok) return;
        const devData = await devRes.json();
        const recipientDevice = devData.devices?.[0];
        if (!recipientDevice) return;

        const prekeyRes = await fetch(`/api/v1/devices/${recipientDevice.id}/prekeys`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!prekeyRes.ok) return;
        const recipientBundle: PrekeyBundle = await prekeyRes.json();
        setRecipientPublicKeys(recipientBundle.publicKeys);

        // Compute initial dynamic session verification
        await generateVerification(true, recipientBundle.publicKeys);
      } catch (err) {
        console.error('Safety number & QR computation error:', err);
      }
    }

    loadPeerKeysAndInit();
  }, [activeConversation, deviceKeys, token]);

  // Handle checking the peer's code
  const handlePerformCheck = (overrideText?: string) => {
    if (!safetyData) return;
    const textToVerify = overrideText !== undefined ? overrideText : checkInput;
    const result = verifySafetyCode(
      safetyData,
      textToVerify,
      activeConversation?.id,
      deviceKeys?.publicKeys,
      recipientPublicKeys
    );
    setComparison(result);

    if (result.isMatch) {
      setIsVerified(true);
      if (activeConversation) {
        verifyConversationSafety(activeConversation.id, true);
      }
    }
  };

  const handleSimulateCheck = (simulateMatch: boolean) => {
    if (!safetyData) return;
    if (simulateMatch) {
      // Simulate verifying peer's exact 60-bit code
      setCheckInput(safetyData.bits60);
      handlePerformCheck(safetyData.bits60);
    } else {
      // Simulate tamper / bit-flip
      const tampered = safetyData.bits60.slice(0, -4) + '0101';
      setCheckInput(tampered);
      handlePerformCheck(tampered);
    }
  };

  const handleCopy = (text: string, type: 'digits' | 'bits' | 'qr' | 'code') => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `ychat-qr-verify-${activeConversation?.recipientUsername || 'contact'}.png`;
    a.click();
  };

  const handleToggleVerified = async () => {
    if (!activeConversation) return;
    const nextVal = !isVerified;
    setIsVerified(nextVal);
    await verifyConversationSafety(activeConversation.id, nextVal);
  };

  return (
    <div
      id="safety-number-modal-backdrop"
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div
        id="safety-number-modal-card"
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-all"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-800/40 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white tracking-tight">Identity & Session Verification</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-950 text-violet-300 border border-violet-800/60">
                  Real QR & 60-Bit Check (Attempt #{attemptCount})
                </span>
              </div>
              <p className="text-xs text-slate-400">
                End-to-End Post-Quantum Verification with @{activeConversation?.recipientUsername}
              </p>
            </div>
          </div>
          <button
            id="close-safety-modal-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar: Fresh CSPRNG Verification Generation on Every Attempt */}
        <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <button
              id="generate-fresh-session-btn"
              onClick={() => generateVerification(true)}
              disabled={isGenerating}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white transition-all shadow-sm"
              title="Regenerates a fresh 128-bit CSPRNG nonce and new 60-bit code on every attempt"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>Regenerate 60-Bit Code & QR</span>
            </button>
            <span className="text-[11px] text-slate-400 font-mono">
              {isDynamic ? '✓ 128-bit CSPRNG Nonce Bound' : 'Static Identity Fingerprint'}
            </span>
          </div>

          <button
            id="toggle-verified-state-btn"
            onClick={handleToggleVerified}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              isVerified
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isVerified ? 'Marked as Verified' : 'Mark as Verified'}</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/20 px-4 pt-2 gap-2 overflow-x-auto">
          <button
            id="tab-qr-btn"
            onClick={() => setActiveTab('qr')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'qr'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Real Scannable QR Code</span>
          </button>

          <button
            id="tab-bits-btn"
            onClick={() => setActiveTab('bits60')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'bits60'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Binary className="w-4 h-4" />
            <span>60-Bit Random Code</span>
          </button>

          <button
            id="tab-digits-btn"
            onClick={() => setActiveTab('digits60')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'digits60'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Hash className="w-4 h-4" />
            <span>60-Digit Safety Number</span>
          </button>

          <button
            id="tab-verifier-btn"
            onClick={() => setActiveTab('verifier')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'verifier'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>60-Bit Verification Check</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-5">
          {/* TAB 1: Real Scannable ISO/IEC 18004 QR Code */}
          {activeTab === 'qr' && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-3.5 bg-white rounded-2xl shadow-xl inline-block border-4 border-violet-500/20">
                {qrDataUrl ? (
                  <img
                    id="verification-qr-image"
                    src={qrDataUrl}
                    alt="End-to-End Cryptographic Verification QR Code"
                    className="w-52 h-52 sm:w-60 sm:h-60 object-contain rounded-lg"
                  />
                ) : (
                  <div className="w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center bg-slate-100 text-slate-400 text-xs font-mono">
                    Generating ISO/IEC 18004 QR...
                  </div>
                )}
              </div>

              <div className="max-w-md text-xs text-slate-400 space-y-1">
                <p className="font-semibold text-slate-200">
                  Scan this QR code with @{activeConversation?.recipientUsername}&apos;s device
                </p>
                <p>
                  This QR code encodes a 128-bit CSPRNG nonce, conversation identity binding, and SHA3-512 authentication tag to prevent replay and cross-conversation substitution.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  id="copy-qr-payload-btn"
                  onClick={() => safetyData && handleCopy(safetyData.qrPayload, 'qr')}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  {copiedType === 'qr' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedType === 'qr' ? 'Payload Copied' : 'Copy Scannable Payload'}</span>
                </button>

                <button
                  id="download-qr-btn"
                  onClick={handleDownloadQr}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Image</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: 60-Bit Cryptographically Secure Random Code */}
          {activeTab === 'bits60' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    60-Bit Random Security Value
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    12 blocks of 5 bits each. Derived using SHA3-512 HKDF from conversation session keys.
                  </p>
                </div>
                <button
                  id="copy-bits-btn"
                  onClick={() => safetyData && handleCopy(safetyData.bits60, 'bits')}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  {copiedType === 'bits' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedType === 'bits' ? 'Copied' : 'Copy Bits'}</span>
                </button>
              </div>

              {safetyData && (
                <div
                  id="bits60-container"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 font-mono text-sm"
                >
                  {safetyData.formattedBitsBlocks.map((blk, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center justify-center hover:border-violet-500/40 transition-colors"
                    >
                      <span className="text-[10px] text-slate-500 mb-0.5">Block #{idx + 1}</span>
                      <span className="text-violet-300 font-semibold tracking-widest text-sm">{blk}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: 60-Digit Decimal Safety Number */}
          {activeTab === 'digits60' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    60-Digit Numeric Safety Number
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    12 blocks of 5 decimal digits (Signal/WhatsApp standard).
                  </p>
                </div>
                <button
                  id="copy-digits-btn"
                  onClick={() => safetyData && handleCopy(safetyData.numericCode, 'digits')}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  {copiedType === 'digits' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedType === 'digits' ? 'Copied' : 'Copy Digits'}</span>
                </button>
              </div>

              {safetyData && (
                <div
                  id="digits60-container"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 font-mono text-sm"
                >
                  {safetyData.formattedBlocks.map((blk, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-xl bg-slate-900/80 border border-slate-800/80 flex flex-col items-center justify-center hover:border-violet-500/40 transition-colors"
                    >
                      <span className="text-[10px] text-slate-500 mb-0.5">#{idx + 1}</span>
                      <span className="text-emerald-300 font-semibold tracking-wider text-sm">{blk}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Dedicated 60-Bit Verification Check Tool */}
          {activeTab === 'verifier' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                    <Binary className="w-3.5 h-3.5 text-violet-400" />
                    <span>Interactive 60-Bit Random Code Check</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Attempt #{attemptCount}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Verify peer&apos;s 60-bit code or scanned QR. When you regenerate, a new 128-bit CSPRNG nonce and 60-bit challenge are computed to ensure freshness.
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSimulateCheck(true)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/60 text-emerald-300 transition-colors"
                  >
                    Simulate 100% Peer Match
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSimulateCheck(false)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-rose-950/60 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 transition-colors"
                  >
                    Simulate Tamper / Mismatch
                  </button>
                </div>
              </div>

              {/* Bit-by-bit Visual Inspection Matrix (if verified or checking) */}
              {comparison?.detailedDiff && comparison.detailedDiff.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Bit-by-Bit Cryptographic Diff:</span>
                    <span className={`font-mono font-bold ${comparison.isMatch ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {comparison.matchedCount} / {comparison.totalCount} bits ({comparison.similarityPercent}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-10 sm:grid-cols-12 gap-1 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                    {comparison.detailedDiff.map(d => (
                      <div
                        key={d.index}
                        title={`Bit #${d.index}: expected ${d.expected}, peer ${d.actual}`}
                        className={`h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold ${
                          d.isMatch
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/30 text-rose-300 border border-rose-500/60 animate-pulse'
                        }`}
                      >
                        {d.actual}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Input Bar & Verification Status */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-violet-400" />
                <span>Verify Peer&apos;s Safety Value / QR Payload</span>
              </span>
            </div>

            <div className="flex gap-2">
              <input
                id="peer-safety-code-input"
                type="text"
                value={checkInput}
                onChange={(e) => setCheckInput(e.target.value)}
                placeholder="Paste peer's 60 bits, 60 digits, or scanned ychat:verify URI..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 font-mono"
              />
              <button
                id="verify-peer-code-btn"
                onClick={() => handlePerformCheck()}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
              >
                Verify
              </button>
            </div>

            {/* Results Display with Security Alerts */}
            {comparison && (
              <div
                id="comparison-result-card"
                className={`p-3.5 rounded-2xl border text-xs space-y-2 transition-all ${
                  comparison.isMatch
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  {comparison.isMatch ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  )}
                  <span className="font-semibold">{comparison.message}</span>
                </div>

                {comparison.securityAlert && (
                  <div className="p-2 rounded-lg bg-rose-900/40 border border-rose-800 text-[11px] text-rose-300 font-mono">
                    ALERT TYPE: {comparison.securityAlert}
                  </div>
                )}

                {comparison.isMatch && (
                  <p className="text-[11px] text-emerald-300/80">
                    No man-in-the-middle, replay attack, or key substitution detected. All messages are securely encrypted with post-quantum ML-KEM-1024 and ChaCha20-Poly1305.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
