"use client";

/**
 * Word-like rich text editor for emails, built on TipTap, plus a lightweight
 * `MergeVariableInput` for single-line fields (e.g. the subject line).
 *
 * Both components share the `{{`-picker: typing `{{` opens a floating
 * dropdown with two groups — "Variabelen" (merge-variable catalog) and
 * "Vacatures" (job titles via useJobs). Selecting a variable inserts a
 * literal `{{path}}` placeholder; selecting a job inserts its title as text.
 *
 * The editor is controlled: `value` is an HTML string, `onChange(html)` is
 * called on every edit. An empty document is reported as "" (not "<p></p>")
 * so existing required-field validation keeps working.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useJobs } from "@/hooks/useJobs";
import {
  buildMergePickerItems,
  type MergePickerItem,
} from "@/lib/mergeVariableCatalog";

// ─── Escape interception ────────────────────────────────────────────────────

/**
 * While a picker is open, intercept Escape on the window capture phase.
 * Radix dialogs listen for Escape with `capture: true` on `document`; a
 * window-level capture listener fires earlier, so we can close just the
 * picker without closing the surrounding dialog.
 */
function useEscapeInterceptor(active: boolean, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [active]);
}

// ─── Picker dropdown (shared) ───────────────────────────────────────────────

interface MergePickerDropdownProps {
  items: MergePickerItem[];
  selectedIndex: number;
  onSelect: (item: MergePickerItem) => void;
  onHover: (index: number) => void;
  style?: CSSProperties;
  className?: string;
}

function MergePickerDropdown({
  items,
  selectedIndex,
  onSelect,
  onHover,
  style,
  className,
}: MergePickerDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-selected row in view while navigating.
  useEffect(() => {
    const el = containerRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const variables = items.filter((i) => i.kind === "variable");
  const jobs = items.filter((i) => i.kind === "job");
  // Items are ordered variables-first (see buildMergePickerItems), so the
  // flat keyboard index maps 1:1 on [variables..., jobs...].
  const jobIndexOffset = variables.length;

  const renderRow = (item: MergePickerItem, index: number) => (
    <button
      key={item.kind === "variable" ? `var-${item.path}` : `job-${index}`}
      type="button"
      data-selected={index === selectedIndex ? "true" : undefined}
      // preventDefault keeps focus (and the caret) in the editor/input;
      // stopPropagation keeps Radix dismiss-layers from seeing the click.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={() => onSelect(item)}
      onMouseEnter={() => onHover(index)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        index === selectedIndex
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/60"
      )}
    >
      {item.kind === "variable" ? (
        <>
          <span className="truncate">{item.label}</span>
          <code className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {`{{${item.path}}}`}
          </code>
        </>
      ) : (
        <span className="truncate">{item.title}</span>
      )}
    </button>
  );

  return (
    <div
      ref={containerRef}
      style={style}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "absolute z-50 max-h-64 w-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg",
        className
      )}
    >
      {variables.length > 0 && (
        <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Variabelen
        </div>
      )}
      {variables.map((item, i) => renderRow(item, i))}
      {jobs.length > 0 && (
        <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vacatures
        </div>
      )}
      {jobs.map((item, i) => renderRow(item, jobIndexOffset + i))}
    </div>
  );
}

// ─── Suggestion extension ───────────────────────────────────────────────────

interface MergeVariableSuggestionOptions {
  suggestion: Omit<
    SuggestionOptions<MergePickerItem, MergePickerItem>,
    "editor"
  >;
}

