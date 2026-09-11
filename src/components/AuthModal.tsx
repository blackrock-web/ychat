import React, { useState } from 'react';
import { useChat } from '../context/ChatContext';
import {
  Lock,
  Shield,
  Sparkles,
  ArrowRight,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  CheckCircle2,
  X,
  KeyRound,
  Cpu,
  RefreshCw,
  HelpCircle,
  AlertTriangle
} from 'lucide-react';

type LoadingAction = 'login' | 'register' | 'demo-alice' | 'demo-bob' | 'demo-charlie' | null;

interface FieldError {
  title: string;
  message: string;
  field?: 'username' | 'email' | 'password' | 'displayName' | 'general';
  suggestion?: string;
  actionText?: string;
  onAction?: () => void;
}

export const AuthModal: React.FC = () => {
  const { login, register, demoLogin } = useChat();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [error, setError] = useState<FieldError | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isLoading = loadingAction !== null;

  const handleTabSwitch = (toRegister: boolean) => {
    if (isLoading) return;
    setIsRegister(toRegister);
    setError(null);
    setSuccessMsg(null);
  };

  const handleInputChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    field: 'username' | 'email' | 'password' | 'displayName'
  ) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
      if (error && (error.field === field || error.field === 'general')) {
        setError(null);
      }
    };
  };

  const validateForm = (): boolean => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError({
        title: 'Username Required',
        message: 'Please provide an alphanumeric username.',
        field: 'username',
        suggestion: 'Choose a unique username to identify your account on the E2EE network.'
      });
      return false;
    }
    if (trimmedUsername.length < 3) {
      setError({
        title: 'Username Too Short',
        message: 'Username must be at least 3 characters long.',
        field: 'username',
        suggestion: 'Enter a handle between 3 and 32 characters.'
      });
      return false;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      setError({
        title: 'Invalid Characters in Username',
        message: 'Username may only contain letters, numbers, underscores, and hyphens.',
        field: 'username',
        suggestion: 'Remove spaces and special characters from your handle.'
      });
      return false;
    }

    if (isRegister) {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setError({
          title: 'Email Address Required',
          message: 'An email address is required for identity recovery.',
          field: 'email',
          suggestion: 'Provide a valid email address (e.g. user@example.com).'
        });
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError({
          title: 'Invalid Email Format',
          message: 'The email address entered is not properly formatted.',
          field: 'email',
          suggestion: 'Check the domain name format (e.g. name@domain.com).'
        });
        return false;
      }
    }

    if (!password) {
      setError({
        title: 'Password Required',
        message: 'Master password is required.',
        field: 'password',
        suggestion: 'Enter your master passphrase to derive client keys.'
      });
      return false;
    }
    if (password.length < 8) {
      setError({
        title: 'Passphrase Too Short',
        message: 'Password must be at least 8 characters long.',
        field: 'password',
        suggestion: 'A longer passphrase is required for Argon2id key derivation security.'
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError(null);
    setSuccessMsg(null);

    if (!validateForm()) return;

    const action = isRegister ? 'register' : 'login';
    setLoadingAction(action);

    try {
      if (isRegister) {
        setCurrentStepIndex(1);
        setLoadingStep('Generating ML-KEM-1024 & X25519 hybrid keypairs...');
        await new Promise(r => setTimeout(r, 150));

        setCurrentStepIndex(2);
        setLoadingStep('Generating ML-DSA-87 post-quantum identity signature keys...');
        await new Promise(r => setTimeout(r, 150));

        setCurrentStepIndex(3);
        setLoadingStep('Deriving master key with Argon2id & provisioning device prekeys...');
        await register(username.trim(), email.trim(), password, displayName.trim() || username.trim());

        setCurrentStepIndex(4);
        setSuccessMsg('Post-quantum identity initialized! Connecting to secure network...');
      } else {
        setCurrentStepIndex(1);
        setLoadingStep('Deriving master key with Argon2id...');
        await new Promise(r => setTimeout(r, 120));

        setCurrentStepIndex(2);
        setLoadingStep('Verifying cryptographic signature & device prekeys...');
        await login(username.trim(), password);

        setCurrentStepIndex(3);
        setSuccessMsg('Authenticated! Initializing zero-knowledge message ratchet...');
      }
    } catch (err: any) {
      const rawMsg: string = err?.message || (isRegister ? 'Registration failed' : 'Authentication failed');
      const lower = rawMsg.toLowerCase();

      let title = isRegister ? 'Registration Failed' : 'Authentication Error';
      let targetField: FieldError['field'] = 'general';
      let suggestion = 'Please review your input and try again.';
      let actionText: string | undefined = undefined;
      let onAction: (() => void) | undefined = undefined;

      if (lower.includes('username already taken') || lower.includes('already exists') || lower.includes('409')) {
        title = 'Username Already Taken';
        targetField = 'username';
        suggestion = `The username "${username}" is already claimed. If this is your account, try signing in.`;
        actionText = 'Switch to Sign In';
        onAction = () => {
          setIsRegister(false);
          setError(null);
        };
      } else if (lower.includes('invalid credentials') || lower.includes('password') || lower.includes('401')) {
        title = 'Invalid Credentials';
        targetField = 'password';
        suggestion = 'The username and password combination did not match any active account. Please verify your credentials.';
        actionText = 'Create an Account';
        onAction = () => {
          setIsRegister(true);
          setError(null);
        };
      } else if (lower.includes('email')) {
        title = 'Email Format Error';
        targetField = 'email';
        suggestion = 'Ensure your email is in a standard format (e.g. user@example.com).';
      } else if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('429')) {
        title = 'Rate Limit Reached';
        suggestion = 'Too many attempts in a short period. Please wait 60 seconds before retrying.';
      } else if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('connection')) {
        title = 'Relay Connection Error';
        suggestion = 'Unable to reach the secure relay server. Please check your internet connection.';
        actionText = 'Retry Now';
        onAction = () => {
          setError(null);
        };
      }

      setError({
        title,
        message: rawMsg,
        field: targetField,
        suggestion,
        actionText,
        onAction
      });

      setLoadingAction(null);
      setLoadingStep('');
      setCurrentStepIndex(0);
    }
  };

  const handleDemo = async (role: 'alice' | 'bob' | 'charlie') => {
    if (isLoading) return;
    setError(null);
    setSuccessMsg(null);
    const actionKey: LoadingAction = `demo-${role}`;
    const nameMap = {
      alice: 'Alice Sterling',
      bob: 'Bob Vance',
      charlie: 'Charlie Davis'
    };
    setLoadingAction(actionKey);
    setLoadingStep(`Signing in as ${nameMap[role]}...`);
    setCurrentStepIndex(1);

    try {
      await demoLogin(role);
      setSuccessMsg(`Welcome, ${nameMap[role]}! Connecting to E2EE network...`);
    } catch (err: any) {
      setError({
        title: 'Demo Sign-In Failed',
        message: err?.message || 'Demo sign-in failed. Please try again.',
        field: 'general',
        suggestion: 'Click the demo button again to retry or register a custom account.',
        actionText: 'Retry Demo',
        onAction: () => handleDemo(role)
      });
      setLoadingAction(null);
      setLoadingStep('');
      setCurrentStepIndex(0);
    }
  };

  return (
    <div id="auth-modal-backdrop" className="fixed inset-0 bg-slate-950/95 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div
        id="auth-modal-card"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-8 space-y-6 relative transition-all"
      >
        {/* Visual Loading Overlay with Multi-Phase Progress Spinner */}
        {isLoading && (
          <div
            id="auth-loading-overlay"
            className="absolute inset-0 bg-slate-950/92 backdrop-blur-md z-20 flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in duration-200"
          >
            <div className="relative">
              {/* Pulsing glow ring */}
              <div className="absolute -inset-2 rounded-full bg-violet-600/30 blur-md animate-pulse" />
              {/* Circular animated spinner */}
              <div className="relative w-16 h-16 rounded-full border-4 border-violet-500/20 border-t-violet-400 border-r-indigo-400 animate-spin flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Cpu className="w-6 h-6 text-violet-300 animate-pulse" />
              </div>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <h3 className="text-sm font-bold text-white tracking-wide flex items-center justify-center space-x-1.5">
                <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                <span>{isRegister ? 'Provisioning Quantum Identity' : 'Authenticating Session'}</span>
              </h3>
              <p className="text-xs text-violet-300 font-medium leading-relaxed">
                {loadingStep || 'Processing cryptographic credentials...'}
              </p>
            </div>

            {/* Micro Progress Bar */}
            <div className="w-52 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(25, currentStepIndex * 25))}%` }}
              />
            </div>

            <p className="text-[11px] text-slate-400 font-mono flex items-center space-x-1">
              <Shield className="w-3 h-3 text-violet-400" />
              <span>FIPS 203 (ML-KEM-1024) • FIPS 204 (ML-DSA-87)</span>
            </p>
          </div>
        )}

        {/* Brand Header */}
        <div className="text-center space-y-2">
          <img
            src="/1.jpg"
            alt="YChat Logo"
            className="w-16 h-16 mx-auto rounded-2xl object-cover shadow-xl shadow-violet-500/25 border-2 border-violet-500/30"
          />
          <h1 className="text-2xl font-black text-white tracking-tight">YChat</h1>
          <p className="text-xs text-slate-400">
            Private & Secure End-to-End Encrypted Messenger
          </p>
        </div>

        {/* Quick 1-Click Demo Profiles */}
        <div id="demo-profiles-container" className="p-3.5 rounded-2xl bg-slate-950 border border-violet-900/40 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-violet-300 flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              <span>Instant 1-Click Demo Sign-In</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Isolated Identities</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              id="demo-alice-btn"
              type="button"
              onClick={() => handleDemo('alice')}
              disabled={isLoading}
              className="px-2.5 py-2 rounded-xl bg-violet-950/60 hover:bg-violet-900/60 disabled:opacity-50 disabled:cursor-not-allowed border border-violet-800/60 text-violet-200 text-xs font-semibold flex flex-col items-center justify-center space-y-0.5 transition-all shadow-sm text-center"
            >
              {loadingAction === 'demo-alice' ? (
                <Loader2 className="w-4 h-4 text-violet-300 animate-spin my-1" />
              ) : (
                <>
                  <span className="truncate w-full font-bold">Alice</span>
                  <span className="text-[10px] text-violet-400 font-normal">User A</span>
                </>
              )}
            </button>
            <button
              id="demo-bob-btn"
              type="button"
              onClick={() => handleDemo('bob')}
              disabled={isLoading}
              className="px-2.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 text-slate-200 text-xs font-semibold flex flex-col items-center justify-center space-y-0.5 transition-all shadow-sm text-center"
            >
              {loadingAction === 'demo-bob' ? (
                <Loader2 className="w-4 h-4 text-slate-300 animate-spin my-1" />
              ) : (
                <>
                  <span className="truncate w-full font-bold">Bob</span>
                  <span className="text-[10px] text-slate-400 font-normal">User B</span>
                </>
              )}
            </button>
            <button
              id="demo-charlie-btn"
              type="button"
              onClick={() => handleDemo('charlie')}
              disabled={isLoading}
              className="px-2.5 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-800/60 text-emerald-200 text-xs font-semibold flex flex-col items-center justify-center space-y-0.5 transition-all shadow-sm text-center"
            >
              {loadingAction === 'demo-charlie' ? (
                <Loader2 className="w-4 h-4 text-emerald-300 animate-spin my-1" />
              ) : (
                <>
                  <span className="truncate w-full font-bold">Charlie</span>
                  <span className="text-[10px] text-emerald-400 font-normal">User C</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Auth Mode Toggle */}
        <div id="auth-mode-toggle" className="flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs font-medium">
          <button
            id="tab-sign-in"
            type="button"
            disabled={isLoading}
            onClick={() => handleTabSwitch(false)}
            className={`flex-1 py-2 rounded-lg transition-all ${
              !isRegister
                ? 'bg-violet-600 text-white font-semibold shadow'
                : 'text-slate-400 hover:text-white disabled:opacity-50'
            }`}
          >
            Sign In
          </button>
          <button
            id="tab-create-account"
            type="button"
            disabled={isLoading}
            onClick={() => handleTabSwitch(true)}
            className={`flex-1 py-2 rounded-lg transition-all ${
              isRegister
                ? 'bg-violet-600 text-white font-semibold shadow'
                : 'text-slate-400 hover:text-white disabled:opacity-50'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Dynamic Success Notice */}
        {successMsg && (
          <div
            id="auth-success-alert"
            className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center space-x-2.5 leading-relaxed animate-in fade-in duration-200"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="flex-1 font-medium">{successMsg}</span>
          </div>
        )}

        {/* Explicit Actionable Error Notice */}
        {error && (
          <div
            id="auth-error-alert"
            className="p-4 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs space-y-2 animate-in fade-in slide-in-from-top-1 duration-200 shadow-lg shadow-rose-950/30"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="font-bold text-rose-300 tracking-wide text-xs">
                  {error.title}
                </span>
              </div>
              <button
                type="button"
                id="dismiss-auth-error-btn"
                onClick={() => setError(null)}
                className="text-rose-400 hover:text-rose-100 p-0.5 rounded transition-colors"
                title="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="pl-6 text-rose-200 leading-relaxed font-normal">
              {error.message}
            </p>

            {error.suggestion && (
              <div className="pl-6 flex items-start space-x-1.5 text-[11px] text-rose-300/90">
                <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                <span>{error.suggestion}</span>
              </div>
            )}

            {error.actionText && error.onAction && (
              <div className="pl-6 pt-1">
                <button
                  type="button"
                  id="auth-error-action-btn"
                  onClick={error.onAction}
                  className="px-3 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800/70 border border-rose-700/60 text-rose-200 text-[11px] font-semibold transition-all inline-flex items-center space-x-1"
                >
                  <span>{error.actionText}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Credentials Form */}
        <form id="auth-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Username Field */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <label htmlFor="input-username">Username</label>
              {error?.field === 'username' && (
                <span className="text-[11px] text-rose-400 flex items-center space-x-1">
                  <AlertTriangle className="w-3 h-3 inline" />
                  <span>Required & unique</span>
                </span>
              )}
            </div>
            <input
              id="input-username"
              type="text"
              required
              disabled={isLoading}
              placeholder="e.g. alice"
              value={username}
              onChange={handleInputChange(setUsername, 'username')}
              className={`w-full px-4 py-2.5 rounded-xl bg-slate-950 border text-slate-200 text-sm focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                error?.field === 'username'
                  ? 'border-rose-500 bg-rose-950/20 ring-1 ring-rose-500/40 text-rose-100'
                  : 'border-slate-800 focus:border-violet-500'
              }`}
            />
          </div>

          {/* Registration Fields */}
          {isRegister && (
            <>
              <div className="space-y-1">
                <label htmlFor="input-display-name" className="text-xs font-medium text-slate-300">
                  Display Name (Optional)
                </label>
                <input
                  id="input-display-name"
                  type="text"
                  disabled={isLoading}
                  placeholder="e.g. Alice Sterling"
                  value={displayName}
                  onChange={handleInputChange(setDisplayName, 'displayName')}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                  <label htmlFor="input-email">Email Address</label>
                  {error?.field === 'email' && (
                    <span className="text-[11px] text-rose-400 flex items-center space-x-1">
                      <AlertTriangle className="w-3 h-3 inline" />
                      <span>Invalid email</span>
                    </span>
                  )}
                </div>
                <input
                  id="input-email"
                  type="email"
                  required
                  disabled={isLoading}
                  placeholder="alice@example.com"
                  value={email}
                  onChange={handleInputChange(setEmail, 'email')}
                  className={`w-full px-4 py-2.5 rounded-xl bg-slate-950 border text-slate-200 text-sm focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    error?.field === 'email'
                      ? 'border-rose-500 bg-rose-950/20 ring-1 ring-rose-500/40 text-rose-100'
                      : 'border-slate-800 focus:border-violet-500'
                  }`}
                />
              </div>
            </>
          )}

          {/* Password Field */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <label htmlFor="input-password">
                {isRegister ? 'Passphrase (min. 8 characters)' : 'Master Passphrase'}
              </label>
              {error?.field === 'password' && (
                <span className="text-[11px] text-rose-400 flex items-center space-x-1">
                  <AlertTriangle className="w-3 h-3 inline" />
                  <span>Check password</span>
                </span>
              )}
            </div>
            <div className="relative">
              <input
                id="input-password"
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isLoading}
                placeholder="••••••••"
                value={password}
                onChange={handleInputChange(setPassword, 'password')}
                className={`w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-950 border text-slate-200 text-sm focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  error?.field === 'password'
                    ? 'border-rose-500 bg-rose-950/20 ring-1 ring-rose-500/40 text-rose-100'
                    : 'border-slate-800 focus:border-violet-500'
                }`}
              />
              <button
                type="button"
                id="toggle-password-visibility-btn"
                disabled={isLoading}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit Action Button with Active Visual Spinner */}
          <button
            id="auth-submit-btn"
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all shadow-lg shadow-violet-600/25 flex items-center justify-center space-x-2 relative"
          >
            {isLoading && (loadingAction === 'login' || loadingAction === 'register') ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white shrink-0" />
                <span className="truncate">{loadingStep || (isRegister ? 'Creating Identity...' : 'Signing In...')}</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4 shrink-0 text-violet-200" />
                <span>{isRegister ? 'Generate Quantum Identity' : 'Sign In with Passphrase'}</span>
                <ArrowRight className="w-4 h-4 text-violet-300" />
              </>
            )}
          </button>
        </form>

        {/* Security Footer */}
        <div className="text-center text-[11px] text-slate-500 flex items-center justify-center space-x-1.5 pt-1">
          <Shield className="w-3.5 h-3.5 text-violet-400" />
          <span>FIPS 203 (ML-KEM-1024) • FIPS 204 (ML-DSA-87) • Argon2id</span>
        </div>
      </div>
    </div>
  );
};
