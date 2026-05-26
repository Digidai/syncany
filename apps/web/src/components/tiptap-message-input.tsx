"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";

export interface TiptapMessageInputHandle {
  focus: () => void;
  clear: () => void;
  getMarkdown: () => string;
  /** Replace @query text near cursor with replacement string */
  replaceMention: (query: string, replacement: string) => void;
}

interface TiptapMessageInputProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaControls?: string;
  ariaActiveDescendant?: string;
  /** Called when user presses Enter on non-empty content */
  onSend: (text: string) => void | boolean | Promise<void | boolean>;
  /** Called on every content change */
  onTextUpdate?: (textBeforeCursor: string, fullText: string) => void;
  /** Intercept keys before Tiptap. Return true to consume (for @mention nav). */
  onKeyDown?: (event: KeyboardEvent) => boolean;
}

function createSendOnEnterExtension(
  onSendRef: React.RefObject<(text: string) => void | boolean | Promise<void | boolean>>
) {
  return Extension.create({
    name: "sendOnEnter",
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const text = editor.getText({ blockSeparator: "\n" });
          if (!text.trim()) return true;
          const result = onSendRef.current(text);
          const clearIfUnchanged = () => {
            if (editor.getText({ blockSeparator: "\n" }) === text) {
              editor.commands.clearContent(true);
            }
          };
          if (result instanceof Promise) {
            void result.then((ok) => { if (ok !== false) clearIfUnchanged(); });
          } else if (result !== false) {
            clearIfUnchanged();
          }
          return true;
        },
      };
    },
  });
}

const TiptapMessageInput = forwardRef<
  TiptapMessageInputHandle,
  TiptapMessageInputProps
>(function TiptapMessageInput(
  { placeholder, disabled, className, ariaLabel, ariaControls, ariaActiveDescendant, onSend, onTextUpdate, onKeyDown },
  ref
) {
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Placeholder.configure({
        placeholder: placeholder || "Write a message...",
      }),
      createSendOnEnterExtension(onSendRef),
    ],
    editorProps: {
      attributes: {
        class: "focus:outline-none",
        role: "textbox",
        "aria-label": ariaLabel || placeholder || "Message",
        "aria-multiline": "true",
        ...(ariaControls ? { "aria-controls": ariaControls } : {}),
        ...(ariaActiveDescendant ? { "aria-activedescendant": ariaActiveDescendant } : {}),
      },
      handleKeyDown: (_view, event) => {
        if (onKeyDown) {
          const handled = onKeyDown(event);
          if (handled) return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (onTextUpdate) {
        const { from } = ed.state.selection;
        const $from = ed.state.doc.resolve(from);
        const textBeforeCursor = $from.parent.textBetween(
          0,
          $from.parentOffset
        );
        onTextUpdate(textBeforeCursor, ed.getText());
      }
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (onTextUpdate) {
        const { from } = ed.state.selection;
        const $from = ed.state.doc.resolve(from);
        const textBeforeCursor = $from.parent.textBetween(
          0,
          $from.parentOffset
        );
        onTextUpdate(textBeforeCursor, ed.getText());
      }
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    dom.setAttribute("role", "textbox");
    dom.setAttribute("aria-label", ariaLabel || placeholder || "Message");
    dom.setAttribute("aria-multiline", "true");
    if (ariaControls) dom.setAttribute("aria-controls", ariaControls);
    else dom.removeAttribute("aria-controls");
    if (ariaActiveDescendant) dom.setAttribute("aria-activedescendant", ariaActiveDescendant);
    else dom.removeAttribute("aria-activedescendant");
  }, [editor, ariaLabel, ariaControls, ariaActiveDescendant, placeholder]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    clear: () => editor?.commands.clearContent(true),
    getMarkdown: () => editor?.getText({ blockSeparator: "\n" }) ?? "",
    replaceMention: (query: string, replacement: string) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const $from = editor.state.doc.resolve(from);
      const parentText = $from.parent.textContent;
      const cursorOffset = $from.parentOffset;
      // Find the `@` that started THIS mention by scanning back from the
      // cursor — same logic the picker's onTextUpdate uses to detect a
      // live mention token. We can't just lastIndexOf("@" + query): if
      // the cursor was MID-token (e.g. `@al|ice` and user picked alice
      // from the dropdown), the query is "al" but the user expects the
      // FULL `@alice` to be replaced — not just `@al`, which would
      // leave the suffix `ice` glued to the inserted mention.
      const textBefore = parentText.slice(0, cursorOffset);
      const atIdx = textBefore.lastIndexOf("@");
      if (atIdx === -1) return;
      // The mention token ends at the FIRST whitespace after the @, or
      // at the end of the parent text. The user might have cursor
      // before that end (mid-token pick); we still consume the full
      // unbroken token so no orphan letters remain.
      const tail = parentText.slice(atIdx + 1);
      const wsMatch = tail.search(/\s/);
      const tokenLen = wsMatch === -1 ? tail.length : wsMatch;
      // Sanity: token must include the query we matched against; if it
      // doesn't (text shifted from under us), bail rather than corrupt.
      if (!parentText.slice(atIdx + 1, atIdx + 1 + tokenLen).startsWith(query)) {
        // Fall back to the legacy lastIndexOf-on-@query strategy.
        const searchStr = `@${query}`;
        const idx = textBefore.lastIndexOf(searchStr);
        if (idx === -1) return;
        const start = $from.start() + idx;
        const end = start + searchStr.length;
        editor.chain().deleteRange({ from: start, to: end }).insertContent(replacement).run();
        return;
      }
      const start = $from.start() + atIdx;
      const end = start + 1 + tokenLen;
      editor
        .chain()
        .deleteRange({ from: start, to: end })
        .insertContent(replacement)
        .run();
    },
  }));

  return (
    <div className={["tiptap-input", className].filter(Boolean).join(" ")}>
      <EditorContent editor={editor} />
    </div>
  );
});

export default TiptapMessageInput;