const MergeVariableSuggestion =
  Extension.create<MergeVariableSuggestionOptions>({
    name: "mergeVariableSuggestion",

    addOptions() {
      return {
        suggestion: { char: "{{" },
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion<MergePickerItem, MergePickerItem>({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  onClick: () => void;
  tooltip: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function ToolbarButton({
  onClick,
  tooltip,
  active,
  disabled,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          aria-pressed={active}
          disabled={disabled}
          // preventDefault keeps the selection/focus inside the editor.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40",
            active && "bg-accent text-accent-foreground"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 self-center bg-border" />;
}

// ─── RichTextEditor ─────────────────────────────────────────────────────────

export interface RichTextEditorProps {
  /** HTML string (controlled). */
  value: string;
  /** Called with the new HTML on every edit; "" when the document is empty. */
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

interface EditorPickerState {
  items: MergePickerItem[];
  command: (item: MergePickerItem) => void;
  top: number;
  left: number;
}

const PICKER_WIDTH = 320; // matches w-80

/**
 * Styling for the ProseMirror content. Tailwind's preflight strips list and
 * heading styles, and @tailwindcss/typography is not installed in this app,
 * so the essentials are restored with arbitrary-variant descendant rules
 * (prose classes are kept for forward compatibility).
 */
const CONTENT_WRAPPER_CLASSES = cn(
  "[&_.ProseMirror]:min-h-[240px] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2",
  "[&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:outline-none",
  "[&_.ProseMirror]:prose [&_.ProseMirror]:prose-sm [&_.ProseMirror]:max-w-none dark:[&_.ProseMirror]:prose-invert",
  // Blocks
  "[&_.ProseMirror_p]:my-1",
  "[&_.ProseMirror_h1]:my-3 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold",
  "[&_.ProseMirror_h2]:my-2.5 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold",
  "[&_.ProseMirror_h3]:my-2 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold",
  "[&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
  "[&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
  "[&_.ProseMirror_li]:my-0.5",
  "[&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:italic",
  "[&_.ProseMirror_a]:text-indigo-600 [&_.ProseMirror_a]:underline dark:[&_.ProseMirror_a]:text-indigo-400",
  // Placeholder (@tiptap/extension-placeholder decoration)
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none",
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left",
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0",
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted-foreground",
  "[&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]"
);

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Begin met typen… Typ {{ voor variabelen.",
  className,
}: RichTextEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { data: jobs } = useJobs();
  const jobTitlesRef = useRef<string[]>([]);
  useEffect(() => {
    jobTitlesRef.current = (jobs ?? []).map((j) => j.title);
  }, [jobs]);

  // ── Picker state ──
  const [picker, setPicker] = useState<EditorPickerState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const pickerRef = useRef<EditorPickerState | null>(null);
  const selectedIndexRef = useRef(0);
  pickerRef.current = picker;
  selectedIndexRef.current = selectedIndex;

  const closePicker = () => {
    const ed = editorRef.current;
    if (ed) exitSuggestion(ed.view);
    setPicker(null);
  };

  useEscapeInterceptor(picker !== null, closePicker);

  // Suggestion config is created once; mutable data flows in through refs.
  const suggestionOptions = useMemo<
    Omit<SuggestionOptions<MergePickerItem, MergePickerItem>, "editor">
  >(() => {
    const updateFromProps = (
      props: SuggestionProps<MergePickerItem, MergePickerItem>
    ) => {
      const rect = props.clientRect?.();
      const wrap = wrapperRef.current?.getBoundingClientRect();
      if (!rect || !wrap || props.items.length === 0) {
        setPicker(null);
        return;
      }
      const left = Math.max(
        0,
        Math.min(rect.left - wrap.left, wrap.width - PICKER_WIDTH)
      );
      setPicker({
        items: props.items,
        command: props.command,
        top: rect.bottom - wrap.top + 4,
        left,
      });
      setSelectedIndex(0);
    };

    return {
      char: "{{",
      // Trigger anywhere, not only after whitespace.
      allowedPrefixes: null,
      // Note: allowSpaces stays off. With a multi-char trigger it stretches
      // the replacement range to the end of the line when editing
      // mid-sentence, which would eat text on selection.
      allowSpaces: false,
      items: ({ query }) =>
        buildMergePickerItems(query, jobTitlesRef.current),
      command: ({ editor, range, props: item }) => {
        const text =
          item.kind === "variable" ? `{{${item.path}}}` : item.title;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [{ type: "text", text }])
          .run();
      },
      render: () => ({
        onStart: updateFromProps,
        onUpdate: updateFromProps,
        onExit: () => setPicker(null),
        onKeyDown: ({ event }: SuggestionKeyDownProps) => {
          const state = pickerRef.current;
          if (!state || state.items.length === 0) return false;
          if (event.key === "ArrowDown") {
            setSelectedIndex((i) => (i + 1) % state.items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            setSelectedIndex(
              (i) => (i - 1 + state.items.length) % state.items.length
            );
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const item = state.items[selectedIndexRef.current];
            if (!item) return false;
            state.command(item);
            return true;
          }
          if (event.key === "Escape") {
            setPicker(null);
            return true;
          }
          return false;
        },
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
      MergeVariableSuggestion.configure({ suggestion: suggestionOptions }),
    ],
    content: value,
    editorProps: {
      attributes: {
        // Descendant styling lives on the wrapper (CONTENT_WRAPPER_CLASSES).
        class: "focus:outline-none",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(ed.isEmpty ? "" : ed.getHTML());
    },
  });
  editorRef.current = editor;

  // Controlled sync: apply external value changes (template pick, reset on
  // dialog open) without clobbering the caret while the user types.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  // ── Toolbar helpers ──
  const headingValue = editor?.isActive("heading", { level: 1 })
    ? "1"
    : editor?.isActive("heading", { level: 2 })
      ? "2"
      : editor?.isActive("heading", { level: 3 })
        ? "3"
        : "paragraph";

  const applyHeading = (v: string) => {
    if (!editor) return;
    if (v === "paragraph") {
      editor.chain().focus().setParagraph().run();
    } else {
      editor
        .chain()
        .focus()
        .setHeading({ level: Number(v) as 1 | 2 | 3 })
        .run();
    }
  };

  const editLink = () => {
    if (!editor) return;
    const previous = (editor.getAttributes("link").href as string) ?? "";
    const url = window.prompt("URL van de link:", previous || "https://");
    if (url === null) return; // geannuleerd
    const trimmed = url.trim();
    if (trimmed === "" || trimmed === "https://") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // No selection: insert the URL itself as a linked text node.
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "text",
            text: trimmed,
            marks: [{ type: "link", attrs: { href: trimmed } }],
          },
        ])
        .run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  };

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background transition focus-within:border-transparent focus-within:ring-2 focus-within:ring-indigo-500",
        className
      )}
    >
      {/* ── Toolbar ── */}
      <TooltipProvider delayDuration={300}>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-1.5 py-1">
          <ToolbarButton
            tooltip="Ongedaan maken (Ctrl+Z)"
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor?.can().undo()}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Opnieuw (Ctrl+Y)"
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor?.can().redo()}
          >
            <Redo2 className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <Select value={headingValue} onValueChange={applyHeading}>
            <SelectTrigger
              aria-label="Tekststijl"
              className="h-8 w-[110px] border-0 bg-transparent px-2 text-xs shadow-none focus:ring-0"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paragraph">Normaal</SelectItem>
              <SelectItem value="1">Kop 1</SelectItem>
              <SelectItem value="2">Kop 2</SelectItem>
              <SelectItem value="3">Kop 3</SelectItem>
            </SelectContent>
          </Select>

          <ToolbarDivider />

          <ToolbarButton
            tooltip="Vet (Ctrl+B)"
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={!editor}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Cursief (Ctrl+I)"
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={!editor}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Onderstrepen (Ctrl+U)"
            active={editor?.isActive("underline")}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            disabled={!editor}
          >
            <Underline className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Doorhalen"
            active={editor?.isActive("strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            disabled={!editor}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            tooltip="Opsomming"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={!editor}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Genummerde lijst"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            disabled={!editor}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            tooltip="Links uitlijnen"
            active={editor?.isActive({ textAlign: "left" })}
            onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            disabled={!editor}
          >
            <AlignLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Centreren"
            active={editor?.isActive({ textAlign: "center" })}
            onClick={() =>
              editor?.chain().focus().setTextAlign("center").run()
            }
            disabled={!editor}
          >
            <AlignCenter className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Rechts uitlijnen"
            active={editor?.isActive({ textAlign: "right" })}
            onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            disabled={!editor}
          >
            <AlignRight className="h-4 w-4" />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            tooltip="Link invoegen of bewerken"
            active={editor?.isActive("link")}
            onClick={editLink}
            disabled={!editor}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Link verwijderen"
            onClick={() => editor?.chain().focus().unsetLink().run()}
            disabled={!editor?.isActive("link")}
          >
            <Link2Off className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </TooltipProvider>

      {/* ── Content + picker ── */}
      <div
        ref={wrapperRef}
        className={cn("relative min-h-[240px]", CONTENT_WRAPPER_CLASSES)}
      >
        <EditorContent editor={editor} />
        {picker && picker.items.length > 0 && (
          <MergePickerDropdown
            items={picker.items}
            selectedIndex={selectedIndex}
            onSelect={(item) => picker.command(item)}
            onHover={setSelectedIndex}
            style={{ top: picker.top, left: picker.left }}
          />
        )}
      </div>
    </div>
  );
}

// ─── MergeVariableInput (subject line) ──────────────────────────────────────

export interface MergeVariableInputProps
  extends Omit<InputProps, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

interface InputTriggerState {
  /** Index of the `{{` that opened the picker. */
  start: number;
  query: string;
}

/**
 * Lightweight `{{`-picker for single-line inputs: detects a trailing `{{`
 * before the caret, shows the same picker dropdown below the field and
 * inserts at the caret position, restoring focus and caret afterwards.
 */
export function MergeVariableInput({
  value,
  onChange,
  className,
  ...rest
}: MergeVariableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: jobs } = useJobs();
  const jobTitles = useMemo(() => (jobs ?? []).map((j) => j.title), [jobs]);

  const [trigger, setTrigger] = useState<InputTriggerState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo(
    () => (trigger ? buildMergePickerItems(trigger.query, jobTitles) : []),
    [trigger, jobTitles]
  );
  const open = trigger !== null && items.length > 0;

  useEscapeInterceptor(open, () => setTrigger(null));

  const detectTrigger = (
    val: string,
    caret: number | null
  ): InputTriggerState | null => {
    if (caret === null) return null;
    const match = /\{\{([^{}]*)$/.exec(val.slice(0, caret));
    return match ? { start: match.index, query: match[1] } : null;
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    setTrigger(detectTrigger(val, e.target.selectionStart));
    setSelectedIndex(0);
  };

  const selectItem = (item: MergePickerItem) => {
    if (!trigger) return;
    const text = item.kind === "variable" ? `{{${item.path}}}` : item.title;
    const end = trigger.start + 2 + trigger.query.length; // after "{{query"
    const next = value.slice(0, trigger.start) + text + value.slice(end);
    onChange(next);
    setTrigger(null);
    const caretPos = trigger.start + text.length;
    // Restore focus + caret after the controlled value round-trips.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) selectItem(item);
    } else if (e.key === "Escape") {
      // Normally intercepted on window capture; kept as a fallback.
      e.preventDefault();
      e.stopPropagation();
      setTrigger(null);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTrigger(null)}
        autoComplete="off"
        className={className}
        {...rest}
      />
      {open && (
        <MergePickerDropdown
          items={items}
          selectedIndex={selectedIndex}
          onSelect={selectItem}
          onHover={setSelectedIndex}
          className="left-0 right-0 top-full mt-1 w-auto"
        />
      )}
    </div>
  );
}
