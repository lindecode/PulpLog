// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import React, { memo, useMemo, useState } from "react";
import { useLang } from "../i18n.jsx";
import { parseMarkdown } from "../markdown.mjs";
import { copyResultText } from "../utils.mjs";

// "línea 123", "líneas 10-12", "line 42", "L42" → clickable jumps to the log row.
const LINE_REF_RE = /\b(l[ií]neas?|lines?|L)(\s*)(\d{1,9})(?:(\s*[-–]\s*)(\d{1,9}))?\b/gi;

const LINE_HEADER_RE = /^(l[ií]neas?|lines?|l[ií]n\.?|#)$/i;
// "line `231`": the model sometimes formats the number as code.
const LINE_WORD_BEFORE_RE = /\b(l[ií]neas?|lines?)\s*$/i;

const plainText = nodes => nodes.map(node => node.text ?? (node.children ? plainText(node.children) : "")).join("");

function withLineRefs(text, onJumpToLine, keyPrefix, bareNumber = false) {
  if (!onJumpToLine) return text;
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(LINE_REF_RE)) {
    if (match[1] === "L" && match[2]) continue;
    parts.push(text.slice(last, match.index));
    const from = Number(match[3]);
    parts.push(
      <span key={`${keyPrefix}-${match.index}`} role="link" tabIndex={0}
        onClick={() => onJumpToLine(from)}
        onKeyDown={event => { if (event.key === "Enter") onJumpToLine(from); }}
        style={{ color:"var(--pl-accent-hover)", cursor:"pointer", textDecoration:"underline dotted", textUnderlineOffset:2 }}>
        {bareNumber ? match[3] : match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (!parts.length) return text;
  parts.push(text.slice(last));
  return parts;
}

function Inline({ nodes, onJumpToLine }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":   return <React.Fragment key={i}>{withLineRefs(node.text, onJumpToLine, i)}</React.Fragment>;
      case "br":     return <br key={i} />;
      case "strong": return <strong key={i} style={{ color:"var(--pl-text-1)" }}><Inline nodes={node.children} onJumpToLine={onJumpToLine} /></strong>;
      case "em":     return <em key={i}><Inline nodes={node.children} onJumpToLine={onJumpToLine} /></em>;
      case "del":    return <del key={i}><Inline nodes={node.children} onJumpToLine={onJumpToLine} /></del>;
      case "code":   if (onJumpToLine && /^\d{1,9}$/.test(node.text) && LINE_WORD_BEFORE_RE.test(nodes[i - 1]?.text || "")) {
        return <React.Fragment key={i}>{withLineRefs(`L${node.text}`, onJumpToLine, i, true)}</React.Fragment>;
      }
      return (
        <code key={i} style={{ background:"var(--pl-bg-app)", border:"0.5px solid var(--pl-border-soft)", borderRadius:4,
          padding:"0 4px", fontSize:"0.92em", color:"var(--pl-syn-match)", wordBreak:"break-word" }}>{node.text}</code>
      );
      case "link":   return (
        <a key={i} href={node.href} target="_blank" rel="noreferrer noopener"
          style={{ color:"var(--pl-accent-alt)", textDecoration:"underline" }}>
          <Inline nodes={node.children} />
        </a>
      );
      default:       return null;
    }
  });
}

function CodeBlock({ block }) {
  const t = useLang();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyResultText(block.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div style={{ position:"relative", margin:"8px 0", border:"0.5px solid var(--pl-border)", borderRadius:6,
      background:"var(--pl-bg-app)", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", padding:"3px 8px", fontSize:10, color:"var(--pl-text-6)",
        borderBottom:"0.5px solid var(--pl-border-soft)", background:"var(--pl-bg-input)" }}>
        <span>{block.lang || "text"}</span>
        <button type="button" onClick={copy}
          style={{ marginLeft:"auto", background:"none", border:0, color:"var(--pl-text-4)", cursor:"pointer",
            fontFamily:"inherit", fontSize:10, padding:0 }}>
          {copied ? t("analysis_copied") : t("analysis_copy")}
        </button>
      </div>
      <pre style={{ margin:0, padding:"8px 10px", overflowX:"auto", fontSize:11, lineHeight:1.45,
        color:"var(--pl-text-2)", fontFamily:"inherit" }}>
        <code>{block.text}</code>
      </pre>
    </div>
  );
}

