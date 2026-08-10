import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Send, Phone, Clock, Check, CheckCheck, ArrowLeft } from 'lucide-react';
import { useFetch } from '../lib/useFetch';
import { ChatSkeleton, Skeleton } from './Skeleton';
import { ErrorState } from './StateViews';

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (sameDay) return time;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatBubbleTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function groupDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

function contactName(contact) {
  if (!contact) return 'Unknown';
  return contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || `+${contact.whatsappPhone}`;
}

function Avatar({ name, size = 44 }) {
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg,#075E54,#128C7E)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function ThreadSkeleton() {
  const bubbles = [1, 2, 3, 4, 5, 6, 7];
  return (
    <div className="wa-thread" style={{ padding: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {bubbles.map((b) => (
          <Skeleton
            key={b}
            height={40}
            radius={10}
            style={b % 2 === 0 ? { alignSelf: 'flex-end', width: `${38 + (b * 8) % 18}%` } : { width: `${44 + (b * 7) % 20}%` }}
          />
        ))}
      </div>
    </div>
  );
}

const WA_STYLES = `
  .wa-app {
    --wa-bg: #e5ddd5;
    --wa-panel: #ffffff;
    --wa-side: #f7f8fa;
    --wa-green: #075E54;
    --wa-green2: #128C7E;
    --wa-out: #d9fdd3;
    --wa-border: #e0e0e0;
    --wa-muted: #667781;
    display: flex;
    height: calc(100vh - 210px);
    min-height: 480px;
    border: 1px solid var(--wa-border);
    border-radius: 14px;
    overflow: hidden;
    background: var(--wa-panel);
    box-shadow: 0 10px 34px rgba(0,0,0,0.10);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wa-list { width: 340px; min-width: 280px; display: flex; flex-direction: column; background: var(--wa-side); border-right: 1px solid var(--wa-border); }
  .wa-list-head { padding: 14px 16px; background: #f0f2f5; display: flex; align-items: center; justify-content: space-between; }
  .wa-list-title { font-size: 16px; font-weight: 700; color: var(--wa-green); display: flex; align-items: center; gap: 8px; }
  .wa-unread-total { background: var(--wa-green2); color: #fff; border-radius: 12px; padding: 2px 9px; font-size: 12px; font-weight: 700; }
  .wa-search { padding: 10px 14px; }
  .wa-search input { width: 100%; box-sizing: border-box; padding: 9px 14px 9px 36px; border: none; border-radius: 8px; background: #fff; font-size: 13px; outline: none; }
  .wa-search-wrap { position: relative; }
  .wa-search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--wa-muted); }
  .wa-list-body { flex: 1; overflow-y: auto; }
  .wa-item { display: flex; gap: 12px; padding: 12px 14px; cursor: pointer; border-bottom: 1px solid #f0f0f0; }
  .wa-item:hover { background: #f0f2f5; }
  .wa-item.active { background: #e9f7f2; }
  .wa-item-mid { flex: 1; min-width: 0; }
  .wa-item-top { display: flex; justify-content: space-between; gap: 8px; }
  .wa-item-name { font-size: 14px; font-weight: 600; color: #111b21; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wa-item-time { font-size: 11px; color: var(--wa-muted); flex-shrink: 0; }
  .wa-item-preview { font-size: 12.5px; color: var(--wa-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .wa-item-preview .you { color: #111b21; }
  .wa-item-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 3px; }
  .wa-item-status { font-size: 11px; color: var(--wa-green2); font-weight: 600; }
  .wa-badge { background: #25D366; color: #fff; border-radius: 12px; min-width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; font-size: 11px; font-weight: 700; box-sizing: border-box; }
  .wa-empty { padding: 30px 16px; text-align: center; color: var(--wa-muted); font-size: 13px; }
  .wa-thread { flex: 1; display: flex; flex-direction: column; background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMzAgNjAgQzEwIDYwIDAgNDggMCAzMCBDMCAxMCAxMCAwIDMwIDAgQzUwIDAgNjAgMTAgNjAgMzAgQzYwIDUwIDUwIDYwIDMwIDYwIFoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2U5ZGVjZCIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9zdmc+'); background-size: 60px; }
  .wa-thread-head { padding: 12px 16px; background: #f0f2f5; border-bottom: 1px solid var(--wa-border); display: flex; align-items: center; gap: 12px; }
  .wa-thread-name { font-size: 15px; font-weight: 600; color: #111b21; }
  .wa-thread-sub { font-size: 12px; color: var(--wa-muted); }
  .wa-thread-head-right { margin-left: auto; display: flex; align-items: center; gap: 10px; color: var(--wa-muted); }
  .wa-thread-body { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; }
  .wa-date-sep { text-align: center; margin: 10px 0 6px; }
  .wa-date-sep span { background: #fff; color: var(--wa-muted); font-size: 11.5px; padding: 4px 12px; border-radius: 8px; box-shadow: 0 1px 1px rgba(0,0,0,0.08); }
  .wa-bubble { max-width: 65%; padding: 7px 10px 5px 10px; border-radius: 10px; position: relative; font-size: 13.5px; line-height: 1.35; color: #111b21; word-wrap: break-word; white-space: pre-wrap; box-shadow: 0 1px 1px rgba(0,0,0,0.08); }
  .wa-bubble.in { background: #fff; align-self: flex-start; border-top-left-radius: 2px; }
  .wa-bubble.out { background: var(--wa-out); align-self: flex-end; border-top-right-radius: 2px; }
  .wa-bubble .meta { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 3px; font-size: 10.5px; color: rgba(17,27,33,0.55); }
  .wa-bubble.media { font-style: italic; color: var(--wa-muted); }
  .wa-thread-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--wa-muted); font-size: 14px; flex-direction: column; gap: 10px; }
  .wa-sendbar { padding: 10px 14px; background: #f0f2f5; display: flex; gap: 10px; align-items: center; }
  .wa-sendbar input { flex: 1; padding: 12px 16px; border: none; border-radius: 8px; font-size: 14px; outline: none; }
  .wa-sendbar button { background: var(--wa-green2); color: #fff; border: none; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
  .wa-sendbar button:hover { background: var(--wa-green); }
  .wa-sendbar button:disabled { opacity: 0.5; cursor: not-allowed; }
  .wa-err { background: #fce8e6; color: #c5221f; font-size: 12.5px; padding: 8px 14px; border-top: 1px solid #f5c6c2; }
`;

export default function WhatsAppChatView({ token }) {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const threadEndRef = useRef(null);

  const {
    data: conversationsData,
    loading: convLoading,
    error: convError,
    refetch: refetchConversations,
    setData: setConversations,
  } = useFetch('/api/conversations?limit=200&includeAll=true', { token, poll: 10000, ttl: 10000 });

  const conversations = Array.isArray(conversationsData) ? conversationsData : [];

  const messagesPath = selected && !selected.virtual ? `/api/messages?conversationId=${selected.id}&limit=200` : null;
  const {
    data: messagesData,
    loading: msgLoading,
    refetch: refetchMessages,
    setData: setThreadMessages,
  } = useFetch(messagesPath, { token, poll: selected ? 10000 : 0, ttl: 10000 });

  const messages = useMemo(
    () => (Array.isArray(messagesData) ? [...messagesData].reverse() : []),
    [messagesData]
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, selected]);

  const openConversation = useCallback(
    async (conv) => {
      setSelected(conv);
      setThreadMessages([]);
      setError(null);
      if (conv.virtual) return;
      if (conv.unreadCount > 0) {
        try {
          await fetch(`/api/conversations/${conv.id}/read`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          setConversations((prev) =>
            (Array.isArray(prev) ? prev : []).map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
          );
        } catch (err) {
          console.error('Failed to mark read:', err);
        }
      }
    },
    [token, setConversations, setThreadMessages]
  );

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    setError(null);
    try {
      const phone = selected.contact?.whatsappPhone;
      const payload = { body };
      if (phone) payload.to = phone;
      // Virtual chats have no conversation row yet; omit conversationId so the
      // backend creates the contact+conversation through the shared path.
      if (!selected.virtual) payload.conversationId = selected.id;
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Send failed');
      }
      setDraft('');
      if (selected.virtual && data.data?.conversationId) {
        // Promote the virtual chat to a real conversation and load its thread.
        const realId = data.data.conversationId;
        setSelected((prev) =>
          prev && prev.contactId === selected.contactId
            ? {
                ...prev,
                id: realId,
                virtual: false,
                lastMessageAt: new Date().toISOString(),
                lastMessagePreview: body,
                lastMessageDirection: 'OUTGOING',
              }
            : prev
        );
        await refetchMessages({ force: true });
      }
      await refetchConversations({ force: true });
    } catch (err) {
      setError(err.message);
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  };

  const filtered = conversations.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const name = contactName(c.contact).toLowerCase();
    const phone = (c.contact?.whatsappPhone || '').toLowerCase();
    return name.includes(q) || phone.includes(q);
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  if (convLoading && conversations.length === 0) {
    return (
      <div className="animate-fade">
        <style>{WA_STYLES}</style>
        <ChatSkeleton />
      </div>
    );
  }

  if (convError) {
    return (
      <div className="animate-fade">
        <div className="glass-card">
          <ErrorState
            message={convError}
            onRetry={() => refetchConversations({ force: true })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade">
      <style>{WA_STYLES}</style>

      <div className="wa-app">
        {/* Chat list */}
        <div className="wa-list">
          <div className="wa-list-head">
            <div className="wa-list-title">
              WhatsApp Chats
            </div>
            {totalUnread > 0 && <span className="wa-unread-total">{totalUnread}</span>}
          </div>
          <div className="wa-search">
            <div className="wa-search-wrap">
              <Search size={16} />
              <input
                placeholder="Search chats by name or number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="wa-list-body">
            {filtered.length === 0 ? (
              <div className="wa-empty">
                No chats yet. Run Auto-Sync Leads to pull contacts, or send a WhatsApp message.
              </div>
            ) : (
              filtered.map((c) => {
                const name = contactName(c.contact);
                const last = c.lastMessagePreview;
                const out = c.lastMessageDirection === 'OUTGOING';
                return (
                  <div
                    key={c.id}
                    className={`wa-item ${selected?.id === c.id ? 'active' : ''}`}
                    onClick={() => openConversation(c)}
                  >
                    <Avatar name={name} size={46} />
                    <div className="wa-item-mid">
                      <div className="wa-item-top">
                        <span className="wa-item-name">{name}</span>
                        <span className="wa-item-time">{formatChatTime(c.lastMessageAt)}</span>
                      </div>
                      <div className="wa-item-preview">
                        {out && <span className="you">You: </span>}
                        {last || 'New chat'}
                      </div>
                      <div className="wa-item-meta">
                        <span className="wa-item-status">
                          {c.status === 'OPEN' ? <span style={{ color: '#25D366' }}>●</span> : <span style={{ color: '#9aa0a6' }}>●</span>}
                          {' '}
                          {c.status === 'OPEN' ? 'Open' : 'Closed'}
                        </span>
                        {c.unreadCount > 0 && <span className="wa-badge">{c.unreadCount}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Chat thread */}
        {selected ? (
          <div className="wa-thread">
            <div className="wa-thread-head">
              <Avatar name={contactName(selected.contact)} size={38} />
              <div style={{ minWidth: 0 }}>
                <div className="wa-thread-name">{contactName(selected.contact)}</div>
                <div className="wa-thread-sub">+{selected.contact?.whatsappPhone || ''}</div>
              </div>
              <div className="wa-thread-head-right">
                <Phone size={18} />
                <span style={{ fontSize: 12 }}>
                  {selected.status === 'OPEN' ? <span style={{ color: '#25D366' }}>Online · Open</span> : 'Closed'}
                </span>
              </div>
            </div>

            {msgLoading && messages.length === 0 ? (
              <ThreadSkeleton />
            ) : (
              <div className="wa-thread-body">
                {messages.length === 0 && (
                  <div className="wa-thread-placeholder" style={{ gap: 4 }}>
                    <Avatar name={contactName(selected.contact)} size={72} />
                    <div style={{ fontWeight: 700, fontSize: 17, color: '#111b21', marginTop: 10 }}>
                      {contactName(selected.contact)}
                    </div>
                    <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--wa-muted)' }}>
                      +{selected.contact?.whatsappPhone || ''}
                    </div>
                    {(selected.contact?.email || selected.contact?.company) && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--wa-muted)',
                          textAlign: 'center',
                          marginTop: 6,
                          maxWidth: 320,
                        }}
                      >
                        {[selected.contact?.email, selected.contact?.company].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <div style={{ fontSize: 12.5, color: 'var(--wa-muted)', marginTop: 14, textAlign: 'center', maxWidth: 320 }}>
                      No messages in this chat yet. Type below to send the first WhatsApp message.
                    </div>
                  </div>
                )}
                {messages.map((m, idx) => {
                  const prev = messages[idx - 1];
                  const showDate = !prev || new Date(m.timestamp).toDateString() !== new Date(prev.timestamp).toDateString();
                  const isMedia = m.type && m.type !== 'TEXT' && m.type !== 'UNKNOWN';
                  return (
                    <React.Fragment key={m.id}>
                      {showDate && (
                        <div className="wa-date-sep"><span>{groupDate(m.timestamp)}</span></div>
                      )}
                      <div className={`wa-bubble ${m.direction === 'INCOMING' ? 'in' : 'out'} ${isMedia ? 'media' : ''}`}>
                        {m.direction === 'OUTGOING' && <span style={{ fontWeight: 600 }}>You: </span>}
                        {isMedia ? `[${m.type.toLowerCase()} attachment]` : ''}
                        {m.body || (isMedia ? '' : '')}
                        <div className="meta">
                          <span>{formatBubbleTime(m.timestamp)}</span>
                          {m.direction === 'OUTGOING' &&
                            (m.status === 'SENT' ? <CheckCheck size={13} /> : m.status === 'FAILED' ? <Clock size={13} style={{ color: '#c5221f' }} /> : <Check size={13} />)}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            )}

            {error && <div className="wa-err">{error}</div>}

            <div className="wa-sendbar">
              <input
                placeholder="Type a message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button onClick={handleSend} disabled={sending || !draft.trim()} title="Send">
                <Send size={19} />
              </button>
            </div>
          </div>
        ) : (
          <div className="wa-thread">
            <div className="wa-thread-placeholder">
              <ArrowLeft size={30} style={{ opacity: 0.5 }} />
              Select a chat to start viewing messages
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
