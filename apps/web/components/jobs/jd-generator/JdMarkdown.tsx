"use client";

import type { JSX, ReactNode } from "react";

/**
 * Lightweight Markdown renderer used by the JD-generator wizard. Supports
 * headings (`#`/`##`/`###`), bullet lists (`- ` / `* `), paragraphs, plus
 * inline `**bold**` and `*italic*`. Identical surface to the renderer in
 * `JobOverzichtTab` so the recruiter sees the same formatting in the wizard
 * preview as on the published job.
 */
export function JdMarkdown({ source }: { source: string }) {
  return <div className="space-y-2">{renderMarkdown(source)}</div>;
}

function renderMarkdown(input: string): JSX.Element[] {
  const lines = input.split(/\r?\n/);
  const blocks: JSX.Element[] = [];
  let listItems: string[] = [];
  let para: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul
          key={`list-${key++}`}
          className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300"
        >
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push(
        <p
          key={`p-${key++}`}
          className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
        >
          {renderInline(para.join(" "))}
        </p>
      );
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      flushList();
      flushPara();
      blocks.push(
        <h4
          key={`h-${key++}`}
          className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      flushList();
      flushPara();
      blocks.push(
        <h3
          key={`h-${key++}`}
          className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {line.slice(3)}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      flushList();
      flushPara();
      blocks.push(
        <h2
          key={`h-${key++}`}
          className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100"
        >
          {line.slice(2)}
        </h2>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      flushPara();
      listItems.push(line.slice(2));
    } else if (line === "") {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return blocks;
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIdx = match.index + token.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}
