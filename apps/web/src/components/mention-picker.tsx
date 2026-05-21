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
import { useCallback, useMemo, useRef, useState } from "react";
import { AtSign, Bot } from "lucide-react";
import { GeneratedAvatar } from "@/components/generated-avatar";
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
  if (activeIdx >= filtered.length && filtered.length > 0) {
    setActiveIdx(0);
  }

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
      setActiveIdx((i) => (i + 1) % filtered.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
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
        role="listbox"
        aria-label="Mention picker"
        className="pointer-events-auto mb-2 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {filtered.map((m, idx) => (
          <button
            key={`${m.kind}:${m.id}`}
            role="option"
            aria-selected={idx === activeIdx}
            onMouseDown={(e) => { e.preventDefault(); pick(idx); }}
            onMouseEnter={() => setActiveIdx(idx)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              idx === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
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
              <div className="truncate text-[11px] text-muted-foreground">@{m.slug}</div>
            </div>
            <AtSign className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          </button>
        ))}
        <div className="border-t px-2 pt-1.5 pb-1 text-[10px] text-muted-foreground">
          ↑↓ navigate · enter / tab pick · esc cancel
        </div>
      </div>
    );
  }, [open, filtered, activeIdx, pick]);

  return { onTextUpdate, onKeyDown, render, open };
}
