import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Compass, Plus, Hash, LogOut, Send, Loader2, Settings, Users, Home, MessageSquare, Check, X, AlertTriangle, Pencil, Trash2, Reply, File as FileIcon, UploadCloud, Download, Hammer, Play, Pause, Smile, Pin, Sun, Moon, ChevronDown, ChevronRight, FolderPlus, Shield, Menu } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import EmojiPicker, { Theme } from 'emoji-picker-react';

const API_BASE = import.meta.env.VITE_API_BASE || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? "http://127.0.0.1:8000" : "");

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

const renderMessageText = (text: string | undefined, onMentionClick?: (username: string, e: React.MouseEvent) => void) => {
  if (!text) return null;
  
  // Pre-process text for mentions: turn @username into [@username](https://mention.local/username)
  // We use a simple regex that only matches if not preceded by word characters
  const processedText = text.replace(/(^|\s)@(\w+)/g, '$1[@$2](https://mention.local/$2)');

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <p style={{ margin: 0, padding: 0 }} {...props} />,
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
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
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
  const [settingsProfilePic, setSettingsProfilePic] = useState('');
  const [settingsBanner, setSettingsBanner] = useState('');
  const [settingsProfilePicFile, setSettingsProfilePicFile] = useState<File | null>(null);
  const [settingsBannerFile, setSettingsBannerFile] = useState<File | null>(null);

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminSearchUser, setAdminSearchUser] = useState('');
  const [adminUserResult, setAdminUserResult] = useState<any>(null);
  const [adminUserServers, setAdminUserServers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

  const [showServerSettings, setShowServerSettings] = useState(false);
  const [isSavingServer, setIsSavingServer] = useState(false);
  const [serverName, setServerName] = useState('');
  const [serverDescription, setServerDescription] = useState('');
  const [serverImage, setServerImage] = useState('');
  const [serverBanner, setServerBanner] = useState('');
  const [serverImageFile, setServerImageFile] = useState<File | null>(null);
  const [serverBannerFile, setServerBannerFile] = useState<File | null>(null);
  const [isDeletingServer, setIsDeletingServer] = useState(false);
  const [isLeavingServer, setIsLeavingServer] = useState(false);

  // Invite code joining
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [isJoiningByInvite, setIsJoiningByInvite] = useState(false);
  const [joinInviteError, setJoinInviteError] = useState('');
  
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  
  // Pending invite from URL
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  const [showInvitePreview, setShowInvitePreview] = useState(false);
  const [invitePreviewData, setInvitePreviewData] = useState<any>(null);
  const [invitePreviewError, setInvitePreviewError] = useState('');
  const [isJoiningPreview, setIsJoiningPreview] = useState(false);

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
    if (ws) { ws.close(); setWs(null); }
    if (isMobile) setMobileNavOpen(true);
    setMobileMembersOpen(false);
    
    fetchServerMembersAndPresence(server.server_id);
    
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
        if (!data.server_id && isViewingDMsRef.current) {
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
          setToken(data.access_token);
        } else throw new Error(data.detail);
      } else {
        const res = await fetch(`${API_BASE}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (res.ok) {
          setIsLogin(true);
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
    setToken(null);
    setUser(null);
    setServers([]);
    setActiveServer(null);
    setChannels([]);
    setActiveChannel(null);
    setMessages([]);
    setTypingUsers({});
    hasAppliedStartupNavRef.current = false;
    if (ws) ws.close();
    setWs(null);
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
      let attachedUrl = "";
      if (fileToSend) {
        const formData = new FormData();
        formData.append("file", fileToSend);
        formData.append("upload_type", "attachments");
        try {
          const res = await fetch(`${API_BASE}/api/upload`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData
          });
          if (res.ok) {
            const data = await res.json();
            attachedUrl = data.url;
          }
        } catch (err) {
          console.error("Upload failed", err);
        }
      }

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
    } else {
      setShowMentions(false);
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

  const setMemberRole = async (memberId: number, role: string) => {
    if (!activeServer) return;
    try {
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}/members/${memberId}/role`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role })
      });
      if (res.ok) {
        const updated = await res.json();
        setServerMembers(prev => prev.map(m => m.user_id === memberId ? { ...m, server_role: updated.server_role } : m));
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
      setSettingsUsername(user.username);
      setSettingsDisplayName(user.display_name || user.username);
      setSettingsDescription(user.description || '');
      setSettingsProfilePic(user.profile_picture || '');
      setSettingsBanner(user.banner || '');
      setShowSettings(true);
      if (isMobile) setMobileNavOpen(false);
    }
  };

  const openServerSettings = () => {
    if (activeServer) {
      setServerName(activeServer.server_name);
      setServerDescription(activeServer.server_description || '');
      setServerImage(activeServer.server_image || '');
      setServerBanner(activeServer.server_banner || '');
      setShowServerSettings(true);
      if (isMobile) setMobileNavOpen(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string>>, fileSetter?: React.Dispatch<React.SetStateAction<File | null>>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (fileSetter) fileSetter(file);
      setter(URL.createObjectURL(file));
    }
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
        const updated = await res.json();
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
              <h2 style={{marginBottom: '8px'}}>{invitePreviewData?.server_name}</h2>
              {invitePreviewData?.server_description && <p style={{color: 'var(--text-muted)', marginBottom: '16px'}}>{invitePreviewData?.server_description}</p>}
              
              <div style={{display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '24px', marginTop: '16px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                  <div style={{width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#23a559'}}></div>
                  <strong>{invitePreviewData?.online_members}</strong> Online
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                  <div style={{width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--text-muted)'}}></div>
                  <strong>{invitePreviewData?.total_members}</strong> Members
                </div>
              </div>

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
      showInvitePreview;

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
        if (showAdminPanel) {
          e.preventDefault();
          e.stopPropagation();
          setShowAdminPanel(false);
          return;
        }
        if (showSettings) {
          e.preventDefault();
          e.stopPropagation();
          setShowSettings(false);
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
          setShowServerSettings(false);
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
  ]);

  if (user && user.status === 'BANNED') {
    return (
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0, zIndex: 9999, backgroundColor: 'var(--bg-main)', color: 'white'}}>
        <AlertTriangle size={64} color="var(--color-danger)" style={{marginBottom: '24px'}} />
        <h1 style={{fontSize: '32px', marginBottom: '16px'}}>Account Suspended</h1>
        <p style={{fontSize: '18px', color: 'var(--text-muted)', marginBottom: '24px'}}>Your account has been permanently banned from Cordis.</p>
        <button className="btn btn-secondary" onClick={() => { localStorage.removeItem('cordis_token'); setToken(''); setUser(null); }}>Log Out</button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="auth-container">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '440px', padding: '16px' }}>
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
              Cordis Beta v0.0.0
            </div>
            <div style={{
              color: '#dbdee1',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              fontWeight: 500
            }}>
              WARNING: THIS IS A PUBLIC BETA. DATABASE IS TO SUBJECT TO RESET. DO NOT SAVE IMPORTANT DATA.
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
  const myServerRole = activeServer ? (activeServer.my_role || (activeServer.owner_id === user?.user_id ? 'admin' : 'default')) : 'default';
  const isServerAdmin = !!activeServer && (activeServer.owner_id === user?.user_id || myServerRole === 'admin');
  const isServerMod = isServerAdmin || myServerRole === 'mod';
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
        <div className={`server-icon ${isViewingDMs ? 'active' : ''}`} onClick={() => { setIsViewingDMs(true); setActiveServer(null); setActiveChannel(null); setMessages([]); if (isMobile) setMobileNavOpen(true); setMobileMembersOpen(false); }} data-tooltip="Direct Messages">
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
                <div style={{fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                  {activeServer?.server_name || 'No Server'}
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
                    onClick={() => {
                      const inviteLink = `${window.location.origin}/invite/${activeServer.invite_code}`;
                      navigator.clipboard.writeText(inviteLink);
                      alert(`Invite link copied to clipboard: ${inviteLink}`);
                    }}
                  >
                    <Users size={12} /> Invite
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
              <div className="user-status-text">Online</div>
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
          {messages.map((m, i) => {
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
                      setContextMenu({x: e.pageX, y: e.pageY, user: m.author});
                    }}
                    style={{cursor: 'pointer'}}
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
                      {renderMessageText(revealedMessages[m.message_id].content?.text)}
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
                        })}
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
                          <span className="reaction-emoji">{r.emoji}</span>
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
                      <EmojiPicker onEmojiClick={(e) => handleReactionToggle(m.message_id, e.emoji)} theme={theme === 'light' ? Theme.LIGHT : Theme.DARK} />
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
          )})}
          <div ref={messagesEndRef} />
        </div>

        {Object.keys(typingUsers).length > 0 && (
          <div className="typing-indicator">
            {Object.values(typingUsers).join(', ')} is typing...
          </div>
        )}

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
                <span className="member-name">{renderUsernameWithBadges(activeChannel.target_user)}</span>
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
                <span className="member-name">{renderUsernameWithBadges(user)}</span>
              </div>
            </>
          ) : (
            <>
              <h3 className="member-group-title">Online — {serverMembers.filter(m => isUserOnline(m.user_id, m.username)).length}</h3>
              {serverMembers.filter(m => isUserOnline(m.user_id, m.username)).map(m => (
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
                    setContextMenu({x: e.pageX, y: e.pageY, user: m, serverRole: m.server_role});
                  }}
                >
                  <div className="user-avatar member-avatar">
                    {getAvatarContent(m)}
                    <div className="status-indicator online"></div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="member-name">{renderUsernameWithBadges(m)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      {activeServer?.owner_id === m.user_id ? 'owner' : (m.server_role || 'default')}
                    </div>
                  </div>
                </div>
              ))}

              <h3 className="member-group-title" style={{marginTop: '16px'}}>Offline — {serverMembers.filter(m => !isUserOnline(m.user_id, m.username)).length}</h3>
              {serverMembers.filter(m => !isUserOnline(m.user_id, m.username)).map(m => (
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
                    setContextMenu({x: e.pageX, y: e.pageY, user: m, serverRole: m.server_role});
                  }}
                >
                  <div className="user-avatar member-avatar">
                    {getAvatarContent(m)}
                    <div className="status-indicator offline"></div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="member-name">{renderUsernameWithBadges(m)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      {activeServer?.owner_id === m.user_id ? 'owner' : (m.server_role || 'default')}
                    </div>
                  </div>
                </div>
              ))}
            </>
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
            <div style={{ padding: '4px 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {serverContextMenu.server.server_name}
            </div>
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
                      <Shield size={12} /> Server role
                    </div>
                    {(['default', 'mod', 'admin'] as const).map(role => (
                      <button
                        key={role}
                        className="dropdown-item"
                        onClick={() => { setMemberRole(contextMenu.user.user_id, role); setContextMenu(null); }}
                        style={{ fontWeight: (contextMenu.serverRole || contextMenu.user.server_role || 'default') === role ? 700 : 400 }}
                      >
                        {role === 'default' ? 'Default' : role === 'mod' ? 'Mod' : 'Admin'}
                        {(contextMenu.serverRole || contextMenu.user.server_role || 'default') === role ? ' ✓' : ''}
                      </button>
                    ))}
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
                      <button className="dropdown-item danger" onClick={() => { handleAdminAction('ban', contextMenu.user.user_id); setContextMenu(null); }}>SYSTEM Ban</button>
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
                           <h4 style={{margin: 0}}>{s.server_name}</h4>
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
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
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
                    <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setSettingsProfilePic, setSettingsProfilePicFile)} />
                  </label>
                </div>

                <div style={{width: '100%', marginBottom: '16px'}}>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Profile Banner</label>
                  <div style={{width: '100%', height: '100px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', position: 'relative', overflow: 'hidden'}}>
                    {settingsBanner && <img src={getFullUrl(settingsBanner)} alt="Banner" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                    <label style={{position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                      <Plus size={16} />
                      <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setSettingsBanner, setSettingsBannerFile)} />
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
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSettings(false)} disabled={isSavingSettings}>Cancel</button>
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
                            <div key={server.server_id} style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '4px'}}>
                              {server.server_name} <span style={{color: 'var(--text-muted)'}}>(ID: {server.server_id})</span>
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
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction(adminUserResult.status === 'BANNED' ? 'unban' : 'ban', adminUserResult.user_id)}>{adminUserResult.status === 'BANNED' ? 'Unban' : 'Ban'}</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('promote', adminUserResult.user_id, {role: 'SYSTEM_MOD'})}>Make Mod</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('promote', adminUserResult.user_id, {role: 'SYSTEM_ADMIN'})}>Make Admin</button>
                            <button type="button" className="btn btn-secondary" onClick={() => handleAdminAction('demote', adminUserResult.user_id)}>Demote</button>
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
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowServerSettings(false); }}>
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
                    <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setServerImage, setServerImageFile)} />
                  </label>
                </div>

                <div style={{width: '100%', marginBottom: '16px'}}>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Server Banner</label>
                  <div style={{width: '100%', height: '100px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', position: 'relative', overflow: 'hidden'}}>
                    {serverBanner && <img src={getFullUrl(serverBanner)} alt="Server Banner" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                    <label style={{position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                      <Plus size={16} />
                      <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setServerBanner, setServerBannerFile)} />
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
              </div>
              <div className="modal-footer" style={{justifyContent: 'space-between'}}>
                <button type="button" className="btn" style={{backgroundColor: '#ef4444', border: 'none'}} onClick={deleteServer} disabled={isDeletingServer || isSavingServer}>
                  {isDeletingServer ? <Loader2 size={18} className="spinner" /> : 'Delete Server'}
                </button>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowServerSettings(false)} disabled={isSavingServer || isDeletingServer}>Cancel</button>
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
    </div>
  );
}

export default App;
