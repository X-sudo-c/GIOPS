import type { ReactNode } from 'react';

interface AssistantRichTextProps {
  content: string;
  className?: string;
  mutedClassName?: string;
}

const LINK_PATTERN = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:])/g;

function toSafeHref(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function renderTextWithLinks(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? -1;
    if (index < 0) continue;

    if (index > lastIndex) {
      nodes.push(
        <span key={`${keyPrefix}-text-${matchIndex}`}>
          {text.slice(lastIndex, index)}
        </span>,
      );
    }

    const markdownLabel = match[2];
    const markdownUrl = match[3];
    const rawUrl = match[4];
    const href = toSafeHref(markdownUrl || rawUrl || '');

    if (href) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${matchIndex}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {markdownLabel || href}
        </a>,
      );
    } else {
      nodes.push(<span key={`${keyPrefix}-raw-${matchIndex}`}>{match[0]}</span>);
    }

    lastIndex = index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`${keyPrefix}-tail`}>{text.slice(lastIndex)}</span>);
  }

  return nodes.length ? nodes : [<span key={`${keyPrefix}-full`}>{text}</span>];
}

function renderInline(content: string): ReactNode[] {
  const tokens = content.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={`strong-${index}`} className="font-semibold">
          {renderTextWithLinks(token.slice(2, -2), `strong-${index}`)}
        </strong>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return <code key={`code-${index}`} className="break-words rounded bg-black/15 px-1 py-0.5 text-[0.95em]">{token.slice(1, -1)}</code>;
    }
    return <span key={`text-${index}`}>{renderTextWithLinks(token, `text-${index}`)}</span>;
  });
}

function renderParagraphLines(lines: string[]): ReactNode[] {
  return lines.flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    return index === lines.length - 1
      ? [<span key={`line-${index}`}>{renderInline(trimmed)}</span>]
      : [<span key={`line-${index}`}>{renderInline(trimmed)}</span>, <br key={`break-${index}`} />];
  });
}

function renderBlock(lines: string[], keyPrefix: string, mutedClassName: string): ReactNode[] {
  if (!lines.length) return [];

  const markdownHeadingMatch = lines[0].match(/^#{1,6}\s+(.+)$/);
  if (markdownHeadingMatch) {
    return [
      <p key={`${keyPrefix}-heading`} className="text-sm font-semibold tracking-[0.01em]">
        {renderInline(markdownHeadingMatch[1])}
      </p>,
      ...renderBlock(lines.slice(1).filter((line) => line.trim().length > 0), `${keyPrefix}-rest`, mutedClassName),
    ];
  }

  const colonHeadingMatch = lines[0].match(/^(.+?):$/);
  if (colonHeadingMatch) {
    return [
      <p key={`${keyPrefix}-heading`} className="text-sm font-semibold tracking-[0.01em]">
        {renderInline(colonHeadingMatch[1])}
      </p>,
      ...renderBlock(lines.slice(1).filter((line) => line.trim().length > 0), `${keyPrefix}-rest`, mutedClassName),
    ];
  }

  const unorderedItems = lines
    .map((line) => line.match(/^[-*•]\s+(.+)$/)?.[1] ?? null);
  if (unorderedItems.every(Boolean)) {
    return [
      <ul key={`${keyPrefix}-ul`} className="ml-5 list-disc space-y-1.5">
        {unorderedItems.map((item, itemIndex) => (
          <li key={`${keyPrefix}-ul-item-${itemIndex}`}>{renderInline(item as string)}</li>
        ))}
      </ul>,
    ];
  }

  const orderedItems = lines
    .map((line) => line.match(/^\d+\.\s+(.+)$/)?.[1] ?? null);
  if (orderedItems.every(Boolean)) {
    return [
      <ol key={`${keyPrefix}-ol`} className="ml-5 list-decimal space-y-1.5">
        {orderedItems.map((item, itemIndex) => (
          <li key={`${keyPrefix}-ol-item-${itemIndex}`}>{renderInline(item as string)}</li>
        ))}
      </ol>,
    ];
  }

  return [
    <p key={`${keyPrefix}-p`} className={lines.length === 1 ? '' : mutedClassName}>
      {renderParagraphLines(lines)}
    </p>,
  ];
}

export const AssistantRichText: React.FC<AssistantRichTextProps> = ({
  content,
  className = 'text-sm leading-6',
  mutedClassName = 'opacity-80',
}) => {
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) {
    return <p className={`break-words ${className}`}>{content}</p>;
  }

  return (
    <div className={`space-y-3 break-words ${className}`}>
      {blocks.flatMap((block, blockIndex) => {
        const lines = block.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
        return renderBlock(lines, `block-${blockIndex}`, mutedClassName);
      })}
    </div>
  );
};