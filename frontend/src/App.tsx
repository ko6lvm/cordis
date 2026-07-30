import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Compass, Plus, Hash, LogOut, Send, Loader2, Settings, Users, Home, MessageSquare, Check, X, AlertTriangle, Pencil, Trash2, Reply, File as FileIcon, UploadCloud, Download, Hammer, Play, Pause, Smile, Pin, Sun, Moon, ChevronDown, ChevronRight, FolderPlus, Shield, Menu, BadgeCheck, Clock, Copy, Link2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import EmojiPicker, { Theme, Categories } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import ImageCropModal from './components/ImageCropModal';

const API_BASE = import.meta.env.VITE_API_BASE || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? "http://127.0.0.1:8000" : "");

const playPingSound = () => {
  try {
    const audio = new Audio('/sounds/ping.mp3');
    audio.play().catch(e => console.warn('Audio play failed:', e));
  } catch (e) {
    // Ignore error
  }
};

const SERVER_ORDER_KEY = 'cordis_server_order';
const PINNED_SERVER_KEY = 'cordis_pinned_server';
const THEME_KEY = 'cordis_theme';

const loadServerOrder = (): number[] => {
  try {
    const raw = localStorage.getItem(SERVER_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
};

const saveServerOrder = (ids: number[]) => {
  localStorage.setItem(SERVER_ORDER_KEY, JSON.stringify(ids));
};

const loadPinnedServerId = (): number | null => {
  const v = localStorage.getItem(PINNED_SERVER_KEY);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const savePinnedServerId = (id: number | null) => {
  if (id === null) localStorage.removeItem(PINNED_SERVER_KEY);
  else localStorage.setItem(PINNED_SERVER_KEY, String(id));
};

const isGeneralServer = (s: any) =>
  s?.invite_code === 'GLOBAL' || String(s?.server_name || '').toLowerCase() === 'general';

const sortServersByOrder = (list: any[], order: number[]): any[] => {
  const byId = new Map(list.map((s) => [s.server_id, s]));
  const sorted: any[] = [];
  for (const id of order) {
    const s = byId.get(id);
    if (s) {
      sorted.push(s);
      byId.delete(id);
    }
  }
  for (const s of list) {
    if (byId.has(s.server_id)) sorted.push(s);
  }
  return sorted;
};

const applyServerListOrder = (list: any[]): any[] => {
  const ordered = sortServersByOrder(list, loadServerOrder());
  saveServerOrder(ordered.map((s) => s.server_id));
  return ordered;
};

const resolvePinnedServer = (list: any[], preferredId: number | null): any | null => {
  if (preferredId != null) {
    const found = list.find((s) => s.server_id === preferredId);
    if (found) return found;
  }
  return list.find(isGeneralServer) || list[0] || null;
};

const getFullUrl = (url: string | undefined | null) => {
  if (!url) return '';
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
};

type ServerEmoji = {
  emoji_id: number;
  server_id: number;
  name: string;
  image_url: string;
  creator_id: number;
  created_at: number;
};

const formatCustomReaction = (emoji: { name: string; emoji_id: number }) =>
  `<:${emoji.name}:${emoji.emoji_id}>`;

const parseCustomReaction = (token: string): { name: string; id: number } | null => {
  const m = token.match(/^<:([a-zA-Z0-9_]+):(\d+)>$/);
  if (!m) return null;
  return { name: m[1], id: parseInt(m[2], 10) };
};

const findCustomEmoji = (
  emojis: ServerEmoji[],
  tokenOrName: string
): ServerEmoji | undefined => {
  const parsed = parseCustomReaction(tokenOrName);
  if (parsed) {
    return (
      emojis.find((e) => e.emoji_id === parsed.id) ||
      emojis.find((e) => e.name.toLowerCase() === parsed.name.toLowerCase())
    );
  }
  const name = tokenOrName.replace(/^:|:$/g, '').toLowerCase();
  return emojis.find((e) => e.name.toLowerCase() === name);
};

const renderReactionEmoji = (token: string, customEmojis: ServerEmoji[]) => {
  const custom = findCustomEmoji(customEmojis, token);
  if (custom) {
    return (
      <img
        src={getFullUrl(custom.image_url)}
        alt={`:${custom.name}:`}
        title={`:${custom.name}:`}
        className="custom-emoji reaction"
        draggable={false}
      />
    );
  }
  return <span className="reaction-emoji">{token}</span>;
};

type CropTarget = 'userAvatar' | 'userBanner' | 'serverIcon' | 'serverBanner';

const CROP_CONFIG: Record<CropTarget, { aspect: number; cropShape: 'round' | 'rect'; outputWidth: number; outputHeight: number; title: string }> = {
  userAvatar: { aspect: 1, cropShape: 'round', outputWidth: 512, outputHeight: 512, title: 'Crop Profile Picture' },
  userBanner: { aspect: 3, cropShape: 'rect', outputWidth: 1500, outputHeight: 500, title: 'Crop Profile Banner' },
  serverIcon: { aspect: 1, cropShape: 'round', outputWidth: 512, outputHeight: 512, title: 'Crop Server Icon' },
  serverBanner: { aspect: 3, cropShape: 'rect', outputWidth: 1500, outputHeight: 500, title: 'Crop Server Banner' },
};

export const getUserHighestRole = (roles: string[], serverRoles: Record<string, any>) => {
  if (!roles || roles.length === 0) return { id: 'default', name: 'Default', hierarchy: 0, color: '' };
  let highest = null;
  for (const roleId of roles) {
    const roleData = serverRoles[roleId];
    if (roleData) {
      if (!highest || roleData.hierarchy > highest.hierarchy) {
        highest = { id: roleId, ...roleData };
      }
    }
  }
  return highest || { id: 'default', name: 'Default', hierarchy: 0, color: '' };
};

const formatLastActive = (lastActiveAt: number | undefined, isOnline: boolean) => {
  if (isOnline) return "Active now";
  if (!lastActiveAt) return "Unknown";
  
  const diffInSeconds = Math.floor(Date.now() / 1000) - lastActiveAt;
  let relative = "";
  if (diffInSeconds < 60) relative = "less than a minute ago";
  else if (diffInSeconds < 3600) relative = `${Math.floor(diffInSeconds / 60)}m ago`;
  else if (diffInSeconds < 86400) relative = `${Math.floor(diffInSeconds / 3600)}h ago`;
  else relative = `${Math.floor(diffInSeconds / 86400)}d ago`;

  const absolute = new Date(lastActiveAt * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `Active ${relative} (${absolute})`;
};

const renderMessageText = (
  text: string | undefined,
  onMentionClick?: (username: string, e: React.MouseEvent) => void,
  customEmojis: ServerEmoji[] = []
) => {
  if (!text) return null;

  let processedText = text.replace(/(^|\s)@(\w+)/g, '$1[@$2](https://mention.local/$2)');

  processedText = processedText.replace(/<:([a-zA-Z0-9_]+):(\d+)>/g, (_m, name, id) => {
    const found =
      customEmojis.find((e) => e.emoji_id === Number(id)) ||
      customEmojis.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
    if (found) {
      return `![custom-emoji:${found.name}](${getFullUrl(found.image_url)})`;
    }
    return `:${name}:`;
  });

  if (customEmojis.length > 0) {
    const byName = new Map(customEmojis.map((e) => [e.name.toLowerCase(), e]));
    processedText = processedText.replace(
      /(^|[^a-zA-Z0-9_]):([a-zA-Z0-9_]{2,32}):(?![a-zA-Z0-9_])/g,
      (full, prefix, name) => {
        const found = byName.get(String(name).toLowerCase());
        if (!found) return full;
        return `${prefix}![custom-emoji:${found.name}](${getFullUrl(found.image_url)})`;
      }
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <p style={{ margin: 0, padding: 0 }} {...props} />,
        img: ({ node, src, alt, ...props }) => {
          if (typeof alt === 'string' && alt.startsWith('custom-emoji:')) {
            const name = alt.replace('custom-emoji:', '');
            return (
              <img
                src={src}
                alt={`:${name}:`}
                title={`:${name}:`}
                className="custom-emoji inline"
                draggable={false}
              />
            );
          }
          return <img src={src} alt={alt} {...props} />;
        },
        a: ({ node, href, children, ...props }) => {
          if (href?.startsWith('https://mention.local/')) {
            const username = href.replace('https://mention.local/', '');
            return (
              <span 
                className="mention-ping"
                onClick={(e) => {
                  if (onMentionClick) {
                    e.stopPropagation();
                    e.preventDefault();
                    onMentionClick(username, e);
                  }
                }}
              >
                {children}
              </span>
            );
          }
          return (
            <a 
              href={href} 
              target="_blank" 
              rel="noopener noreferrer"
              className="msg-link"
              {...props}
            >
              {children}
            </a>
          );
        }
      }}
    >
      {processedText}
    </ReactMarkdown>
  );
};

const extractYoutubeVideoId = (url: string | undefined | null): string | null => {
  if (!url) return null;
  const cleaned = url.trim().replace(/[).,;!>'"]+$/, '');
  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#\s]*&)?v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/i,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) return m[1];
  }
  return null;
};

const MessageEmbed = ({ embed, onImageLoad }: { embed: any, onImageLoad?: () => void }) => {
  const [playing, setPlaying] = useState(false);
  const videoId =
    embed?.video_id ||
    (embed?.type === 'youtube' ? extractYoutubeVideoId(embed?.url) : null) ||
    extractYoutubeVideoId(embed?.url);
  const isYoutube = embed?.type === 'youtube' || !!videoId;

  if (!embed || (!embed.title && !embed.description && !embed.image && !videoId)) return null;

  if (isYoutube && videoId) {
    const watchUrl = embed.url || `https://www.youtube.com/watch?v=${videoId}`;
    const thumb =
      embed.image ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return (
      <div className="msg-embed msg-embed-youtube">
        <div className="msg-embed-provider">YouTube</div>
        {embed.title && (
          <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="msg-embed-title">
            {embed.title}
          </a>
        )}
        {embed.description && (
          <div className="msg-embed-description">{embed.description}</div>
        )}
        <div className="msg-embed-video">
          {playing ? (
            <iframe
              className="msg-embed-iframe"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
              title={embed.title || 'YouTube video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              onLoad={onImageLoad}
            />
          ) : (
            <button
              type="button"
              className="msg-embed-video-poster"
              onClick={() => setPlaying(true)}
              aria-label="Play YouTube video"
            >
              <img
                src={getFullUrl(thumb)}
                alt={embed.title || 'YouTube thumbnail'}
                className="msg-embed-thumbnail msg-embed-video-thumb"
                onLoad={onImageLoad}
              />
              <span className="msg-embed-play-btn" aria-hidden>
                <svg viewBox="0 0 68 48" width="68" height="48">
                  <path
                    className="msg-embed-play-bg"
                    d="M66.52,7.74c-0.78-2.93-2.49-5.41-5.42-6.19C55.79,.13,34,0,34,0S12.21,.13,6.9,1.55 C3.97,2.33,2.27,4.81,1.48,7.74C0.06,13.05,0,24,0,24s0.06,10.95,1.48,16.26c0.78,2.93,2.49,5.41,5.42,6.19 C12.21,47.87,34,48,34,48s21.79-0.13,27.1-1.55c2.93-0.78,4.64-3.26,5.42-6.19C67.94,34.95,68,24,68,24S67.94,13.05,66.52,7.74z"
                    fill="#f00"
                  />
                  <path d="M 45,24 27,14 27,34" fill="#fff" />
                </svg>
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="msg-embed">
      <div className="msg-embed-content">
        {embed.title && (
          <a href={embed.url} target="_blank" rel="noopener noreferrer" className="msg-embed-title">
            {embed.title}
          </a>
        )}
        {embed.description && (
          <div className="msg-embed-description">{embed.description}</div>
        )}
      </div>
      {embed.image && (
        <img src={getFullUrl(embed.image)} alt="embed" className="msg-embed-thumbnail" onLoad={onImageLoad} />
      )}
    </div>
  );
};

const formatAudioTime = (secs: number) => {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const AudioAttachment = ({ url, filename, onLoad }: { url: string, filename: string, onLoad?: () => void }) => {
  const fullUrl = getFullUrl(url);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => { setDuration(audio.duration || 0); onLoad?.(); };
    const handleEnded = () => { setPlaying(false); setCurrentTime(0); };
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause(); else audio.play();
    setPlaying(!playing);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
    setCurrentTime(audio.currentTime);
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="msg-attachment audio-attachment" style={{
      marginTop: '8px',
      padding: '12px',
      backgroundColor: 'var(--bg-panel)',
      borderRadius: '8px',
      border: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      maxWidth: '400px'
    }}>
      <audio ref={audioRef} src={fullUrl} preload="metadata" style={{ display: 'none' }} />
      <button
        type="button"
        onClick={togglePlay}
        title={playing ? 'Pause' : 'Play'}
        style={{
          flexShrink: 0,
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: 'none',
          backgroundColor: 'var(--brand-primary)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer'
        }}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: '2px' }} />}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: '4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filename}>{filename}</span>
        <div
          onClick={handleSeek}
          style={{ position: 'relative', height: '6px', borderRadius: '3px', backgroundColor: 'var(--bg-dark)', cursor: 'pointer' }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${progress}%`, borderRadius: '3px', backgroundColor: 'var(--brand-primary)' }} />
        </div>
      </div>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>{formatAudioTime(currentTime)} / {formatAudioTime(duration)}</span>
      <a href={fullUrl} download={filename} target="_blank" rel="noopener noreferrer" className="icon-btn" style={{ padding: '4px', flexShrink: 0 }} title="Download">
        <Download size={16} />
      </a>
    </div>
  );
};

const MessageAttachment = ({ url, onLoad }: { url: string, onLoad?: () => void }) => {
  const fullUrl = getFullUrl(url);
  const parts = url.split('/');
  let filename = parts[parts.length - 1];
  const underscoreIndex = filename.indexOf('_');
  if (underscoreIndex !== -1 && underscoreIndex === 32) {
    filename = filename.substring(underscoreIndex + 1);
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isVideo = ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext);
  const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'opus'].includes(ext);

  if (isAudio) {
    return <AudioAttachment url={url} filename={filename} onLoad={onLoad} />;
  }

  if (isImage) {
    return (
      <div className="msg-attachment" style={{marginTop: '8px'}}>
        <img src={fullUrl} alt="attachment" style={{maxWidth: '400px', maxHeight: '300px', borderRadius: '8px'}} onLoad={onLoad} />
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="msg-attachment" style={{marginTop: '8px'}}>
        <video src={fullUrl} controls style={{maxWidth: '400px', maxHeight: '300px', borderRadius: '8px'}} onLoadedData={onLoad} />
      </div>
    );
  }

  return (
    <div className="msg-attachment file-attachment" style={{
      marginTop: '8px', 
      padding: '12px', 
      backgroundColor: 'var(--bg-panel)', 
      borderRadius: '8px', 
      border: '1px solid var(--border-subtle)', 
      display: 'inline-flex', 
      alignItems: 'center', 
      gap: '12px',
      maxWidth: '400px'
    }}>
      <div style={{height: '40px', width: '40px', backgroundColor: 'var(--bg-dark)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
        <FileIcon size={20} />
      </div>
      <div style={{display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, overflow: 'hidden'}}>
        <span style={{fontSize: '14px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={filename}>{filename}</span>
        <span style={{fontSize: '12px', color: 'var(--text-muted)'}}>Attachment</span>
      </div>
      <a href={fullUrl} download={filename} target="_blank" rel="noopener noreferrer" className="icon-btn" style={{padding: '8px'}} title="Download">
        <Download size={18} />
      </a>
    </div>
  );
};

const DEFAULT_EMOJIS = ["💀", "😭", "❤️", "👍", "👎", "👆"];

function App() {
  const [token] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(null);
  
  // App State
  const [servers, setServers] = useState<any[]>([]);
  const [activeServer, setActiveServer] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<number, boolean>>({});
  const [activeChannel, setActiveChannel] = useState<any>(null);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [channelSettingsTarget, setChannelSettingsTarget] = useState<any>(null);
  const [channelSettingsName, setChannelSettingsName] = useState('');
  const [channelSettingsCategoryId, setChannelSettingsCategoryId] = useState<number | 0>(0);
  const [channelSettingsViewRoles, setChannelSettingsViewRoles] = useState<string[]>(['default', 'mod', 'admin']);
  const [channelSettingsSendRoles, setChannelSettingsSendRoles] = useState<string[]>(['default', 'mod', 'admin']);
  const [isSavingChannelSettings, setIsSavingChannelSettings] = useState(false);
  const [newChannelCategoryId, setNewChannelCategoryId] = useState<number | 0>(0);
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [pinnedServerId, setPinnedServerId] = useState<number | null>(() => loadPinnedServerId());
  const [serverContextMenu, setServerContextMenu] = useState<{ x: number; y: number; server: any } | null>(null);
  const [dragServerId, setDragServerId] = useState<number | null>(null);
  const [dragOverServerId, setDragOverServerId] = useState<number | null>(null);
  const serverDragMovedRef = useRef(false);
  const hasAppliedStartupNavRef = useRef(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' ? 'light' : 'dark';
  });
  
  // DM State
  const [dms, setDms] = useState<any[]>([]);
  const [isViewingDMs, setIsViewingDMs] = useState(true);
  const isViewingDMsRef = useRef(true);
  useEffect(() => {
    isViewingDMsRef.current = isViewingDMs;
  }, [isViewingDMs]);
  
  // Loading States
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [isCreatingServer, setIsCreatingServer] = useState(false);
  const [isJoiningServer, setIsJoiningServer] = useState<number | null>(null);

  // Realtime State
  const [ws, setWs] = useState<WebSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const selectChannelGenRef = useRef(0);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [unreadStates, setUnreadStates] = useState<Record<number, { server_id: number | null, last_read_message_id: number, last_message_id: number, mentions_count: number, has_unread?: boolean }>>({});
  const activeChannelRef = useRef<any>(null);
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);
  const dmsRef = useRef<any[]>([]);
  const serversRef = useRef<any[]>([]);
  const selectChannelRef = useRef<any>(null);
  const navigateToChannelRef = useRef<any>(null);

  useEffect(() => { dmsRef.current = dms; }, [dms]);
  useEffect(() => { serversRef.current = servers; }, [servers]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | null>(null);
  const [showFullEmojiPicker, setShowFullEmojiPicker] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);

  const onDrop = React.useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setAttachmentFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true
  });

  useEffect(() => {
    if (attachmentFile) {
      const url = URL.createObjectURL(attachmentFile);
      setAttachmentPreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAttachmentPreview(null);
    }
  }, [attachmentFile]);

  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const isSendingRef = useRef(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<number, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<any>(null);
  
  // Modals
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [publicServers, setPublicServers] = useState<any[]>([]);
  const [isLoadingDiscover, setIsLoadingDiscover] = useState(false);
  
  const [showSettings, setShowSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsUsername, setSettingsUsername] = useState('');
  const [settingsDisplayName, setSettingsDisplayName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsDiscordId, setSettingsDiscordId] = useState('');
  const [settingsProfilePic, setSettingsProfilePic] = useState('');
  const [settingsBanner, setSettingsBanner] = useState('');
  const [settingsProfilePicFile, setSettingsProfilePicFile] = useState<File | null>(null);
  const [settingsBannerFile, setSettingsBannerFile] = useState<File | null>(null);

  const [cropRequest, setCropRequest] = useState<{ target: CropTarget; imageSrc: string } | null>(null);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminSearchUser, setAdminSearchUser] = useState('');
  const [adminUserResult, setAdminUserResult] = useState<any>(null);
  const [adminUserServers, setAdminUserServers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

  const [showServerSettings, setShowServerSettings] = useState(false);
  const [isSavingServer, setIsSavingServer] = useState(false);
  const [serverName, setServerName] = useState('');
  const [serverRolesSettings, setServerRolesSettings] = useState<Record<string, any>>({});
  const [serverDescription, setServerDescription] = useState('');
  const [serverImage, setServerImage] = useState('');
  const [serverBanner, setServerBanner] = useState('');
  const [serverImageFile, setServerImageFile] = useState<File | null>(null);
  const [serverBannerFile, setServerBannerFile] = useState<File | null>(null);
  const [isDeletingServer, setIsDeletingServer] = useState(false);
  const [isLeavingServer, setIsLeavingServer] = useState(false);
  const [serverEmojis, setServerEmojis] = useState<ServerEmoji[]>([]);
  const [newEmojiName, setNewEmojiName] = useState('');
  const [newEmojiFile, setNewEmojiFile] = useState<File | null>(null);
  const [newEmojiPreview, setNewEmojiPreview] = useState('');
  const [isUploadingEmoji, setIsUploadingEmoji] = useState(false);
  const [emojiSettingsError, setEmojiSettingsError] = useState('');
  const [showEmojiSuggestions, setShowEmojiSuggestions] = useState(false);
  const [emojiFilter, setEmojiFilter] = useState('');
  const [emojiTriggerIndex, setEmojiTriggerIndex] = useState(-1);

  // Invite code joining
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [isJoiningByInvite, setIsJoiningByInvite] = useState(false);
  const [joinInviteError, setJoinInviteError] = useState('');
  
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);

  // Forced Username Change
  const [forcedNewUsername, setForcedNewUsername] = useState('');
  const [isChangingForcedUsername, setIsChangingForcedUsername] = useState(false);
  const [forcedUsernameError, setForcedUsernameError] = useState('');
  
  // Pending invite from URL
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  const [showInvitePreview, setShowInvitePreview] = useState(false);
  const [invitePreviewData, setInvitePreviewData] = useState<any>(null);
  const [invitePreviewError, setInvitePreviewError] = useState('');
  const [isJoiningPreview, setIsJoiningPreview] = useState(false);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleAtLocal, setScheduleAtLocal] = useState('');
  const [scheduledMessages, setScheduledMessages] = useState<any[]>([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSuccess, setScheduleSuccess] = useState('');

  const [showInviteManager, setShowInviteManager] = useState(false);
  const [serverInvites, setServerInvites] = useState<any[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [inviteCreateError, setInviteCreateError] = useState('');
  const [inviteCopiedId, setInviteCopiedId] = useState<number | null>(null);
  const [inviteMaxUses, setInviteMaxUses] = useState<string>('unlimited');
  const [inviteExpires, setInviteExpires] = useState<string>('never');
  const [inviteTemporary, setInviteTemporary] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/invite/')) {
      const code = path.substring(8);
      if (code) {
        setPendingInviteCode(code);
        window.history.replaceState(null, '', '/');
        
        fetch(`${API_BASE}/servers/invite/${code}/preview`)
          .then(res => res.json().then(data => ({ status: res.status, data })))
          .then(({ status, data }) => {
            if (status === 200) {
              setInvitePreviewData(data);
              setShowInvitePreview(true);
            } else {
              setInvitePreviewError(data.detail || "Invalid invite link");
              setShowInvitePreview(true);
            }
          })
          .catch(() => {
            setInvitePreviewError("Network error fetching invite");
            setShowInvitePreview(true);
          });
      }
    }
  }, []);

  useEffect(() => {
    if (token && pendingInviteCode && !showInvitePreview) {
      // If they log in and have a pending invite, show the preview if not already shown
      setShowInvitePreview(true);
    }
  }, [token, pendingInviteCode, showInvitePreview]);
  
  // Member List & Presence
  const [showMemberList, setShowMemberList] = useState(true);
  const [serverMembers, setServerMembers] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Record<number, boolean>>({});
  const isUserOnline = (userId: number | undefined, username: string | undefined) => {
    if (username?.toLowerCase() === 'system') return true;
    return userId ? !!onlineUsers[userId] : false;
  };
  const [selectedProfile, setSelectedProfile] = useState<{user: any, rect: DOMRect} | null>(null);
  
  // Lanyard Presence
  const [lanyardData, setLanyardData] = useState<Record<string, any>>({});
  const lanyardWsRef = useRef<WebSocket | null>(null);
  const lanyardHeartbeatIntervalRef = useRef<number | null>(null);
  const lanyardTargetIdsRef = useRef<string[]>([]);
  const [lanyardNotInServer, setLanyardNotInServer] = useState(false);

  useEffect(() => {
    if (user?.discord_id) {
      fetch(`https://api.lanyard.rest/v1/users/${user.discord_id}`)
        .then(res => res.json())
        .then(data => {
          if (!data.success && data.error?.code === 'user_not_monitored') {
            setLanyardNotInServer(true);
          } else {
            setLanyardNotInServer(false);
          }
        })
        .catch(() => {});
    } else {
      setLanyardNotInServer(false);
    }
  }, [user?.discord_id]);

  const renderLanyardPresenceInProfile = (u: any) => {
    if (!u?.discord_id) return null;
    
    // Show prompt if it's the current user and they aren't in the server
    if (user && u.user_id === user.user_id && lanyardNotInServer) {
      return (
        <div className="lanyard-profile-card error">
          <div className="desc-title">DISCORD PRESENCE ERROR</div>
          <p style={{fontSize: '0.85rem', color: '#e5e7eb'}}>To show your Discord presence, join the <a href="https://discord.gg/UrXF2cfJ7F" target="_blank" rel="noreferrer" style={{color: 'var(--brand-primary)'}}>Lanyard Discord</a>.</p>
        </div>
      );
    }

    const presence = lanyardData[u.discord_id];
    if (!presence) return null;
    
    const activities = presence.activities || [];
    const customStatus = activities.find((a: any) => a.type === 4);
    const otherActivities = activities.filter((a: any) => a.type !== 4);

    if (!customStatus && otherActivities.length === 0) return null;

    return (
      <div className="lanyard-profile-cards">
        {customStatus && (
          <div className="lanyard-custom-status">
            {customStatus.emoji?.id ? (
              <img src={`https://cdn.discordapp.com/emojis/${customStatus.emoji.id}.webp`} alt="emoji" className="lanyard-emoji" />
            ) : customStatus.emoji?.name ? (
              <span className="lanyard-emoji">{customStatus.emoji.name}</span>
            ) : null}
            <span>{customStatus.state ? `"${customStatus.state}"` : ''}</span>
          </div>
        )}
        {otherActivities.map((activity: any, idx: number) => {
          let imageUrl = '';
          if (activity.assets?.large_image) {
            if (activity.assets.large_image.startsWith('mp:external')) {
              imageUrl = activity.assets.large_image.replace('mp:external/', 'https://media.discordapp.net/external/');
            } else {
              imageUrl = `https://cdn.discordapp.com/app-assets/${activity.application_id}/${activity.assets.large_image}.png`;
            }
          } else if (activity.name === 'Spotify' && presence.spotify) {
            imageUrl = presence.spotify.album_art_url;
          }
          
          return (
            <div key={idx} className="lanyard-profile-card activity">
              <div className="desc-title" style={{marginBottom: '8px'}}>{activity.type === 2 ? 'LISTENING TO' : 'PLAYING A GAME'}</div>
              <div className="lanyard-activity-body">
                {imageUrl && <img src={imageUrl} alt="Asset" className="lanyard-activity-img" />}
                <div className="lanyard-activity-info">
                  <div className="lanyard-activity-name">{activity.name}</div>
                  {activity.details && <div className="lanyard-activity-details">{activity.details}</div>}
                  {activity.state && <div className="lanyard-activity-state">{activity.state}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLanyardStatusInList = (u: any) => {
    if (!u?.discord_id) return null;
    const presence = lanyardData[u.discord_id];
    if (!presence) return null;
    
    const gameStatus = presence.activities?.find((a: any) => a.type !== 4);
    const customStatus = presence.activities?.find((a: any) => a.type === 4);
    
    if (gameStatus) {
      return <div className="lanyard-list-status">Playing <strong>{gameStatus.name}</strong></div>;
    }
    if (customStatus) {
      return <div className="lanyard-list-status">{customStatus.emoji?.name} {customStatus.state ? `"${customStatus.state}"` : ''}</div>;
    }
    return null;
  };

  const [contextMenu, setContextMenu] = useState<{x: number, y: number, user: any, serverRole?: string} | null>(null);
  const [revealedMessages, setRevealedMessages] = useState<Record<number, any>>({});
  const [msgContextMenu, setMsgContextMenu] = useState<{x: number, y: number, message: any} | null>(null);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);

  useEffect(() => {
    // Collect all discord IDs from server members, DMs, and current user
    const discordIds = new Set<string>();
    if (user?.discord_id) discordIds.add(user.discord_id);
    serverMembers.forEach(m => {
      if (m.discord_id) discordIds.add(m.discord_id);
    });
    channels.filter(c => c.channel_type === 'DM').forEach(c => {
      if (c.target_user?.discord_id) discordIds.add(c.target_user.discord_id);
    });

    const targetIds = Array.from(discordIds);
    lanyardTargetIdsRef.current = targetIds;
    
    if (targetIds.length === 0) {
      if (lanyardWsRef.current) {
        lanyardWsRef.current.close();
        lanyardWsRef.current = null;
      }
      return;
    }

    if (!lanyardWsRef.current || lanyardWsRef.current.readyState === WebSocket.CLOSED) {
      const ws = new WebSocket('wss://api.lanyard.rest/socket');
      lanyardWsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ op: 2, d: { subscribe_to_ids: lanyardTargetIdsRef.current } }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.op === 1) { // Hello
            const interval = data.d.heartbeat_interval;
            if (lanyardHeartbeatIntervalRef.current) clearInterval(lanyardHeartbeatIntervalRef.current);
            lanyardHeartbeatIntervalRef.current = window.setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: 3 }));
              }
            }, interval);
          } else if (data.op === 0) {
            if (data.t === 'INIT_STATE') {
              setLanyardData(data.d);
            } else if (data.t === 'PRESENCE_UPDATE') {
              setLanyardData(prev => ({ ...prev, [data.d.discord_user.id]: data.d }));
            }
          }
        } catch (e) {
          console.error("Lanyard error:", e);
        }
      };

      ws.onclose = () => {
        if (lanyardHeartbeatIntervalRef.current) clearInterval(lanyardHeartbeatIntervalRef.current);
        lanyardWsRef.current = null;
      };
    } else if (lanyardWsRef.current.readyState === WebSocket.OPEN) {
      // Re-subscribe if the connection is already open but we have new IDs
      lanyardWsRef.current.send(JSON.stringify({ op: 2, d: { subscribe_to_ids: targetIds } }));
    }

    return () => {
      // Cleanup happens when component unmounts, not on every re-render, to avoid flapping the socket
    };
  }, [user?.discord_id, serverMembers, channels]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) {
        setShowMemberList(false);
        setMobileMembersOpen(false);
        setMobileNavOpen((prev) => prev || !activeChannelRef.current);
      } else {
        setShowMemberList(true);
        setMobileNavOpen(false);
        setMobileMembersOpen(false);
      }
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const currentUserRef = useRef<any>(null);
  useEffect(() => {
    currentUserRef.current = user;
  }, [user]);

  // Auth Forms
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (token) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      fetchMe();
      fetchMyServers();
      fetchDMs();
      fetchUnreads();
    }
  }, [token]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  const fetchMe = async () => {
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setUser(await res.json());
      } else {
        logout();
      }
    } catch { logout(); }
  };

  const fetchMyServers = async () => {
    setIsLoadingServers(true);
    try {
      const res = await fetch(`${API_BASE}/servers/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const ordered = applyServerListOrder(data);
        setServers(ordered);
        if (!hasAppliedStartupNavRef.current && ordered.length > 0) {
          hasAppliedStartupNavRef.current = true;
          const home = resolvePinnedServer(ordered, pinnedServerId);
          if (home) selectServer(home);
        }
      }
    } finally {
      setIsLoadingServers(false);
    }
  };

  const getEffectivePinnedServerId = (list: any[] = servers): number | null => {
    const preferred = resolvePinnedServer(list, pinnedServerId);
    return preferred?.server_id ?? null;
  };

  const pinServer = (server: any) => {
    setPinnedServerId(server.server_id);
    savePinnedServerId(server.server_id);
    setServerContextMenu(null);
  };

  const unpinServer = () => {
    setPinnedServerId(null);
    savePinnedServerId(null);
    setServerContextMenu(null);
  };

  const reorderServers = (fromId: number, toId: number) => {
    if (fromId === toId) return;
    setServers((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((s) => s.server_id === fromId);
      const toIdx = next.findIndex((s) => s.server_id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      saveServerOrder(next.map((s) => s.server_id));
      return next;
    });
  };


  const fetchUnreads = async () => {
    try {
      const res = await fetch(`${API_BASE}/users/me/unreads`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setUnreadStates(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch unreads", e);
    }
  };
  const fetchDMs = async () => {
    try {
      const res = await fetch(`${API_BASE}/dms`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setDms(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch DMs", e);
    }
  };

  const fetchServerMembersAndPresence = async (serverId: number) => {
    try {
      const [membersRes, presenceRes] = await Promise.all([
        fetch(`${API_BASE}/servers/${serverId}/members`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/servers/${serverId}/presence`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (membersRes.ok && presenceRes.ok) {
        setServerMembers(await membersRes.json());
        const onlineIds = await presenceRes.json();
        const presenceMap: Record<number, boolean> = {};
        onlineIds.forEach((id: number) => { presenceMap[id] = true; });
        setOnlineUsers(presenceMap);
      }
    } catch (e) {
      console.error("Failed to fetch members or presence", e);
    }
  };

  const loadServerChannelsAndCategories = async (serverId: number) => {
    const [chanRes, catRes] = await Promise.all([
      fetch(`${API_BASE}/servers/${serverId}/channels`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_BASE}/servers/${serverId}/categories`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    let chanList: any[] = [];
    if (chanRes.ok) {
      chanList = await chanRes.json();
      setChannels(chanList);
    }
    if (catRes.ok) {
      setCategories(await catRes.json());
    } else {
      setCategories([]);
    }
    return chanList;
  };

  const loadServerEmojis = async (serverId: number) => {
    try {
      const res = await fetch(`${API_BASE}/servers/${serverId}/emojis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setServerEmojis(await res.json());
      } else {
        setServerEmojis([]);
      }
    } catch (e) {
      console.error('Failed to load server emojis', e);
      setServerEmojis([]);
    }
  };

  const navigateToChannel = async (serverId: number | null | undefined, channelId: number) => {
    if (serverId === null || serverId === undefined) {
      setIsViewingDMs(true);
      setActiveServer(null);
      const dm = dmsRef.current.find(d => d.channel_id === channelId);
      if (dm) {
        selectChannelRef.current?.(dm);
      } else {
        try {
          const res = await fetch(`${API_BASE}/dms`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const fetchedDMs = await res.json();
            setDms(fetchedDMs);
            const foundDm = fetchedDMs.find((d: any) => d.channel_id === channelId);
            if (foundDm) selectChannelRef.current?.(foundDm);
          }
        } catch(e) {
          console.error(e);
        }
      }
    } else {
      const server = serversRef.current.find(s => s.server_id === serverId);
      if (server) {
        setIsViewingDMs(false);
        setActiveServer(server);
        fetchServerMembersAndPresence(serverId);
        loadServerEmojis(serverId);
        setIsLoadingChannels(true);
        try {
          const chanList = await loadServerChannelsAndCategories(serverId);
          const targetChan = chanList.find((c: any) => c.channel_id === channelId);
          if (targetChan) {
            selectChannelRef.current?.(targetChan);
          }
        } finally {
          setIsLoadingChannels(false);
        }
      }
    }
  };

  const closeSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWs(null);
  };

  const selectServer = async (server: any) => {
    setIsViewingDMs(false);
    setActiveServer(server);
    setActiveChannel(null);
    setMessages([]);
    setCategories([]);
    setServerEmojis([]);
    if (ws) { ws.close(); setWs(null); }
    if (isMobile) setMobileNavOpen(true);
    setMobileMembersOpen(false);
    
    fetchServerMembersAndPresence(server.server_id);
    loadServerEmojis(server.server_id);
    
    setIsLoadingChannels(true);
    try {
      const data = await loadServerChannelsAndCategories(server.server_id);
      if (data.length > 0) {
        selectChannel(data[0]);
      }
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const startDM = async (targetUserId: number) => {
    setSelectedProfile(null);
    setMobileMembersOpen(false);
    try {
      const res = await fetch(`${API_BASE}/dms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ target_user_id: targetUserId })
      });
      if (res.ok) {
        const dm = await res.json();
        setDms(prev => {
          if (!prev.find(d => d.channel_id === dm.channel_id)) {
            return [...prev, dm];
          }
          return prev;
        });
        setIsViewingDMs(true);
        setActiveServer(null);
        selectChannel(dm);
        setSelectedProfile(null);
      }
    } catch (e) {
      console.error("Failed to start DM", e);
    }
  };

  const selectChannel = async (channel: any) => {
    setActiveChannel(channel);
    setMobileNavOpen(false);
    setMobileMembersOpen(false);
    setActiveMessageId(null);

    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setWs(null);

    const connectGen = ++selectChannelGenRef.current;
    
    let lastMsgId = 0;
    const res = await fetch(`${API_BASE}/channels/${channel.channel_id}/messages?limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (connectGen !== selectChannelGenRef.current) return;

    if (res.ok) {
      const msgs = await res.json();
      if (connectGen !== selectChannelGenRef.current) return;
      setMessages(msgs);
      if (msgs.length > 0) {
        lastMsgId = msgs[msgs.length - 1].message_id;
        setUnreadStates(prev => ({
           ...prev,
           [channel.channel_id]: {
             ...(prev[channel.channel_id] || { server_id: channel.server_id || null, mentions_count: 0 }),
             last_read_message_id: Math.max(prev[channel.channel_id]?.last_read_message_id || 0, lastMsgId),
             has_unread: false,
             mentions_count: 0
           }
        }));
      }
    }

    if (connectGen !== selectChannelGenRef.current) return;

    const wsUrl = API_BASE.replace(/^http/, 'ws') + `/ws/${channel.channel_id}?token=${token}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;
    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      if (lastMsgId > 0) {
        socket.send(JSON.stringify({ type: 'read_update', message_id: lastMsgId }));
      }
    };
    socket.onmessage = (event) => {
      if (wsRef.current !== socket) return;
      const data = JSON.parse(event.data);
      if (data.type === 'typing') {
        if (data.user_id !== currentUserRef.current?.user_id) {
          setTypingUsers(prev => ({ ...prev, [data.user_id]: data.display_name || data.username }));
          setTimeout(() => {
            setTypingUsers(prev => {
              const next = { ...prev };
              delete next[data.user_id];
              return next;
            });
          }, 3000);
        }
      } else if (data.type === 'presence') {
        setOnlineUsers(prev => ({
          ...prev,
          [data.user_id]: data.status === 'online'
        }));
      } else if (data.type === 'error') {
        alert(data.message);
      } else if (data.type === 'mute_update') {
        if (currentUserRef.current) {
          setUser({ ...currentUserRef.current, muted_until: data.muted_until });
        }
      } else if (data.type === 'ban_update') {
        if (currentUserRef.current) {
          setUser({ ...currentUserRef.current, status: data.status });
        }
      } else if (data.type === 'unread_notification') {
        if (!data.server_id) {
          if (!dmsRef.current.some(d => d.channel_id === data.channel_id)) {
            fetch(`${API_BASE}/dms`, { headers: { Authorization: `Bearer ${token}` } })
              .then(res => res.json())
              .then(fetched => setDms(fetched))
              .catch(e => console.error(e));
          }
        }
        setUnreadStates(prev => {
          const next = { ...prev };
          const chanId = data.channel_id;
          if (!next[chanId]) next[chanId] = { server_id: data.server_id || null, last_read_message_id: 0, last_message_id: 0, mentions_count: 0 };
          
          next[chanId].last_message_id = data.message_id;
          next[chanId].has_unread = true;
          
          const amIMentioned = currentUserRef.current && data.mentions && data.mentions.includes(currentUserRef.current.user_id);
          const isDM = !data.server_id;
          const isFromSomeoneElse = data.author_id !== currentUserRef.current?.user_id;
          const shouldPing = (amIMentioned || (isDM && isFromSomeoneElse));
          
          if (shouldPing) {
            next[chanId].mentions_count += 1;
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
              const notification = new Notification(`New Message from ${data.author?.display_name || data.author?.username}`, {
                body: data.content.text
              });
              notification.onclick = () => {
                window.focus();
                navigateToChannelRef.current?.(data.server_id, data.channel_id);
              };
            }
          }
          return next;
        });
      } else if (data.type === 'message_update') {
        if (data.channel_id === activeChannelRef.current?.channel_id) {
          setMessages(prev => prev.map(msg => msg.message_id === data.message_id ? data : msg));
        }
      } else {
        if (!data.server_id && !dmsRef.current.some(d => d.channel_id === data.channel_id)) {
          fetch(`${API_BASE}/dms`, { headers: { Authorization: `Bearer ${token}` } })
            .then(res => res.json())
            .then(fetched => setDms(fetched))
            .catch(e => console.error(e));
        }

        if (data.channel_id === activeChannelRef.current?.channel_id) {
          setMessages(prev =>
            prev.some(msg => msg.message_id === data.message_id) ? prev : [...prev, data]
          );
        }

        const amIMentioned = currentUserRef.current && data.mentions && data.mentions.includes(currentUserRef.current.user_id);
        const isDM = !data.server_id;
        const isFromSomeoneElse = data.author_id !== currentUserRef.current?.user_id;
        const shouldPing = (amIMentioned || (isDM && isFromSomeoneElse));
        const isChannelInactive = activeChannelRef.current?.channel_id !== data.channel_id;

        if (isChannelInactive && shouldPing) {
          playPingSound();
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
            const notification = new Notification(`New Message from ${data.author?.display_name || data.author?.username}`, {
              body: data.content.text
            });
            notification.onclick = () => {
              window.focus();
              navigateToChannelRef.current?.(data.server_id, data.channel_id);
            };
          }
        }

        setUnreadStates(prev => {
          const next = { ...prev };
          const chanId = data.channel_id;
          if (!next[chanId]) next[chanId] = { server_id: data.server_id || null, last_read_message_id: 0, last_message_id: 0, mentions_count: 0 };
          
          next[chanId].last_message_id = data.message_id;
          next[chanId].has_unread = true;
          
          const amIMentioned = currentUserRef.current && data.mentions && data.mentions.includes(currentUserRef.current.user_id);
          const isDM = !data.server_id;
          const isFromSomeoneElse = data.author_id !== currentUserRef.current?.user_id;
          const shouldPing = (amIMentioned || (isDM && isFromSomeoneElse));
          
          if (activeChannelRef.current?.channel_id !== chanId) {
            if (shouldPing) {
              next[chanId].mentions_count += 1;
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
                const notification = new Notification(`New Message from ${data.author?.display_name || data.author?.username}`, {
                  body: data.content.text
                });
                notification.onclick = () => {
                  window.focus();
                  navigateToChannelRef.current?.(data.server_id, data.channel_id);
                };
              }
            }
          } else {
            if (socket.readyState === WebSocket.OPEN) {
               socket.send(JSON.stringify({ type: 'read_update', message_id: data.message_id }));
            }
            next[chanId].last_read_message_id = data.message_id;
            next[chanId].mentions_count = 0;
          }
          return next;
        });
      }
    };
    socket.onclose = () => {
      // If the websocket closes, we should nullify it so the UI knows it's disconnected
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      setWs(prev => prev === socket ? null : prev);
    };
    if (connectGen !== selectChannelGenRef.current) {
      socket.close();
      return;
    }
    setWs(socket);
  };

  selectChannelRef.current = selectChannel;
  navigateToChannelRef.current = navigateToChannel;


  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoadingAuth(true);
    
    if (!isLogin) {
      if (password.length < 8) {
        setAuthError('Password must be at least 8 characters long.');
        setIsLoadingAuth(false);
        return;
      }
      if (!(/[a-zA-Z]/.test(password) && /[0-9]/.test(password))) {
        setAuthError('Password must contain both letters and numbers.');
        setIsLoadingAuth(false);
        return;
      }
    }

    try {
      if (isLogin) {
        const res = await fetch(`${API_BASE}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('token', data.access_token);
          window.location.reload();
        } else throw new Error(data.detail);
      } else {
        const res = await fetch(`${API_BASE}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (res.ok) {
          window.location.reload();
        } else {
          const data = await res.json();
          throw new Error(data.detail);
        }
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    if (ws) ws.close();
    window.location.reload();
  };

  const uploadAttachmentIfNeeded = async (fileToSend: File | null): Promise<string> => {
    if (!fileToSend) return '';
    const formData = new FormData();
    formData.append('file', fileToSend);
    formData.append('upload_type', 'attachments');
    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        return data.url || '';
      }
    } catch (err) {
      console.error('Upload failed', err);
    }
    return '';
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (isSendingRef.current) return;
    if (activeChannel && activeChannel.can_send === false) return;

    const textToSend = chatInput;
    const fileToSend = attachmentFile;
    const parentId = replyingTo?.message_id || 0;
    const socket = wsRef.current || ws;

    if ((!textToSend.trim() && !fileToSend) || !socket || socket.readyState !== WebSocket.OPEN) return;

    isSendingRef.current = true;
    setIsSendingMessage(true);
    setChatInput('');
    setAttachmentFile(null);
    setReplyingTo(null);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.style.height = 'auto';
    }

    try {
      const attachedUrl = await uploadAttachmentIfNeeded(fileToSend);
      const attachments = attachedUrl ? [attachedUrl] : [];

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          content: { text: textToSend, attachments: attachments, embeds: [] },
          message_type: "DEFAULT",
          parent_id: parentId,
          mentions: [],
          flags: [],
          reactions: []
        }));
      }
    } finally {
      window.setTimeout(() => {
        isSendingRef.current = false;
        setIsSendingMessage(false);
      }, 400);
    }
  };

  const toDatetimeLocalValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const openScheduleModal = async () => {
    if (!activeChannel || !canTypeInChannel) return;
    if (!chatInput.trim() && !attachmentFile) {
      setScheduleError('Type a message (or attach a file) before scheduling.');
      setShowScheduleModal(true);
      setScheduleSuccess('');
      setScheduleAtLocal(toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)));
      return;
    }
    setScheduleError('');
    setScheduleSuccess('');
    setScheduleAtLocal(toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)));
    setShowScheduleModal(true);
    if (token && activeChannel) {
      try {
        const res = await fetch(`${API_BASE}/channels/${activeChannel.channel_id}/scheduled-messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setScheduledMessages(await res.json());
      } catch {
        /* ignore */
      }
    }
  };

  const refreshScheduledMessages = async () => {
    if (!token || !activeChannel) return;
    try {
      const res = await fetch(`${API_BASE}/channels/${activeChannel.channel_id}/scheduled-messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setScheduledMessages(await res.json());
    } catch {
      /* ignore */
    }
  };

  const submitScheduledMessage = async () => {
    if (!activeChannel || !token) return;
    if (!chatInput.trim() && !attachmentFile) {
      setScheduleError('Type a message or attach a file first.');
      return;
    }
    if (!scheduleAtLocal) {
      setScheduleError('Pick a date and time.');
      return;
    }
    const scheduledAt = Math.floor(new Date(scheduleAtLocal).getTime() / 1000);
    if (!Number.isFinite(scheduledAt)) {
      setScheduleError('Invalid date/time.');
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (scheduledAt < nowSec + 30) {
      setScheduleError('Schedule at least 30 seconds in the future.');
      return;
    }

    setIsScheduling(true);
    setScheduleError('');
    setScheduleSuccess('');
    try {
      const attachedUrl = await uploadAttachmentIfNeeded(attachmentFile);
      const attachments = attachedUrl ? [attachedUrl] : [];
      const res = await fetch(`${API_BASE}/channels/${activeChannel.channel_id}/scheduled-messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: { text: chatInput, attachments, embeds: [] },
          scheduled_at: scheduledAt,
          parent_id: replyingTo?.message_id || 0,
          mentions: [],
          flags: [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to schedule message');
      }
      setChatInput('');
      setAttachmentFile(null);
      setAttachmentPreview(null);
      setReplyingTo(null);
      if (inputRef.current) {
        inputRef.current.value = '';
        inputRef.current.style.height = 'auto';
      }
      setScheduleSuccess(`Message scheduled for ${new Date(scheduledAt * 1000).toLocaleString()}`);
      await refreshScheduledMessages();
    } catch (err: any) {
      setScheduleError(err.message || 'Failed to schedule message');
    } finally {
      setIsScheduling(false);
    }
  };

  const cancelScheduledMessage = async (id: number) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/scheduled-messages/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) await refreshScheduledMessages();
    } catch {
      /* ignore */
    }
  };

  const openInviteManager = async () => {
    if (!activeServer || activeServer.invite_code === 'GLOBAL') return;
    setShowInviteManager(true);
    setInviteCreateError('');
    setInviteCopiedId(null);
    setIsLoadingInvites(true);
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/invites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setServerInvites(await res.json());
      else setServerInvites([]);
    } catch {
      setServerInvites([]);
    } finally {
      setIsLoadingInvites(false);
    }
  };

  const createServerInvite = async () => {
    if (!activeServer || !token) return;
    setIsCreatingInvite(true);
    setInviteCreateError('');
    try {
      const maxUses = inviteMaxUses === 'unlimited' ? null : Number(inviteMaxUses);
      const expiresMap: Record<string, number | null> = {
        never: null,
        '30m': 30 * 60,
        '1h': 60 * 60,
        '6h': 6 * 60 * 60,
        '12h': 12 * 60 * 60,
        '1d': 24 * 60 * 60,
        '7d': 7 * 24 * 60 * 60,
      };
      const expires_in_seconds = expiresMap[inviteExpires] ?? null;
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/invites`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max_uses: maxUses,
          expires_in_seconds,
          temporary: inviteTemporary,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create invite');
      }
      const created = await res.json();
      setServerInvites((prev) => [created, ...prev]);
      setInviteMaxUses('unlimited');
      setInviteExpires('never');
      setInviteTemporary(false);
    } catch (err: any) {
      setInviteCreateError(err.message || 'Failed to create invite');
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const revokeServerInvite = async (inviteId: number) => {
    if (!activeServer || !token) return;
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/invites/${inviteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setServerInvites((prev) => prev.filter((i) => i.invite_id !== inviteId));
      }
    } catch {
      /* ignore */
    }
  };

  const copyInviteLink = async (code: string, inviteId?: number) => {
    const link = `${window.location.origin}/invite/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      if (inviteId != null) {
        setInviteCopiedId(inviteId);
        window.setTimeout(() => setInviteCopiedId(null), 2000);
      }
    } catch {
      window.prompt('Copy invite link:', link);
    }
  };

  const formatInviteExpiry = (expiresAt: number | null | undefined) => {
    if (!expiresAt) return 'Never';
    return new Date(expiresAt * 1000).toLocaleString();
  };

  const handleEditMessageSubmit = (messageId: number, originalAttachments: any[]) => {
    if (!editContent.trim() || !ws || ws.readyState !== WebSocket.OPEN) {
      setEditingMessageId(null);
      return;
    }
    ws.send(JSON.stringify({
      type: "message_edit",
      message_id: messageId,
      content: { text: editContent, attachments: originalAttachments || [], embeds: [] }
    }));
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleDeleteMessage = (messageId: number, bypassConfirm: boolean = false) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (bypassConfirm || window.confirm("Are you sure you want to delete this message?")) {
      ws.send(JSON.stringify({
        type: "message_delete",
        message_id: messageId
      }));
    }
  };

  const handleReactionToggle = (messageId: number, emoji: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "reaction_toggle",
      message_id: messageId,
      emoji: emoji
    }));
    setShowEmojiPicker(null);
    setShowFullEmojiPicker(null);
  };

  const handleRevealMessage = async (messageId: number) => {
    try {
      const res = await fetch(`${API_BASE}/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const fullMsg = await res.json();
        setRevealedMessages(prev => ({ ...prev, [messageId]: fullMsg }));
      } else {
        alert("Failed to reveal message. You might not have permission.");
      }
    } catch (e) {
      console.error(e);
    }
    setMsgContextMenu(null);
  };

  const getMentionSuggestions = () => {
    let list: any[] = [];
    if (isViewingDMs) {
      if (user) list.push(user);
      if (activeChannel?.target_user) list.push(activeChannel.target_user);
    } else {
      list = serverMembers;
    }
    
    if (!mentionFilter) return list;
    return list.filter(u => 
      u.username.toLowerCase().includes(mentionFilter.toLowerCase())
    );
  };

  const insertMention = (username: string) => {
    if (mentionTriggerIndex === -1) return;
    const beforeMention = chatInput.slice(0, mentionTriggerIndex);
    const afterMention = chatInput.slice(mentionTriggerIndex + 1 + mentionFilter.length);
    const newText = `${beforeMention}@${username} ${afterMention}`;
    setChatInput(newText);
    setShowMentions(false);
    setMentionTriggerIndex(-1);
    setMentionFilter('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  const getEmojiSuggestions = () => {
    if (!serverEmojis.length) return [];
    const q = emojiFilter.toLowerCase();
    if (!q) return serverEmojis.slice(0, 12);
    return serverEmojis.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 12);
  };

  const insertEmojiShortcode = (name: string) => {
    if (emojiTriggerIndex === -1) return;
    const before = chatInput.slice(0, emojiTriggerIndex);
    const after = chatInput.slice(emojiTriggerIndex + 1 + emojiFilter.length);
    const newText = `${before}:${name}:${after.startsWith(' ') ? after : ` ${after}`}`;
    setChatInput(newText);
    setShowEmojiSuggestions(false);
    setEmojiTriggerIndex(-1);
    setEmojiFilter('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  const startEditingLastOwnMessage = () => {
    if (!user) return false;
    const lastOwn = [...messages].reverse().find(
      (m) => m.author_id === user.user_id && !m.flags?.includes('DELETED')
    );
    if (!lastOwn) return false;
    setEditingMessageId(lastOwn.message_id);
    setEditContent(lastOwn.content?.text || '');
    setTimeout(() => {
      document.getElementById(`message-${lastOwn.message_id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 50);
    return true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions) {
      const suggestions = getMentionSuggestions();
      if (suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          insertMention(suggestions[activeSuggestionIndex].username);
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentions(false);
          return;
        }
      }
    }

    if (showEmojiSuggestions) {
      const suggestions = getEmojiSuggestions();
      if (suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
          return;
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertEmojiShortcode(suggestions[activeSuggestionIndex].name);
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowEmojiSuggestions(false);
          return;
        }
      }
    }

    if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const el = e.currentTarget;
      const caretAtStart = (el.selectionStart ?? 0) === 0 && (el.selectionEnd ?? 0) === 0;
      if (!chatInput.trim() && caretAtStart && !editingMessageId) {
        e.preventDefault();
        startEditingLastOwnMessage();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        sendMessage();
      }
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setChatInput(value);
    
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
    
    if (ws && user) {
      if (!typingTimeoutRef.current) {
        ws.send(JSON.stringify({ type: 'typing', username: user.display_name || user.username }));
      }
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null;
      }, 2000);
    }

    const selectionStart = e.target.selectionStart || 0;
    const textBeforeCursor = value.slice(0, selectionStart);
    const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_]*)$/);
    
    if (mentionMatch) {
      setShowMentions(true);
      setMentionFilter(mentionMatch[1]);
      setMentionTriggerIndex(selectionStart - mentionMatch[0].length);
      setActiveSuggestionIndex(0);
      setShowEmojiSuggestions(false);
    } else {
      setShowMentions(false);
      const emojiMatch = textBeforeCursor.match(/(^|[^a-zA-Z0-9_:/]):([a-zA-Z0-9_]{0,32})$/);
      if (emojiMatch && serverEmojis.length > 0 && !textBeforeCursor.endsWith('://')) {
        setShowEmojiSuggestions(true);
        setEmojiFilter(emojiMatch[2]);
        setEmojiTriggerIndex(selectionStart - emojiMatch[2].length - 1);
        setActiveSuggestionIndex(0);
      } else {
        setShowEmojiSuggestions(false);
      }
    }
  };

  const openDiscover = async () => {
    setShowDiscover(true);
    setIsLoadingDiscover(true);
    try {
      const res = await fetch(`${API_BASE}/servers/discover`);
      if (res.ok) {
        setPublicServers(await res.json());
      }
    } finally {
      setIsLoadingDiscover(false);
    }
  };

  const joinServer = async (invite_code: string, server_id: number) => {
    setIsJoiningServer(server_id);
    try {
      const res = await fetch(`${API_BASE}/servers/join-by-invite/${invite_code}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setShowDiscover(false);
        fetchMyServers();
      }
    } finally {
      setIsJoiningServer(null);
    }
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim() || !activeServer) return;
    setIsCreatingChannel(true);
    try {
      const res = await fetch(`${API_BASE}/channels`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          server_id: activeServer.server_id,
          channel_name: newChannelName.trim(),
          channel_type: 'TEXT',
          category_id: newChannelCategoryId || null,
        })
      });
      if (res.ok) {
        const channel = await res.json();
        setChannels([...channels, channel]);
        setShowCreateChannelModal(false);
        setNewChannelName('');
        setNewChannelCategoryId(0);
        selectChannel(channel);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to create channel.");
      }
    } catch (err) {
      console.error(err);
      alert("Error creating channel");
    } finally {
      setIsCreatingChannel(false);
    }
  };

  const createCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim() || !activeServer) return;
    setIsCreatingCategory(true);
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/categories`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newCategoryName.trim() })
      });
      if (res.ok) {
        const cat = await res.json();
        setCategories(prev => [...prev, cat]);
        setShowCreateCategoryModal(false);
        setNewCategoryName('');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to create category.");
      }
    } catch {
      alert("Error creating category");
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const openChannelSettings = (ch: any) => {
    setChannelSettingsTarget(ch);
    setChannelSettingsName(ch.channel_name || '');
    setChannelSettingsCategoryId(ch.category_id || 0);
    setChannelSettingsViewRoles(ch.view_roles || ['default', 'mod', 'admin']);
    setChannelSettingsSendRoles(ch.send_roles || ['default', 'mod', 'admin']);
    setShowChannelSettings(true);
  };

  const saveChannelSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelSettingsTarget) return;
    setIsSavingChannelSettings(true);
    try {
      const res = await fetch(`${API_BASE}/channels/${channelSettingsTarget.channel_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel_name: channelSettingsName.trim(),
          category_id: channelSettingsCategoryId || 0,
          view_roles: channelSettingsViewRoles,
          send_roles: channelSettingsSendRoles,
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setChannels(prev => prev.map(c => c.channel_id === updated.channel_id ? updated : c));
        if (activeChannel?.channel_id === updated.channel_id) setActiveChannel(updated);
        setShowChannelSettings(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to save channel settings");
      }
    } catch {
      alert("Error saving channel settings");
    } finally {
      setIsSavingChannelSettings(false);
    }
  };

  const deleteChannel = async (channelId: number) => {
    if (!window.confirm("Delete this channel and all its messages?")) return;
    try {
      const res = await fetch(`${API_BASE}/channels/${channelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const next = channels.filter(c => c.channel_id !== channelId);
        setChannels(next);
        if (activeChannel?.channel_id === channelId) {
          if (next.length) selectChannel(next[0]);
          else { setActiveChannel(null); setMessages([]); }
        }
        setShowChannelSettings(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete channel");
      }
    } catch {
      alert("Error deleting channel");
    }
  };

  const deleteCategory = async (categoryId: number) => {
    if (!window.confirm("Delete this category? Channels will become uncategorized.")) return;
    try {
      const res = await fetch(`${API_BASE}/categories/${categoryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setCategories(prev => prev.filter(c => c.category_id !== categoryId));
        setChannels(prev => prev.map(c => c.category_id === categoryId ? { ...c, category_id: null } : c));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete category");
      }
    } catch {
      alert("Error deleting category");
    }
  };

  const setMemberRoles = async (memberId: number, roles: string[]) => {
    if (!activeServer) return;
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/members/${memberId}/role`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ roles })
      });
      if (res.ok) {
        const updated = await res.json();
        setServerMembers(prev => prev.map(m => m.user_id === memberId ? { ...m, server_roles: updated.server_roles } : m));
        await loadServerChannelsAndCategories(activeServer.server_id);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to update role");
      }
    } catch {
      alert("Error updating role");
    }
  };

  const kickMember = async (memberId: number) => {
    if (!activeServer || !window.confirm("Remove this member from the server?")) return;
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/members/${memberId}/kick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setServerMembers(prev => prev.filter(m => m.user_id !== memberId));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to kick member");
      }
    } catch {
      alert("Error kicking member");
    }
  };

  const toggleRoleInList = (list: string[], role: string, setter: (v: string[]) => void) => {
    if (list.includes(role)) {
      const next = list.filter(r => r !== role);
      setter(next.length ? next : list);
    } else {
      setter([...list, role]);
    }
  };

  const createServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingServer(true);
    const formData = new FormData(e.target as HTMLFormElement);
    try {
      const res = await fetch(`${API_BASE}/servers`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          server_name: formData.get('name'),
          server_description: formData.get('desc'),
          server_image: "",
          is_public: formData.get('is_public') === 'on'
        })
      });
      if (res.ok) {
        setShowCreateServer(false);
        fetchMyServers();
      }
    } finally {
      setIsCreatingServer(false);
    }
  };

  const openSettings = () => {
    if (user) {
      if (settingsProfilePic.startsWith('blob:')) URL.revokeObjectURL(settingsProfilePic);
      if (settingsBanner.startsWith('blob:')) URL.revokeObjectURL(settingsBanner);
      setSettingsUsername(user.username);
      setSettingsDisplayName(user.display_name || user.username);
      setSettingsDescription(user.description || '');
      setSettingsDiscordId(user.discord_id || '');
      setSettingsProfilePic(user.profile_picture || '');
      setSettingsBanner(user.banner || '');
      setShowSettings(true);
      if (isMobile) setMobileNavOpen(false);
    }
  };

  const closeSettings = () => {
    if (settingsProfilePic.startsWith('blob:')) URL.revokeObjectURL(settingsProfilePic);
    if (settingsBanner.startsWith('blob:')) URL.revokeObjectURL(settingsBanner);
    setShowSettings(false);
  };

  const openServerSettings = () => {
    if (activeServer) {
      if (serverImage.startsWith('blob:')) URL.revokeObjectURL(serverImage);
      if (serverBanner.startsWith('blob:')) URL.revokeObjectURL(serverBanner);
      if (newEmojiPreview.startsWith('blob:')) URL.revokeObjectURL(newEmojiPreview);
      setServerName(activeServer.server_name);
      setServerDescription(activeServer.server_description || '');
      setServerImage(activeServer.server_image || '');
      const rawRoles = JSON.parse(JSON.stringify(activeServer.roles || {}));
      for (const k in rawRoles) {
        if (!rawRoles[k].id) rawRoles[k].id = k;
      }
      setServerRolesSettings(rawRoles);
      setNewEmojiName('');
      setNewEmojiFile(null);
      setNewEmojiPreview('');
      setEmojiSettingsError('');
      loadServerEmojis(activeServer.server_id);
      setShowServerSettings(true);
      if (isMobile) setMobileNavOpen(false);
    }
  };

  const closeServerSettings = () => {
    if (serverImage.startsWith('blob:')) URL.revokeObjectURL(serverImage);
    if (serverBanner.startsWith('blob:')) URL.revokeObjectURL(serverBanner);
    if (newEmojiPreview.startsWith('blob:')) URL.revokeObjectURL(newEmojiPreview);
    setNewEmojiName('');
    setNewEmojiFile(null);
    setNewEmojiPreview('');
    setEmojiSettingsError('');
    setShowServerSettings(false);
  };

  const handleNewEmojiFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setEmojiSettingsError('Emoji must be an image file (PNG, JPG, GIF, WebP).');
      return;
    }
    if (file.size > 256 * 1024) {
      setEmojiSettingsError('Emoji image must be 256KB or smaller.');
      return;
    }
    if (newEmojiPreview.startsWith('blob:')) URL.revokeObjectURL(newEmojiPreview);
    setNewEmojiFile(file);
    setNewEmojiPreview(URL.createObjectURL(file));
    setEmojiSettingsError('');
  };

  const addServerEmoji = async () => {
    if (!activeServer || !token) return;
    const name = newEmojiName.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(name)) {
      setEmojiSettingsError('Name must be 2–32 characters: letters, numbers, underscores.');
      return;
    }
    if (!newEmojiFile) {
      setEmojiSettingsError('Choose an image for the emoji.');
      return;
    }
    setIsUploadingEmoji(true);
    setEmojiSettingsError('');
    try {
      const formData = new FormData();
      formData.append('file', newEmojiFile);
      formData.append('upload_type', 'emojis');
      const uploadRes = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload emoji image');
      }
      const { url } = await uploadRes.json();
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/emojis`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, image_url: url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create emoji');
      }
      const created: ServerEmoji = await res.json();
      setServerEmojis((prev) =>
        [...prev.filter((e) => e.emoji_id !== created.emoji_id), created].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      if (newEmojiPreview.startsWith('blob:')) URL.revokeObjectURL(newEmojiPreview);
      setNewEmojiName('');
      setNewEmojiFile(null);
      setNewEmojiPreview('');
    } catch (e: any) {
      setEmojiSettingsError(e?.message || 'Failed to add emoji');
    } finally {
      setIsUploadingEmoji(false);
    }
  };

  const deleteServerEmoji = async (emojiId: number) => {
    if (!activeServer || !token) return;
    if (!window.confirm('Delete this custom emoji?')) return;
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/emojis/${emojiId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || 'Failed to delete emoji');
        return;
      }
      setServerEmojis((prev) => prev.filter((e) => e.emoji_id !== emojiId));
    } catch (e) {
      console.error(e);
      alert('Failed to delete emoji');
    }
  };

  const openCropModalForFile = (e: React.ChangeEvent<HTMLInputElement>, target: CropTarget) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    setCropRequest({ target, imageSrc: URL.createObjectURL(file) });
  };

  const handleCropCancel = () => {
    if (cropRequest) URL.revokeObjectURL(cropRequest.imageSrc);
    setCropRequest(null);
  };

  const handleCropSave = (blob: Blob) => {
    if (!cropRequest) return;
    const file = new File([blob], `${cropRequest.target}-${Date.now()}.jpg`, { type: blob.type });
    const previewUrl = URL.createObjectURL(blob);
    if (cropRequest.target === 'userAvatar') {
      if (settingsProfilePic.startsWith('blob:')) URL.revokeObjectURL(settingsProfilePic);
      setSettingsProfilePicFile(file);
      setSettingsProfilePic(previewUrl);
    } else if (cropRequest.target === 'userBanner') {
      if (settingsBanner.startsWith('blob:')) URL.revokeObjectURL(settingsBanner);
      setSettingsBannerFile(file);
      setSettingsBanner(previewUrl);
    } else if (cropRequest.target === 'serverIcon') {
      if (serverImage.startsWith('blob:')) URL.revokeObjectURL(serverImage);
      setServerImageFile(file);
      setServerImage(previewUrl);
    } else {
      if (serverBanner.startsWith('blob:')) URL.revokeObjectURL(serverBanner);
      setServerBannerFile(file);
      setServerBanner(previewUrl);
    }
    URL.revokeObjectURL(cropRequest.imageSrc);
    setCropRequest(null);
  };

  const uploadFileToServer = async (file: File, uploadType: string): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_type", uploadType);
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    if (res.ok) {
      const data = await res.json();
      return data.url;
    }
    throw new Error("Upload failed");
  };

  const doAdminSearch = async (usernameToSearch: string) => {
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const res = await fetch(`${API_BASE}/users/by-username/${usernameToSearch}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('User not found');
      const data = await res.json();
      setAdminUserResult(data);
      
      const srvRes = await fetch(`${API_BASE}/admin/users/${data.user_id}/servers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (srvRes.ok) {
        setAdminUserServers(await srvRes.json());
      } else {
        setAdminUserServers([]);
      }
    } catch (err: any) {
      setAdminMessage(err.message);
      setAdminUserResult(null);
      setAdminUserServers([]);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleAdminSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await doAdminSearch(adminSearchUser);
  };

  const handleForcedUsernameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setForcedUsernameError('');
    if (forcedNewUsername.toLowerCase() === user?.username?.toLowerCase()) {
      setForcedUsernameError("You must choose a DIFFERENT username.");
      return;
    }
    setIsChangingForcedUsername(true);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: forcedNewUsername })
      });
      if (res.ok) {
        const d = await res.json();
        setUser(d);
        setForcedNewUsername('');
      } else {
        const d = await res.json();
        setForcedUsernameError(d.detail || 'Failed to change username');
      }
    } catch (err: any) {
      setForcedUsernameError(err.message);
    } finally {
      setIsChangingForcedUsername(false);
    }
  };

  const handleAdminAction = async (action: string, userId: number, payload?: any) => {
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const res = await fetch(`/admin/${action}/${userId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: payload ? JSON.stringify(payload) : undefined
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Action failed');
      }
      setAdminMessage(`Action ${action} successful`);
      if (adminUserResult && adminUserResult.user_id === userId) {
        const uRes = await fetch(`/users/${userId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (uRes.ok) setAdminUserResult(await uRes.json());
      }
    } catch (err: any) {
      setAdminMessage(err.message);
    } finally {
      setAdminLoading(false);
    }
  };

  const toggleServerVerification = async (serverId: number) => {
    try {
      const res = await fetch(`/admin/flag_server/${serverId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const updatedServer = await res.json();
        setServers(prev => prev.map(s => s.server_id === serverId ? {...s, is_verified: updatedServer.is_verified} : s));
        setPublicServers(prev => prev.map(s => s.server_id === serverId ? {...s, is_verified: updatedServer.is_verified} : s));
        setAdminUserServers(prev => prev.map(s => s.server_id === serverId ? {...s, is_verified: updatedServer.is_verified} : s));
        if (activeServer && activeServer.server_id === serverId) {
          setActiveServer((prev: any) => ({...prev, is_verified: updatedServer.is_verified}));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      let finalProfilePic = settingsProfilePic;
      if (settingsProfilePicFile) {
        finalProfilePic = await uploadFileToServer(settingsProfilePicFile, "avatars");
      }
      let finalBanner = settingsBanner;
      if (settingsBannerFile) {
        finalBanner = await uploadFileToServer(settingsBannerFile, "banners");
      }

      const res = await fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: settingsUsername,
          display_name: settingsDisplayName,
          description: settingsDescription,
          discord_id: settingsDiscordId,
          profile_picture: finalProfilePic,
          banner: finalBanner
        })
      });
      if (res.ok) {
        setShowSettings(false);
        fetchMe();
        if (activeChannel) {
          selectChannel(activeChannel);
        }
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const saveServerSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer) return;
    setIsSavingServer(true);
    try {
      let finalImage = serverImage;
      if (serverImageFile) {
        finalImage = await uploadFileToServer(serverImageFile, "avatars");
      }
      let finalBanner = serverBanner;
      if (serverBannerFile) {
        finalBanner = await uploadFileToServer(serverBannerFile, "banners");
      }

      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          server_name: serverName,
          server_description: serverDescription,
          server_image: finalImage,
          server_banner: finalBanner
        })
      });
      if (res.ok) {
        const rolesRes = await fetch(`${API_BASE}/servers/${activeServer.server_id}/roles`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ roles: serverRolesSettings })
        });
        const updated = await res.json();
        if (rolesRes.ok) {
          const rolesData = await rolesRes.json();
          updated.roles = rolesData.roles;
        }
        setActiveServer(updated);
        setShowServerSettings(false);
        fetchMyServers();
      }
    } finally {
      setIsSavingServer(false);
    }
  };

  const deleteServer = async () => {
    if (!activeServer || !window.confirm("Are you sure you want to delete this server?")) return;
    setIsDeletingServer(true);
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setShowServerSettings(false);
        setActiveServer(null);
        setActiveChannel(null);
        setChannels([]);
        setMessages([]);
        closeSocket();
        fetchMyServers();
      }
    } finally {
      setIsDeletingServer(false);
    }
  };

  const leaveServer = async () => {
    if (!activeServer || !window.confirm("Are you sure you want to leave this server?")) return;
    setIsLeavingServer(true);
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/leave`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setActiveServer(null);
        setActiveChannel(null);
        setChannels([]);
        setMessages([]);
        closeSocket();
        fetchMyServers();
      }
    } finally {
      setIsLeavingServer(false);
    }
  };

  const joinByInviteCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInviteCode.trim()) return;
    setIsJoiningByInvite(true);
    setJoinInviteError('');
    try {
      const res = await fetch(`${API_BASE}/servers/join-by-invite/${joinInviteCode.trim()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setJoinInviteCode('');
        setShowCreateServer(false);
        const serversRes = await fetch(`${API_BASE}/servers/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (serversRes.ok) {
          const serversData = applyServerListOrder(await serversRes.json());
          setServers(serversData);
          const newlyJoined = serversData.find((s: any) => s.invite_code === joinInviteCode.trim());
          if (newlyJoined) {
            selectServer(newlyJoined);
          }
        }
      } else {
        const err = await res.json();
        setJoinInviteError(err.detail || 'Failed to join server');
      }
    } catch {
      setJoinInviteError('Failed to join server');
    } finally {
      setIsJoiningByInvite(false);
    }
  };

  const getAvatarContent = (u: any) => {
    if (u?.profile_picture) {
      return <img src={getFullUrl(u.profile_picture)} alt="avatar" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />;
    }
    const nameToUse = u?.display_name || u?.username;
    return nameToUse ? nameToUse.charAt(0).toUpperCase() : 'U';
  };

  const renderUsernameWithBadges = (u: any) => {
    if (!u) return 'Unknown';
    const isAdmin = u.permissions?.includes('SYSTEM_ADMIN');
    const isMod = !isAdmin && u.permissions?.includes('SYSTEM_MOD');
    
    return (
      <span style={{display: 'inline-flex', alignItems: 'center'}} title={`@${u.username}`}>
        {u.display_name || u.username}
        {isAdmin && (
          <span style={{display: 'inline-flex', alignItems: 'center', gap: '2px', backgroundColor: 'var(--brand-primary)', color: 'white', padding: '1px 4px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', marginLeft: '6px', verticalAlign: 'middle', height: '16px'}}>
            <Hammer size={10} /> ADMIN
          </span>
        )}
        {isMod && (
          <span style={{display: 'inline-flex', alignItems: 'center', gap: '2px', backgroundColor: '#23a559', color: 'white', padding: '1px 4px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', marginLeft: '6px', verticalAlign: 'middle', height: '16px'}}>
            <Hammer size={10} /> MOD
          </span>
        )}
      </span>
    );
  };

  const getServerIconContent = (s: any) => {
    if (s?.server_image) {
      return <img src={getFullUrl(s.server_image)} alt="icon" style={{width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover'}} />;
    }
    return s.server_name.charAt(0).toUpperCase();
  };

  const handleJoinPreview = async () => {
    if (!token) {
      setShowInvitePreview(false); // hide it to let them log in, they have pendingInviteCode so it'll pop back up
      return;
    }
    setIsJoiningPreview(true);
    try {
      const res = await fetch(`${API_BASE}/servers/join-by-invite/${pendingInviteCode}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setShowInvitePreview(false);
        setPendingInviteCode(null);
        
        // Refetch servers and select the new one
        const sRes = await fetch(`${API_BASE}/servers/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (sRes.ok) {
          const serversData = applyServerListOrder(await sRes.json());
          setServers(serversData);
          const newlyJoined = serversData.find((s: any) => s.invite_code === pendingInviteCode);
          if (newlyJoined) {
            selectServer(newlyJoined);
          }
        }
      } else {
        const err = await res.json();
        setInvitePreviewError(err.detail || 'Failed to join server');
      }
    } catch {
      setInvitePreviewError('Failed to join server');
    } finally {
      setIsJoiningPreview(false);
    }
  };

  const renderInvitePreviewModal = () => {
    if (!showInvitePreview) return null;
    return (
      <div className="modal-overlay">
        <div className="card modal-content" style={{width: '400px', textAlign: 'center'}}>
          {invitePreviewError ? (
            <>
              <h3>Invite Invalid</h3>
              <p style={{color: 'var(--text-muted)'}}>{invitePreviewError}</p>
              <div className="modal-actions" style={{justifyContent: 'center', marginTop: '24px'}}>
                <button className="btn" onClick={() => { setShowInvitePreview(false); setPendingInviteCode(null); }}>Close</button>
              </div>
            </>
          ) : (
            <>
              <div style={{width: '80px', height: '80px', margin: '0 auto 16px', borderRadius: '16px', backgroundColor: 'var(--bg-300)', overflow: 'hidden'}}>
                {invitePreviewData?.server_image ? (
                  <img src={getFullUrl(invitePreviewData.server_image)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
                ) : (
                  <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem', fontWeight: 600}}>
                    {invitePreviewData?.server_name?.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <h2 style={{marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'}}>
                {invitePreviewData?.server_name}
                {invitePreviewData?.is_verified && <span data-tooltip="Verified" style={{display: 'flex'}}><BadgeCheck size={20} color="#3b82f6" /></span>}
              </h2>
              {invitePreviewData?.server_description && <p style={{color: 'var(--text-muted)', marginBottom: '16px'}}>{invitePreviewData?.server_description}</p>}
              
              <div style={{display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '12px', marginTop: '16px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                  <div style={{width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#23a559'}}></div>
                  <strong>{invitePreviewData?.online_members}</strong> Online
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                  <div style={{width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--text-muted)'}}></div>
                  <strong>{invitePreviewData?.total_members}</strong> Members
                </div>
              </div>
              {(invitePreviewData?.temporary || invitePreviewData?.expires_at || invitePreviewData?.max_uses != null) && (
                <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px'}}>
                  {invitePreviewData?.temporary && <span>Temporary membership — you leave when you go offline</span>}
                  {invitePreviewData?.expires_at && (
                    <span>Expires {new Date(invitePreviewData.expires_at * 1000).toLocaleString()}</span>
                  )}
                  {invitePreviewData?.max_uses != null && (
                    <span>
                      Uses {invitePreviewData.uses ?? 0}/{invitePreviewData.max_uses}
                    </span>
                  )}
                </div>
              )}

              <div className="modal-actions" style={{flexDirection: 'column', gap: '8px', padding: '0 16px'}}>
                <button className="btn btn-primary" style={{width: '100%', padding: '12px', justifyContent: 'center'}} disabled={isJoiningPreview} onClick={handleJoinPreview}>
                  {isJoiningPreview ? <Loader2 size={18} className="spinner" /> : token ? 'Join Server' : 'Log in to Join'}
                </button>
                <button className="btn btn-secondary" style={{width: '100%', padding: '12px', justifyContent: 'center'}} onClick={() => { setShowInvitePreview(false); setPendingInviteCode(null); }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!token) return;

    const muted = !!(user && user.muted_until && (user.muted_until * 1000) > Date.now());

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };

    const anyModalOpen =
      showCreateServer ||
      showDiscover ||
      showSettings ||
      showAdminPanel ||
      showServerSettings ||
      showCreateChannelModal ||
      showInvitePreview ||
      showScheduleModal ||
      showInviteManager ||
      cropRequest !== null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEmojiPicker !== null || showFullEmojiPicker !== null) {
          e.preventDefault();
          e.stopPropagation();
          setShowEmojiPicker(null);
          setShowFullEmojiPicker(null);
          return;
        }
        if (contextMenu) {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          return;
        }
        if (serverContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          setServerContextMenu(null);
          return;
        }
        if (msgContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          setMsgContextMenu(null);
          return;
        }
        if (selectedProfile) {
          e.preventDefault();
          e.stopPropagation();
          setSelectedProfile(null);
          return;
        }
        if (showMentions) {
          e.preventDefault();
          e.stopPropagation();
          setShowMentions(false);
          return;
        }
        if (editingMessageId !== null) {
          e.preventDefault();
          e.stopPropagation();
          setEditingMessageId(null);
          setEditContent('');
          inputRef.current?.focus();
          return;
        }
        if (replyingTo) {
          e.preventDefault();
          e.stopPropagation();
          setReplyingTo(null);
          return;
        }
        if (cropRequest) {
          e.preventDefault();
          e.stopPropagation();
          handleCropCancel();
          return;
        }
        if (showScheduleModal) {
          e.preventDefault();
          e.stopPropagation();
          setShowScheduleModal(false);
          return;
        }
        if (showInviteManager) {
          e.preventDefault();
          e.stopPropagation();
          setShowInviteManager(false);
          return;
        }
        if (showAdminPanel) {
          e.preventDefault();
          e.stopPropagation();
          setShowAdminPanel(false);
          return;
        }
        if (showSettings) {
          e.preventDefault();
          e.stopPropagation();
          closeSettings();
          return;
        }
        if (showCreateServer) {
          e.preventDefault();
          e.stopPropagation();
          setShowCreateServer(false);
          return;
        }
        if (showDiscover) {
          e.preventDefault();
          e.stopPropagation();
          setShowDiscover(false);
          return;
        }
        if (showServerSettings) {
          e.preventDefault();
          e.stopPropagation();
          closeServerSettings();
          return;
        }
        if (showCreateChannelModal) {
          e.preventDefault();
          e.stopPropagation();
          setShowCreateChannelModal(false);
          return;
        }
        if (showInvitePreview) {
          e.preventDefault();
          e.stopPropagation();
          setShowInvitePreview(false);
          return;
        }
        if (attachmentFile) {
          e.preventDefault();
          e.stopPropagation();
          setAttachmentFile(null);
          setAttachmentPreview(null);
          return;
        }
        if (e.target === inputRef.current) {
          e.preventDefault();
          inputRef.current?.blur();
        }
        return;
      }

      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isEditableTarget(e.target) &&
        !anyModalOpen &&
        activeChannel &&
        !muted &&
        !editingMessageId
      ) {
        e.preventDefault();
        const input = inputRef.current;
        if (!input || input.disabled) return;
        setChatInput((prev) => {
          const next = prev + '/';
          requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange(next.length, next.length);
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 200) + 'px';
          });
          return next;
        });
        return;
      }

      if (
        e.key === 'ArrowUp' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isEditableTarget(e.target) &&
        !anyModalOpen &&
        activeChannel &&
        !editingMessageId &&
        !chatInput.trim()
      ) {
        const lastOwn = [...messages].reverse().find(
          (m) => m.author_id === user?.user_id && !m.flags?.includes('DELETED')
        );
        if (lastOwn) {
          e.preventDefault();
          setEditingMessageId(lastOwn.message_id);
          setEditContent(lastOwn.content?.text || '');
          setTimeout(() => {
            document.getElementById(`message-${lastOwn.message_id}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }, 50);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    token,
    showCreateServer,
    showDiscover,
    showSettings,
    showAdminPanel,
    showServerSettings,
    showCreateChannelModal,
    showInvitePreview,
    showScheduleModal,
    showInviteManager,
    showEmojiPicker,
    showFullEmojiPicker,
    contextMenu,
    serverContextMenu,
    msgContextMenu,
    selectedProfile,
    showMentions,
    editingMessageId,
    replyingTo,
    attachmentFile,
    activeChannel,
    chatInput,
    messages,
    user,
    cropRequest,
    settingsProfilePic,
    settingsBanner,
    serverImage,
    serverBanner,
  ]);

  if (user && user.status === 'BANNED') {
    return (
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0, zIndex: 9999, backgroundColor: 'var(--bg-main)', color: 'white'}}>
        <AlertTriangle size={64} color="var(--color-danger)" style={{marginBottom: '24px'}} />
        <h1 style={{fontSize: '32px', marginBottom: '16px'}}>Account Suspended</h1>
        <p style={{fontSize: '18px', color: 'var(--text-muted)', marginBottom: '24px'}}>Your account has been permanently banned from Cordis.</p>
        <button className="btn btn-secondary" onClick={logout}>Log Out</button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="auth-container">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '440px', padding: '16px' }}>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: 'var(--text-normal, #dbdee1)' }}>
              Cordis v1.1
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted, #949ba4)', fontSize: '0.95rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span>made by</span>
              <a href="https://killsecurly.com" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center' }}>
                <img 
                  src="https://raw.githubusercontent.com/killsecurly/assets/main/KSFLogoRed.png" 
                  alt="KillSecurly" 
                  style={{ height: '36px', filter: 'invert(1) hue-rotate(180deg)' }} 
                />
              </a>
              <span>, a project of</span>
              <a href="https://lvmlabs.org" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center' }}>
                <img 
                  src="https://raw.githubusercontent.com/ko6lvm/LVMLabs.org/b6cf7afb3ea2011e533b103f83620672c448cac0/lvmlabs/static/images/logo-crop-white-italics.png" 
                  alt="LVMLabs" 
                  style={{ height: '18px' }} 
                />
              </a>
            </div>
          </div>

          <div className="card" style={{
            backgroundColor: 'rgba(242, 63, 67, 0.1)',
            border: '1px solid rgba(242, 63, 67, 0.3)',
            padding: '16px',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: 'var(--shadow-lift)'
          }}>
            <div style={{
              color: '#f23f43',
              fontWeight: 700,
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertTriangle size={20} />
              Warning
            </div>
            <div style={{
              color: '#dbdee1',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              fontWeight: 500
            }}>
              Cordis is a new app with the possiblity for a lot of bugs. Please report them accordingly in Github or the KillSecurly Discord.
            </div>
          </div>

          <div className="card auth-box" style={{ width: '100%' }}>
            <h2 className="text-xl" style={{textAlign: 'center', marginBottom: '8px'}}>{isLogin ? 'Log In' : 'Create an Account'}</h2>
            {authError && <div className="error-msg">{authError}</div>}
            <form onSubmit={handleAuth} style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              <input className="input" type="text" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} required disabled={isLoadingAuth} />
              <input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={isLoadingAuth} />
              {!isLogin && (
                <div className="password-requirements" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', marginTop: '-8px', marginBottom: '-4px', padding: '0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: password.length >= 8 ? 'var(--status-online, #23a559)' : '#fa777c' }}>
                    {password.length >= 8 ? <Check size={14} /> : <X size={14} />}
                    <span>At least 8 characters long</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: (/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) ? 'var(--status-online, #23a559)' : '#fa777c' }}>
                    {(/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) ? <Check size={14} /> : <X size={14} />}
                    <span>Contains both letters and numbers</span>
                  </div>
                </div>
              )}
              <button className="btn" type="submit" disabled={isLoadingAuth}>
                {isLoadingAuth ? <Loader2 size={18} className="spinner" /> : isLogin ? 'Login' : 'Register'}
              </button>
            </form>
            <div className="auth-link" onClick={() => !isLoadingAuth && setIsLogin(!isLogin)}>
              {isLogin ? "Need an account? Register" : "Already have an account? Login"}
            </div>
          </div>
        </div>
        {renderInvitePreviewModal()}
      </div>
    );
  }

  // Render computations
  const serverUnreadStatus: Record<number, boolean> = {};
  const serverMentionCount: Record<number, number> = {};
  
  Object.values(unreadStates).forEach(state => {
    const isUnread = state.has_unread ?? (state.last_message_id > state.last_read_message_id);
    if (state.server_id) {
      if (isUnread) serverUnreadStatus[state.server_id] = true;
      if (state.mentions_count > 0) {
        serverMentionCount[state.server_id] = (serverMentionCount[state.server_id] || 0) + state.mentions_count;
      }
    } else {
      if (isUnread) serverUnreadStatus[0] = true; 
      if (state.mentions_count > 0) {
        serverMentionCount[0] = (serverMentionCount[0] || 0) + state.mentions_count;
      }
    }
  });

  const isMuted = user && user.muted_until && (user.muted_until * 1000) > Date.now();
  const effectivePinnedServerId = getEffectivePinnedServerId(servers);
  const myServerRoles = activeServer?.my_roles || ['default'];
  const hasPermission = (perm: string) => {
    if (activeServer?.owner_id === user?.user_id) return true;
    for (const rid of myServerRoles) {
      const perms = activeServer?.roles?.[rid]?.permissions || [];
      if (perms.includes(perm) || perms.includes('ADMIN')) return true;
    }
    return false;
  };
  
  const isServerAdmin = hasPermission('ADMIN');
  const isServerMod = hasPermission('MOD');
  const canTypeInChannel = !isMuted && activeChannel && (activeChannel.server_id == null || activeChannel.can_send !== false);

  const sortedCategories = [...categories].sort((a, b) => (a.position || 0) - (b.position || 0) || a.category_id - b.category_id);
  const channelsInCategory = (catId: number | null) =>
    channels
      .filter(c => (catId == null ? !c.category_id : c.category_id === catId))
      .sort((a, b) => (a.position || 0) - (b.position || 0) || a.channel_id - b.channel_id);

  const renderChannelRow = (c: any) => {
    const unreadState = unreadStates[c.channel_id];
    const isUnread = unreadState ? (unreadState.has_unread ?? (unreadState.last_message_id > unreadState.last_read_message_id)) : false;
    const isUnreadClass = isUnread && activeChannel?.channel_id !== c.channel_id ? 'unread' : '';
    return (
    <div
      key={c.channel_id}
      className={`channel-item ${activeChannel?.channel_id === c.channel_id ? 'active' : ''} ${isUnreadClass}`}
      onClick={() => selectChannel(c)}
      onContextMenu={(e) => {
        if (!isServerAdmin) return;
        e.preventDefault();
        openChannelSettings(c);
      }}
      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
    >
      <Hash size={18} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.channel_name}</span>
      {isServerAdmin && (
        <button
          type="button"
          className="icon-btn"
          title="Channel settings"
          onClick={(e) => { e.stopPropagation(); openChannelSettings(c); }}
          style={{ padding: '2px', opacity: 0.7 }}
        >
          <Settings size={14} />
        </button>
      )}
    </div>
  );
};

  const membersVisible = isMobile ? mobileMembersOpen : showMemberList;

  return (
    <div 
      {...getRootProps()}
      className={`app-layout${isMobile ? ' is-mobile' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}${membersVisible ? ' members-open' : ''}`}
      onClick={() => {
        if (selectedProfile) setSelectedProfile(null);
        if (showEmojiPicker !== null) setShowEmojiPicker(null);
        if (showFullEmojiPicker !== null) setShowFullEmojiPicker(null);
        if (activeMessageId !== null) setActiveMessageId(null);
      }}
    >
      <input {...getInputProps()} />
      {isDragActive && (
          <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white'
          }}>
            <div style={{pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <UploadCloud size={64} style={{marginBottom: '16px', color: 'var(--brand-primary)'}} />
              <h2 style={{fontSize: '24px', fontWeight: 600}}>Drop files to upload</h2>
            </div>
          </div>
      )}

      {isMobile && (mobileNavOpen || mobileMembersOpen) && (
        <div
          className="mobile-drawer-overlay"
          onClick={() => {
            setMobileNavOpen(false);
            setMobileMembersOpen(false);
          }}
        />
      )}

      {/* Server Sidebar */}
      <div className="panel server-sidebar">
        <div className={`server-icon ${isViewingDMs ? 'active' : ''}`} onClick={() => { setIsViewingDMs(true); setActiveServer(null); setActiveChannel(null); setMessages([]); setServerEmojis([]); if (isMobile) setMobileNavOpen(true); setMobileMembersOpen(false); }} data-tooltip="Direct Messages">
          {isViewingDMs && <div className="active-pill" />}
          {!isViewingDMs && serverUnreadStatus[0] && !serverMentionCount[0] && <div className="unread-dot" />}
          <Home size={24} color={isViewingDMs ? '#fff' : 'var(--text-main)'} />
          {serverMentionCount[0] > 0 && <div className="mention-badge">{serverMentionCount[0]}</div>}
        </div>
        <div className="server-separator" />
        {(user?.permissions?.includes('SYSTEM_ADMIN') || user?.permissions?.includes('SYSTEM_MOD')) && (
          <>
            <div className={`server-icon ${showAdminPanel ? 'active' : ''}`} onClick={() => { setShowAdminPanel(true); if (isMobile) setMobileNavOpen(false); }} data-tooltip="Administration">
              {showAdminPanel && <div className="active-pill" />}
              <Hammer size={24} color={showAdminPanel ? '#fff' : 'var(--text-main)'} />
            </div>
            <div className="server-separator" />
          </>
        )}
        
        {isLoadingServers ? (
          <>
            <div className="skeleton skeleton-icon"></div>
            <div className="skeleton skeleton-icon"></div>
          </>
        ) : (
          servers.map(s => {
            const isPinned = effectivePinnedServerId === s.server_id;
            const isDragging = dragServerId === s.server_id;
            const isDragOver = dragOverServerId === s.server_id && dragServerId !== s.server_id;
            return (
            <div
              key={s.server_id}
              className={`server-icon ${activeServer?.server_id === s.server_id ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${isPinned ? 'pinned' : ''}`}
              draggable
              onDragStart={(e) => {
                serverDragMovedRef.current = false;
                setDragServerId(s.server_id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(s.server_id));
                try {
                  e.dataTransfer.setDragImage(e.currentTarget, 24, 24);
                } catch {}
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverServerId !== s.server_id) setDragOverServerId(s.server_id);
              }}
              onDragLeave={() => {
                if (dragOverServerId === s.server_id) setDragOverServerId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = Number(e.dataTransfer.getData('text/plain') || dragServerId);
                if (Number.isFinite(fromId)) {
                  serverDragMovedRef.current = true;
                  reorderServers(fromId, s.server_id);
                }
                setDragServerId(null);
                setDragOverServerId(null);
              }}
              onDragEnd={() => {
                setDragServerId(null);
                setDragOverServerId(null);
                window.setTimeout(() => { serverDragMovedRef.current = false; }, 0);
              }}
              onClick={() => {
                if (serverDragMovedRef.current) return;
                selectServer(s);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setServerContextMenu({ x: e.pageX, y: e.pageY, server: s });
              }}
              data-tooltip={isPinned ? `${s.server_name} (pinned)` : s.server_name}
            >
              {activeServer?.server_id === s.server_id && <div className="active-pill" />}
              {activeServer?.server_id !== s.server_id && serverUnreadStatus[s.server_id] && !serverMentionCount[s.server_id] && <div className="unread-dot" />}
              {getServerIconContent(s)}
              {isPinned && (
                <div className="server-pin-badge" title="Opens on launch">
                  <Pin size={10} />
                </div>
              )}
              {serverMentionCount[s.server_id] > 0 && <div className="mention-badge">{serverMentionCount[s.server_id]}</div>}
            </div>
            );
          })
        )}
        <div className="server-separator" />
        <div className="server-icon action" onClick={() => { setShowCreateServer(true); if (isMobile) setMobileNavOpen(false); }} data-tooltip="Create Server">
          <Plus size={24} />
        </div>
        <div className="server-icon discover" onClick={() => { openDiscover(); if (isMobile) setMobileNavOpen(false); }} data-tooltip="Discover">
          <Compass size={24} />
        </div>
      </div>

      {/* Channels Sidebar */}
      <div className="panel channel-sidebar">
        <div className="server-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 'auto', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)'}}>
          <div style={{flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0}}>
            {isViewingDMs ? (
              <div style={{fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                Direct Messages
              </div>
            ) : isLoadingServers ? (
              <div className="skeleton skeleton-text-short"></div>
            ) : (
              <>
                <div style={{display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0}}>
                  <div style={{fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {activeServer?.server_name || 'No Server'}
                  </div>
                  {activeServer?.is_verified && <span data-tooltip="Verified" style={{display: 'flex', flexShrink: 0}}><BadgeCheck size={16} color="#3b82f6" /></span>}
                </div>
                {activeServer && activeServer.invite_code !== 'GLOBAL' && (
                  <button 
                    className="btn" 
                    style={{
                      fontSize: '0.7rem', 
                      padding: '4px 8px', 
                      marginTop: '6px', 
                      width: 'fit-content',
                      height: 'auto',
                      backgroundColor: 'var(--brand-primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer'
                    }}
                    onClick={() => openInviteManager()}
                    title="Manage invites"
                  >
                    <Link2 size={12} /> Invite
                  </button>
                )}
              </>
            )}
          </div>
          <div style={{display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center'}}>
            {activeServer && user && (
              <>
                {(activeServer.owner_id === user.user_id || isServerAdmin) && (
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); openServerSettings(); if (isMobile) setMobileNavOpen(false); }} title="Server Settings">
                    <Settings size={18} />
                  </button>
                )}
                {activeServer.owner_id !== user.user_id && activeServer.invite_code !== 'GLOBAL' && (
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); leaveServer(); }} title="Leave Server" disabled={isLeavingServer}>
                    <LogOut size={18} />
                  </button>
                )}
              </>
            )}
            {isMobile && (
              <button
                type="button"
                className="icon-btn mobile-close-nav"
                onClick={() => setMobileNavOpen(false)}
                title="Close menu"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        <div className="channel-list">
          {isViewingDMs ? (
            dms.map(dm => {
              const unreadState = unreadStates[dm.channel_id];
              const isUnread = unreadState ? (unreadState.has_unread ?? (unreadState.last_message_id > unreadState.last_read_message_id)) : false;
              const isUnreadClass = isUnread && activeChannel?.channel_id !== dm.channel_id ? 'unread' : '';
              const mentionCount = unreadState?.mentions_count || 0;
              
              return (
              <div key={dm.channel_id} className={`channel-item ${activeChannel?.channel_id === dm.channel_id ? 'active' : ''} ${isUnreadClass}`} onClick={() => selectChannel(dm)} style={{padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                <div className="user-avatar" style={{width: '32px', height: '32px'}}>
                  {getAvatarContent(dm.target_user)}
                  <div className={`status-indicator ${isUserOnline(dm.target_user?.user_id, dm.target_user?.username) ? 'online' : 'offline'}`} style={{width: '10px', height: '10px', bottom: '-2px', right: '-2px', border: '2px solid var(--bg-panel)'}}></div>
                </div>
                <span style={{fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={dm.target_user?.username ? `@${dm.target_user.username}` : undefined}>{dm.target_user?.display_name || dm.target_user?.username || 'Unknown User'}</span>
                {mentionCount > 0 && (
                  <div className="mention-badge" style={{position: 'static', transform: 'none', marginLeft: 'auto', fontSize: '11px', padding: '2px 6px', height: '16px', lineHeight: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{mentionCount}</div>
                )}
              </div>
            )})
          ) : isLoadingChannels ? (
            <>
              <div className="skeleton skeleton-text" style={{height: '24px', marginBottom: '8px'}}></div>
              <div className="skeleton skeleton-text-short" style={{height: '24px'}}></div>
            </>
          ) : (
            <>
              <div style={{
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '12px 10px 4px 10px',
                color: 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.02em'
              }}>
                <span>Channels</span>
                {isServerAdmin && (
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button 
                      className="icon-btn" 
                      onClick={() => setShowCreateCategoryModal(true)} 
                      title="Create Category"
                      style={{ padding: '2px', background: 'transparent' }}
                    >
                      <FolderPlus size={16} />
                    </button>
                    <button 
                      className="icon-btn" 
                      onClick={() => { setNewChannelCategoryId(0); setShowCreateChannelModal(true); }} 
                      title="Create Channel"
                      style={{ padding: '2px', background: 'transparent' }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
              {sortedCategories.map(cat => {
                const collapsed = !!collapsedCategories[cat.category_id];
                const catChannels = channelsInCategory(cat.category_id);
                return (
                  <div key={cat.category_id} style={{ marginBottom: '4px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '8px 8px 2px',
                        color: 'var(--text-muted)',
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                      onClick={() => setCollapsedCategories(prev => ({ ...prev, [cat.category_id]: !prev[cat.category_id] }))}
                    >
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.name}</span>
                      {isServerAdmin && (
                        <>
                          <button type="button" className="icon-btn" title="Add channel" style={{ padding: '1px' }} onClick={(e) => { e.stopPropagation(); setNewChannelCategoryId(cat.category_id); setShowCreateChannelModal(true); }}>
                            <Plus size={12} />
                          </button>
                          <button type="button" className="icon-btn" title="Delete category" style={{ padding: '1px' }} onClick={(e) => { e.stopPropagation(); deleteCategory(cat.category_id); }}>
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                    {!collapsed && catChannels.map(renderChannelRow)}
                  </div>
                );
              })}
              {channelsInCategory(null).length > 0 && (
                <>
                  {sortedCategories.length > 0 && (
                    <div style={{ padding: '10px 10px 2px', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                      Uncategorized
                    </div>
                  )}
                  {channelsInCategory(null).map(renderChannelRow)}
                </>
              )}
            </>
          )}
        </div>
        {user && (
          <div className="user-panel">
            <div className="user-avatar">
              {getAvatarContent(user)}
              <div className="status-indicator status-online"></div>
            </div>
            <div className="user-info">
              <div className="user-name">{renderUsernameWithBadges(user)}</div>
              <div className="user-status-text" style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                Online
                {user.discord_id && lanyardNotInServer && (
                  <span title="Not in Lanyard Discord" style={{display: 'flex', cursor: 'help'}}>
                    <AlertTriangle size={12} color="var(--status-dnd)" />
                  </span>
                )}
              </div>
            </div>
            <div className="user-actions">
              <button className="icon-btn" onClick={openSettings} title="User Settings"><Settings size={18} /></button>
              <button className="icon-btn" onClick={logout} title="Log Out"><LogOut size={18} /></button>
            </div>
          </div>
        )}
      </div>

      <div className="chat-area">
        <div className="chat-header" style={{justifyContent: 'space-between'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1}}>
            {isMobile && (
              <button
                type="button"
                className="icon-btn mobile-nav-toggle"
                onClick={() => {
                  setMobileNavOpen(true);
                  setMobileMembersOpen(false);
                  setSelectedProfile(null);
                }}
                title="Open navigation"
                aria-label="Open navigation"
              >
                <Menu size={22} />
              </button>
            )}
            {isViewingDMs ? (
              <>
                <MessageSquare size={24} style={{color: 'var(--text-muted)', flexShrink: 0}} className="chat-header-icon" />
                <div className="chat-title">{renderUsernameWithBadges(activeChannel?.target_user) || (isMobile ? 'Messages' : '')}</div>
              </>
            ) : (
              <>
                <Hash size={24} style={{color: 'var(--text-muted)', flexShrink: 0}} className="chat-header-icon" />
                <div className="chat-title">{activeChannel?.channel_name || 'Select a channel'}</div>
              </>
            )}
          </div>
          {activeChannel && (
            <button 
              className="icon-btn" 
              onClick={() => {
                if (isMobile) {
                  setMobileMembersOpen((v) => !v);
                  setMobileNavOpen(false);
                } else {
                  setShowMemberList(!showMemberList);
                }
              }} 
              title={isViewingDMs ? "Toggle User Profile" : "Toggle Member List"}
              style={{color: membersVisible ? 'var(--text-heading)' : 'var(--text-muted)', flexShrink: 0}}
            >
              <Users size={20} />
            </button>
          )}
        </div>
        
        <div className="message-list" onClick={() => { setSelectedProfile(null); setActiveMessageId(null); }}>
          {!activeChannel && (
            <div className="mobile-empty-chat">
              <MessageSquare size={40} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.95rem', lineHeight: 1.5, maxWidth: 280 }}>
                {isMobile
                  ? 'Tap the menu button to pick a server, channel, or direct message.'
                  : 'Select a channel or direct message to start chatting.'}
              </p>
              {isMobile && (
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 16 }}
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu size={18} /> Open menu
                </button>
              )}
            </div>
          )}
          {useMemo(() => messages.map((m, i) => {
            const isMentioned = currentUserRef.current && m.mentions?.includes(currentUserRef.current.user_id);
            const isDeleted = m.flags?.includes("DELETED");
            const isEdited = m.flags?.includes("EDITED");
            const canEdit = currentUserRef.current?.user_id === m.author_id;
            const canDelete = canEdit || (activeServer && currentUserRef.current?.user_id === activeServer.owner_id);
            
            return (
            <div
              key={m.message_id ?? i}
              id={`message-${m.message_id}`}
              className={`message ${isMentioned ? 'mentioned' : ''} ${isDeleted ? 'deleted' : ''} ${activeMessageId === m.message_id ? 'msg-active' : ''}`}
              style={{display: 'flex', gap: '16px', position: 'relative', flexDirection: 'column'}}
              onClick={(e) => {
                if (!isMobile) return;
                e.stopPropagation();
                setActiveMessageId((prev) => (prev === m.message_id ? null : m.message_id));
              }}
            >
              {m.parent_message && (
                <div 
                  className="inline-quote" 
                  onClick={() => {
                    const el = document.getElementById(`message-${m.parent_message.message_id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', paddingLeft: '42px', marginBottom: '-12px', fontSize: '13px', color: 'var(--text-muted)'}}
                >
                  <div style={{width: '2px', height: '12px', backgroundColor: 'var(--border)', borderRadius: '2px'}}></div>
                  <div className="msg-avatar" style={{width: '16px', height: '16px', minWidth: '16px', fontSize: '8px'}}>
                    {getAvatarContent(m.parent_message.author)}
                  </div>
                  <span style={{fontWeight: 500}}>{renderUsernameWithBadges(m.parent_message.author)}</span>
                  <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px'}}>{m.parent_message.content?.text || 'Attachment'}</span>
                </div>
              )}
              <div style={{display: 'flex', gap: '16px', position: 'relative'}}>
              <div 
                className="msg-avatar" 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProfile({ user: m.author, rect: e.currentTarget.getBoundingClientRect() });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({x: e.pageX, y: e.pageY, user: m.author});
                }}
                style={{cursor: 'pointer'}}
              >
                {getAvatarContent(m.author)}
              </div>
              <div className="msg-content" style={{flex: 1}}>
                <div className="msg-header">
                  <span 
                    className="msg-author"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProfile({ user: m.author, rect: e.currentTarget.getBoundingClientRect() });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const memberRoles = serverMembers.find(sm => sm.user_id === m.author.user_id)?.server_roles || [];
                      setContextMenu({x: e.pageX, y: e.pageY, user: m.author, serverRole: memberRoles});
                    }}
                    style={{
                      cursor: 'pointer',
                      color: (() => {
                        const member = serverMembers.find(sm => sm.user_id === m.author.user_id);
                        return member ? getUserHighestRole(member.server_roles, activeServer?.roles || {}).color || 'inherit' : 'inherit';
                      })()
                    }}
                  >
                    {renderUsernameWithBadges(m.author)}
                  </span>
                  <span className="msg-time">
                    {new Date(m.created_at * 1000).toLocaleString()}
                    {isEdited && !isDeleted && <span className="edited-tag" style={{marginLeft: '4px', fontSize: '11px', color: 'var(--text-muted)'}}>(edited)</span>}
                  </span>
                </div>
                
                {isDeleted ? (
                  revealedMessages[m.message_id] ? (
                    <div className="msg-text revealed-message" style={{opacity: 0.8, borderLeft: '2px solid var(--brand-primary)', paddingLeft: '8px'}}>
                      <div style={{fontSize: '11px', color: 'var(--brand-primary)', fontWeight: 'bold', marginBottom: '4px'}}>Revealed Deleted Message:</div>
                      {renderMessageText(revealedMessages[m.message_id].content?.text, undefined, serverEmojis)}
                      {revealedMessages[m.message_id].content?.attachments && revealedMessages[m.message_id].content.attachments.map((url: string, idx: number) => (
                        <MessageAttachment key={idx} url={url} onLoad={scrollToBottom} />
                      ))}
                    </div>
                  ) : (
                    <div className="msg-text tombstone" style={{color: 'var(--text-muted)', fontStyle: 'italic'}} onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMsgContextMenu({x: e.pageX, y: e.pageY, message: m});
                    }}>This message was deleted.</div>
                  )
                ) : (
                  editingMessageId === m.message_id ? (
                    <div className="msg-edit-container" style={{marginTop: '4px'}}>
                      <textarea
                        className="msg-edit-input"
                        value={editContent}
                        onChange={(e) => {
                          setEditContent(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleEditMessageSubmit(m.message_id, m.content.attachments);
                          } else if (e.key === 'Escape') {
                            setEditingMessageId(null);
                          }
                        }}
                        autoFocus
                        disabled={isMuted}
                        onFocus={(e) => {
                          const val = e.currentTarget.value;
                          e.currentTarget.setSelectionRange(val.length, val.length);
                        }}
                      />
                      <div className="msg-edit-actions" style={{marginTop: '4px'}}>
                        <span style={{fontSize: '12px', color: 'var(--text-muted)'}}>
                          escape to <span className="cancel-link" style={{color: 'var(--brand-primary)', cursor: 'pointer'}} onClick={() => setEditingMessageId(null)}>cancel</span> • enter to <span className="save-link" style={{color: 'var(--brand-primary)', cursor: 'pointer'}} onClick={() => handleEditMessageSubmit(m.message_id, m.content.attachments)}>save</span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="msg-text">
                        {renderMessageText(m.content.text, (username, e) => {
                          let matchedUser = serverMembers.find(u => u.username === username) || 
                                            dms.find(d => d.target_user.username === username)?.target_user ||
                                            messages.find(msg => msg.author.username === username)?.author;
                          
                          if (!matchedUser) {
                            matchedUser = { username, user_id: 0 };
                          }
                          setSelectedProfile({ user: matchedUser, rect: e.currentTarget.getBoundingClientRect() });
                        }, serverEmojis)}
                      </div>
                      {m.content.attachments && m.content.attachments.map((url: string, idx: number) => (
                        <MessageAttachment key={idx} url={url} onLoad={scrollToBottom} />
                      ))}
                      {m.content.embeds && m.content.embeds.map((embed: any, idx: number) => (
                        <MessageEmbed key={`embed-${idx}`} embed={embed} onImageLoad={scrollToBottom} />
                      ))}
                    </>
                  )
                )}
                {m.reactions && m.reactions.length > 0 && (
                  <div className="msg-reactions">
                    {m.reactions.map((r: any, rIdx: number) => {
                      const hasReacted = currentUserRef.current && r.user_ids.includes(currentUserRef.current.user_id);
                      
                      const reactorNames = r.user_ids.map((id: number) => {
                        if (currentUserRef.current?.user_id === id) return currentUserRef.current.username;
                        let member = serverMembers.find(u => u.user_id === id);
                        if (member) return member.username;
                        let dmUser = dms.find(d => d.target_user.user_id === id)?.target_user;
                        if (dmUser) return dmUser.username;
                        let msgAuthor = messages.find(msg => msg.author.user_id === id)?.author;
                        if (msgAuthor) return msgAuthor.username;
                        return `User`;
                      });
                      
                      let tooltipText = "";
                      if (reactorNames.length > 0) {
                         if (reactorNames.length <= 3) {
                            tooltipText = reactorNames.join(", ") + " reacted";
                         } else {
                            tooltipText = reactorNames.slice(0, 3).join(", ") + ` and ${reactorNames.length - 3} others reacted`;
                         }
                      }

                      return (
                        <button key={rIdx} className={`reaction-pill ${hasReacted ? 'active' : ''}`} onClick={() => handleReactionToggle(m.message_id, r.emoji)}>
                          {renderReactionEmoji(r.emoji, serverEmojis)}
                          <span className="reaction-count">{r.count}</span>
                          <div className="reaction-tooltip">{tooltipText}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {!isDeleted && editingMessageId !== m.message_id && (
                <div
                  className={`msg-actions ${showEmojiPicker === m.message_id || showFullEmojiPicker === m.message_id || activeMessageId === m.message_id ? 'force-show' : ''}`}
                  style={{position: 'relative'}}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="icon-btn action-btn" onClick={() => setShowEmojiPicker(showEmojiPicker === m.message_id ? null : m.message_id)} title="Add Reaction">
                    <Smile size={16} />
                  </button>
                  {showEmojiPicker === m.message_id && !showFullEmojiPicker && (
                    <div className="emoji-picker-tooltip">
                      {DEFAULT_EMOJIS.map(e => (
                        <button key={e} className="emoji-btn" onClick={() => handleReactionToggle(m.message_id, e)}>{e}</button>
                      ))}
                      <button className="emoji-btn" onClick={() => setShowFullEmojiPicker(m.message_id)} style={{color: 'var(--text-muted)'}}><Plus size={20} /></button>
                    </div>
                  )}
                  {showFullEmojiPicker === m.message_id && (
                    <div style={{position: 'absolute', bottom: '100%', right: '0', zIndex: 50, marginBottom: '8px'}}>
                      <EmojiPicker
                        onEmojiClick={(emojiData: EmojiClickData) => {
                          if (emojiData.isCustom) {
                            const id = parseInt(emojiData.unified, 10);
                            const found =
                              serverEmojis.find((em) => em.emoji_id === id) ||
                              serverEmojis.find((em) => em.name === emojiData.names[0]);
                            if (found) {
                              handleReactionToggle(m.message_id, formatCustomReaction(found));
                              return;
                            }
                          }
                          handleReactionToggle(m.message_id, emojiData.emoji);
                        }}
                        theme={theme === 'light' ? Theme.LIGHT : Theme.DARK}
                        customEmojis={serverEmojis.map((em) => ({
                          id: String(em.emoji_id),
                          names: [em.name],
                          imgUrl: getFullUrl(em.image_url),
                        }))}
                        categories={[
                          { category: Categories.SUGGESTED, name: 'Frequently Used' },
                          { category: Categories.CUSTOM, name: 'Server' },
                          { category: Categories.SMILEYS_PEOPLE, name: 'Smileys & People' },
                          { category: Categories.ANIMALS_NATURE, name: 'Animals & Nature' },
                          { category: Categories.FOOD_DRINK, name: 'Food & Drink' },
                          { category: Categories.TRAVEL_PLACES, name: 'Travel & Places' },
                          { category: Categories.ACTIVITIES, name: 'Activities' },
                          { category: Categories.OBJECTS, name: 'Objects' },
                          { category: Categories.SYMBOLS, name: 'Symbols' },
                          { category: Categories.FLAGS, name: 'Flags' },
                        ]}
                      />
                    </div>
                  )}
                  <button className="icon-btn action-btn" onClick={() => setReplyingTo(m)} title="Reply">
                    <Reply size={16} />
                  </button>
                  {canEdit && (
                    <button className="icon-btn action-btn" onClick={() => {
                      setEditingMessageId(m.message_id);
                      setEditContent(m.content.text);
                    }} title="Edit">
                      <Pencil size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button className="icon-btn action-btn danger" onClick={(e) => handleDeleteMessage(m.message_id, e.shiftKey)} title="Delete (Hold Shift to bypass confirmation)">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>
          )}), [messages, activeServer?.server_id, activeMessageId, isMobile, revealedMessages, editingMessageId, editContent, isMuted, serverMembers, dms, showEmojiPicker, showFullEmojiPicker, theme, serverEmojis])}
          <div ref={messagesEndRef} />
        </div>

        {Object.keys(typingUsers).length > 0 && (
          <div className="typing-indicator">
            {Object.values(typingUsers).join(', ')} is typing...
          </div>
        )}

        <div style={{position: 'absolute', bottom: '10px', right: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 500, pointerEvents: 'none'}}>
          Cordis v1.1
        </div>

        <div className="chat-input-wrapper">
          {showMentions && getMentionSuggestions().length > 0 && (
            <div className="mention-suggestions-popup">
              {getMentionSuggestions().map((u, index) => (
                <div 
                  key={u.user_id} 
                  className={`mention-suggestion-item ${index === activeSuggestionIndex ? 'active' : ''}`}
                  onClick={() => insertMention(u.username)}
                >
                  <div className="user-avatar" style={{ width: '24px', height: '24px', fontSize: '10px' }}>
                    {getAvatarContent(u)}
                  </div>
                  <span title={`@${u.username}`}>{u.display_name || u.username}</span>
                </div>
              ))}
            </div>
          )}
          {!showMentions && showEmojiSuggestions && getEmojiSuggestions().length > 0 && (
            <div className="mention-suggestions-popup">
              {getEmojiSuggestions().map((em, index) => (
                <div
                  key={em.emoji_id}
                  className={`mention-suggestion-item ${index === activeSuggestionIndex ? 'active' : ''}`}
                  onClick={() => insertEmojiShortcode(em.name)}
                >
                  <img
                    src={getFullUrl(em.image_url)}
                    alt={`:${em.name}:`}
                    className="custom-emoji suggestion"
                    draggable={false}
                  />
                  <span title={`:${em.name}:`}>:{em.name}:</span>
                </div>
              ))}
            </div>
          )}
          {replyingTo && (
            <div className="reply-banner" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', backgroundColor: 'var(--bg-secondary)', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottom: '1px solid var(--border)'}}>
              <div style={{fontSize: '13px', color: 'var(--text-muted)'}}>
                Replying to <span style={{fontWeight: 600, color: 'var(--text-primary)'}} title={`@${replyingTo.author?.username}`}>@{replyingTo.author?.display_name || replyingTo.author?.username}</span>
              </div>
              <button className="icon-btn" style={{padding: '4px'}} onClick={() => setReplyingTo(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          <form
            className="chat-input-box"
            onSubmit={(e) => {
              e.preventDefault();
            }}
            style={{borderTopLeftRadius: replyingTo ? 0 : '8px', borderTopRightRadius: replyingTo ? 0 : '8px', position: 'relative'}}
          >
            {attachmentPreview && (
              <div className="attachment-preview" style={{position: 'absolute', bottom: 'calc(100% + 8px)', left: '0', padding: '12px', backgroundColor: 'var(--bg-panel)', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: 'var(--shadow-lift)'}}>
                {(attachmentFile?.type?.startsWith('image/') || attachmentFile?.name?.match(/\.(jpeg|jpg|gif|png|webp|avif)$/i)) ? (
                  <img src={attachmentPreview} alt="" style={{height: '60px', width: '60px', objectFit: 'cover', borderRadius: '4px'}} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div style={{height: '60px', width: '60px', backgroundColor: 'var(--bg-dark)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <FileIcon size={24} />
                  </div>
                )}
                <div style={{display: 'flex', flexDirection: 'column', maxWidth: '200px', minWidth: 0}}>
                  <span style={{fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{attachmentFile?.name}</span>
                  <span style={{fontSize: '11px', color: 'var(--text-muted)'}}>{Math.round((attachmentFile?.size || 0) / 1024)} KB</span>
                </div>
                <button type="button" className="icon-btn" style={{padding: '4px', alignSelf: 'flex-start'}} onClick={() => { setAttachmentFile(null); setAttachmentPreview(null); }}>
                  <X size={16} />
                </button>
              </div>
            )}
            <label style={{cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', color: attachmentFile ? 'var(--brand-primary)' : 'var(--text-muted)'}}>
              <Plus size={20} />
              <input type="file" style={{display: 'none'}} onChange={e => { if (e.target.files?.[0]) setAttachmentFile(e.target.files[0]); }} />
            </label>
            <textarea 
              ref={inputRef}
              className="chat-input" 
              placeholder={
                isMuted ? 'You are currently muted.'
                : (activeChannel && activeChannel.can_send === false) ? 'You cannot send messages in this channel.'
                : (ws ? `Message #${activeChannel?.channel_name || ''}` : 'Connecting...')
              } 
              value={chatInput}
              onChange={handleTyping}
              onKeyDown={handleKeyDown}
              disabled={!canTypeInChannel || !activeChannel || !ws || isSendingMessage}
              rows={1}
            />
            <button
              type="button"
              className="icon-btn"
              title="Schedule message"
              aria-label="Schedule message"
              disabled={!canTypeInChannel || !activeChannel || isSendingMessage || isMuted}
              onClick={() => openScheduleModal()}
              style={{ color: showScheduleModal ? 'var(--brand-primary)' : undefined }}
            >
              <Clock size={20} />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={!canTypeInChannel || !activeChannel || (!chatInput.trim() && !attachmentFile) || !ws || isSendingMessage}
              onClick={() => sendMessage()}
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>
      
      {membersVisible && activeChannel && (
        <div className="member-list">
          {isMobile && (
            <div className="mobile-members-header">
              <h3 className="member-group-title" style={{ margin: 0 }}>{isViewingDMs ? 'Members' : 'Server members'}</h3>
              <button type="button" className="icon-btn" onClick={() => setMobileMembersOpen(false)} aria-label="Close members">
                <X size={18} />
              </button>
            </div>
          )}
          {isViewingDMs ? (
            <>
              <h3 className="member-group-title">Members — 2</h3>
              
              <div 
                className="member-item" 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProfile({ user: activeChannel.target_user, rect: e.currentTarget.getBoundingClientRect() });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({x: e.pageX, y: e.pageY, user: activeChannel.target_user});
                }}
              >
                <div className="user-avatar member-avatar">
                  {getAvatarContent(activeChannel.target_user)}
                  <div className={`status-indicator ${isUserOnline(activeChannel.target_user?.user_id, activeChannel.target_user?.username) ? 'online' : 'offline'}`}></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="member-name">{renderUsernameWithBadges(activeChannel.target_user)}</div>
                  {renderLanyardStatusInList(activeChannel.target_user)}
                </div>
              </div>
              
              <div 
                className="member-item" 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProfile({ user: user, rect: e.currentTarget.getBoundingClientRect() });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({x: e.pageX, y: e.pageY, user: user});
                }}
              >
                <div className="user-avatar member-avatar">
                  {getAvatarContent(user)}
                  <div className="status-indicator online"></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="member-name">{renderUsernameWithBadges(user)}</div>
                  {renderLanyardStatusInList(user)}
                </div>
              </div>
            </>
          ) : (
            (() => {
              const serverRoles = activeServer?.roles || {};
              const visibleMembers = serverMembers.filter(m => {
                if (activeServer?.owner_id === m.user_id) return true;
                const viewRoles = (activeChannel?.view_roles && activeChannel.view_roles.length > 0) 
                  ? activeChannel.view_roles 
                  : ['default', 'mod', 'admin'];
                const userRoles = m.server_roles || ['default'];
                return userRoles.some((r: string) => viewRoles.includes(r));
              });
              const onlineMembers = visibleMembers.filter(m => isUserOnline(m.user_id, m.username));
              const offlineMembers = visibleMembers.filter(m => !isUserOnline(m.user_id, m.username));

              const groups: Record<string, any[]> = {};
              for (const m of onlineMembers) {
                const highestRole = activeServer?.owner_id === m.user_id 
                  ? { id: 'owner', name: 'Server Owner', hierarchy: 9999, color: '' }
                  : getUserHighestRole(m.server_roles, serverRoles);
                const key = `${highestRole.hierarchy}_${highestRole.name}`;
                if (!groups[key]) groups[key] = [];
                m._highestRole = highestRole;
                groups[key].push(m);
              }

              const sortedGroups = Object.entries(groups).sort((a, b) => {
                const hA = parseInt(a[0].split('_')[0]);
                const hB = parseInt(b[0].split('_')[0]);
                return hB - hA;
              });

              return (
                <>
                  {sortedGroups.map(([groupKey, members]) => {
                    const roleName = groupKey.split('_').slice(1).join('_');
                    return (
                      <div key={groupKey}>
                        <h3 className="member-group-title" style={{marginTop: '16px'}}>{roleName} — {members.length}</h3>
                        {members.sort((a,b) => (a.display_name || a.username).localeCompare(b.display_name || b.username)).map(m => (
                          <div 
                            key={m.user_id} 
                            className="member-item" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProfile({ user: m, rect: e.currentTarget.getBoundingClientRect() });
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({x: e.pageX, y: e.pageY, user: m, serverRole: m.server_roles});
                            }}
                          >
                            <div className="user-avatar member-avatar">
                              {getAvatarContent(m)}
                              <div className="status-indicator online"></div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="member-name" style={{ color: m._highestRole?.color || 'inherit' }}>{renderUsernameWithBadges(m)}</div>
                              {renderLanyardStatusInList(m)}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {offlineMembers.length > 0 && (
                    <>
                      <h3 className="member-group-title" style={{marginTop: '16px'}}>Offline — {offlineMembers.length}</h3>
                      {offlineMembers.sort((a,b) => (a.display_name || a.username).localeCompare(b.display_name || b.username)).map(m => {
                        const highestRole = activeServer?.owner_id === m.user_id 
                          ? { id: 'owner', name: 'Server Owner', hierarchy: 9999, color: '' }
                          : getUserHighestRole(m.server_roles, serverRoles);
                        return (
                          <div 
                            key={m.user_id} 
                            className="member-item offline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProfile({ user: m, rect: e.currentTarget.getBoundingClientRect() });
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({x: e.pageX, y: e.pageY, user: m, serverRole: m.server_roles});
                            }}
                          >
                            <div className="user-avatar member-avatar">
                              {getAvatarContent(m)}
                              <div className="status-indicator offline"></div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="member-name" style={{ color: highestRole.color || 'inherit' }}>{renderUsernameWithBadges(m)}</div>
                              {renderLanyardStatusInList(m)}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              );
            })()
          )}
        </div>
      )}

      {selectedProfile && isMobile && (
        <div className="mobile-drawer-overlay profile-overlay" onClick={() => setSelectedProfile(null)} />
      )}
      {selectedProfile && (
        <div 
          className={`profile-popover${isMobile ? ' profile-popover-mobile' : ''}`}
          style={isMobile ? {
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            position: 'fixed',
            maxHeight: 'min(85vh, 520px)',
            overflowY: 'auto',
            width: 'min(340px, calc(100vw - 32px))',
            zIndex: 10050,
          } : {
            top: `${Math.min(selectedProfile.rect.top, window.innerHeight - 300)}px`,
            left: `${selectedProfile.rect.left > window.innerWidth - 350 ? selectedProfile.rect.left - 320 : selectedProfile.rect.right + 10}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {isMobile && (
            <button
              type="button"
              className="icon-btn profile-popover-close"
              onClick={() => setSelectedProfile(null)}
              aria-label="Close profile"
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: 'rgba(0,0,0,0.35)', color: '#fff' }}
            >
              <X size={18} />
            </button>
          )}
          <div className="popover-header">
            {selectedProfile.user.banner && (
              <img
                src={getFullUrl(selectedProfile.user.banner)}
                alt=""
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            <div className="msg-avatar popover-avatar">
              {getAvatarContent(selectedProfile.user)}
            </div>
          </div>
          <div className="popover-body">
            <h3 className="popover-username" style={{margin: 0}}>{renderUsernameWithBadges(selectedProfile.user)}</h3>
            <div style={{fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px', marginTop: '2px'}}>@{selectedProfile.user.username}</div>
            {selectedProfile.user.description && (
              <div className="popover-description">
                <div className="desc-title">ABOUT ME</div>
                <p>{selectedProfile.user.description}</p>
              </div>
            )}
            <div className="desc-title" style={{marginTop: '12px'}}>CORDIS MEMBER SINCE</div>
            <p style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '8px'}}>July 2026</p>
            <div className="desc-title" style={{marginTop: '12px'}}>LAST ACTIVE</div>
            <p style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '16px'}}>
              {formatLastActive(selectedProfile.user.last_active_at, isUserOnline(selectedProfile.user.user_id, selectedProfile.user.username))}
            </p>
            {renderLanyardPresenceInProfile(selectedProfile.user)}
            {user && selectedProfile.user.user_id !== user.user_id && (
              <button 
                className="btn" 
                style={{width: '100%', backgroundColor: 'var(--brand-primary)', color: '#fff', border: 'none', padding: '8px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer'}}
                onClick={() => startDM(selectedProfile.user.user_id)}
              >
                <MessageSquare size={16} /> Message
              </button>
            )}
          </div>
        </div>
      )}

      {serverContextMenu && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999 }}
            onClick={() => setServerContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setServerContextMenu(null); }}
          />
          <div
            style={{
              position: 'fixed',
              top: Math.min(serverContextMenu.y, window.innerHeight - 120),
              left: Math.min(serverContextMenu.x, window.innerWidth - 200),
              zIndex: 100000,
              backgroundColor: 'var(--bg-card)',
              borderRadius: '8px',
              padding: '8px',
              boxShadow: 'var(--shadow-lift)',
              minWidth: '180px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ padding: '4px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{serverContextMenu.server.server_name}</div>
              {serverContextMenu.server.is_verified && <span data-tooltip="Verified" style={{display: 'flex', flexShrink: 0}}><BadgeCheck size={14} color="#3b82f6" /></span>}
            </div>
            {user?.permissions?.includes('SYSTEM_ADMIN') && (
              <button className="dropdown-item" onClick={() => { toggleServerVerification(serverContextMenu.server.server_id); setServerContextMenu(null); }}>
                Toggle Verification
              </button>
            )}
            {effectivePinnedServerId === serverContextMenu.server.server_id ? (
              <>
                <div className="dropdown-item" style={{ cursor: 'default', opacity: 0.75, backgroundColor: 'transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Pin size={14} /> Opens on launch
                </div>
                {!isGeneralServer(serverContextMenu.server) && (
                  <button className="dropdown-item" onClick={unpinServer}>
                    Unpin (use General)
                  </button>
                )}
                {isGeneralServer(serverContextMenu.server) && (
                  <div className="dropdown-item" style={{ cursor: 'default', opacity: 0.6, backgroundColor: 'transparent', fontSize: '12px' }}>
                    General is pinned by default
                  </div>
                )}
              </>
            ) : (
              <button className="dropdown-item" onClick={() => pinServer(serverContextMenu.server)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Pin size={14} /> Pin server
              </button>
            )}
            <button className="dropdown-item" onClick={() => { selectServer(serverContextMenu.server); setServerContextMenu(null); }}>
              Open
            </button>
          </div>
        </>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999}} onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}></div>
          <div style={{position: 'fixed', top: Math.min(contextMenu.y, window.innerHeight - 220), left: Math.min(contextMenu.x, window.innerWidth - 200), zIndex: 100000, backgroundColor: 'var(--bg-card)', borderRadius: '8px', padding: '8px', boxShadow: 'var(--shadow-lift)', minWidth: '180px', border: '1px solid var(--border-subtle)'}}>
            <div style={{padding: '4px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', marginBottom: '4px'}}>{renderUsernameWithBadges(contextMenu.user)}</div>
            {contextMenu.user && user && contextMenu.user.user_id !== user.user_id && (
              <button className="dropdown-item" onClick={() => { startDM(contextMenu.user.user_id); setContextMenu(null); }}>Message</button>
            )}
            {activeServer && !isViewingDMs && contextMenu.user && user && contextMenu.user.user_id !== user.user_id && activeServer.owner_id !== contextMenu.user.user_id && (
              <>
                {isServerAdmin && (
                  <>
                    <div style={{padding: '6px 8px 2px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px'}}>
                      <Shield size={12} /> Server roles
                    </div>
                    {Object.values(activeServer.roles || {}).sort((a: any, b: any) => b.hierarchy - a.hierarchy).map((roleData: any) => {
                      const role = roleData.id || Object.keys(activeServer.roles || {}).find(k => activeServer.roles?.[k] === roleData) || 'default';
                      const userRoles = contextMenu.serverRole || contextMenu.user.server_roles || ['default'];
                      const hasRole = userRoles.includes(role);
                      return (
                        <button
                          key={role}
                          className="dropdown-item"
                          onClick={() => {
                            const newRoles = hasRole ? userRoles.filter((r: string) => r !== role) : [...userRoles, role];
                            if (newRoles.length === 0) newRoles.push('default');
                            setMemberRoles(contextMenu.user.user_id, newRoles);
                            setContextMenu(null);
                          }}
                          style={{ fontWeight: hasRole ? 700 : 400, color: roleData.color || 'inherit' }}
                        >
                          {roleData.name}
                          {hasRole ? ' ✓' : ''}
                        </button>
                      );
                    })}
                  </>
                )}
                {isServerMod && activeServer.invite_code !== 'GLOBAL' && (
                  <button className="dropdown-item danger" onClick={() => { kickMember(contextMenu.user.user_id); setContextMenu(null); }}>
                    Kick from server
                  </button>
                )}
              </>
            )}
            {contextMenu.user && user && contextMenu.user.user_id !== user.user_id && (user.permissions?.includes('SYSTEM_ADMIN') || user.permissions?.includes('SYSTEM_MOD')) && (
              <>
                <button className="dropdown-item" onClick={() => { 
                  setShowAdminPanel(true);
                  setAdminSearchUser(contextMenu.user.username);
                  doAdminSearch(contextMenu.user.username);
                  setContextMenu(null);
                }}>Show in Mod Panel</button>
                
                {contextMenu.user.status === 'BANNED' ? (
                  <div className="dropdown-item danger" style={{cursor: 'default', opacity: 0.8, backgroundColor: 'transparent'}}>Banned</div>
                ) : (
                  <>
                    {(contextMenu.user.muted_until && contextMenu.user.muted_until * 1000 > Date.now()) ? (
                      <div className="dropdown-item danger" style={{cursor: 'default', opacity: 0.8, backgroundColor: 'transparent'}}>Muted</div>
                    ) : (
                      <button className="dropdown-item danger" onClick={() => { handleAdminAction('mute', contextMenu.user.user_id, {duration_seconds: 3600}); setContextMenu(null); }}>SYSTEM Mute (1h)</button>
                    )}
                    
                    {user.permissions?.includes('SYSTEM_ADMIN') && (
                      <button className="dropdown-item danger" onClick={() => { handleAdminAction('ban', contextMenu.user.user_id); setContextMenu(null); }} disabled={contextMenu.user.username?.toLowerCase() === 'system' || contextMenu.user.user_id === user?.user_id}>SYSTEM Ban</button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {msgContextMenu && (
        <>
          <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999}} onClick={() => setMsgContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMsgContextMenu(null); }}></div>
          <div style={{position: 'fixed', top: Math.min(msgContextMenu.y, window.innerHeight - 150), left: Math.min(msgContextMenu.x, window.innerWidth - 180), zIndex: 100000, backgroundColor: 'var(--bg-card)', borderRadius: '8px', padding: '8px', boxShadow: 'var(--shadow-lift)', minWidth: '150px', border: '1px solid var(--border-subtle)'}}>
            <button className="dropdown-item" onClick={() => handleRevealMessage(msgContextMenu.message.message_id)}>Show message</button>
          </div>
        </>
      )}

      {/* Create Server Modal */}
      {showCreateServer && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowCreateServer(false); setJoinInviteError(''); } }}>
          <div className="modal-content" style={{gap: '0px'}}>
            <div className="modal-header">
              <div className="modal-title">Create a Server</div>
              <div className="modal-desc">Give your new server a personality with a name and description.</div>
            </div>
            <form onSubmit={createServer} style={{marginBottom: '20px'}}>
              <div className="modal-body" style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                <input name="name" className="input" placeholder="Server Name" required disabled={isCreatingServer} />
                <input name="desc" className="input" placeholder="Description" disabled={isCreatingServer} />
                <label style={{display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px', color: 'var(--text-muted)'}}>
                  <input type="checkbox" name="is_public" disabled={isCreatingServer} /> Make Public (Discoverable)
                </label>
              </div>
              <div className="modal-footer" style={{marginTop: '12px'}}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateServer(false)} disabled={isCreatingServer}>Cancel</button>
                <button type="submit" className="btn" style={{minWidth: '100px'}} disabled={isCreatingServer}>
                  {isCreatingServer ? <Loader2 size={18} className="spinner" /> : 'Create'}
                </button>
              </div>
            </form>
            
            <hr style={{border: '0', borderTop: '1px solid var(--border-subtle)', margin: '16px 0', width: '100%'}} />
            
            <div className="modal-header" style={{paddingTop: '8px'}}>
              <div className="modal-title" style={{fontSize: '1.1rem'}}>Join a Server</div>
              <div className="modal-desc">Enter an invite code to join an existing server.</div>
            </div>
            <form onSubmit={joinByInviteCodeSubmit}>
              <div className="modal-body" style={{display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '0px'}}>
                <div style={{display: 'flex', gap: '8px'}}>
                  <input 
                    className="input" 
                    placeholder="Invite Code (e.g. aBcdEfg)" 
                    value={joinInviteCode} 
                    onChange={e => setJoinInviteCode(e.target.value)} 
                    required 
                    disabled={isJoiningByInvite}
                    style={{margin: 0, flex: 1}}
                  />
                  <button type="submit" className="btn" disabled={isJoiningByInvite} style={{minWidth: '80px'}}>
                    {isJoiningByInvite ? <Loader2 size={18} className="spinner" /> : 'Join'}
                  </button>
                </div>
                {joinInviteError && <div className="error-msg" style={{marginTop: '4px'}}>{joinInviteError}</div>}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discover Server Modal */}
      {showDiscover && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowDiscover(false); }}>
          <div className="modal-content" style={{maxHeight: '80vh'}}>
            <div className="modal-header">
              <div className="modal-title">Discover Servers</div>
              <div className="modal-desc">Find communities to join</div>
            </div>
            <div className="modal-body" style={{overflowY: 'auto'}}>
              {isLoadingDiscover ? (
                <>
                  <div className="skeleton" style={{height: '80px', marginBottom: '8px'}}></div>
                  <div className="skeleton" style={{height: '80px'}}></div>
                </>
              ) : (
                <>
                  {publicServers.map(s => (
                    <div key={s.server_id} className="server-card">
                      <div className="server-card-info">
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                           <div style={{width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--brand-primary)', flexShrink: 0, overflow: 'hidden'}}>
                             {s.server_image ? <img src={getFullUrl(s.server_image)} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
                           </div>
                           <h4 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '4px'}}>
                             {s.server_name}
                             {s.is_verified && <span data-tooltip="Verified" style={{display: 'flex'}}><BadgeCheck size={16} color="#3b82f6" /></span>}
                           </h4>
                        </div>
                        <p style={{marginTop: '4px'}}>{s.server_description}</p>
                      </div>
                      <button 
                        className="btn" 
                        onClick={() => joinServer(s.invite_code, s.server_id)}
                        disabled={isJoiningServer === s.server_id || servers.some(myS => myS.server_id === s.server_id)}
                        style={{minWidth: '80px'}}
                      >
                        {isJoiningServer === s.server_id ? <Loader2 size={18} className="spinner" /> : (servers.some(myS => myS.server_id === s.server_id) ? 'Joined' : 'Join')}
                      </button>
                    </div>
                  ))}
                  {publicServers.length === 0 && (
                    <div style={{textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-4) 0'}}>
                      No public servers found.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}>
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">My Account</div>
              <div className="modal-desc">Update your profile settings</div>
            </div>
            
            <form onSubmit={saveSettings}>
              <div className="modal-body" style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                
                <div style={{position: 'relative', width: '80px', height: '80px', marginBottom: '16px'}}>
                  {settingsProfilePic ? (
                    <img src={getFullUrl(settingsProfilePic)} alt="Profile" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />
                  ) : (
                    <div style={{width: '100%', height: '100%', borderRadius: '50%', backgroundColor: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: '#fff', fontWeight: 600}}>
                      {settingsUsername.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <label style={{position: 'absolute', bottom: 0, right: 0, backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                    <Plus size={16} />
                    <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => openCropModalForFile(e, 'userAvatar')} />
                  </label>
                </div>

                <div style={{width: '100%', marginBottom: '16px'}}>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Profile Banner</label>
                  <div style={{width: '100%', height: '100px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', position: 'relative', overflow: 'hidden'}}>
                    {settingsBanner && <img src={getFullUrl(settingsBanner)} alt="Banner" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                    <label style={{position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                      <Plus size={16} />
                      <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => openCropModalForFile(e, 'userBanner')} />
                    </label>
                  </div>
                </div>

                <div style={{width: '100%', display: 'flex', flexDirection: 'column', gap: '16px'}}>
                  <div>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Appearance</label>
                    <div className="theme-toggle-row">
                      <span>Theme</span>
                      <div className="theme-toggle-btns">
                        <button
                          type="button"
                          className={`btn btn-secondary${theme === 'dark' ? ' active' : ''}`}
                          onClick={() => setTheme('dark')}
                          disabled={isSavingSettings}
                        >
                          <Moon size={16} /> Dark
                        </button>
                        <button
                          type="button"
                          className={`btn btn-secondary${theme === 'light' ? ' active' : ''}`}
                          onClick={() => setTheme('light')}
                          disabled={isSavingSettings}
                        >
                          <Sun size={16} /> Light
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Display Name</label>
                    <input className="input" value={settingsDisplayName} onChange={e => setSettingsDisplayName(e.target.value)} required disabled={isSavingSettings} />
                  </div>
                  <div>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Username</label>
                    <input className="input" value={settingsUsername} onChange={e => setSettingsUsername(e.target.value)} required disabled={isSavingSettings} />
                  </div>
                  <div>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>About Me</label>
                    <textarea 
                      className="input" 
                      value={settingsDescription} 
                      onChange={e => setSettingsDescription(e.target.value)} 
                      disabled={isSavingSettings}
                      style={{resize: 'none', height: '80px'}}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Discord ID (for Lanyard Rich Presence)</label>
                  <input className="input" value={settingsDiscordId} onChange={e => setSettingsDiscordId(e.target.value)} disabled={isSavingSettings} placeholder="e.g. 123456789012345678" />
                  {lanyardNotInServer && settingsDiscordId === user?.discord_id && (
                    <div style={{color: 'var(--status-dnd)', fontSize: '12px', marginTop: '4px'}}>
                      To show your Discord presence, you must join the <a href="https://discord.gg/UrXF2cfJ7F" target="_blank" rel="noreferrer" style={{color: 'var(--status-dnd)', textDecoration: 'underline'}}>Lanyard Discord</a>.
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeSettings} disabled={isSavingSettings}>Cancel</button>
                <button type="submit" className="btn" style={{minWidth: '100px'}} disabled={isSavingSettings}>
                  {isSavingSettings ? <Loader2 size={18} className="spinner" /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {showAdminPanel && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAdminPanel(false); }}>
          <div className="modal-content" style={{width: '100vw', height: '100vh', maxWidth: 'none', maxHeight: 'none', borderRadius: 0, display: 'flex', flexDirection: 'column'}}>
            <div className="modal-header" style={{ position: 'relative' }}>
              <div className="modal-title">System Administration</div>
              <div className="modal-desc">ADMINSTRATEEE THEMMMMMMM</div>
              <button 
                onClick={() => setShowAdminPanel(false)}
                style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
              >
                <span style={{ fontSize: '20px', marginBottom: '2px' }}>×</span>
                ESC
              </button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ width: '100%', maxWidth: '500px', margin: '0 auto', paddingTop: '32px' }}>
                <form onSubmit={handleAdminSearch} style={{display: 'flex', gap: '8px', marginBottom: '16px'}}>
                  <input className="input" placeholder="Search by username..." value={adminSearchUser} onChange={e => setAdminSearchUser(e.target.value)} style={{ flex: 1 }} />
                  <button type="submit" className="btn" disabled={adminLoading}>Search</button>
                </form>
                {adminMessage && <div style={{color: 'var(--brand-primary)', marginBottom: '16px'}}>{adminMessage}</div>}
                {adminUserResult && (
                  <div className="profile-popover" style={{ position: 'relative', width: '100%', marginBottom: '16px' }}>
                    <div className="popover-header">
                      {adminUserResult.banner && (
                        <img
                          src={getFullUrl(adminUserResult.banner)}
                          alt=""
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      )}
                      <div className="msg-avatar popover-avatar">
                        {getAvatarContent(adminUserResult)}
                      </div>
                    </div>
                    <div className="popover-body">
                      <h3 className="popover-username" style={{margin: 0}}>
                        {renderUsernameWithBadges(adminUserResult)} <span style={{fontSize: '14px', fontWeight: 'normal', color: 'var(--text-muted)'}}>(ID: {adminUserResult.user_id})</span>
                      </h3>
                      <div style={{fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px', marginTop: '2px'}}>@{adminUserResult.username}</div>
                      {adminUserResult.description && (
                        <div className="popover-description">
                          <div className="desc-title">ABOUT ME</div>
                          <p>{adminUserResult.description}</p>
                        </div>
                      )}
                      <div className="desc-title" style={{marginTop: '12px'}}>CORDIS MEMBER SINCE</div>
                      <p style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '8px'}}>July 2026</p>
                      <div className="desc-title" style={{marginTop: '12px'}}>LAST ACTIVE</div>
                      <p style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '16px'}}>
                        {formatLastActive(adminUserResult.last_active_at, isUserOnline(adminUserResult.user_id, adminUserResult.username))}
                      </p>
                      
                      {adminUserServers.length > 0 && (
                        <>
                          <div className="desc-title" style={{marginTop: '12px'}}>SERVERS JOINED</div>
                          {adminUserServers.map(server => (
                            <div key={server.server_id} style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                              <span style={{display: 'flex', alignItems: 'center', gap: '4px'}}>{server.server_name} {server.is_verified && <span data-tooltip="Verified" style={{display: 'flex'}}><BadgeCheck size={14} color="#3b82f6" /></span>}</span>
                              <span style={{color: 'var(--text-muted)'}}>(ID: {server.server_id})</span>
                              {user?.permissions?.includes('SYSTEM_ADMIN') && (
                                <button type="button" className="btn btn-secondary" style={{padding: '2px 6px', fontSize: '10px'}} onClick={() => toggleServerVerification(server.server_id)}>Toggle Verification</button>
                              )}
                            </div>
                          ))}
                          <div style={{marginBottom: '16px'}}></div>
                        </>
                      )}

                      <div className="desc-title" style={{marginTop: '12px'}}>MODERATION STATUS</div>
                      <div style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '16px'}}>
                        Status: {adminUserResult.status}<br/>
                        Roles: {adminUserResult.permissions?.join(', ') || 'None'}<br/>
                        {adminUserResult.muted_until ? <>Muted Until: {new Date(adminUserResult.muted_until * 1000).toLocaleString()}<br/></> : null}
                      </div>
                      
                      <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px'}}>
                        {user?.permissions?.includes('SYSTEM_ADMIN') && (
                          <>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction(adminUserResult.status === 'BANNED' ? 'unban' : 'ban', adminUserResult.user_id)} disabled={adminUserResult.username?.toLowerCase() === 'system' || adminUserResult.user_id === user?.user_id}>{adminUserResult.status === 'BANNED' ? 'Unban' : 'Ban'}</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('promote', adminUserResult.user_id, {role: 'SYSTEM_MOD'})}>Make Mod</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('promote', adminUserResult.user_id, {role: 'SYSTEM_ADMIN'})}>Make Admin</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('demote', adminUserResult.user_id)}>Demote</button>
                            <button type="button" className="btn btn-secondary" onClick={() => {
                              const newName = window.prompt("Enter new display name:", adminUserResult.display_name);
                              if (newName && newName !== adminUserResult.display_name) {
                                handleAdminAction('update_user', adminUserResult.user_id, { display_name: newName });
                              }
                            }}>Rename User</button>
                            <button type="button" className="btn btn-secondary danger" onClick={() => {
                              if (window.confirm("Flag this user's username? They will be forced to change it.")) {
                                handleAdminAction('flag_username', adminUserResult.user_id);
                              }
                            }} disabled={adminUserResult.username?.toLowerCase() === 'system' || adminUserResult.user_id === user?.user_id}>Flag Username</button>
                          </>
                        )}
                        {(user?.permissions?.includes('SYSTEM_ADMIN') || user?.permissions?.includes('SYSTEM_MOD')) && (
                          <>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('mute', adminUserResult.user_id, {duration_seconds: 3600})}>Mute (1h)</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('mute', adminUserResult.user_id, {duration_seconds: 0})}>Mute (Indefinite)</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('unmute', adminUserResult.user_id)}>Unmute</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Server Settings Modal */}
      {showServerSettings && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeServerSettings(); }}>
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">Server</div>
              <div className="modal-desc">UPDATE IT!!! UPDATE YOUR SERVER!!!!!!!</div>
            </div>
            <form onSubmit={saveServerSettings}>
              <div className="modal-body" style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                
                <div style={{position: 'relative', width: '80px', height: '80px', marginBottom: '16px'}}>
                  {serverImage ? (
                    <img src={getFullUrl(serverImage)} alt="Server Icon" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />
                  ) : (
                    <div style={{width: '100%', height: '100%', borderRadius: '50%', backgroundColor: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: '#fff', fontWeight: 600}}>
                      {serverName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <label style={{position: 'absolute', bottom: 0, right: 0, backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                    <Plus size={16} />
                    <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => openCropModalForFile(e, 'serverIcon')} />
                  </label>
                </div>

                <div style={{width: '100%', marginBottom: '16px'}}>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Server Banner</label>
                  <div style={{width: '100%', height: '100px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', position: 'relative', overflow: 'hidden'}}>
                    {serverBanner && <img src={getFullUrl(serverBanner)} alt="Server Banner" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                    <label style={{position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                      <Plus size={16} />
                      <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => openCropModalForFile(e, 'serverBanner')} />
                    </label>
                  </div>
                </div>

                <div style={{width: '100%', display: 'flex', flexDirection: 'column', gap: '16px'}}>
                  <div>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Server Name</label>
                    <input className="input" value={serverName} onChange={e => setServerName(e.target.value)} required disabled={isSavingServer} />
                  </div>
                  <div>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Description</label>
                    <textarea 
                      className="input" 
                      value={serverDescription} 
                      onChange={e => setServerDescription(e.target.value)} 
                      disabled={isSavingServer}
                      style={{resize: 'none', height: '80px'}}
                    />
                  </div>
                </div>
                
                <div style={{width: '100%', marginTop: '24px', borderTop: '1px solid var(--border-subtle)', paddingTop: '24px'}}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0}}>Roles</label>
                    <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => {
                      const newRoleId = 'role_' + Date.now();
                      setServerRolesSettings({
                        ...serverRolesSettings,
                        [newRoleId]: { id: newRoleId, name: 'New Role', color: '#99aab5', hierarchy: Object.keys(serverRolesSettings).length + 1, permissions: [] }
                      });
                    }}>
                      <Plus size={14} style={{ marginRight: '4px' }} /> Add Role
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {Object.entries(serverRolesSettings).sort((a: any, b: any) => b[1].hierarchy - a[1].hierarchy).map(([roleId, role]: [string, any]) => (
                      <div key={roleId} style={{ display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', padding: '8px', borderRadius: '8px' }}>
                        <input 
                          type="color" 
                          value={role.color || '#99aab5'}
                          onChange={(e) => {
                            const updated = { ...role, color: e.target.value };
                            setServerRolesSettings({ ...serverRolesSettings, [roleId]: updated });
                          }}
                          style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        />
                        <input 
                          className="input" 
                          value={role.name}
                          onChange={(e) => {
                            const updated = { ...role, name: e.target.value };
                            setServerRolesSettings({ ...serverRolesSettings, [roleId]: updated });
                          }}
                          style={{ flex: 1, padding: '4px 8px', height: 'auto' }}
                          placeholder="Role Name"
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Rank:</label>
                          <input 
                            type="number"
                            className="input"
                            value={role.hierarchy}
                            onChange={(e) => {
                              const updated = { ...role, hierarchy: parseInt(e.target.value) || 0 };
                              setServerRolesSettings({ ...serverRolesSettings, [roleId]: updated });
                            }}
                            style={{ width: '60px', padding: '4px 8px', height: 'auto' }}
                          />
                        </div>
                        
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                          <input 
                            type="checkbox"
                            checked={role.permissions?.includes('ADMIN')}
                            onChange={(e) => {
                              const perms = role.permissions || [];
                              const newPerms = e.target.checked ? [...perms, 'ADMIN'] : perms.filter((p: string) => p !== 'ADMIN');
                              const updated = { ...role, permissions: newPerms };
                              setServerRolesSettings({ ...serverRolesSettings, [roleId]: updated });
                            }}
                          />
                          Admin
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                          <input 
                            type="checkbox"
                            checked={role.permissions?.includes('MOD')}
                            onChange={(e) => {
                              const perms = role.permissions || [];
                              const newPerms = e.target.checked ? [...perms, 'MOD'] : perms.filter((p: string) => p !== 'MOD');
                              const updated = { ...role, permissions: newPerms };
                              setServerRolesSettings({ ...serverRolesSettings, [roleId]: updated });
                            }}
                          />
                          Mod
                        </label>
                        <button 
                          type="button" 
                          className="icon-btn" 
                          style={{ color: '#ef4444' }}
                          onClick={() => {
                            if (!window.confirm(`Delete role ${role.name}?`)) return;
                            const newRoles = { ...serverRolesSettings };
                            delete newRoles[roleId];
                            setServerRolesSettings(newRoles);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    {Object.keys(serverRolesSettings).length === 0 && (
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                        No custom roles. Server uses default roles.
                      </div>
                    )}
                  </div>
                </div>

                <div style={{width: '100%', marginTop: '24px', borderTop: '1px solid var(--border-subtle)', paddingTop: '24px'}}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0}}>
                      Custom Emojis ({serverEmojis.length}/50)
                    </label>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Members can use these with <code style={{ color: 'var(--text-primary)' }}>:name:</code> in chat or as reactions.
                  </div>

                  {isServerAdmin ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px', backgroundColor: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <label
                          style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '8px',
                            background: 'var(--bg-primary)',
                            border: '1px dashed var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}
                          title="Upload emoji image"
                        >
                          {newEmojiPreview ? (
                            <img src={newEmojiPreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <Plus size={18} style={{ color: 'var(--text-muted)' }} />
                          )}
                          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: 'none' }} onChange={handleNewEmojiFileChange} />
                        </label>
                        <input
                          className="input"
                          value={newEmojiName}
                          onChange={(e) => setNewEmojiName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (!isUploadingEmoji && newEmojiFile && newEmojiName.trim()) addServerEmoji();
                            }
                          }}
                          placeholder="emoji_name"
                          disabled={isUploadingEmoji}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{ minWidth: '90px' }}
                          onClick={addServerEmoji}
                          disabled={isUploadingEmoji || !newEmojiFile || !newEmojiName.trim()}
                        >
                          {isUploadingEmoji ? <Loader2 size={16} className="spinner" /> : 'Add'}
                        </button>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        PNG/GIF/WebP/JPEG · max 256KB · name: 2–32 chars (a-z, 0-9, _)
                      </div>
                      {emojiSettingsError && <div className="error-msg" style={{ margin: 0 }}>{emojiSettingsError}</div>}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      Only server admins can add or remove emojis.
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                    {serverEmojis.map((em) => (
                      <div
                        key={em.emoji_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          backgroundColor: 'var(--bg-secondary)',
                          padding: '8px 10px',
                          borderRadius: '8px',
                        }}
                      >
                        <img
                          src={getFullUrl(em.image_url)}
                          alt={`:${em.name}:`}
                          className="custom-emoji"
                          style={{ width: '32px', height: '32px' }}
                          draggable={false}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>:{em.name}:</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID {em.emoji_id}</div>
                        </div>
                        {isServerAdmin && (
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ color: '#ef4444' }}
                            onClick={() => deleteServerEmoji(em.emoji_id)}
                            title="Delete emoji"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    {serverEmojis.length === 0 && (
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                        No custom emojis yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{justifyContent: 'space-between'}}>
                <button type="button" className="btn" style={{backgroundColor: '#ef4444', border: 'none'}} onClick={deleteServer} disabled={isDeletingServer || isSavingServer}>
                  {isDeletingServer ? <Loader2 size={18} className="spinner" /> : 'Delete Server'}
                </button>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button type="button" className="btn btn-secondary" onClick={closeServerSettings} disabled={isSavingServer || isDeletingServer}>Cancel</button>
                  <button type="submit" className="btn" style={{minWidth: '100px'}} disabled={isSavingServer || isDeletingServer}>
                    {isSavingServer ? <Loader2 size={18} className="spinner" /> : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {renderInvitePreviewModal()}

      {showScheduleModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowScheduleModal(false); }}>
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="modal-header" style={{ position: 'relative' }}>
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={20} /> Schedule Message
              </div>
              <div className="modal-desc">
                Pick when to send your current draft in #{activeChannel?.channel_name || 'channel'}.
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowScheduleModal(false)}
                style={{ position: 'absolute', top: '16px', right: '16px', color: 'var(--text-muted)' }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(chatInput.trim() || attachmentFile) ? (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  maxHeight: '80px',
                  overflow: 'hidden',
                }}>
                  <div style={{ color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 600 }}>Draft</div>
                  {chatInput.trim() ? (
                    <div style={{ whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {chatInput.length > 160 ? chatInput.slice(0, 160) + '…' : chatInput}
                    </div>
                  ) : (
                    <div>Attachment: {attachmentFile?.name}</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Type a message in the chat box first, then open this again.
                </div>
              )}
              <label style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                Send at
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduleAtLocal}
                  onChange={(e) => setScheduleAtLocal(e.target.value)}
                  disabled={isScheduling}
                />
              </label>
              {scheduleError && <div className="error-msg">{scheduleError}</div>}
              {scheduleSuccess && (
                <div style={{ fontSize: '13px', color: '#23a559', fontWeight: 500 }}>{scheduleSuccess}</div>
              )}
              {scheduledMessages.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Pending in this channel
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '160px', overflowY: 'auto' }}>
                    {scheduledMessages.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '12px', color: 'var(--brand-primary)', fontWeight: 600 }}>
                            {new Date(s.scheduled_at * 1000).toLocaleString()}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.content?.text || (s.content?.attachments?.length ? '[attachment]' : '(empty)')}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Cancel scheduled message"
                          onClick={() => cancelScheduledMessage(s.id)}
                          style={{ flexShrink: 0 }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ marginTop: '12px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowScheduleModal(false)} disabled={isScheduling}>
                Close
              </button>
              <button
                type="button"
                className="btn"
                style={{ minWidth: '120px' }}
                disabled={isScheduling || (!chatInput.trim() && !attachmentFile)}
                onClick={() => submitScheduledMessage()}
              >
                {isScheduling ? <Loader2 size={18} className="spinner" /> : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteManager && activeServer && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowInviteManager(false); }}>
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header" style={{ position: 'relative' }}>
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link2 size={20} /> Server Invites
              </div>
              <div className="modal-desc">
                Create links with expiry, use limits, and temporary membership for {activeServer.server_name}.
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowInviteManager(false)}
                style={{ position: 'absolute', top: '16px', right: '16px', color: 'var(--text-muted)' }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
              }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  Max uses
                  <select className="input" value={inviteMaxUses} onChange={(e) => setInviteMaxUses(e.target.value)} disabled={isCreatingInvite}>
                    <option value="unlimited">Unlimited</option>
                    <option value="1">1 use</option>
                    <option value="5">5 uses</option>
                    <option value="10">10 uses</option>
                    <option value="25">25 uses</option>
                    <option value="50">50 uses</option>
                    <option value="100">100 uses</option>
                  </select>
                </label>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  Expires after
                  <select className="input" value={inviteExpires} onChange={(e) => setInviteExpires(e.target.value)} disabled={isCreatingInvite}>
                    <option value="never">Never</option>
                    <option value="30m">30 minutes</option>
                    <option value="1h">1 hour</option>
                    <option value="6h">6 hours</option>
                    <option value="12h">12 hours</option>
                    <option value="1d">1 day</option>
                    <option value="7d">7 days</option>
                  </select>
                </label>
                <label style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={inviteTemporary}
                    onChange={(e) => setInviteTemporary(e.target.checked)}
                    disabled={isCreatingInvite}
                  />
                  Temporary membership (leave when offline)
                </label>
                {inviteCreateError && <div className="error-msg" style={{ gridColumn: '1 / -1' }}>{inviteCreateError}</div>}
                <button
                  type="button"
                  className="btn"
                  style={{ gridColumn: '1 / -1' }}
                  onClick={() => createServerInvite()}
                  disabled={isCreatingInvite}
                >
                  {isCreatingInvite ? <Loader2 size={18} className="spinner" /> : 'Create Invite'}
                </button>
              </div>

              {activeServer.invite_code && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Default server code</div>
                    <div style={{ fontSize: '13px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {activeServer.invite_code}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => copyInviteLink(activeServer.invite_code)}>
                    <Copy size={14} /> Copy
                  </button>
                </div>
              )}

              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Active invites
                </div>
                {isLoadingInvites ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
                    <Loader2 size={20} className="spinner" />
                  </div>
                ) : serverInvites.length === 0 ? (
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No invites yet — create one above.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                    {serverInvites.map((inv) => (
                      <div
                        key={inv.invite_id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-subtle)',
                          background: inv.is_valid ? 'var(--bg-secondary)' : 'rgba(242, 63, 67, 0.08)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '14px' }}>{inv.code}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              <span>
                                Uses: {inv.uses}{inv.max_uses != null ? ` / ${inv.max_uses}` : ' / ∞'}
                              </span>
                              <span>Expires: {formatInviteExpiry(inv.expires_at)}</span>
                              {inv.temporary && <span style={{ color: 'var(--brand-primary)' }}>Temporary</span>}
                              {!inv.is_valid && <span style={{ color: '#f23f43' }}>Expired / full</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Copy link"
                              onClick={() => copyInviteLink(inv.code, inv.invite_id)}
                            >
                              {inviteCopiedId === inv.invite_id ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="Revoke invite"
                              onClick={() => revokeServerInvite(inv.invite_id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowInviteManager(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannelModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreateChannelModal(false); }}>
          <div className="modal-content" style={{maxWidth: '400px'}}>
            <div className="modal-header" style={{ position: 'relative' }}>
              <div className="modal-title">Create Channel</div>
              <div className="modal-desc">Create a new text channel to organize your discussions.</div>
              <button 
                className="icon-btn" 
                onClick={() => setShowCreateChannelModal(false)}
                style={{ position: 'absolute', top: '16px', right: '16px', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={createChannel}>
              <div className="modal-body" style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                {categories.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Category</label>
                    <select
                      className="input"
                      value={newChannelCategoryId}
                      onChange={e => setNewChannelCategoryId(Number(e.target.value))}
                      disabled={isCreatingChannel}
                    >
                      <option value={0}>None</option>
                      {sortedCategories.map(cat => (
                        <option key={cat.category_id} value={cat.category_id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="channelName" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Channel Name</label>
                  <div style={{
                    display: 'flex', 
                    alignItems: 'center', 
                    backgroundColor: 'var(--bg-input)', 
                    borderRadius: 'var(--radius-sm)', 
                    border: '1px solid var(--border-subtle)', 
                    paddingLeft: '10px'
                  }}>
                    <Hash size={16} style={{color: 'var(--text-muted)', marginRight: '6px'}}/>
                    <input 
                      type="text" 
                      id="channelName" 
                      className="input"
                      required 
                      autoFocus
                      placeholder="new-channel" 
                      value={newChannelName}
                      onChange={e => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                      disabled={isCreatingChannel}
                      style={{ 
                        border: 'none', 
                        backgroundColor: 'transparent', 
                        padding: '10px 10px 10px 0', 
                        margin: 0,
                        flex: 1,
                        color: 'var(--text-normal)',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <small style={{color: 'var(--text-muted)', fontSize: '0.75rem'}}>
                    Only lowercase letters, numbers, and dashes.
                  </small>
                </div>
              </div>
              <div className="modal-footer" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateChannelModal(false)} disabled={isCreatingChannel}>Cancel</button>
                <button type="submit" className="btn" disabled={isCreatingChannel} style={{minWidth: '120px'}}>
                  {isCreatingChannel ? <Loader2 size={18} className="spinner" /> : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateCategoryModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreateCategoryModal(false); }}>
          <div className="modal-content" style={{maxWidth: '400px'}}>
            <div className="modal-header">
              <div className="modal-title">Create Category</div>
              <div className="modal-desc">Group channels under a category header.</div>
            </div>
            <form onSubmit={createCategory}>
              <div className="modal-body">
                <input
                  className="input"
                  placeholder="Category name"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  required
                  autoFocus
                  disabled={isCreatingCategory}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateCategoryModal(false)} disabled={isCreatingCategory}>Cancel</button>
                <button type="submit" className="btn" disabled={isCreatingCategory}>
                  {isCreatingCategory ? <Loader2 size={18} className="spinner" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChannelSettings && channelSettingsTarget && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowChannelSettings(false); }}>
          <div className="modal-content" style={{maxWidth: '440px'}}>
            <div className="modal-header">
              <div className="modal-title">Channel Settings</div>
              <div className="modal-desc">Who can see and type in #{channelSettingsTarget.channel_name}</div>
            </div>
            <form onSubmit={saveChannelSettings}>
              <div className="modal-body" style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                <div>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '6px'}}>Name</label>
                  <input className="input" value={channelSettingsName} onChange={e => setChannelSettingsName(e.target.value)} required disabled={isSavingChannelSettings} />
                </div>
                <div>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '6px'}}>Category</label>
                  <select className="input" value={channelSettingsCategoryId} onChange={e => setChannelSettingsCategoryId(Number(e.target.value))} disabled={isSavingChannelSettings}>
                    <option value={0}>None</option>
                    {sortedCategories.map(cat => (
                      <option key={cat.category_id} value={cat.category_id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '8px'}}>Who can view</label>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    {(['default', 'mod', 'admin'] as const).map(role => (
                      <label key={`view-${role}`} style={{display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer'}}>
                        <input
                          type="checkbox"
                          checked={channelSettingsViewRoles.includes(role)}
                          onChange={() => toggleRoleInList(channelSettingsViewRoles, role, setChannelSettingsViewRoles)}
                          disabled={isSavingChannelSettings}
                        />
                        {role === 'default' ? 'Default (everyone)' : role === 'mod' ? 'Mod' : 'Admin'}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '8px'}}>Who can type</label>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    {(['default', 'mod', 'admin'] as const).map(role => (
                      <label key={`send-${role}`} style={{display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer'}}>
                        <input
                          type="checkbox"
                          checked={channelSettingsSendRoles.includes(role)}
                          onChange={() => toggleRoleInList(channelSettingsSendRoles, role, setChannelSettingsSendRoles)}
                          disabled={isSavingChannelSettings}
                        />
                        {role === 'default' ? 'Default (everyone)' : role === 'mod' ? 'Mod' : 'Admin'}
                      </label>
                    ))}
                  </div>
                  <div style={{fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px'}}>
                    Example: announcements → only Admin can type. Private → uncheck Default under view.
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{justifyContent: 'space-between'}}>
                <button type="button" className="btn" style={{backgroundColor: '#ef4444', border: 'none'}} onClick={() => deleteChannel(channelSettingsTarget.channel_id)} disabled={isSavingChannelSettings}>
                  Delete
                </button>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowChannelSettings(false)} disabled={isSavingChannelSettings}>Cancel</button>
                  <button type="submit" className="btn" disabled={isSavingChannelSettings}>
                    {isSavingChannelSettings ? <Loader2 size={18} className="spinner" /> : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Crop Modal - rendered last so it always paints on top of any other open modal */}
      {cropRequest && (
        <ImageCropModal
          imageSrc={cropRequest.imageSrc}
          {...CROP_CONFIG[cropRequest.target]}
          onCancel={handleCropCancel}
          onSave={handleCropSave}
        />
      )}

      {user?.username_flagged && (
        <div className="modal-overlay" style={{ zIndex: 9999999, backgroundColor: 'var(--bg-card)' }}>
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title">Action Required</div>
              <div className="modal-desc">Your username has been flagged by a moderator and must be changed before you can continue using Cordis.</div>
            </div>
            <form onSubmit={handleForcedUsernameChange}>
              <div className="modal-body">
                {forcedUsernameError && <div className="error-message" style={{marginBottom: '12px'}}>{forcedUsernameError}</div>}
                <div style={{marginBottom: '16px'}}>
                  <label style={{display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '13px', color: 'var(--text-muted)'}}>New Username</label>
                  <input
                    type="text"
                    className="input"
                    value={forcedNewUsername}
                    onChange={e => setForcedNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                    placeholder="Enter new username..."
                    disabled={isChangingForcedUsername}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer" style={{justifyContent: 'flex-end'}}>
                <button type="submit" className="btn btn-primary" disabled={isChangingForcedUsername || !forcedNewUsername.trim()}>
                  {isChangingForcedUsername ? <Loader2 size={18} className="spinner" /> : 'Update Username'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
