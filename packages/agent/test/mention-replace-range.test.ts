/**
 * Mirrors TiptapMessageInput's `replaceMention` range computation as a
 * pure function — apps/web has no vitest setup, so we test the
 * algorithm here. If you change the production impl in
 * apps/web/src/components/tiptap-message-input.tsx replaceMention,
 * update this mirror too (both impl + this test).
 *
 * Covers the mid-token replace case codex flagged as a regression risk:
 * cursor inside `@al|ice` should select FULL `@alice` token, not just
 * `@al`, when the user picks "alice" from the picker.
 */
import { describe, it, expect } from "vitest";

function mentionReplaceRange(
  parentText: string,
  cursorOffset: number,
  query: string,
): { start: number; end: number } | null {
  const textBefore = parentText.slice(0, cursorOffset);
  const atIdx = textBefore.lastIndexOf("@");
  if (atIdx === -1) return null;
  const tail = parentText.slice(atIdx + 1);
  const wsMatch = tail.search(/\s/);
  const tokenLen = wsMatch === -1 ? tail.length : wsMatch;
  if (!parentText.slice(atIdx + 1, atIdx + 1 + tokenLen).startsWith(query)) {
    return null;
  }
  return { start: atIdx, end: atIdx + 1 + tokenLen };
}

describe("mentionReplaceRange (mid-token pick)", () => {
  it("cursor at end: replaces @<query>", () => {
    expect(mentionReplaceRange("hello @al", 9, "al")).toEqual({ start: 6, end: 9 });
  });

  it("cursor MID token: replaces the FULL token, no orphan suffix", () => {
    // text: "hello @alice" cursor at 9 (after "@al"); query "al".
    // User picks "alice" from the dropdown — should replace WHOLE "@alice".
    expect(mentionReplaceRange("hello @alice", 9, "al")).toEqual({ start: 6, end: 12 });
  });

  it("cursor mid-token with trailing word: stops at next whitespace", () => {
    expect(mentionReplaceRange("ping @alice please", 8, "al")).toEqual({ start: 5, end: 11 });
  });

  it("returns null when no @ before cursor", () => {
    expect(mentionReplaceRange("hello world", 5, "x")).toBeNull();
  });

  it("returns null when query doesn't prefix the token (text raced)", () => {
    expect(mentionReplaceRange("hi @x", 5, "al")).toBeNull();
  });

  it("handles @ at line start", () => {
    expect(mentionReplaceRange("@code-reviewer", 14, "code-reviewer"))
      .toEqual({ start: 0, end: 14 });
  });
});
