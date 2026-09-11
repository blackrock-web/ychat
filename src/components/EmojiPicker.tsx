import React, { useState, useMemo } from 'react';
import { Search, X, Star, Smile, Hand, Cat, Coffee, Trophy, Sparkles } from 'lucide-react';

export const FAVORITE_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🙏'];

export interface EmojiCategory {
  id: string;
  name: string;
  icon: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: '😃',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
      '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
      '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓',
      '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦',
      '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞',
      '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿'
    ]
  },
  {
    id: 'gestures',
    name: 'Gestures & People',
    icon: '👋',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍',
      '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝',
      '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂',
      '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅'
    ]
  },
  {
    id: 'hearts',
    name: 'Hearts & Affection',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
      '💟', '💌', '💋', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️'
    ]
  },
  {
    id: 'nature',
    name: 'Animals & Nature',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨',
      '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒',
      '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗',
      '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰',
      '🌸', '💮', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱'
    ]
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: '🍕',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐',
      '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑',
      '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅',
      '🍞', '🥐', '🥖', '🫓', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖',
      '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯'
    ]
  },
  {
    id: 'activities',
    name: 'Activities & Celebration',
    icon: '🎉',
    emojis: [
      '🎉', '🎊', '🎈', '🎂', '🎆', '🎇', '✨', '🎃', '🎄', '🎁',
      '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎗️', '🎫', '🎟️', '🎪',
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱',
      '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳',
      '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷'
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols & Objects',
    icon: '⚡',
    emojis: [
      '🔥', '⚡', '⭐', '🌟', '✨', '💡', '🔔', '🔕', '💬', '💭',
      '🗯️', '🚀', '🛸', '🛰️', '✈️', '⛵', '⚓', '🚨', '🛑', '⛔',
      '✅', '❌', '✔️', '➕', '➖', '➗', '❓', '❗', '💤', '🎵'
    ]
  }
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
  showFavoritesOnly?: boolean;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelect,
  onClose,
  className = '',
  showFavoritesOnly = false
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('smileys');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const allEmojis = useMemo(() => {
    const list: { emoji: string; category: string }[] = [];
    EMOJI_CATEGORIES.forEach((cat) => {
      cat.emojis.forEach((e) => {
        list.push({ emoji: e, category: cat.name });
      });
    });
    return list;
  }, []);

  const filteredEmojis = useMemo(() => {
    if (!searchTerm.trim()) return null;
    return allEmojis.map((e) => e.emoji);
  }, [searchTerm, allEmojis]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-50 text-slate-200 select-none ${className}`}
    >
      {/* Top Header with Favorites Row */}
      <div className="p-2.5 bg-slate-950/80 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
          <span className="flex items-center space-x-1 text-slate-300">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>Favorite Reactions</span>
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* User-requested Favorites Line: 👍, ❤️, 😂, 😮, 😢, 🔥, 🎉, 🙏 */}
        <div className="flex items-center justify-between gap-1">
          {FAVORITE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSelect(emoji)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-lg hover:scale-125 hover:bg-slate-800 transition-all cursor-pointer"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>

        {!showFavoritesOnly && (
          /* Search Bar */
          <div className="relative pt-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-3" />
            <input
              type="text"
              placeholder="Search all emojis..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-hidden focus:border-violet-500 placeholder:text-slate-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-2.5 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {!showFavoritesOnly && (
        <>
          {/* Category Tabs */}
          {!searchTerm.trim() && (
            <div className="flex items-center justify-around px-2 py-1.5 bg-slate-950/40 border-b border-slate-800/60 overflow-x-auto scrollbar-none text-base">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-violet-600/30 text-white shadow-xs'
                      : 'opacity-70 hover:opacity-100 hover:bg-slate-800'
                  }`}
                  title={cat.name}
                >
                  {cat.icon}
                </button>
              ))}
            </div>
          )}

          {/* Emoji Grid */}
          <div className="p-2 overflow-y-auto max-h-56 min-h-40 grid grid-cols-8 gap-1 scrollbar-thin">
            {searchTerm.trim() ? (
              filteredEmojis && filteredEmojis.length > 0 ? (
                filteredEmojis.map((emoji, idx) => (
                  <button
                    key={`${emoji}-${idx}`}
                    type="button"
                    onClick={() => onSelect(emoji)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-lg hover:scale-125 hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))
              ) : (
                <div className="col-span-8 py-8 text-center text-xs text-slate-500">
                  No emojis found
                </div>
              )
            ) : (
              EMOJI_CATEGORIES.find((c) => c.id === selectedCategory)?.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-lg hover:scale-125 hover:bg-slate-800 transition-all cursor-pointer"
                >
                  {emoji}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
