import React, { useState, useEffect, useRef } from 'react';
import { Compass, Plus, Hash, LogOut, Send, Loader2, Settings, Users, Home, MessageSquare } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(null);
  
  // App State
  const [servers, setServers] = useState<any[]>([]);
  const [activeServer, setActiveServer] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [activeChannel, setActiveChannel] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  
  // DM State
  const [dms, setDms] = useState<any[]>([]);
  const [isViewingDMs, setIsViewingDMs] = useState(true);
  
  // Loading States
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [isCreatingServer, setIsCreatingServer] = useState(false);
  const [isJoiningServer, setIsJoiningServer] = useState<number | null>(null);

  // Realtime State
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [unreadStates, setUnreadStates] = useState<Record<number, { server_id: number | null, last_read_message_id: number, last_message_id: number, mentions_count: number }>>({});
  const activeChannelRef = useRef<any>(null);
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);
  const dmsRef = useRef<any[]>([]);
  const serversRef = useRef<any[]>([]);
  const selectChannelRef = useRef<any>(null);
  const navigateToChannelRef = useRef<any>(null);

  useEffect(() => { dmsRef.current = dms; }, [dms]);
  useEffect(() => { serversRef.current = servers; }, [servers]);
  const [chatInput, setChatInput] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
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
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsProfilePic, setSettingsProfilePic] = useState('');
  const [settingsBanner, setSettingsBanner] = useState('');

  const [showServerSettings, setShowServerSettings] = useState(false);
  const [isSavingServer, setIsSavingServer] = useState(false);
  const [serverName, setServerName] = useState('');
  const [serverDescription, setServerDescription] = useState('');
  const [serverImage, setServerImage] = useState('');
  const [serverBanner, setServerBanner] = useState('');
  const [isDeletingServer, setIsDeletingServer] = useState(false);
  const [isLeavingServer, setIsLeavingServer] = useState(false);

  // Invite code joining
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [isJoiningByInvite, setIsJoiningByInvite] = useState(false);
  const [joinInviteError, setJoinInviteError] = useState('');
  
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
  const [selectedProfile, setSelectedProfile] = useState<{user: any, rect: DOMRect} | null>(null);

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
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
      fetchMe();
      fetchMyServers();
      fetchDMs();
      fetchUnreads();
    }
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        setServers(data);
        if (data.length > 0 && !activeServer) {
          selectServer(data[0]);
        }
      }
    } finally {
      setIsLoadingServers(false);
    }
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
          const res = await fetch(`${API_BASE}/servers/${serverId}/channels`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const chanList = await res.json();
            setChannels(chanList);
            const targetChan = chanList.find((c: any) => c.channel_id === channelId);
            if (targetChan) {
              selectChannelRef.current?.(targetChan);
            }
          }
        } finally {
          setIsLoadingChannels(false);
        }
      }
    }
  };

  const selectServer = async (server: any) => {
    setIsViewingDMs(false);
    setActiveServer(server);
    setActiveChannel(null);
    setMessages([]);
    if (ws) { ws.close(); setWs(null); }
    
    fetchServerMembersAndPresence(server.server_id);
    
    setIsLoadingChannels(true);
    try {
      const res = await fetch(`${API_BASE}/servers/${server.server_id}/channels`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChannels(data);
        if (data.length > 0) {
          selectChannel(data[0]);
        }
      }
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const startDM = async (targetUserId: number) => {
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
    if (ws) { ws.close(); }
    
    const res = await fetch(`${API_BASE}/channels/${channel.channel_id}/messages?limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const msgs = await res.json();
      setMessages(msgs);
      if (msgs.length > 0) {
        const lastMsgId = msgs[msgs.length - 1].message_id;
        setUnreadStates(prev => ({
           ...prev,
           [channel.channel_id]: {
             ...(prev[channel.channel_id] || { server_id: channel.server_id || null, mentions_count: 0 }),
             last_read_message_id: Math.max(prev[channel.channel_id]?.last_read_message_id || 0, lastMsgId),
             mentions_count: 0
           }
        }));
      }
    }

    const wsUrl = API_BASE.replace(/^http/, 'ws') + `/ws/${channel.channel_id}?token=${token}`;
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'typing') {
        if (data.user_id !== currentUserRef.current?.user_id) {
          setTypingUsers(prev => ({ ...prev, [data.user_id]: data.username }));
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
      } else if (data.type === 'unread_notification') {
        setUnreadStates(prev => {
          const next = { ...prev };
          const chanId = data.channel_id;
          if (!next[chanId]) next[chanId] = { server_id: data.server_id || null, last_read_message_id: 0, last_message_id: 0, mentions_count: 0 };
          
          next[chanId].last_message_id = data.message_id;
          
          const amIMentioned = currentUserRef.current && data.mentions && data.mentions.includes(currentUserRef.current.user_id);
          
          if (amIMentioned) {
            next[chanId].mentions_count += 1;
            if (Notification.permission === 'granted' && document.hidden) {
              const notification = new Notification(`New Mention from ${data.author?.username}`, {
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
      } else {
        if (data.channel_id === activeChannelRef.current?.channel_id) {
          setMessages(prev => [...prev, data]);
        }
        setUnreadStates(prev => {
          const next = { ...prev };
          const chanId = data.channel_id;
          if (!next[chanId]) next[chanId] = { server_id: data.server_id || null, last_read_message_id: 0, last_message_id: 0, mentions_count: 0 };
          
          next[chanId].last_message_id = data.message_id;
          
          const amIMentioned = currentUserRef.current && data.mentions && data.mentions.includes(currentUserRef.current.user_id);
          
          if (activeChannelRef.current?.channel_id !== chanId) {
            if (amIMentioned) {
              next[chanId].mentions_count += 1;
              if (Notification.permission === 'granted' && document.hidden) {
                const notification = new Notification(`New Mention from ${data.author?.username}`, {
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
      setWs(prev => prev === socket ? null : prev);
    };
    setWs(socket);
  };

  selectChannelRef.current = selectChannel;
  navigateToChannelRef.current = navigateToChannel;


  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsLoadingAuth(true);
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
    if (ws) ws.close();
    setWs(null);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!chatInput.trim() && !attachmentFile) || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    setIsSendingMessage(true);
    let attachedUrl = "";
    if (attachmentFile) {
      const formData = new FormData();
      formData.append("file", attachmentFile);
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

    ws.send(JSON.stringify({
      content: { text: chatInput, attachments: attachments, embeds: [] },
      message_type: "DEFAULT",
      mentions: [],
      flags: [],
      reactions: []
    }));
    setChatInput('');
    setAttachmentFile(null);
    setIsSendingMessage(false);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showMentions) return;
    const suggestions = getMentionSuggestions();
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertMention(suggestions[activeSuggestionIndex].username);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowMentions(false);
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setChatInput(value);
    
    if (ws && user) {
      if (!typingTimeoutRef.current) {
        ws.send(JSON.stringify({ type: 'typing', username: user.username }));
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
      setSettingsDescription(user.description || '');
      setSettingsProfilePic(user.profile_picture || '');
      setSettingsBanner(user.banner || '');
      setShowSettings(true);
    }
  };

  const openServerSettings = () => {
    if (activeServer) {
      setServerName(activeServer.server_name);
      setServerDescription(activeServer.server_description || '');
      setServerImage(activeServer.server_image || '');
      setServerBanner(activeServer.server_banner || '');
      setShowServerSettings(true);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string>>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setter(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: settingsUsername,
          description: settingsDescription,
          profile_picture: settingsProfilePic,
          banner: settingsBanner
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
      const res = await fetch(`${API_BASE}/servers/${activeServer.server_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          server_name: serverName,
          server_description: serverDescription,
          server_image: serverImage,
          server_banner: serverBanner
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
        if (ws) { ws.close(); setWs(null); }
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
        if (ws) { ws.close(); setWs(null); }
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
          const serversData = await serversRes.json();
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
      return <img src={u.profile_picture} alt="avatar" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />;
    }
    return u?.username ? u.username.charAt(0).toUpperCase() : 'U';
  };

  const getServerIconContent = (s: any) => {
    if (s?.server_image) {
      return <img src={s.server_image} alt="icon" style={{width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover'}} />;
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
          const serversData = await sRes.json();
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
                  <img src={invitePreviewData.server_image} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
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

  if (!token) {
    return (
      <div className="auth-container">
        <div className="card auth-box">
          <h2 className="text-xl" style={{textAlign: 'center', marginBottom: '8px'}}>{isLogin ? 'Welcome Back' : 'Create an Account'}</h2>
          {authError && <div className="error-msg">{authError}</div>}
          <form onSubmit={handleAuth} style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
            <input className="input" type="text" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} required disabled={isLoadingAuth} />
            <input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={isLoadingAuth} />
            <button className="btn" type="submit" disabled={isLoadingAuth}>
              {isLoadingAuth ? <Loader2 size={18} className="spinner" /> : isLogin ? 'Login' : 'Register'}
            </button>
          </form>
          <div className="auth-link" onClick={() => !isLoadingAuth && setIsLogin(!isLogin)}>
            {isLogin ? "Need an account? Register" : "Already have an account? Login"}
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
    const isUnread = state.last_message_id > state.last_read_message_id;
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

  return (
    <div className="app-layout">
      {/* Server Sidebar */}
      <div className="panel server-sidebar">
        <div className={`server-icon ${isViewingDMs ? 'active' : ''}`} onClick={() => { setIsViewingDMs(true); setActiveServer(null); setActiveChannel(null); setMessages([]); }} data-tooltip="Direct Messages">
          {isViewingDMs && <div className="active-pill" />}
          {!isViewingDMs && serverUnreadStatus[0] && <div className="unread-dot" />}
          <Home size={24} color={isViewingDMs ? '#fff' : 'var(--text-main)'} />
          {serverMentionCount[0] > 0 && <div className="mention-badge">{serverMentionCount[0]}</div>}
        </div>
        <div className="server-separator" />
        
        {isLoadingServers ? (
          <>
            <div className="skeleton skeleton-icon"></div>
            <div className="skeleton skeleton-icon"></div>
          </>
        ) : (
          servers.map(s => (
            <div key={s.server_id} className={`server-icon ${activeServer?.server_id === s.server_id ? 'active' : ''}`} onClick={() => selectServer(s)} data-tooltip={s.server_name}>
              {activeServer?.server_id === s.server_id && <div className="active-pill" />}
              {activeServer?.server_id !== s.server_id && serverUnreadStatus[s.server_id] && <div className="unread-dot" />}
              {getServerIconContent(s)}
              {serverMentionCount[s.server_id] > 0 && <div className="mention-badge">{serverMentionCount[s.server_id]}</div>}
            </div>
          ))
        )}
        <div className="server-separator" />
        <div className="server-icon action" onClick={() => setShowCreateServer(true)} data-tooltip="Create Server">
          <Plus size={24} />
        </div>
        <div className="server-icon discover" onClick={openDiscover} data-tooltip="Discover">
          <Compass size={24} />
        </div>
      </div>

      {/* Channels Sidebar */}
      <div className="panel channel-sidebar">
        <div className="server-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 'auto', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)'}}>
          <div style={{flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column'}}>
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
                {activeServer && (
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
          {activeServer && user && (
            <div style={{display: 'flex', gap: '4px'}}>
              {activeServer.owner_id === user.user_id && (
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); openServerSettings(); }} title="Server Settings">
                  <Settings size={18} />
                </button>
              )}
              {activeServer.owner_id !== user.user_id && activeServer.invite_code !== 'GLOBAL' && (
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); leaveServer(); }} title="Leave Server" disabled={isLeavingServer}>
                  <LogOut size={18} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="channel-list">
          {isViewingDMs ? (
            dms.map(dm => (
              <div key={dm.channel_id} className={`channel-item ${activeChannel?.channel_id === dm.channel_id ? 'active' : ''}`} onClick={() => selectChannel(dm)} style={{padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                <div className="user-avatar" style={{width: '32px', height: '32px'}}>
                  {getAvatarContent(dm.target_user)}
                  <div className={`status-indicator ${onlineUsers[dm.target_user?.user_id] ? 'online' : 'offline'}`} style={{width: '10px', height: '10px', bottom: '-2px', right: '-2px', border: '2px solid var(--bg-panel)'}}></div>
                </div>
                <span style={{fontWeight: 500}}>{dm.target_user?.username || 'Unknown User'}</span>
              </div>
            ))
          ) : isLoadingChannels ? (
            <>
              <div className="skeleton skeleton-text" style={{height: '24px', marginBottom: '8px'}}></div>
              <div className="skeleton skeleton-text-short" style={{height: '24px'}}></div>
            </>
          ) : (
            channels.map(c => (
              <div key={c.channel_id} className={`channel-item ${activeChannel?.channel_id === c.channel_id ? 'active' : ''}`} onClick={() => selectChannel(c)}>
                <Hash size={18} />
                {c.channel_name}
              </div>
            ))
          )}
        </div>
        {user && (
          <div className="user-panel">
            <div className="user-avatar">
              {getAvatarContent(user)}
              <div className="status-indicator status-online"></div>
            </div>
            <div className="user-info">
              <div className="user-name">{user.username}</div>
              <div className="user-status-text">Online</div>
            </div>
            <div className="user-actions">
              <button className="icon-btn" onClick={openSettings} title="User Settings"><Settings size={18} /></button>
              <button className="icon-btn" onClick={logout} title="Log Out"><LogOut size={18} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="chat-area">
        <div className="chat-header" style={{justifyContent: 'space-between'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {isViewingDMs ? (
              <>
                <MessageSquare size={24} style={{color: 'var(--text-muted)'}} />
                <div className="chat-title">{activeChannel?.target_user?.username || 'Select a user'}</div>
              </>
            ) : (
              <>
                <Hash size={24} style={{color: 'var(--text-muted)'}} />
                <div className="chat-title">{activeChannel?.channel_name || 'Select a channel'}</div>
              </>
            )}
          </div>
          {activeChannel && (
            <button 
              className="icon-btn" 
              onClick={() => setShowMemberList(!showMemberList)} 
              title={isViewingDMs ? "Toggle User Profile" : "Toggle Member List"}
              style={{color: showMemberList ? '#f9fafb' : '#9ca3af'}}
            >
              <Users size={20} />
            </button>
          )}
        </div>
        
        <div className="message-list" onClick={() => setSelectedProfile(null)}>
          {messages.map((m, i) => {
            const isMentioned = currentUserRef.current && m.mentions?.includes(currentUserRef.current.user_id);
            return (
            <div key={i} className={`message ${isMentioned ? 'mentioned' : ''}`} style={{display: 'flex', gap: '16px'}}>
              <div 
                className="msg-avatar" 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProfile({ user: m.author, rect: e.currentTarget.getBoundingClientRect() });
                }}
                style={{cursor: 'pointer'}}
              >
                {getAvatarContent(m.author)}
              </div>
              <div className="msg-content">
                <div className="msg-header">
                  <span 
                    className="msg-author"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProfile({ user: m.author, rect: e.currentTarget.getBoundingClientRect() });
                    }}
                    style={{cursor: 'pointer'}}
                  >
                    {m.author?.username || `User ${m.author_id}`}
                  </span>
                  <span className="msg-time">{new Date(m.created_at * 1000).toLocaleString()}</span>
                </div>
                <div className="msg-text">{m.content.text}</div>
                {m.content.attachments && m.content.attachments.map((url: string, idx: number) => (
                  <div key={idx} className="msg-attachment" style={{marginTop: '8px'}}>
                    <img src={url} alt="attachment" style={{maxWidth: '400px', maxHeight: '300px', borderRadius: '8px'}} />
                  </div>
                ))}
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
                  <span>{u.username}</span>
                </div>
              ))}
            </div>
          )}
          <form className="chat-input-box" onSubmit={sendMessage}>
            <label style={{cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', color: attachmentFile ? 'var(--brand-primary)' : 'var(--text-muted)'}}>
              <Plus size={20} />
              <input type="file" style={{display: 'none'}} onChange={e => { if (e.target.files?.[0]) setAttachmentFile(e.target.files[0]); }} />
            </label>
            <input 
              ref={inputRef}
              className="chat-input" 
              placeholder={ws ? `Message #${activeChannel?.channel_name || ''}` : 'Connecting...'} 
              value={chatInput}
              onChange={handleTyping}
              onKeyDown={handleKeyDown}
              disabled={!activeChannel || !ws || isSendingMessage}
            />
            <button type="submit" className="icon-btn" disabled={!activeChannel || (!chatInput.trim() && !attachmentFile) || !ws || isSendingMessage}>
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>
      
      {showMemberList && activeChannel && (
        <div className="member-list">
          {isViewingDMs ? (
            <>
              <h3 className="member-group-title">Members — 2</h3>
              
              <div 
                className="member-item" 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProfile({ user: activeChannel.target_user, rect: e.currentTarget.getBoundingClientRect() });
                }}
              >
                <div className="user-avatar member-avatar">
                  {getAvatarContent(activeChannel.target_user)}
                  <div className={`status-indicator ${onlineUsers[activeChannel.target_user?.user_id] ? 'online' : 'offline'}`}></div>
                </div>
                <span className="member-name">{activeChannel.target_user?.username}</span>
              </div>
              
              <div 
                className="member-item" 
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProfile({ user: user, rect: e.currentTarget.getBoundingClientRect() });
                }}
              >
                <div className="user-avatar member-avatar">
                  {getAvatarContent(user)}
                  <div className="status-indicator online"></div>
                </div>
                <span className="member-name">{user.username}</span>
              </div>
            </>
          ) : (
            <>
              <h3 className="member-group-title">Online — {serverMembers.filter(m => onlineUsers[m.user_id]).length}</h3>
              {serverMembers.filter(m => onlineUsers[m.user_id]).map(m => (
                <div 
                  key={m.user_id} 
                  className="member-item" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProfile({ user: m, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  <div className="user-avatar member-avatar">
                    {getAvatarContent(m)}
                    <div className="status-indicator online"></div>
                  </div>
                  <span className="member-name">{m.username}</span>
                </div>
              ))}

              <h3 className="member-group-title" style={{marginTop: '16px'}}>Offline — {serverMembers.filter(m => !onlineUsers[m.user_id]).length}</h3>
              {serverMembers.filter(m => !onlineUsers[m.user_id]).map(m => (
                <div 
                  key={m.user_id} 
                  className="member-item offline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProfile({ user: m, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  <div className="user-avatar member-avatar">
                    {getAvatarContent(m)}
                    <div className="status-indicator offline"></div>
                  </div>
                  <span className="member-name">{m.username}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {selectedProfile && (
        <div 
          className="profile-popover" 
          style={{
            top: `${Math.min(selectedProfile.rect.top, window.innerHeight - 300)}px`,
            left: `${selectedProfile.rect.left > window.innerWidth - 350 ? selectedProfile.rect.left - 320 : selectedProfile.rect.right + 10}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="popover-header">
            <div className="msg-avatar popover-avatar">
              {getAvatarContent(selectedProfile.user)}
            </div>
          </div>
          <div className="popover-body">
            <h3 className="popover-username">{selectedProfile.user.username}</h3>
            {selectedProfile.user.description && (
              <div className="popover-description">
                <div className="desc-title">ABOUT ME</div>
                <p>{selectedProfile.user.description}</p>
              </div>
            )}
            <div className="desc-title" style={{marginTop: '12px'}}>CORDIS MEMBER SINCE</div>
            <p style={{color: '#e5e7eb', fontSize: '0.875rem', marginBottom: '16px'}}>July 2026</p>
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
                             {s.server_image ? <img src={s.server_image} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
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
                    <img src={settingsProfilePic} alt="Profile" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />
                  ) : (
                    <div style={{width: '100%', height: '100%', borderRadius: '50%', backgroundColor: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: '#fff', fontWeight: 600}}>
                      {settingsUsername.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <label style={{position: 'absolute', bottom: 0, right: 0, backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                    <Plus size={16} />
                    <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setSettingsProfilePic)} />
                  </label>
                </div>

                <div style={{width: '100%', marginBottom: '16px'}}>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Profile Banner</label>
                  <div style={{width: '100%', height: '100px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', position: 'relative', overflow: 'hidden'}}>
                    {settingsBanner && <img src={settingsBanner} alt="Banner" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                    <label style={{position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                      <Plus size={16} />
                      <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setSettingsBanner)} />
                    </label>
                  </div>
                </div>

                <div style={{width: '100%', display: 'flex', flexDirection: 'column', gap: '16px'}}>
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
                    <img src={serverImage} alt="Server Icon" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />
                  ) : (
                    <div style={{width: '100%', height: '100%', borderRadius: '50%', backgroundColor: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', color: '#fff', fontWeight: 600}}>
                      {serverName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <label style={{position: 'absolute', bottom: 0, right: 0, backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                    <Plus size={16} />
                    <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setServerImage)} />
                  </label>
                </div>

                <div style={{width: '100%', marginBottom: '16px'}}>
                  <label style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'block'}}>Server Banner</label>
                  <div style={{width: '100%', height: '100px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', position: 'relative', overflow: 'hidden'}}>
                    {serverBanner && <img src={serverBanner} alt="Server Banner" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
                    <label style={{position: 'absolute', top: '8px', right: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '50%', padding: '4px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>
                      <Plus size={16} />
                      <input type="file" accept="image/*" style={{display: 'none'}} onChange={(e) => handleImageUpload(e, setServerBanner)} />
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
    </div>
  );
}

export default App;
