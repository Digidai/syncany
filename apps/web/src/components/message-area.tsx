"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Channel, type ChannelMember, type Agent, ApiError } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { useChannelSocket } from "@/hooks/use-channel-socket";
import { useGateway } from "@/hooks/use-agent-activity";
import { authClient } from "@/lib/auth-client";
import type { MessageRow } from "@syncany/protocol";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeneratedAvatar } from "./generated-avatar";
import TiptapMessageInput, { type TiptapMessageInputHandle } from "./tiptap-message-input";
import { Smile, Pencil, Trash2 } from "lucide-react";

interface MessageAreaProps {
  channelId: string | null;
}

const QUICK_REACTIONS = ["👍", "❤️", "😄", "🎉", "👀", "🚀"];

export function MessageArea({ channelId }: MessageAreaProps) {
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? "";
  const { bumpRead, seedChannel } = useGateway();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const inputRef = useRef<TiptapMessageInputHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Only mark messages as read when this tab is actually visible.
  function isVisible(): boolean {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }
  function markReadIfVisible(seq: number) {
    if (!channelId || seq <= 0) return;
    bumpRead(channelId, seq);                                  // optimistic local
    if (!isVisible()) return;                                  // server only when foreground
    api.markRead(channelId, seq).catch(() => {});
  }

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setToken(null);
    (async () => {
      try {
        const [chData, msgData, tokData, agData] = await Promise.all([
          api.getChannel(channelId),
          api.listMessages(channelId, { limit: 100 }),
          api.mintWsToken(channelId),
          api.listAgents(),
        ]);
        if (cancelled) return;
        setChannel(chData.channel);
        setMembers(chData.members);
        setAgents(agData.agents);
        setMessages(msgData.messages);
        setToken(tokData.token);
        // Seed gateway state with the actual max seq from server, then mark
        // visible-as-read (only if tab is foreground).
        const lastSeq = msgData.messages.reduce((m, x) => Math.max(m, x.seq), 0);
        if (lastSeq > 0) {
          seedChannel(channelId, lastSeq, lastSeq);
          markReadIfVisible(lastSeq);
        }
      } catch (e) {
        if (e instanceof ApiError) console.error("MessageArea load failed", e.code, e.message);
        else throw e;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const handleNew = useCallback((m: MessageRow) => {
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
    });
    markReadIfVisible(m.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // When tab regains focus, flush a mark-read for the newest visible message.
  useEffect(() => {
    if (!channelId) return;
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const top = messages[messages.length - 1];
      if (top) markReadIfVisible(top.seq);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, messages.length]);

  const handleUpdate = useCallback((m: MessageRow) => {
    setMessages((prev) => prev.map(p => p.id === m.id ? { ...p, ...m, reactions: p.reactions } : p));
  }, []);

  const handleReaction = useCallback((ev: { messageId: string; emoji: string; reactorId: string; added: boolean }) => {
    setMessages((prev) => prev.map(p => {
      if (p.id !== ev.messageId) return p;
      const list = (p.reactions ?? []).slice();
      const idx = list.findIndex(r => r.emoji === ev.emoji);
      if (ev.added) {
        if (idx === -1) list.push({ emoji: ev.emoji, reactorIds: [ev.reactorId] });
        else if (!list[idx].reactorIds.includes(ev.reactorId))
          list[idx] = { ...list[idx], reactorIds: [...list[idx].reactorIds, ev.reactorId] };
      } else {
        if (idx !== -1) {
          const remaining = list[idx].reactorIds.filter(r => r !== ev.reactorId);
          if (remaining.length === 0) list.splice(idx, 1);
          else list[idx] = { ...list[idx], reactorIds: remaining };
        }
      }
      return { ...p, reactions: list };
    }));
  }, []);

  const { connected, send } = useChannelSocket({
    channelId, token,
    onMessage: handleNew,
    onMessageUpdate: handleUpdate,
    onReaction: handleReaction,
  });

  const memberLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.displayName);
    if (session.data?.user) map.set(session.data.user.id, session.data.user.name ?? "You");
    return map;
  }, [agents, session.data?.user]);

  if (!channelId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a conversation to start chatting.
      </div>
    );
  }

  function handleSend(content: string) {
    if (!content.trim() || !channelId) return;
    const ok = send(content);
    if (!ok) return;
    inputRef.current?.clear();
  }

  // Inline-edit state — no more window.prompt().
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  function startEdit(m: MessageRow) {
    setEditingId(m.id);
    setEditingDraft(m.content);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingDraft("");
  }
  async function saveEdit(m: MessageRow) {
    const next = editingDraft.trim();
    if (!next || next === m.content) { cancelEdit(); return; }
    try { await api.editMessage(m.id, next); }
    catch (e) { notifyThrown("Couldn't save edit", e); }
    cancelEdit();
  }

  async function handleDelete(m: MessageRow) {
    if (!confirm("Delete this message? This can't be undone.")) return;
    try { await api.deleteMessage(m.id); }
    catch (e) { notifyThrown("Couldn't delete message", e); }
  }

  async function handleReact(m: MessageRow, emoji: string) {
    try { await api.toggleReaction(m.id, emoji); }
    catch (e) { notifyThrown("Couldn't react", e); }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <h3 className="text-sm font-semibold">{channel?.name ?? "Channel"}</h3>
          {channel?.description && (
            <p className="text-xs text-muted-foreground">{channel.description}</p>
          )}
        </div>
        <span className={"inline-flex items-center gap-1 text-xs " + (connected ? "text-emerald-600" : "text-amber-600")}>
          <span className={"h-2 w-2 rounded-full " + (connected ? "bg-emerald-500" : "bg-amber-500")} />
          {connected ? "Live" : "Connecting…"}
        </span>
      </header>

      <ScrollArea className="flex-1" ref={scrollerRef as any}>
        <div className="space-y-3 p-4">
          {loading && <p className="text-sm text-muted-foreground">Loading messages…</p>}
          {!loading && messages.length === 0 && (
            <p className="text-sm text-muted-foreground">No messages yet — say hi.</p>
          )}
          {messages.map((m) => (
            <MessageRowView
              key={m.id}
              m={m}
              label={memberLabel.get(m.senderId) ?? m.senderId.slice(0, 8)}
              currentUserId={userId}
              editing={editingId === m.id}
              draft={editingDraft}
              onStartEdit={() => startEdit(m)}
              onCancelEdit={cancelEdit}
              onSaveEdit={() => saveEdit(m)}
              onDraftChange={setEditingDraft}
              onDelete={() => handleDelete(m)}
              onReact={(emoji) => handleReact(m, emoji)}
            />
          ))}
        </div>
      </ScrollArea>

      <footer className="border-t p-2">
        <TiptapMessageInput
          ref={inputRef}
          onSend={handleSend}
          disabled={!connected}
          placeholder={connected ? "Send a message…" : "Connecting…"}
        />
      </footer>
    </div>
  );
}

