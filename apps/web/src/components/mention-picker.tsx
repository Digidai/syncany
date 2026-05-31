"use client";

/**
 * @-mention autocomplete picker for the message composer.
 *
 * Usage:
 *   const picker = useMentionPicker({ members, onPick });
 *   <TiptapMessageInput
 *     onTextUpdate={picker.onTextUpdate}
 *     onKeyDown={picker.onKeyDown}
 *   />
 *   {picker.render()}
 *
 * Design:
 *   - Triggered by typing `@` after whitespace (or at line start)
 *   - Filters members by name prefix/contains (case-insensitive)
 *   - Arrow up/down navigates, Enter/Tab inserts, Esc/click-outside dismisses
 *   - Renders a small floating panel anchored above the composer footer
 *   - "Member" here = channel humans + agents (both addressable)
 *
 * What it doesn't do (yet — future polish):
 *   - Doesn't track caret pixel position; the panel is anchored to the
 *     composer footer (Slack-style stacking) which is simpler and works
 *     fine for single-line composers.
 *   - Doesn't fuzzy-match — strict prefix/contains. Good enough until
 *     members grow > 50.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AtSign, Bot } from "lucide-react";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { Button } from "@/components/heroui-pro/button";
import { cn } from "@/lib/utils";

export interface MentionMember {
  id: string;
  /** Display name shown in the row. */
  displayName: string;
  /** The slug we insert into the message (@<slug>). Agents have a slug;
   *  humans use their `name` field. The picker doesn't care; both are strings. */
  slug: string;
  kind: "human" | "agent";
  /** Optional image URL for humans (falls back to GeneratedAvatar). */
  image?: string | null;
}

interface UseMentionPickerOpts {
  members: MentionMember[];
  /** Called when user picks a member. The hook gives you the query (text
   *  after @ up to cursor) and the chosen member; you replace the `@<query>`
   *  in the input with `@<member.slug> ` (trailing space convention). */
  onPick: (member: MentionMember, query: string) => void;
}