function Blocks({ blocks, onJumpToLine }) {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "heading": {
        const size = [16, 14, 13, 12, 12, 12][block.level - 1];
        return (
          <div key={i} role="heading" aria-level={block.level}
            style={{ fontSize:size, fontWeight:700, color:"var(--pl-text-1)", margin:"12px 0 6px",
              paddingBottom:block.level <= 2 ? 3 : 0,
              borderBottom:block.level <= 2 ? "0.5px solid var(--pl-border-soft)" : "none" }}>
            <Inline nodes={block.children} onJumpToLine={onJumpToLine} />
          </div>
        );
      }
      case "paragraph":
        return <p key={i} style={{ margin:"6px 0" }}><Inline nodes={block.children} onJumpToLine={onJumpToLine} /></p>;
      case "code":
        return <CodeBlock key={i} block={block} />;
      case "hr":
        return <hr key={i} style={{ border:0, borderTop:"0.5px solid var(--pl-border)", margin:"10px 0" }} />;
      case "blockquote":
        return (
          <blockquote key={i} style={{ margin:"6px 0", padding:"2px 10px", borderLeft:"3px solid var(--pl-border-strong)",
            color:"var(--pl-text-4)" }}>
            <Blocks blocks={block.children} onJumpToLine={onJumpToLine} />
          </blockquote>
        );
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={i} start={block.ordered && block.start !== 1 ? block.start : undefined}
            style={{ margin:"4px 0", paddingLeft:20 }}>
            {block.items.map((item, j) => (
              <li key={j} style={{ margin:"2px 0", listStyle:item.checked != null ? "none" : undefined }}>
                {item.checked != null && (
                  <span aria-hidden="true" style={{ marginLeft:-16, marginRight:5, color:item.checked ? "var(--pl-accent)" : "var(--pl-text-6)" }}>
                    {item.checked ? "☑" : "☐"}
                  </span>
                )}
                <ListItemBody blocks={item.children} onJumpToLine={onJumpToLine} />
              </li>
            ))}
          </Tag>
        );
      }
      case "table": {
        // Numbers in a "Línea"/"Line" column jump to the log row, like inline line references.
        const lineColumns = block.header.map(cell => LINE_HEADER_RE.test(plainText(cell).trim()));
        return (
          <div key={i} style={{ overflowX:"auto", margin:"8px 0" }}>
            <table style={{ borderCollapse:"collapse", fontSize:11, minWidth:"60%" }}>
              <thead>
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c} style={{ textAlign:block.align[c] || "left", padding:"4px 8px", color:"var(--pl-text-1)",
                      whiteSpace: lineColumns[c] ? "nowrap" : undefined,
                      background:"var(--pl-bg-input)", border:"0.5px solid var(--pl-border)" }}>
                      <Inline nodes={cell} onJumpToLine={onJumpToLine} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {block.header.map((_, c) => (
                      <td key={c} style={{ textAlign:block.align[c] || "left", padding:"4px 8px", verticalAlign:"top",
                        border:"0.5px solid var(--pl-border-soft)" }}>
                        {lineColumns[c] && onJumpToLine && /^\d{1,9}$/.test(plainText(row[c] || []).trim())
                          ? withLineRefs(`L${plainText(row[c]).trim()}`, onJumpToLine, `${r}-${c}`, true)
                          : <Inline nodes={row[c] || []} onJumpToLine={onJumpToLine} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return null;
    }
  });
}

// Tight list items render their first paragraph inline, like most chat UIs.
function ListItemBody({ blocks, onJumpToLine }) {
  if (blocks[0]?.type !== "paragraph") return <Blocks blocks={blocks} onJumpToLine={onJumpToLine} />;
  return (
    <>
      <Inline nodes={blocks[0].children} onJumpToLine={onJumpToLine} />
      <Blocks blocks={blocks.slice(1)} onJumpToLine={onJumpToLine} />
    </>
  );
}

const Markdown = memo(function Markdown({ text, onJumpToLine }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div style={{ fontSize:12, lineHeight:1.55, color:"var(--pl-text-2)", wordBreak:"break-word" }}>
      <Blocks blocks={blocks} onJumpToLine={onJumpToLine} />
    </div>
  );
});

export { Markdown };
