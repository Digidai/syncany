"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { Chip } from "@heroui/react/chip";
import { ScrollShadow } from "@heroui/react/scroll-shadow";
import { TextArea } from "@heroui/react/textarea";
import { Navbar } from "@heroui-pro/react/navbar";
import { Button } from "@/components/heroui-pro/button";
import { ConfirmDialog } from "@/components/heroui-pro/confirm-dialog";
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
import { cn } from "@/lib/utils";
import type { MessageRow } from "@raltic/protocol";
import { GeneratedAvatar } from "./generated-avatar";
import TiptapMessageInput, { type TiptapMessageInputHandle } from "./tiptap-message-input";
import { Smile, Pencil, Pin, PinOff, Trash2, MessageSquareReply, Copy, X as XIcon, ArrowDown, Hash, AtSign, LockKeyhole, SendHorizontal, ChevronDown } from "lucide-react";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const inputRef = useRef<TiptapMessageInputHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Scroll container wrapper. HeroUI ScrollShadow scrolls on its root;
  // the data-slot fallback keeps the old ScrollArea selector harmless
  // if this component is ever mounted through a mixed wrapper during
  // migration.
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
  const [composerText, setComposerText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MessageRow | null>(null);

  // Only mark messages as read when this tab is actually visible.
  const isVisible = useCallback((): boolean => {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }, []);
  const markReadIfVisible = useCallback((seq: number) => {
    if (!channelId || seq <= 0) return;
    bumpRead(channelId, seq);                                  // optimistic local
    if (!isVisible()) return;                                  // server only when foreground
    api.markRead(channelId, seq).catch(() => {});
  }, [bumpRead, channelId, isVisible]);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setMessages([]);
    setToken(null);
    setComposerText("");
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
        if (cancelled) return;
        const message = e instanceof ApiError ? e.message : String(e);
        setLoadError(message);
        if (e instanceof ApiError) console.error("MessageArea load failed", e.code, e.message);
        else console.error("MessageArea load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId, markReadIfVisible, seedChannel]);

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
        console.warn("[message-area] scrollToBottom: viewport not found (ScrollShadow root may not be mounted)");
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
    let inserted = false;
    setMessages((prev) => {
      const partialId = `agent-partial:${m.senderId}`;
      if (prev.some((p) => p.id === m.id)) {
        return prev
          .filter((p) => p.id !== partialId || p.id === m.id)
          .map((p) => {
            if (p.id !== m.id) return p;
            const merged = { ...p, ...m };
            if (m.attachments === undefined) merged.attachments = p.attachments;
            if (m.reactions === undefined) merged.reactions = p.reactions;
            return merged;
          });
      }
      inserted = true;
      return [...prev.filter((p) => p.id !== `agent-partial:${m.senderId}`), m];
    });
    if (!inserted) {
      markReadIfVisible(m.seq);
      return;
    }
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

  const handleAgentTextDelta = useCallback((ev: { agentId: string; text: string }) => {
    if (!ev.text.trim()) return;
    const now = Date.now();
    const partialId = `agent-partial:${ev.agentId}`;
    let added = false;
    setMessages((prev) => {
      const maxSeq = prev.reduce((max, m) => Math.max(max, m.seq), 0);
      const partial: MessageRow = {
        id: partialId,
        channelId: channelId ?? "",
        senderId: ev.agentId,
        senderType: "agent",
        content: ev.text,
        seq: maxSeq,
        threadParentId: null,
        createdAt: now,
        updatedAt: now,
      };
      if (prev.some((p) => p.id === partialId)) {
        return prev.map((p) => p.id === partialId ? { ...p, ...partial } : p);
      }
      added = true;
      return [...prev, partial];
    });
    if (stickToBottomRef.current) scheduleSmoothScrollToBottom();
    else if (added) setUnreadBelow(n => n + 1);
  }, [channelId, scheduleSmoothScrollToBottom]);

  // Resolve the real overflow viewport, then attach scroll + resize
  // listeners. ScrollShadow scrolls on its root; the old data-slot
  // selector is a compatibility fallback only. useLayoutEffect keeps
  // the ref ready before the initial-scroll effect below runs in the
  // same commit.
  useLayoutEffect(() => {
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;
    const v = wrapper.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? wrapper;
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
    // whose ref can briefly be null on mount. Only re-scroll when
    // currently stuck.
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
  // stuck, snap. Some browsers / scroll-wrapper combinations can
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
    onAgentTextDelta: handleAgentTextDelta,
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
    // Codex C-ui HIGH 3 — block Enter while uploads are in flight so
    // the message doesn't ship without files the user is still adding.
    if (uploadingCount > 0) {
      notifyThrown("Upload in progress", new Error("Wait for uploads to finish before sending."));
      return false;
    }
    sendInFlightRef.current = true;
    stickToBottomRef.current = true;
    try {
      // Attachment-bearing sends use REST so the server can link
      // attachmentIds atomically with the new message. Pure text
      // sends keep the WS fast-path.
      let ok: boolean;
      if (hasAttachments) {
        try {
          const res = await api.sendMessage({
            channelId,
            content,
            threadParentId: replyTo?.id ?? null,
            idempotencyKey: crypto.randomUUID(),
            attachmentIds: pendingAttachmentsRef.current.map((a) => a.attachmentId),
          });
          ok = true;
          if (res.messageId) {
            const staged = pendingAttachmentsRef.current;
            const now = Date.now();
            handleNew({
              id: res.messageId,
              channelId,
              senderId: userId,
              senderType: "human",
              content,
              seq: res.seq,
              threadParentId: replyTo?.id ?? null,
              createdAt: now,
              updatedAt: now,
              attachments: staged.map((a) => ({
                id: a.attachmentId,
                filename: a.filename,
                contentType: a.contentType,
                sizeBytes: a.sizeBytes,
                url: a.url,
              })),
            });
          }
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
        setComposerText("");
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

  async function handleComposerSubmit() {
    const ok = await handleSend(inputRef.current?.getMarkdown() ?? "");
    if (ok) inputRef.current?.clear();
  }

  function handleComposerTextUpdate(textBeforeCursor: string, fullText: string) {
    setComposerText(fullText);
    picker.onTextUpdate(textBeforeCursor);
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

  async function confirmDeleteMessage() {
    if (!deleteTarget) return;
    try {
      await api.deleteMessage(deleteTarget.id);
      setDeleteTarget(null);
    }
    catch (e) { notifyThrown("Couldn't delete message", e); }
  }

  async function handleReact(m: MessageRow, emoji: string) {
    try { await api.toggleReaction(m.id, emoji); }
    catch (e) { notifyThrown("Couldn't react", e); }
  }

  const isReadOnly = channel?.archivedAt != null;
  const canSubmit = !isReadOnly && uploadingCount === 0 && (
    composerText.trim().length > 0 || pendingAttachments.length > 0
  );
  const channelTitle = channel?.type === "dm" && channelPeer?.name
    ? channelPeer.name
    : channel?.name ?? "Channel";
  const channelSubtitle = channel?.topic || channel?.description || "Get familiar with Raltic";

  return (
    <div
      className="flex min-w-0 flex-1 flex-col bg-background"
      data-chat-surface="heroui-pro-template-chat"
      style={{ "--chat-navbar-height": "64px" } as CSSProperties}
    >
      <Navbar.Root
        aria-label="Conversation header"
        height="var(--chat-navbar-height)"
        maxWidth="full"
        className="shrink-0 border-b border-border/70 bg-background px-4"
      >
        <Navbar.Header className="flex w-full items-center justify-between gap-4">
          <Navbar.Brand className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 shadow-[0_0_0_4px_rgba(6,182,212,0.08)]"
            >
              {channel?.type === "dm" ? (
                <AtSign className="h-4 w-4" />
              ) : channel?.type === "private" ? (
                <LockKeyhole className="h-4 w-4" />
              ) : (
                <Hash className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground sm:text-base">
                {channelTitle}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {channelSubtitle}
              </p>
            </div>
          </Navbar.Brand>
          <Navbar.Content className="shrink-0 justify-end gap-2">
            <PresencePill
              channel={channel}
              channelPeer={channelPeer}
              members={members}
              userId={userId}
              connected={connected}
            />
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
          </Navbar.Content>
        </Navbar.Header>
      </Navbar.Root>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <ScrollShadow
          ref={scrollWrapperRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          hideScrollBar={false}
          offset={24}
          size={42}
        >
          <div ref={innerRef} className="mx-auto flex w-full max-w-[714px] flex-col gap-8 px-4 pb-10 pt-10">
            {loading && <p className="text-sm text-muted-foreground">Loading messages...</p>}
            {!loading && loadError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-foreground">
                Couldn&apos;t load this conversation: {loadError}
              </div>
            )}
            {!loading && !loadError && messages.length === 0 && (
              <div className="flex min-h-64 items-center justify-center">
                <p className="text-sm text-muted-foreground">No messages yet. Say hi.</p>
              </div>
            )}
            {messages.map((m) => {
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
                  onDelete={() => setDeleteTarget(m)}
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
        </ScrollShadow>
        {unreadBelow > 0 && (
          <Button
            type="button"
            onPress={() => scrollToBottom({ smooth: true })}
            aria-label={`Jump to ${unreadBelow} new message${unreadBelow === 1 ? "" : "s"}`}
            size="sm"
            variant="tertiary"
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 shadow-md"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {unreadBelow} new
          </Button>
        )}
      </div>

      <footer className="shrink-0 border-t border-border/70 bg-background px-4 pb-4 pt-3">
        <div className="relative mx-auto flex w-full max-w-[714px] flex-col gap-2">
          <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 flex justify-start pb-2">
            {picker.render()}
          </div>
          {replyTo && (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-default px-3 py-2 text-xs">
              <MessageSquareReply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Replying to {replyToLabel}</div>
                <div className="truncate text-muted-foreground">
                  {(replyTo.content ?? "").replace(/\s+/g, " ").trim() || "(empty message)"}
                </div>
              </div>
              <Button
                type="button"
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="h-7 w-7 min-w-7"
              >
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {(pendingAttachments.length > 0 || uploadingCount > 0) && (
            <div className="flex flex-wrap gap-2" aria-live="polite" aria-atomic="true">
              {pendingAttachments.map((a) => (
                <Chip key={a.attachmentId} size="sm" variant="secondary" color="default" className="max-w-[220px]">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-medium">{a.filename}</span>
                    <Button
                      type="button"
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      onClick={() => removeStagedAttachment(a.attachmentId)}
                      aria-label={`Remove ${a.filename}`}
                      className="h-5 w-5 min-w-5 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </span>
                </Chip>
              ))}
              {uploadingCount > 0 && (
                <Chip size="sm" variant="soft" color="accent">
                  Uploading {uploadingCount}...
                </Chip>
              )}
            </div>
          )}
          <div
            data-testid="message-composer"
            className="flex w-full items-center gap-2 rounded-full bg-background px-3 py-2 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06),0_0_1px_rgba(0,0,0,0.06)] ring-1 ring-border/70 transition-shadow focus-within:ring-cyan-300"
          >
            <Button
              type="button"
              isIconOnly
              size="sm"
              variant="tertiary"
              disabled={isReadOnly}
              onPress={() => fileInputRef.current?.click()}
              aria-label="Attach file or image"
              className="shrink-0"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <div data-testid="message-composer-input" className="flex min-h-9 min-w-0 flex-1 items-center text-sm">
              <TiptapMessageInput
                key={channelId ?? "no-channel"}
                ref={inputRef}
                className="tiptap-input--composer w-full px-1 py-1"
                onSend={handleSend}
                disabled={isReadOnly}
                ariaLabel={`Message ${channelTitle}`}
                ariaControls={picker.aria.controls}
                ariaActiveDescendant={picker.aria.activeDescendant}
                placeholder={
                  isReadOnly
                    ? "This channel is archived - read-only"
                    : composerPlaceholder
                }
                onTextUpdate={handleComposerTextUpdate}
                onKeyDown={picker.onKeyDown}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,application/zip,text/plain,text/markdown"
              className="sr-only"
              disabled={isReadOnly}
              onChange={(e) => {
                if (e.target.files) handleAttachmentPick(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              className="hidden max-w-[200px] shrink-0 justify-between gap-2 px-3 text-muted-foreground sm:inline-flex"
              disabled
            >
              <span className="truncate">{dmAgent ? dmAgent.displayName : "Raltic Agent"}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              isIconOnly
              size="sm"
              variant="primary"
              disabled={!canSubmit}
              onPress={handleComposerSubmit}
              aria-label="Send message"
              className="shrink-0"
            >
              <SendHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </footer>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title="Delete this message?"
        description="This can't be undone. Replies and reactions attached to this message may also lose context."
        confirmLabel="Delete message"
        onConfirm={confirmDeleteMessage}
      />
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
  const isPartial = m.id.startsWith("agent-partial:");
  const [showPicker, setShowPicker] = useState(false);
  const timeLabel = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const actionButtons = !isDeleted && !isPartial ? (
    <div className={cn(
      "pointer-events-none absolute z-20 flex items-center gap-1 rounded-full border border-border bg-background/95 p-1 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      isMine
        ? "right-0 top-full mt-1 sm:right-full sm:top-8 sm:mr-2 sm:mt-0"
        : "left-2 top-full mt-1 sm:left-10 sm:top-0 sm:mt-0 sm:-translate-y-1/2",
    )}>
      <Button
        type="button"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={() => setShowPicker(p => !p)}
        aria-label="Add reaction"
        className="h-8 w-8 min-w-8 text-muted-foreground"
      >
        <Smile className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={onReply}
        aria-label="Reply in thread"
        className="h-8 w-8 min-w-8 text-muted-foreground"
      >
        <MessageSquareReply className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={onCopy}
        aria-label="Copy text"
        className="h-8 w-8 min-w-8 text-muted-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={onTogglePin}
        aria-label={m.pinnedAt ? "Unpin from channel" : "Pin to channel"}
        className="h-8 w-8 min-w-8 text-muted-foreground"
      >
        {m.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </Button>
      {isMine && (
        <>
          <Button
            type="button"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={onStartEdit}
            aria-label="Edit"
            className="h-8 w-8 min-w-8 text-muted-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={onDelete}
            aria-label="Delete"
            className="h-8 w-8 min-w-8 text-muted-foreground hover:text-destructive-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  ) : null;

  const parentPreview = parent ? (
    <div className={cn(
      "flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-default px-2 py-1 text-[11px] text-muted-foreground",
      isMine ? "justify-end" : "justify-start",
    )}>
      <MessageSquareReply className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium">{parentLabel || "reply"}</span>
      <span className="truncate">
        {(parent.content ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "(empty)"}
      </span>
    </div>
  ) : null;

  const messageBody = editing ? (
    <div className="flex w-full flex-col gap-2">
      <TextArea
        value={draft}
        onChange={(e) => onDraftChange((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSaveEdit(); }
        }}
        autoFocus
        rows={Math.max(2, Math.min(8, draft.split("\n").length))}
        fullWidth
        variant="secondary"
        className="text-sm"
      />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Button type="button" size="sm" variant="primary" onPress={onSaveEdit}>
          Save
        </Button>
        <Button type="button" size="sm" variant="tertiary" onPress={onCancelEdit}>
          Cancel
        </Button>
        <span>Cmd/Ctrl+Enter to save, Esc to cancel</span>
      </div>
    </div>
  ) : (
    <>
      {m.content && (
        <div className={cn(
          "prose-message prose prose-sm dark:prose-invert max-w-none text-[15px] leading-6",
          isMine && "prose-p:my-0",
          isDeleted && "italic text-muted-foreground",
        )}>
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
  );

  const reactions = m.reactions && m.reactions.length > 0 ? (
    <div className={cn("mt-1 flex flex-wrap gap-1", isMine && "justify-end")}>
      {m.reactions.map(r => {
        const ids = r.reactorIds ?? [];
        const mineReacted = ids.includes(currentUserId);
        return (
          <Button
            key={r.emoji}
            type="button"
            onClick={() => onReact(r.emoji)}
            variant="outline"
            size="sm"
            className={cn(
              "h-7 rounded-full px-2 text-xs transition-colors",
              mineReacted
                ? "border-cyan-400 bg-cyan-50 text-cyan-700"
                : "border-border bg-background hover:bg-default",
            )}
          >
            <span>{r.emoji}</span> <span className="text-[10px] text-muted-foreground">{ids.length}</span>
          </Button>
        );
      })}
    </div>
  ) : null;

  if (isMine && !isSystem) {
    return (
      <div className="group flex flex-col items-end gap-2">
        <div className="relative flex max-w-[min(82%,560px)] flex-col items-end gap-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {m.pinnedAt && !isDeleted && <Pin className="h-3 w-3" aria-label="Pinned" />}
            {m.editedAt && !isDeleted && <span>edited</span>}
            <span>{timeLabel}</span>
          </div>
          {parentPreview}
          <div className="rounded-xl bg-default px-4 py-3 text-default-foreground">
            {messageBody}
          </div>
          {showPicker && (
            <QuickReactionPicker onReact={onReact} onClose={() => setShowPicker(false)} />
          )}
          {reactions}
          {actionButtons}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "group relative flex flex-col items-start gap-2 py-2 pl-2 pr-12",
      isAgent && "border-l-2 border-cyan-300/70",
    )}>
      <div className="flex items-center gap-2">
        <GeneratedAvatar id={m.senderId} name={label} size="sm" />
        <span className={cn("text-sm font-semibold leading-tight", isAgent && "text-cyan-700")}>{label}</span>
        {isAgent && <Chip size="sm" variant="soft" color="accent">AI</Chip>}
        {isSystem && <Chip size="sm" variant="tertiary" color="default">system</Chip>}
        <span className="text-[11px] leading-tight text-muted-foreground">{timeLabel}</span>
        {m.editedAt && !isDeleted && <span className="text-[10px] text-muted-foreground">edited</span>}
        {m.pinnedAt && !isDeleted && <Pin className="h-3 w-3 text-muted-foreground" aria-label="Pinned" />}
      </div>
      <div className="flex w-full max-w-[620px] flex-col gap-2">
        {parentPreview}
        {showPicker && (
          <QuickReactionPicker onReact={onReact} onClose={() => setShowPicker(false)} />
        )}
        {messageBody}
        {reactions}
        {actionButtons}
      </div>
    </div>
  );
}

function QuickReactionPicker({
  onReact,
  onClose,
}: {
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-fit gap-1 rounded-xl border border-border bg-background p-1 shadow-sm">
      {QUICK_REACTIONS.map((emoji) => (
        <Button
          key={emoji}
          type="button"
          size="sm"
          variant="ghost"
          onPress={() => { onReact(emoji); onClose(); }}
          className="h-8 min-w-8 px-2 text-base"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </Button>
      ))}
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
}) {
  const presence = useWorkspacePresence(channel?.serverId);

  // Local WS dropped → show that first; nothing else matters until reconnect.
  if (!connected) {
    return (
      <Chip size="sm" variant="soft" color="warning" className="shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        Connecting...
      </Chip>
    );
  }

  const isDmWithHuman = channel?.type === "dm" && channelPeer?.type === "human";
  if (isDmWithHuman && channelPeer) {
    const peer = presence[channelPeer.id];
    if (peer) {
      const label = peer.online ? "Online" : peer.lastSeenAt ? `Last seen ${humanizeAgo(peer.lastSeenAt)}` : "Offline";
      return (
        <Chip size="sm" variant="soft" color={peer.online ? "success" : "default"} className="shrink-0">
          <span className={
            "h-1.5 w-1.5 rounded-full " +
            (peer.online ? "bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]" : "bg-zinc-400")
          } />
          {label}
        </Chip>
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
      <Chip size="sm" variant="soft" color="success" className="shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
        {onlineCount} online
      </Chip>
    );
  }

  // Fallback: DM with an agent (no human peer presence to show).
  // Agents have their own status mechanism via useAgentActivity; the
  // pill is just a "we're connected" affordance here.
  return (
    <Chip size="sm" variant="soft" color="success" className="shrink-0">
      <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
      Live
    </Chip>
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