export function useMentionPicker({ members, onPick }: UseMentionPickerOpts) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  // Track the last query the input reported so the picker doesn't
  // jitter while the user is typing whitespace inside the same `@token`.
  const queryRef = useRef("");
  queryRef.current = query;
  // Modality tracker — last input the user gave the picker. While in
  // "keyboard" mode we ignore mouse hover so a small mouse drift doesn't
  // hijack the user's keyboard-navigated active option (codex LOW finding).
  const [mode, setMode] = useState<"keyboard" | "mouse">("mouse");
  // Stable ids for aria-activedescendant + listbox association so screen
  // readers can follow the visual active state.
  const listboxId = useId();
  const optionId = useCallback((idx: number) => `${listboxId}-opt-${idx}`, [listboxId]);
  // Panel ref for click-outside dismissal.
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Detect: cursor is somewhere inside an active `@<word>` token.
  // The trigger is the LAST '@' before the cursor that is preceded by
  // whitespace or line-start. If the text between '@' and cursor contains
  // a space, the mention is no longer active.
  const onTextUpdate = useCallback((textBeforeCursor: string) => {
    const lastAt = textBeforeCursor.lastIndexOf("@");
    if (lastAt < 0) {
      if (open) setOpen(false);
      return;
    }
    // '@' must be at start or after whitespace, else it's part of a word
    // (e.g. an email address).
    const prevChar = lastAt > 0 ? textBeforeCursor[lastAt - 1] : "";
    if (prevChar && !/\s/.test(prevChar)) {
      if (open) setOpen(false);
      return;
    }
    const q = textBeforeCursor.slice(lastAt + 1);
    // Cancel if a space slipped into the query (user typed past the mention)
    // or the query is excessively long (likely a paste).
    if (/\s/.test(q) || q.length > 64) {
      if (open) setOpen(false);
      return;
    }
    setQuery(q);
    setOpen(true);
    setActiveIdx(0);
  }, [open]);

  // Members matching the current query (case-insensitive contains on
  // displayName + slug). Self-ranking: prefix matches first, then contains.
  const filtered = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    if (q === "") return members.slice(0, 8);
    const prefix: MentionMember[] = [];
    const rest: MentionMember[] = [];
    for (const m of members) {
      const slug = m.slug.toLowerCase();
      const name = m.displayName.toLowerCase();
      if (slug.startsWith(q) || name.startsWith(q)) prefix.push(m);
      else if (slug.includes(q) || name.includes(q)) rest.push(m);
    }
    return [...prefix, ...rest].slice(0, 8);
  }, [open, members, query]);

  // Keep activeIdx within bounds when filtered set shrinks.
  // Previous version called setActiveIdx during render — React 19 treats
  // that as an anti-pattern; useEffect after commit is safe.
  useEffect(() => {
    if (filtered.length > 0 && activeIdx >= filtered.length) {
      setActiveIdx(0);
    }
  }, [filtered.length, activeIdx]);

  // Click-outside / focus-out dismissal. Without this, an open picker
  // sticks around when the user clicks elsewhere on the page (e.g. the
  // sidebar). pointerdown fires before focus shifts so it's the right
  // event for "the user is interacting with something else".
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (panelRef.current && target && panelRef.current.contains(target)) return;
      // ProseMirror editor swallows pointerdown inside the editor itself;
      // we only want to dismiss when the user clicks OUTSIDE the editor.
      // The composer wraps the editor in `.tiptap-input` — check that too.
      const editorRoot = (target as Element | null)?.closest?.(".tiptap-input");
      if (editorRoot) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const pick = useCallback((idx: number) => {
    const choice = filtered[idx];
    if (!choice) return;
    onPick(choice, queryRef.current);
    setOpen(false);
    setQuery("");
  }, [filtered, onPick]);

  const onKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (!open || filtered.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMode("keyboard");
      setActiveIdx((i) => (i + 1) % filtered.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMode("keyboard");
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(activeIdx);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return true;
    }
    return false;
  }, [open, filtered.length, activeIdx, pick]);

  const render = useCallback(() => {
    if (!open || filtered.length === 0) return null;
    return (
      <div
        ref={panelRef}
        id={listboxId}
        role="listbox"
        aria-label="Mention picker"
        className="pointer-events-auto mb-2 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        // pointerdown puts us in mouse mode so the next hover applies;
        // when navigating by keyboard the mouse pointer over the panel
        // doesn't steal the active option.
        onPointerMove={() => { if (mode !== "mouse") setMode("mouse"); }}
      >
        {filtered.map((m, idx) => (
          <Button
            key={`${m.kind}:${m.id}`}
            id={optionId(idx)}
            role="option"
            aria-selected={idx === activeIdx}
            type="button"
            variant="ghost"
            size="sm"
            onMouseDown={(e) => { e.preventDefault(); pick(idx); }}
            onMouseEnter={() => { if (mode === "mouse") setActiveIdx(idx); }}
            className={cn(
              "!h-auto !w-full !justify-start !whitespace-normal rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              idx === activeIdx ? "bg-cyan-500/10 text-foreground ring-1 ring-cyan-500/25" : "hover:bg-accent/50",
            )}
          >
            <div className="shrink-0">
              {m.image
                ? <img src={m.image} alt="" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                : <GeneratedAvatar id={m.id} name={m.displayName} size="sm" />
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 truncate text-[13px] font-medium">
                <span className="truncate">{m.displayName}</span>
                {m.kind === "agent" && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-500/10 px-1 py-px text-[9px] font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
                    <Bot className="h-2.5 w-2.5" /> AI
                  </span>
                )}
              </div>
              <div className={cn("truncate text-[11px]", idx === activeIdx ? "text-foreground/80" : "text-muted-foreground")}>@{m.slug}</div>
            </div>
            <AtSign className={cn("h-3 w-3 shrink-0", idx === activeIdx ? "text-foreground/70" : "text-muted-foreground/60")} aria-hidden="true" />
          </Button>
        ))}
        <div className="border-t px-2 pt-1.5 pb-1 text-[10px] text-muted-foreground">
          ↑↓ navigate · enter / tab pick · esc cancel
        </div>
      </div>
    );
  }, [open, filtered, activeIdx, pick, listboxId, mode, optionId]);

  // Expose ids so the composer can wire aria-controls / activedescendant
  // on the editor's underlying element. Consumer can ignore if not using.
  const aria = {
    controls: open && filtered.length > 0 ? listboxId : undefined,
    activeDescendant: open && filtered.length > 0 ? optionId(activeIdx) : undefined,
  };

  return { onTextUpdate, onKeyDown, render, open, aria };
}
