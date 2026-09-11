import React from 'react';
import { ShieldCheck } from 'lucide-react';

export interface AvatarProps {
  name: string;
  avatarUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  isOnline?: boolean;
  presenceStatus?: 'online' | 'away' | 'offline';
  isVerified?: boolean;
  verified?: boolean;
  shape?: 'rounded' | 'circle';
  className?: string;
  onClick?: () => void;
  id?: string;
}

// Generate consistent, aesthetic gradient based on user name/initials
const GRADIENT_PAIRS = [
  'from-violet-600 to-indigo-600',
  'from-indigo-600 to-cyan-600',
  'from-emerald-600 to-teal-600',
  'from-rose-600 to-pink-600',
  'from-amber-600 to-orange-600',
  'from-fuchsia-600 to-purple-600',
  'from-blue-600 to-sky-600',
  'from-teal-600 to-emerald-600'
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % GRADIENT_PAIRS.length;
  return GRADIENT_PAIRS[index];
}

function getInitials(name: string): string {
  if (!name) return '?';
  const clean = name.trim().replace(/^@/, '');
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

const SIZE_MAP = {
  xs: {
    container: 'w-6 h-6 text-[10px]',
    dot: 'w-2 h-2 -bottom-0.5 -right-0.5',
    badge: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
    icon: 'w-1.5 h-1.5'
  },
  sm: {
    container: 'w-8 h-8 text-xs',
    dot: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
    badge: 'w-3 h-3 -bottom-0.5 -right-0.5',
    icon: 'w-2 h-2'
  },
  md: {
    container: 'w-10 h-10 text-sm font-semibold',
    dot: 'w-3 h-3 -bottom-0.5 -right-0.5',
    badge: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5',
    icon: 'w-2.5 h-2.5'
  },
  lg: {
    container: 'w-12 h-12 text-base font-semibold',
    dot: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5',
    badge: 'w-4 h-4 -bottom-0.5 -right-0.5',
    icon: 'w-2.5 h-2.5'
  },
  xl: {
    container: 'w-16 h-16 text-xl font-bold',
    dot: 'w-4 h-4 -bottom-0.5 -right-0.5',
    badge: 'w-5 h-5 -bottom-0.5 -right-0.5',
    icon: 'w-3 h-3'
  },
  '2xl': {
    container: 'w-20 h-20 text-2xl font-bold',
    dot: 'w-5 h-5 bottom-0 right-0',
    badge: 'w-6 h-6 bottom-0 right-0',
    icon: 'w-3.5 h-3.5'
  }
};

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarUrl,
  size = 'md',
  isOnline,
  presenceStatus,
  isVerified,
  verified,
  shape = 'circle',
  className = '',
  onClick,
  id
}) => {
  const [imgFailed, setImgFailed] = React.useState(false);

  React.useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const sizeConfig = SIZE_MAP[size];
  const roundedClass = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';
  const gradient = getGradient(name);
  const initials = getInitials(name);
  const hasVerifiedBadge = isVerified ?? verified;

  const effectivePresence = presenceStatus ?? (isOnline !== undefined ? (isOnline ? 'online' : 'offline') : undefined);
  const showImage = !!avatarUrl && !imgFailed;

  return (
    <div
      id={id}
      onClick={onClick}
      className={`relative inline-flex flex-shrink-0 items-center justify-center select-none ${
        onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
      } ${className}`}
    >
      <div
        className={`${sizeConfig.container} ${roundedClass} flex items-center justify-center overflow-hidden shadow-sm border border-slate-700/40 ${
          showImage ? 'bg-slate-800' : `bg-gradient-to-tr ${gradient} text-white`
        }`}
      >
        {showImage ? (
          <img
            src={avatarUrl}
            alt={name}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="tracking-tight">{initials}</span>
        )}
      </div>

      {/* Online/Away/Offline indicator dot */}
      {effectivePresence !== undefined && !hasVerifiedBadge && (
        <span
          className={`absolute ${sizeConfig.dot} rounded-full border-2 border-slate-900 ${
            effectivePresence === 'online'
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
              : effectivePresence === 'away'
              ? 'bg-amber-400'
              : 'bg-slate-500'
          }`}
          title={
            effectivePresence === 'online'
              ? 'Online'
              : effectivePresence === 'away'
              ? 'Away'
              : 'Offline'
          }
        />
      )}

      {/* Verified safety shield badge */}
      {hasVerifiedBadge && (
        <span
          className={`absolute ${sizeConfig.badge} rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-slate-950 shadow-xs`}
          title="Safety Number Verified"
        >
          <ShieldCheck className={sizeConfig.icon} />
        </span>
      )}
    </div>
  );
};