interface MessageRowProps {
  m: MessageRow;
  label: string;
  currentUserId: string;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDraftChange: (s: string) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}

function MessageRowView({ m, label, currentUserId, editing, draft, onStartEdit, onCancelEdit, onSaveEdit, onDraftChange, onDelete, onReact }: MessageRowProps) {
  const isAgent = m.senderType === "agent";
  const isSystem = m.senderType === "system";
  const isMine = m.senderId === currentUserId;
  const isDeleted = !!m.deletedAt;
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div className="group flex gap-3">
      <div className="shrink-0">
        {isAgent ? (
          <Avatar className="h-8 w-8 bg-violet-100 text-violet-700">
            <AvatarFallback>{label.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        ) : (
          <GeneratedAvatar id={m.senderId} size="md" />
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">
            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {m.editedAt && !isDeleted && <span className="text-[10px] text-muted-foreground">(edited)</span>}
          {isSystem && <span className="text-[10px] uppercase text-muted-foreground">system</span>}
          {!isDeleted && (
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button onClick={() => setShowPicker(p => !p)} title="Add reaction"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Smile className="h-3.5 w-3.5" />
              </button>
              {isMine && (
                <>
                  <button onClick={onStartEdit} title="Edit"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={onDelete} title="Delete"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive-foreground">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {showPicker && (
          <div className="mt-1 flex gap-1 rounded border bg-card p-1 shadow-sm">
            {QUICK_REACTIONS.map(em => (
              <button key={em} onClick={() => { onReact(em); setShowPicker(false); }}
                className="rounded px-2 py-0.5 text-base hover:bg-accent">{em}</button>
            ))}
          </div>
        )}
        {editing ? (
          <div className="mt-1 flex flex-col gap-1">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSaveEdit(); }
              }}
              autoFocus
              rows={Math.max(2, Math.min(8, draft.split("\n").length))}
              className="w-full rounded border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <button onClick={onSaveEdit} className="rounded bg-foreground px-2 py-0.5 text-background hover:opacity-90">
                Save
              </button>
              <button onClick={onCancelEdit} className="rounded border px-2 py-0.5 hover:bg-accent">
                Cancel
              </button>
              <span>⌘/Ctrl+Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : (
          <div className={"prose prose-sm dark:prose-invert max-w-none text-sm " + (isDeleted ? "italic text-muted-foreground" : "")}>
            {isAgent && !isDeleted ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl}>{m.content}</ReactMarkdown>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        )}
        {m.reactions && m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map(r => {
              const mineReacted = r.reactorIds.includes(currentUserId);
              return (
                <button key={r.emoji} onClick={() => onReact(r.emoji)}
                  className={"rounded-full border px-2 py-0.5 text-xs transition-colors " +
                    (mineReacted ? "border-blue-400 bg-blue-50 text-blue-700" : "border-zinc-200 bg-card hover:bg-accent")}>
                  <span>{r.emoji}</span> <span className="text-[10px] text-muted-foreground">{r.reactorIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function safeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return url;
  if (trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) return url;
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) return url;
  return "#";
}
