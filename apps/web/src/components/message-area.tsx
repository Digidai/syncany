"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChannelActions } from "./channel-actions";
import { AttachmentList } from "./attachment-render";
import { Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Channel, type ChannelMember, type Agent, ApiError } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { useChannelSocket } from "@/hooks/use-channel-socket";
import { useGateway, useWorkspacePresence } from "@/hooks/use-agent-activity";
import { authClient } from "@/lib/auth-client";
import type { MessageRow } from "@raltic/protocol";
import { ScrollArea } from "@raltic/ui/components/ui/scroll-area";
import { GeneratedAvatar } from "./generated-avatar";
import TiptapMessageInput, { type TiptapMessageInputHandle } from "./tiptap-message-input";
import { Smile, Pencil, Pin, PinOff, Trash2, MessageSquareReply, Copy, X as XIcon, ArrowDown } from "lucide-react";
import { useMentionPicker, type MentionMember } from "./mention-picker";
import { notifySuccess } from "@/lib/notify";

interface MessageAreaProps {
  channelId: string | null;
}

const QUICK_REACTIONS = ["👍", "❤️", "😄", "🎉", "👀", "🚀"];

export function MessageArea({ channelId }: MessageAreaProps) {
  const session = authClient.useSession();
  const userId = session.data?.user?.id ?? "";
  // Workspace slug used by ChannelActions for "leave / delete" router pushes.
  // MessageArea is always rendered under /s/[slug]/{channel,dm}/[id] so
  // the param is always present.
  const params = useParams<{ slug?: string }>();
  const serverSlug = params?.slug ?? "";
  const { bumpRead, seedChannel } = useGateway();

  const [channel, setChannel] = useState<Channel | null>(null);
  // Cached viewer-can-manage flag from api.getChannel — drives the
  // header's settings/delete affordances. Re-fetched every channel switch.
  const [viewerCanManage, setViewerCanManage] = useState(false);
  // viewerCanAddMembers — any channel member can invite. Separate flag
  // because canManage is creator/owner-only and would under-expose Add.
  const [viewerCanAddMembers, setViewerCanAddMembers] = useState(false);
  // DM peer — populated by api.getChannel; used by the header to render
  // the OTHER party's display name instead of channels.name (which for
  // human↔human DMs is just a hex slug, never an actual person's name).
  const [channelPeer, setChannelPeer] = useState<Channel["peer"]>(null);
  // Members list — used to identify the agent participant in a DM
  // channel so the composer placeholder can address them by name.
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const inputRef = useRef<TiptapMessageInputHandle | null>(null);
  // ScrollArea wrapper element — we query the actual overflow viewport
  // out of it via data-slot (see scroll-area.tsx). The Viewport, NOT
  // this wrapper or the inner content div, is what scrolls; targeting
  // the wrong node was the previous "send doesn't snap to bottom" bug.
  const scrollWrapperRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  // Inner content div — observe its size so growing messages
  // (streaming assistant text, image loads, edits) keep us pinned to
  // the bottom when we're already there.
  const innerRef = useRef<HTMLDivElement | null>(null);
  // Live "user is near bottom" flag. Ref (not state) because we read
  // it inside passive scroll listeners that fire every frame.
  const stickToBottomRef = useRef(true);
  // Track which channel we've already done the initial paint-scroll
  // for. Without this guard, the initial-scroll effect would refire
  // every time `messages.length` changes (e.g. a new live message
  // arrives) and yank a scrolled-up reader back to the bottom. We
  // explicitly need messages.length in the dep array because the
  // load promise resolves in two commits on slow links (setLoading
  // false → setMessages populated in different microtasks), so a
  // load-only dep occasionally fires the effect with messages=[].
  const initialScrolledChannelRef = useRef<string | null>(null);
  // Coalesce burst scrolls — when 5 messages stream in within one rAF
  // we don't want 5 stacked smooth-scroll animations fighting each
  // other (and the ResizeObserver's instant pin). One pending frame.
  // Codex perf/UX LOW finding.
  const pendingScrollRef = useRef<number | null>(null);
  // Number of unseen messages while scrolled up. State → renders the
  // pill button. Reset when the user scrolls back to bottom (manually
  // OR via the pill).
  const [unreadBelow, setUnreadBelow] = useState(0);
  const sendInFlightRef = useRef(false);
  // Phase C — pending attachments staged before send. Held in a ref
  // for handleSend access without re-render churn, mirrored to state
  // for the composer chips UI.
  type StagedAttachment = { attachmentId: string; filename: string; contentType: string; sizeBytes: number; url: string };
  const pendingAttachmentsRef = useRef<StagedAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

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
    // Fresh channel — assume the user wants to land at the bottom.
    // Without this, switching from a scrolled-up channel back to a
    // freshly-opened one would inherit "not at bottom" state and the
    // unread pill would flash for the first incoming message.
    stickToBottomRef.current = true;
    setUnreadBelow(0);
    // Re-arm the initial-scroll guard so the new channel gets one
    // paint-scroll. (The guard prevents re-scrolling within the same
    // channel as live messages arrive.)
    initialScrolledChannelRef.current = null;
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
        setChannelPeer(chData.peer);
        setMembers(chData.members);
        setViewerCanManage(chData.viewerCanManage ?? false);
        setViewerCanAddMembers(chData.viewerCanAddMembers ?? false);
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

  // Pixel distance from the bottom that still counts as "at the bottom"
  // for sticky-scroll purposes. Slightly bigger than one message row so
  // a reply landing right above the viewport bottom doesn't flip the
  // user out of stick mode. Tuned by feel — keep it small enough that a
  // user scrolled clearly above the latest still gets the unread pill.
  const STICK_THRESHOLD_PX = 80;

  const isViewportNearBottom = useCallback((): boolean => {
    const v = viewportRef.current;
    if (!v) return true;        // before mount: assume "yes" so first paint scrolls
    return v.scrollHeight - v.scrollTop - v.clientHeight <= STICK_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((opts?: { smooth?: boolean }) => {
    const v = viewportRef.current;
    if (!v) {
      if (process.env.NODE_ENV !== "production") {
        // Codex a11y LOW: silent no-op makes diagnosis hard. Logged
        // in dev only so prod bundles stay quiet.
        // eslint-disable-next-line no-console
        console.warn("[message-area] scrollToBottom: viewport not found (ScrollArea data-slot may have changed)");
      }
      return;
    }
    // Honor user's reduced-motion preference even when we asked for
    // smooth — `behavior: "smooth"` on scrollTo() does NOT auto-fall
    // back to "auto" under prefers-reduced-motion (codex a11y MED).
    const prefersReducedMotion = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    v.scrollTo({
      top: v.scrollHeight,
      behavior: opts?.smooth && !prefersReducedMotion ? "smooth" : "auto",
    });
    stickToBottomRef.current = true;
    setUnreadBelow(0);
  }, []);

  /** Schedule at most one scroll-to-bottom per animation frame. Bursts
   *  of incoming messages collapse into one smooth scroll rather than
   *  stacking N competing animations (codex UX MED + perf LOW). */
  const scheduleSmoothScrollToBottom = useCallback(() => {
    if (pendingScrollRef.current !== null) return;
    pendingScrollRef.current = requestAnimationFrame(() => {
      pendingScrollRef.current = null;
      scrollToBottom({ smooth: true });
    });
  }, [scrollToBottom]);

  const handleNew = useCallback((m: MessageRow) => {
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    // Defer the scroll/unread decision until after React commits the
    // new row — otherwise scrollHeight reflects the old DOM and the
    // sticky check misjudges. scheduleSmoothScrollToBottom() coalesces
    // bursts so 5 quick messages don't stack 5 animations.
    if (stickToBottomRef.current) {
      scheduleSmoothScrollToBottom();
    } else {
      setUnreadBelow(n => n + 1);
    }
    markReadIfVisible(m.seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, scheduleSmoothScrollToBottom]);

  // Resolve the real overflow viewport out of the ScrollArea wrapper,
  // attach scroll + resize listeners. ScrollAreaPrimitive renders its
  // own Viewport with data-slot="scroll-area-viewport"; that's the
  // node whose scrollTop changes (the wrapper + inner div don't have
  // overflow). useLayoutEffect so the ref is populated before the
  // initial-scroll effect below runs in the same commit.
  useLayoutEffect(() => {
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;
    const v = wrapper.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!v) return;
    viewportRef.current = v;

    function onScroll() {
      stickToBottomRef.current = isViewportNearBottom();
      // When the user scrolls back to bottom themselves, clear the
      // unread badge. (Programmatic scrollToBottom already does this.)
      if (stickToBottomRef.current) setUnreadBelow(0);
    }
    v.addEventListener("scroll", onScroll, { passive: true });

    // ResizeObserver on the VIEWPORT (not its inner content). The
    // viewport's scrollHeight changes when content grows — observing
    // it directly is more reliable than observing the content div,
    // whose ref can briefly be null on mount and whose size changes
    // aren't always reported synchronously by ScrollAreaPrimitive's
    // internal wrappers. Only re-scroll when currently stuck.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (stickToBottomRef.current) {
          // Use scrollTop assignment (not scrollTo) — sync, no animation,
          // no jitter during streaming. Browser clamps to scrollHeight - clientHeight.
          v.scrollTop = v.scrollHeight;
        }
      });
      // Observe BOTH the viewport (catches its own size changes) and
      // the inner content (catches child-driven growth). Either source
      // pins us. ResizeObserver dedups same-frame fires per element.
      ro.observe(v);
      const inner = innerRef.current;
      if (inner) ro.observe(inner);
    }
    return () => {
      v.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      // Cancel any in-flight coalesced scroll on unmount so we don't
      // touch a stale viewport.
      if (pendingScrollRef.current !== null) {
        cancelAnimationFrame(pendingScrollRef.current);
        pendingScrollRef.current = null;
      }
    };
  }, [isViewportNearBottom]);

  // First paint of a channel's messages — land at the bottom. Guarded
  // by initialScrolledChannelRef so the effect can safely depend on
  // `messages.length` (needed because setLoading + setMessages can
  // land in separate commits) without yanking a scrolled-up reader
  // every time a live message arrives.
  useLayoutEffect(() => {
    if (loading) return;
    if (messages.length === 0) return;
    if (initialScrolledChannelRef.current === channelId) return;
    initialScrolledChannelRef.current = channelId;
    scrollToBottom();
  }, [loading, channelId, messages.length, scrollToBottom]);

  // Belt-and-suspenders pin: when messages.length changes and we're
  // stuck, snap. Some browsers / ScrollAreaPrimitive wrapping can
  // suppress ResizeObserver fires for grandchild growth (e.g. partial
  // streams that update existing rows rather than appending new ones).
  // useLayoutEffect runs after DOM commit so scrollHeight is fresh.
  // Cheap: branch is dead unless stickToBottomRef is true.
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    const v = viewportRef.current;
    if (!v) return;
    // Use scrollTop assignment for instant pin — smooth animation here
    // would fight the user's perception of "the chat moved on its own".
    v.scrollTop = v.scrollHeight;
  }, [messages.length]);

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
        else {
          const ids = list[idx].reactorIds ?? [];
          if (!ids.includes(ev.reactorId))
            list[idx] = { ...list[idx], reactorIds: [...ids, ev.reactorId] };
        }
      } else {
        if (idx !== -1) {
          const ids = list[idx].reactorIds ?? [];
          const remaining = ids.filter(r => r !== ev.reactorId);
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

  // For DM channels: which agent is the "other side"? Drives the
  // personalised composer placeholder + header subtitle. We need it
  // memo'd because it depends on members + agents and feeds the
  // composer's deps array.
  const dmAgent = useMemo(() => {
    if (channel?.type !== "dm") return null;
    const agentMember = members.find((m) => m.memberType === "agent");
    if (!agentMember) return null;
    return agents.find((a) => a.id === agentMember.memberId) ?? null;
  }, [channel?.type, members, agents]);

  // Composer placeholder: name-the-recipient in DM, generic for channels.
  // Matches the "Ask {agent} anything" pattern competitive products use
  // — turns an abstract input box into "I'm having a conversation".
  const composerPlaceholder = useMemo(() => {
    if (dmAgent) return `Ask ${dmAgent.displayName} anything`;
    if (channel?.type === "dm") return "Send a direct message";
    if (channel?.name) return `Message #${channel.name}`;
    return "Send a message…";
  }, [dmAgent, channel?.type, channel?.name]);

  // ── Hooks must all run before the early-return below to satisfy
  // React's Rules of Hooks. The chain: replyTo + edit state, then
  // mentionMembers memo, then useMentionPicker (which itself calls hooks).
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  // Reset reply target when channel changes — otherwise switching mid-reply
  // leaks the parent reference into the next channel's send.
  useEffect(() => { setReplyTo(null); }, [channelId]);

  const mentionMembers = useMemo<MentionMember[]>(() => {
    const out: MentionMember[] = [];
    const seen = new Set<string>();
    for (const m of members) {
      if (m.memberType !== "agent" || seen.has(m.memberId)) continue;
      seen.add(m.memberId);
      const a = agents.find(x => x.id === m.memberId);
      if (a) out.push({
        id: a.id, displayName: a.displayName,
        slug: a.name, kind: "agent",
      });
    }
    return out;
  }, [members, agents]);

  const picker = useMentionPicker({
    members: mentionMembers,
    onPick: (member, query) => {
      inputRef.current?.replaceMention(query, `@${member.slug} `);
      inputRef.current?.focus();
    },
  });

  if (!channelId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a conversation to start chatting.
      </div>
    );
  }

  // Derived only after early-return is past — safe to read state here.
  const replyToLabel = replyTo ? memberLabel.get(replyTo.senderId) ?? "someone" : "";

  async function handleSend(content: string): Promise<boolean> {
    if (!channelId || sendInFlightRef.current) return false;
    // Phase C — allow attachment-only messages (no text required).
    const hasAttachments = pendingAttachmentsRef.current.length > 0;
    if (!content.trim() && !hasAttachments) return false;
    sendInFlightRef.current = true;
    stickToBottomRef.current = true;
    try {
      // Attachment-bearing sends use REST so the server can link
      // attachmentIds atomically with the new message. Pure text
      // sends keep the WS fast-path.
      let ok: boolean;
      if (hasAttachments) {
        try {
          await api.sendMessage({
            channelId,
            content,
            threadParentId: replyTo?.id ?? null,
            idempotencyKey: crypto.randomUUID(),
            attachmentIds: pendingAttachmentsRef.current.map((a) => a.attachmentId),
          });
          ok = true;
          pendingAttachmentsRef.current = [];
          setPendingAttachments([]);
        } catch (e) {
          notifyThrown("Couldn't send message", e);
          ok = false;
        }
      } else {
        ok = await send(content, replyTo ? { threadParentId: replyTo.id } : undefined);
      }
      if (ok) {
        setReplyTo(null);
        requestAnimationFrame(() => scrollToBottom());
      }
      if (!ok && !hasAttachments) notifyThrown("Couldn't send message", new Error(connected ? "Send was not acknowledged." : "Not connected."));
      return ok;
    } finally {
      sendInFlightRef.current = false;
    }
  }

  async function handleAttachmentPick(files: FileList | File[]) {
    if (!channelId) return;
    const list = Array.from(files);
    // Hard client-side cap mirrors server (10 per message + 25 MB each).
    const remaining = 10 - pendingAttachmentsRef.current.length;
    if (remaining <= 0) {
      notifyThrown("Attachment limit reached", new Error("Max 10 attachments per message"));
      return;
    }
    const toUpload = list.slice(0, remaining);
    for (const file of toUpload) {
      if (file.size > 25 * 1024 * 1024) {
        notifyThrown("File too large", new Error(`${file.name} exceeds 25 MB`));
        continue;
      }
      setUploadingCount((n) => n + 1);
      try {
        const r = await api.uploadAttachment(channelId, file);
        const staged: StagedAttachment = {
          attachmentId: r.attachmentId,
          filename: r.filename,
          contentType: r.contentType,
          sizeBytes: r.sizeBytes,
          url: r.url,
        };
        pendingAttachmentsRef.current.push(staged);
        setPendingAttachments([...pendingAttachmentsRef.current]);
      } catch (e) {
        notifyThrown(`Upload failed: ${file.name}`, e);
      } finally {
        setUploadingCount((n) => n - 1);
      }
    }
  }

  function removeStagedAttachment(attachmentId: string) {
    pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter((a) => a.attachmentId !== attachmentId);
    setPendingAttachments([...pendingAttachmentsRef.current]);
  }

  async function handleTogglePin(m: MessageRow) {
    try {
      if (m.pinnedAt) {
        await api.unpinMessage(m.id);
        notifySuccess("Unpinned");
      } else {
        await api.pinMessage(m.id);
        notifySuccess("Pinned to channel");
      }
      // Optimistic flip — the WS broadcast (message_update from the
      // backend's broadcastMessageUpdate call) will reconcile shortly,
      // but the immediate flip avoids a perceived lag for the actor.
      setMessages((prev) => prev.map(x => x.id === m.id
        ? { ...x, pinnedAt: m.pinnedAt ? null : Date.now() }
        : x));
    } catch (e) {
      notifyThrown("Couldn't toggle pin", e);
    }
  }

  async function handleCopy(m: MessageRow) {
    const text = m.content ?? "";
    // Modern path: Clipboard API. Requires secure context (HTTPS or
    // localhost) AND user gesture. Worth attempting first because it
    // works on virtually all current browsers in prod.
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        notifySuccess("Copied", "Message text copied to clipboard");
        return;
      }
    } catch {
      // Fall through to legacy path. Permission denied / insecure context
      // both throw; both are recoverable via execCommand.
    }
    // Legacy fallback: hidden textarea + execCommand("copy"). Deprecated
    // but still works in HTTP contexts and older browsers. Wrapped in a
    // try so a failure here surfaces a clean error instead of throwing.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("execCommand returned false");
      notifySuccess("Copied", "Message text copied to clipboard");
    } catch (e) {
      notifyThrown("Copy failed", e);
    }
  }

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
    <div className="flex flex-1 flex-col min-w-0">
      <header className="flex items-center justify-between gap-3 border-b bg-gradient-to-b from-card to-card/60 px-6 py-3.5">
        {/* Left cluster: type chip + title. min-w-0 + flex-1 lets the
            title truncate when the right cluster squeezes (codex C5
            MED — narrow-pane overflow). */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {channel?.type && (
            <span
              aria-hidden
              className={
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-medium " +
                (channel.type === "dm"
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : channel.type === "private"
                  ? "bg-violet-500/10 text-violet-700 dark:text-violet-400"
                  : "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400")
              }
            >
              {channel.type === "dm" ? "@" : channel.type === "private" ? "🔒" : "#"}
            </span>
          )}
          <div className="min-w-0">
            {/* For DMs, header shows the OTHER party's name (peer.name).
                For channels, shows channel.name. Falls back to the raw
                channel.name only if peer wasn't returned (older API). */}
            <h3 className="truncate text-base font-semibold leading-tight">
              {channel?.type === "dm" && channelPeer?.name
                ? channelPeer.name
                : channel?.name ?? "Channel"}
            </h3>
            {/* Topic OR description below name — topic wins when set
                because it reflects current focus; falls back to the
                permanent description. */}
            {(channel?.topic || channel?.description) && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {channel.topic || channel.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PresencePill
            channel={channel}
            channelPeer={channelPeer}
            members={members}
            userId={userId}
            connected={connected}
          />
          {/* Channel actions: members chip + ⋯ menu (Settings / Leave).
              DMs deliberately skip this — no rename / no members to
              manage / "leaving" a DM isn't a thing in v1. */}
          {channel && (channel.type === "public" || channel.type === "private") && (
            <ChannelActions
              channel={channel}
              members={members}
              selfUserId={userId}
              serverSlug={serverSlug}
              canManage={viewerCanManage}
              canAddMembers={viewerCanAddMembers}
              onChanged={async () => {
                try {
                  const r = await api.getChannel(channel.id);
                  setChannel(r.channel);
                  setMembers(r.members);
                  setViewerCanManage(r.viewerCanManage ?? false);
                  setViewerCanAddMembers(r.viewerCanAddMembers ?? false);
                } catch { /* noop — next nav refetches */ }
              }}
            />
          )}
        </div>
      </header>

      <div ref={scrollWrapperRef} className="relative flex-1 min-h-0">
        <ScrollArea className="absolute inset-0">
          {/* Bottom padding leaves room for the floating "N new" pill
              so it never overlaps reactions on the last message
              (codex a11y MED). 64px = pill height + breathing room. */}
          <div ref={innerRef} className="space-y-6 px-6 pt-6 pb-16">
            {loading && <p className="text-sm text-muted-foreground">Loading messages…</p>}
          {!loading && messages.length === 0 && (
            <div className="flex h-full min-h-64 items-center justify-center">
              <p className="text-sm text-muted-foreground">No messages yet — say hi.</p>
            </div>
          )}
          {messages.map((m) => {
            // Defensive: API has historically sent system rows without a
            // senderId; .slice on undefined throws and would torch the
            // whole channel page. Default to a stable placeholder so the
            // row still renders and a single bad row can never crash the
            // list.
            const sid = m.senderId ?? "";
            const parent = m.threadParentId
              ? messages.find(p => p.id === m.threadParentId) ?? null
              : null;
            return (
              <MessageRowView
                key={m.id}
                m={m}
                label={memberLabel.get(sid) ?? (sid ? sid.slice(0, 8) : "Unknown")}
                currentUserId={userId}
                editing={editingId === m.id}
                draft={editingDraft}
                onStartEdit={() => startEdit(m)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => saveEdit(m)}
                onDraftChange={setEditingDraft}
                onDelete={() => handleDelete(m)}
                onReact={(emoji) => handleReact(m, emoji)}
                onReply={() => { setReplyTo(m); inputRef.current?.focus(); }}
                onCopy={() => handleCopy(m)}
                onTogglePin={() => handleTogglePin(m)}
                parent={parent}
                parentLabel={parent ? memberLabel.get(parent.senderId) ?? "" : ""}
              />
            );
          })}
          </div>
        </ScrollArea>
        {/* Floating "jump to latest" affordance. Visible only when the
            user is scrolled away from the bottom AND new messages have
            arrived in that window. Clicking it snaps to the newest
            message and clears the unread counter. */}
        {unreadBelow > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom({ smooth: true })}
            aria-label={`Jump to ${unreadBelow} new message${unreadBelow === 1 ? "" : "s"}`}
            // min-h-9 = 36px target. Pairs with px-4 to land near the
            // 44×44 mobile-tap recommendation while staying visually
            // light. h-9 alone would clip mid-vertical-align on some
            // browsers due to the icon + text baseline (codex a11y MED).
            className="absolute bottom-4 left-1/2 z-10 flex min-h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background px-4 py-2 text-xs font-medium shadow-md transition-shadows hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {unreadBelow} new
          </button>
        )}
      </div>

      <footer className="border-t px-6 py-3">
        {/* Picker floats above the composer when active. The wrapper has
            position relative so the absolute panel stays anchored to the
            footer rather than the viewport. */}
        <div className="relative">
          <div className="pointer-events-none absolute bottom-full left-0 right-0 flex justify-start">
            {picker.render()}
          </div>
          {replyTo && (
            <div className="mb-2 flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <MessageSquareReply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Replying to {replyToLabel}</div>
                <div className="truncate text-muted-foreground">
                  {(replyTo.content ?? "").replace(/\s+/g, " ").trim() || "(empty message)"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Cancel reply"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          )}
          {/* Phase C — staged attachments preview row above composer */}
          {(pendingAttachments.length > 0 || uploadingCount > 0) && (
            <div className="flex flex-wrap gap-2 px-1 pb-2">
              {pendingAttachments.map((a) => (
                <div key={a.attachmentId} className="group inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
                  <Paperclip className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  <span className="max-w-[160px] truncate font-medium">{a.filename}</span>
                  <button
                    type="button"
                    onClick={() => removeStagedAttachment(a.attachmentId)}
                    aria-label={`Remove ${a.filename}`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {uploadingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border bg-card/50 px-2 py-1 text-xs text-muted-foreground">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-500" />
                  Uploading {uploadingCount}…
                </span>
              )}
            </div>
          )}
          {/* key={channelId} forces the TipTap editor to fully unmount + remount
              when the user navigates between channels — without it the draft
              text from channel A leaks into channel B's composer because the
              editor instance is reused. */}
          <div className="flex items-end gap-2">
            <label
              className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground ${
                channel?.archivedAt != null ? "pointer-events-none opacity-50" : ""
              }`}
              title="Attach file or image"
            >
              <Paperclip className="h-4 w-4" />
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,application/zip,text/plain,text/markdown"
                className="sr-only"
                disabled={channel?.archivedAt != null}
                onChange={(e) => {
                  if (e.target.files) handleAttachmentPick(e.target.files);
                  e.target.value = ""; // allow re-pick of same file
                }}
              />
            </label>
            <div className="min-w-0 flex-1">
          <TiptapMessageInput
            key={channelId ?? "no-channel"}
            ref={inputRef}
            onSend={handleSend}
            // Phase B — composer disabled when the channel is archived.
            // Backend rejects with 423 even if a stale tab tries to
            // POST, but disabling client-side avoids the bad-request
            // round-trip + clearly signals read-only state.
            disabled={channel?.archivedAt != null}
            placeholder={
              channel?.archivedAt != null
                ? "This channel is archived — read-only"
                : composerPlaceholder
            }
            onTextUpdate={picker.onTextUpdate}
            onKeyDown={picker.onKeyDown}
          />
            </div>
          </div>
        </div>
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
  onReply: () => void;
  onCopy: () => void;
  onTogglePin: () => void;
  /** Parent message of a thread reply — when present we render a small
   *  quoted chip above the body so the reply has visible context. null
   *  for top-level messages. */
  parent: MessageRow | null;
  parentLabel: string;
}

function MessageRowView({ m, label, currentUserId, editing, draft, onStartEdit, onCancelEdit, onSaveEdit, onDraftChange, onDelete, onReact, onReply, onCopy, onTogglePin, parent, parentLabel }: MessageRowProps) {
  const isAgent = m.senderType === "agent";
  const isSystem = m.senderType === "system";
  const isMine = m.senderId === currentUserId;
  const isDeleted = !!m.deletedAt;
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div className={
      "group relative flex gap-3 " +
      // Agent replies get a subtle cyan rule + tiny badge — visual cue
      // that this came from an AI teammate, not a human. The product's
      // whole point is humans + AI together, so the split should be
      // legible at a glance without being noisy.
      (isAgent
        ? "before:absolute before:-left-3 before:top-1 before:bottom-1 before:w-[2px] before:rounded-full before:bg-gradient-to-b before:from-cyan-500/60 before:to-cyan-500/0"
        : "")
    }>
      <div className="shrink-0 pt-0.5">
        <GeneratedAvatar id={m.senderId} name={label} size="lg" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={
            "text-sm font-semibold leading-tight " +
            (isAgent ? "text-cyan-700 dark:text-cyan-400" : "")
          }>{label}</span>
          {isAgent && (
            <span className="rounded-full bg-cyan-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
              AI
            </span>
          )}
          <span className="text-[11px] text-muted-foreground leading-tight">
            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {m.editedAt && !isDeleted && <span className="text-[10px] text-muted-foreground">(edited)</span>}
          {m.pinnedAt && !isDeleted && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Pinned to channel">
              <Pin className="h-2.5 w-2.5" aria-hidden="true" />
              pinned
            </span>
          )}
          {isSystem && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">system</span>}
          {!isDeleted && (
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button onClick={() => setShowPicker(p => !p)} title="Add reaction"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Smile className="h-3.5 w-3.5" />
              </button>
              <button onClick={onReply} title="Reply in thread"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <MessageSquareReply className="h-3.5 w-3.5" />
              </button>
              <button onClick={onCopy} title="Copy text"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onTogglePin}
                title={m.pinnedAt ? "Unpin from channel" : "Pin to channel"}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {m.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
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
        {parent && (
          // Tiny quote chip above thread replies — gives the reader
          // enough context to know what this message is replying to
          // without scrolling. Inline (not collapsible) for the common
          // case of 1-2 deep replies; deeper threads should switch to
          // a dedicated thread pane (P1 polish).
          <div className="mt-0.5 mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MessageSquareReply className="h-3 w-3" aria-hidden="true" />
            <span className="font-medium">{parentLabel || "reply"}</span>
            <span className="truncate">
              {(parent.content ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "(empty)"}
            </span>
          </div>
        )}
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
          <>
            {m.content && (
              <div className={"prose prose-sm dark:prose-invert max-w-none mt-0.5 text-[14.5px] leading-relaxed " + (isDeleted ? "italic text-muted-foreground" : "")}>
                {isAgent && !isDeleted ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeUrl}>{m.content}</ReactMarkdown>
                ) : (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                )}
              </div>
            )}
            {m.attachments && m.attachments.length > 0 && !isDeleted && (
              <AttachmentList attachments={m.attachments} />
            )}
          </>
        )}
        {m.reactions && m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map(r => {
              // Defensive: a reaction with a missing/empty reactorIds list
              // shouldn't be on the wire, but we've seen it happen during
              // partial updates. Treat it as zero-count, not a crash.
              const ids = r.reactorIds ?? [];
              const mineReacted = ids.includes(currentUserId);
              return (
                <button key={r.emoji} onClick={() => onReact(r.emoji)}
                  className={"rounded-full border px-2 py-0.5 text-xs transition-colors " +
                    (mineReacted ? "border-blue-400 bg-blue-50 text-blue-700" : "border-zinc-200 bg-card hover:bg-accent")}>
                  <span>{r.emoji}</span> <span className="text-[10px] text-muted-foreground">{ids.length}</span>
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

/**
 * Header pill for the channel/DM. Three modes:
 *
 *   1. DM with HUMAN peer → "Olivia · Online" / "Last seen 5m"
 *      (real workspace presence, replacing the old "Live" pill that
 *      meant nothing more than "your own WS is up".)
 *
 *   2. Regular CHANNEL with humans → "N online" (count of human
 *      members currently online — agents don't count toward presence).
 *
 *   3. Anything else (DM with an agent, no peer info, channel with
 *      no human members) → falls back to the original WS status
 *      so the user still knows if THEIR connection just dropped.
 *
 * The amber "Connecting…" pulse always wins on local WS drop so
 * debugging signal isn't lost.
 */
function PresencePill({ channel, channelPeer, members, userId, connected }: {
  channel: Channel | null;
  channelPeer: Channel["peer"];
  members: ChannelMember[];
  userId: string;
  connected: boolean;
}): React.ReactElement {
  const presence = useWorkspacePresence(channel?.serverId);

  // Local WS dropped → show that first; nothing else matters until reconnect.
  if (!connected) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium border-warning/30 bg-warning/10 text-warning-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        Connecting…
      </span>
    );
  }

  const isDmWithHuman = channel?.type === "dm" && channelPeer?.type === "human";
  if (isDmWithHuman && channelPeer) {
    const peer = presence[channelPeer.id];
    if (peer) {
      const label = peer.online ? "Online" : peer.lastSeenAt ? `Last seen ${humanizeAgo(peer.lastSeenAt)}` : "Offline";
      return (
        <span className={
          "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium " +
          (peer.online
            ? "border-success/30 bg-success/10 text-success-foreground"
            : "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400")
        }>
          <span className={
            "h-1.5 w-1.5 rounded-full " +
            (peer.online ? "bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]" : "bg-zinc-400")
          } />
          {label}
        </span>
      );
    }
  }

  // Regular channel: count human members who appear online in the
  // workspace presence map. Self is always online (this tab is open),
  // so include if user is a member.
  const isPublicOrPrivateChannel = channel?.type === "public" || channel?.type === "private";
  if (isPublicOrPrivateChannel) {
    const humanMemberIds = members
      .filter(m => m.memberType === "human")
      .map(m => m.memberId);
    const onlineCount = humanMemberIds.filter(id => id === userId || presence[id]?.online).length;
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium border-success/30 bg-success/10 text-success-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
        {onlineCount} online
      </span>
    );
  }

  // Fallback: DM with an agent (no human peer presence to show).
  // Agents have their own status mechanism via useAgentActivity; the
  // pill is just a "we're connected" affordance here.
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium border-success/30 bg-success/10 text-success-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
      Live
    </span>
  );
}

/** Compact "5m" / "2h" / "3d" formatter for last-seen labels. */
function humanizeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
