/**
 * Pure Node.js (.mjs) HTML & Rich-Text to SVG <text>/<tspan> Layout Engine.
 * Supports draw.io's `html=1` labels (<br>, <div>, <p>, <b>, <i>, <u>, <s>, <font>, <span>,
 * <ul>/<ol>/<li>, <h1>-<h6>, <hr>, <table>/<tr>/<td>, inline CSS styles),
 * East Asian Width (Japanese/CJK) word wrapping (`whiteSpace=wrap`),
 * horizontal/vertical alignment, rotation, and label background/border boxes.
 */
import { decodeXmlEntities, XmlNode } from "./xml.mjs";

const FONT_BOLD = 1;
const FONT_ITALIC = 2;
const FONT_UNDERLINE = 4;
const FONT_STRIKETHROUGH = 8;

// Classic HTML <font size="1..7"> mapping in px
const HTML_FONT_SIZES = {
  1: 10,
  2: 13,
  3: 16,
  4: 18,
  5: 24,
  6: 32,
  7: 48,
};

const HEADING_SCALE = {
  h1: 2.0,
  h2: 1.5,
  h3: 1.17,
  h4: 1.0,
  h5: 0.83,
  h6: 0.67,
};

/**
 * Checks if a Unicode code point is full-width (CJK, Hiragana, Katakana, Kanji, Fullwidth forms, Emoji).
 */
export function isFullWidthCodePoint(cp) {
  if (cp == null) return false;
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || // CJK Radicals, Hiragana, Katakana, Kanji
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth ASCII variants
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // Emoji & Symbols
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/**
 * Estimates the rendered pixel width of a single character at the given fontSize and bold flag.
 */
export function estimateCharWidth(ch, fontSize, isBold = false) {
  const cp = ch.codePointAt(0);
  if (cp == null) return 0;
  if (ch === "\t") return fontSize * 1.6;
  if (ch === " " || ch === "\u00a0") return fontSize * 0.31;
  if (isFullWidthCodePoint(cp)) {
    return fontSize * (isBold ? 1.04 : 1.0);
  }
  if ("ilI1|.,:;!'`()[]{}".includes(ch)) {
    return fontSize * (isBold ? 0.36 : 0.32);
  }
  if ("mwMW@%".includes(ch)) {
    return fontSize * (isBold ? 0.88 : 0.82);
  }
  if (cp >= 0x41 && cp <= 0x5a) {
    // Uppercase ASCII
    return fontSize * (isBold ? 0.67 : 0.63);
  }
  return fontSize * (isBold ? 0.56 : 0.52);
}

/**
 * Estimates the rendered pixel width of a string at the given fontSize and bold flag.
 */
export function estimateTextWidth(text, fontSize, isBold = false) {
  if (!text) return 0;
  let total = 0;
  for (const ch of text) {
    total += estimateCharWidth(ch, fontSize, isBold);
  }
  return total;
}

function parseInlineCss(styleAttr) {
  const map = Object.create(null);
  if (!styleAttr || typeof styleAttr !== "string") return map;
  for (const part of styleAttr.split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) {
      const k = part.slice(0, colon).trim().toLowerCase();
      const v = part.slice(colon + 1).trim();
      if (k && v) map[k] = v;
    }
  }
  return map;
}

function applyCssToStyle(css, baseStyle) {
  const next = { ...baseStyle };
  if (css.color) {
    next.color = css.color;
  }
  if (css["background-color"]) {
    next.backgroundColor = css["background-color"];
  }
  if (css["font-family"]) {
    next.fontFamily = css["font-family"].replace(/['"]/g, "");
  }
  if (css["font-size"]) {
    const raw = css["font-size"];
    if (raw.endsWith("px")) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) next.fontSize = n;
    } else if (raw.endsWith("pt")) {
      const n = parseFloat(raw) * (4 / 3);
      if (Number.isFinite(n) && n > 0) next.fontSize = n;
    } else if (raw.endsWith("em")) {
      const n = parseFloat(raw) * baseStyle.fontSize;
      if (Number.isFinite(n) && n > 0) next.fontSize = n;
    } else if (raw.endsWith("%")) {
      const n = (parseFloat(raw) / 100) * baseStyle.fontSize;
      if (Number.isFinite(n) && n > 0) next.fontSize = n;
    } else {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) next.fontSize = n;
    }
  }
  if (css["font-weight"]) {
    const fw = css["font-weight"].toLowerCase();
    if (fw === "bold" || fw === "bolder" || parseInt(fw, 10) >= 600) {
      next.bold = true;
    } else if (fw === "normal" || fw === "lighter" || parseInt(fw, 10) < 600) {
      next.bold = false;
    }
  }
  if (css["font-style"]) {
    const fs = css["font-style"].toLowerCase();
    next.italic = fs === "italic" || fs === "oblique";
  }
  if (css["text-decoration"] || css["text-decoration-line"]) {
    const td = (css["text-decoration"] || css["text-decoration-line"]).toLowerCase();
    if (td.includes("underline")) next.underline = true;
    if (td.includes("line-through")) next.strikethrough = true;
  }
  if (css["text-align"]) {
    const ta = css["text-align"].toLowerCase();
    if (ta === "left" || ta === "center" || ta === "right") {
      next.align = ta;
    }
  }
  return next;
}

const BLOCK_TAGS = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "blockquote",
  "pre",
  "hr",
]);

/**
 * Parses an HTML or plain-text string into an array of logical lines:
 * Each line is `{ spans: Array<{ text, fontSize, fontFamily, color, backgroundColor, bold, italic, underline, strikethrough, baselineShift }>, align: string | null, isHr?: boolean }`
 */
export function parseRichTextLines(str, defaultStyle, isHtml = true) {
  const baseSpanStyle = {
    fontSize: Number(defaultStyle.fontSize) || 12,
    fontFamily: defaultStyle.fontFamily || "Helvetica, Arial, sans-serif",
    color: defaultStyle.fontColor || "#000000",
    backgroundColor: null,
    bold: ((defaultStyle.fontStyle || 0) & FONT_BOLD) !== 0,
    italic: ((defaultStyle.fontStyle || 0) & FONT_ITALIC) !== 0,
    underline: ((defaultStyle.fontStyle || 0) & FONT_UNDERLINE) !== 0,
    strikethrough: ((defaultStyle.fontStyle || 0) & FONT_STRIKETHROUGH) !== 0,
    baselineShift: 0,
    align: null,
  };

  if (str == null || str === "") {
    return [];
  }

  const rawStr = String(str);

  // Plain text fast path when not HTML or when there are no HTML tags/entities
  if (!isHtml || (!rawStr.includes("<") && !rawStr.includes("&"))) {
    const text = isHtml ? decodeXmlEntities(rawStr) : rawStr;
    return text.split(/\r?\n/).map((lineText) => ({
      align: null,
      spans: lineText.length > 0 ? [{ ...baseSpanStyle, text: lineText }] : [],
    }));
  }

  const lines = [];
  let currentLine = { align: null, spans: [], explicitBreak: false };

  const flushLine = (forceEmpty = false, nextAlign = null) => {
    if (currentLine.spans.length > 0 || forceEmpty) {
      lines.push(currentLine);
    }
    currentLine = { align: nextAlign, spans: [], explicitBreak: false };
  };

  const pushText = (txt, style, preserveWhitespace = false) => {
    if (!txt) return;
    const normalized = preserveWhitespace
      ? txt
      : txt.replace(/\r?\n/g, " ").replace(/[ \t]{2,}/g, " ");
    if (!normalized) return;

    const parts = normalized.split(/\r?\n/);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        flushLine(true, style.align);
      }
      const part = parts[i];
      if (part.length > 0) {
        if (!currentLine.align && style.align) {
          currentLine.align = style.align;
        }
        const prev = currentLine.spans[currentLine.spans.length - 1];
        if (
          prev &&
          prev.fontSize === style.fontSize &&
          prev.fontFamily === style.fontFamily &&
          prev.color === style.color &&
          prev.backgroundColor === style.backgroundColor &&
          prev.bold === style.bold &&
          prev.italic === style.italic &&
          prev.underline === style.underline &&
          prev.strikethrough === style.strikethrough &&
          prev.baselineShift === style.baselineShift
        ) {
          prev.text += part;
        } else {
          currentLine.spans.push({ ...style, text: part });
        }
      }
    }
  };

  // Tokenize HTML into tags and text segments
  const tokenRe = /<!--[\s\S]*?-->|<\/([A-Za-z0-9_:-]+)\s*>|<([A-Za-z0-9_:-]+)((?:\s+[A-Za-z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([A-Za-z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  const styleStack = [baseSpanStyle];
  const tagStack = [];
  let listCounter = 0;
  let inTableCell = false;

  let m;
  while ((m = tokenRe.exec(rawStr)) !== null) {
    if (m[1] !== undefined) {
      // Closing tag
      const closeTag = m[1].toLowerCase();
      if (closeTag === "td" || closeTag === "th") {
        inTableCell = false;
      }
      for (let i = tagStack.length - 1; i >= 0; i--) {
        if (tagStack[i] === closeTag) {
          tagStack.length = i;
          styleStack.length = i + 1;
          break;
        }
      }
      if (BLOCK_TAGS.has(closeTag) && closeTag !== "td" && closeTag !== "th") {
        if (currentLine.spans.length > 0) {
          flushLine(false, styleStack[styleStack.length - 1].align);
        }
      }
    } else if (m[2] !== undefined) {
      // Opening tag
      const tag = m[2].toLowerCase();
      const selfClosing = Boolean(m[4]) || tag === "br" || tag === "hr" || tag === "img";
      const attrs = Object.create(null);
      attrRe.lastIndex = 0;
      let am;
      while ((am = attrRe.exec(m[3] || "")) !== null) {
        attrs[am[1].toLowerCase()] = decodeXmlEntities(am[2] ?? am[3] ?? am[4] ?? "");
      }

      const curStyle = styleStack[styleStack.length - 1];

      if (tag === "br") {
        // Explicit line break
        flushLine(true, curStyle.align);
        continue;
      }

      if (tag === "hr") {
        if (currentLine.spans.length > 0) {
          flushLine(false, curStyle.align);
        }
        lines.push({ align: curStyle.align, spans: [], isHr: true });
        currentLine = { align: curStyle.align, spans: [], explicitBreak: false };
        continue;
      }

      let nextStyle = { ...curStyle };
      if (attrs.style) {
        nextStyle = applyCssToStyle(parseInlineCss(attrs.style), nextStyle);
      }
      if (attrs.align) {
        const a = attrs.align.toLowerCase();
        if (a === "left" || a === "center" || a === "right") {
          nextStyle.align = a;
        }
      }

      if (tag === "b" || tag === "strong" || tag === "th") {
        nextStyle.bold = true;
      } else if (tag === "i" || tag === "em") {
        nextStyle.italic = true;
      } else if (tag === "u" || tag === "ins") {
        nextStyle.underline = true;
      } else if (tag === "s" || tag === "strike" || tag === "del") {
        nextStyle.strikethrough = true;
      } else if (tag === "sub") {
        nextStyle.fontSize = Math.max(7, nextStyle.fontSize * 0.78);
        nextStyle.baselineShift = (nextStyle.baselineShift || 0) + nextStyle.fontSize * 0.28;
      } else if (tag === "sup") {
        nextStyle.fontSize = Math.max(7, nextStyle.fontSize * 0.78);
        nextStyle.baselineShift = (nextStyle.baselineShift || 0) - nextStyle.fontSize * 0.35;
      } else if (tag === "code" || tag === "pre" || tag === "tt") {
        nextStyle.fontFamily = "Courier New, monospace";
      } else if (HEADING_SCALE[tag]) {
        nextStyle.fontSize = Math.round(baseSpanStyle.fontSize * HEADING_SCALE[tag]);
        nextStyle.bold = true;
      } else if (tag === "small") {
        nextStyle.fontSize = Math.max(8, Math.round(nextStyle.fontSize * 0.85));
      } else if (tag === "big") {
        nextStyle.fontSize = Math.round(nextStyle.fontSize * 1.2);
      } else if (tag === "font") {
        if (attrs.color) nextStyle.color = attrs.color;
        if (attrs.face) nextStyle.fontFamily = attrs.face;
        if (attrs.size) {
          const sVal = attrs.size.trim();
          if (sVal.startsWith("+") || sVal.startsWith("-")) {
            const idx = Math.max(1, Math.min(7, 3 + parseInt(sVal, 10)));
            nextStyle.fontSize = HTML_FONT_SIZES[idx] || nextStyle.fontSize;
          } else {
            const num = parseInt(sVal, 10);
            if (HTML_FONT_SIZES[num]) {
              nextStyle.fontSize = HTML_FONT_SIZES[num];
            } else if (num > 7) {
              nextStyle.fontSize = num;
            }
          }
        }
      }

      if (BLOCK_TAGS.has(tag)) {
        if (currentLine.spans.length > 0) {
          flushLine(false, nextStyle.align);
        } else if (nextStyle.align) {
          currentLine.align = nextStyle.align;
        }
      }

      if (tag === "ul" || tag === "ol") {
        listCounter = 0;
      } else if (tag === "li") {
        listCounter++;
        const parentList = [...tagStack].reverse().find((t) => t === "ul" || t === "ol");
        const bullet = parentList === "ol" ? `${listCounter}. ` : "\u2022 ";
        pushText(bullet, nextStyle);
      } else if (tag === "td" || tag === "th") {
        if (inTableCell || currentLine.spans.length > 0) {
          pushText("   ", nextStyle, true);
        }
        inTableCell = true;
      }

      if (!selfClosing) {
        tagStack.push(tag);
        styleStack.push(nextStyle);
      }
    } else if (m[5] !== undefined) {
      // Text content
      const curStyle = styleStack[styleStack.length - 1];
      const inPre = tagStack.includes("pre");
      const decoded = decodeXmlEntities(m[5]);
      pushText(decoded, curStyle, inPre);
    }
  }

  if (currentLine.spans.length > 0 || lines.length === 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Wraps parsed rich-text lines to fit within `maxWidth` pixels (when `wrap` is true and `maxWidth > 0`).
 * Supports both space-separated words (Latin/ASCII) and character-by-character wrapping (Japanese/CJK).
 */
export function wrapRichTextLines(lines, maxWidth, wrap = false) {
  if (!wrap || !Number.isFinite(maxWidth) || maxWidth <= 4) {
    return lines;
  }

  const wrapped = [];

  for (const line of lines) {
    if (line.isHr || line.spans.length === 0) {
      wrapped.push(line);
      continue;
    }

    // Break spans into atomic wrapping tokens (either CJK single character, whitespace, or non-CJK word)
    const tokens = [];
    for (const span of line.spans) {
      const text = span.text || "";
      let buf = "";
      let bufType = null; // 'space' | 'word'

      const flushBuf = () => {
        if (buf.length > 0) {
          tokens.push({
            span,
            text: buf,
            isSpace: bufType === "space",
            width: estimateTextWidth(buf, span.fontSize, span.bold),
          });
          buf = "";
          bufType = null;
        }
      };

      for (const ch of text) {
        const cp = ch.codePointAt(0);
        const isSpace = ch === " " || ch === "\t";
        const isCjk = isFullWidthCodePoint(cp);

        if (isCjk) {
          flushBuf();
          tokens.push({
            span,
            text: ch,
            isSpace: false,
            isCjk: true,
            width: estimateCharWidth(ch, span.fontSize, span.bold),
          });
        } else if (isSpace) {
          if (bufType !== "space") flushBuf();
          buf += ch;
          bufType = "space";
        } else {
          if (bufType !== "word") flushBuf();
          buf += ch;
          bufType = "word";
        }
      }
      flushBuf();
    }

    let curSpans = [];
    let curWidth = 0;

    const pushSpanToCur = (spanProto, txt) => {
      if (!txt) return;
      const last = curSpans[curSpans.length - 1];
      if (
        last &&
        last.fontSize === spanProto.fontSize &&
        last.fontFamily === spanProto.fontFamily &&
        last.color === spanProto.color &&
        last.backgroundColor === spanProto.backgroundColor &&
        last.bold === spanProto.bold &&
        last.italic === spanProto.italic &&
        last.underline === spanProto.underline &&
        last.strikethrough === spanProto.strikethrough &&
        last.baselineShift === spanProto.baselineShift
      ) {
        last.text += txt;
      } else {
        curSpans.push({ ...spanProto, text: txt });
      }
    };

    const commitLine = () => {
      // Trim trailing whitespace on wrapped line
      if (curSpans.length > 0) {
        const last = curSpans[curSpans.length - 1];
        last.text = last.text.replace(/[ \t]+$/, "");
        if (last.text.length === 0) curSpans.pop();
      }
      if (curSpans.length > 0) {
        wrapped.push({ align: line.align, spans: curSpans });
      }
      curSpans = [];
      curWidth = 0;
    };

    for (const tok of tokens) {
      if (tok.isSpace && curSpans.length === 0) {
        // Drop leading spaces at start of wrapped line
        continue;
      }

      if (curWidth + tok.width <= maxWidth || (curSpans.length === 0 && tok.width <= maxWidth)) {
        pushSpanToCur(tok.span, tok.text);
        curWidth += tok.width;
      } else if (!tok.isSpace && tok.width > maxWidth) {
        // Single long token wider than maxWidth: break character by character
        for (const ch of tok.text) {
          const cw = estimateCharWidth(ch, tok.span.fontSize, tok.span.bold);
          if (curWidth + cw > maxWidth && curSpans.length > 0) {
            commitLine();
          }
          pushSpanToCur(tok.span, ch);
          curWidth += cw;
        }
      } else {
        commitLine();
        if (!tok.isSpace) {
          pushSpanToCur(tok.span, tok.text);
          curWidth = tok.width;
        }
      }
    }

    if (curSpans.length > 0) {
      commitLine();
    }
  }

  return wrapped.length > 0 ? wrapped : lines;
}

/**
 * Computes line metrics (width, fontSize, lineHeight) for each line and overall block dimensions.
 */
export function computeLinesMetrics(lines, defaultFontSize = 12, lineHeightFactor = 1.2) {
  let maxWidth = 0;
  let totalHeight = 0;
  const lineMetrics = [];

  for (const line of lines) {
    if (line.isHr) {
      const h = Math.max(6, Math.round(defaultFontSize * 0.6));
      lineMetrics.push({
        line,
        width: 0,
        fontSize: defaultFontSize,
        lineHeight: h,
        yOffset: totalHeight,
      });
      totalHeight += h;
      continue;
    }

    let lineW = 0;
    let maxFs = defaultFontSize;
    for (const sp of line.spans) {
      lineW += estimateTextWidth(sp.text, sp.fontSize, sp.bold);
      if (sp.fontSize > maxFs) maxFs = sp.fontSize;
    }
    const lh = Math.round(maxFs * lineHeightFactor);
    lineMetrics.push({
      line,
      width: lineW,
      fontSize: maxFs,
      lineHeight: lh,
      yOffset: totalHeight,
    });
    if (lineW > maxWidth) maxWidth = lineW;
    totalHeight += lh;
  }

  return {
    lineMetrics,
    maxWidth,
    totalHeight,
  };
}

/**
 * Renders text (HTML or plain text) into pure SVG <g>/<rect>/<text>/<tspan> XmlNodes.
 * Note: `(x, y)` passed to `SvgCanvas2D.prototype.text` is already the aligned anchor point
 * produced by `mxCellRenderer.prototype.getLabelBounds` / `rotateLabelBounds` (or `mxStencil`).
 */
export function renderTextToSvgNodes({
  doc,
  x,
  y,
  w,
  h,
  str,
  align = "center",
  valign = "middle",
  wrap = false,
  format = "",
  overflow = "",
  clip = false,
  rotation = 0,
  dir = "",
  canvasState,
  resolveColor = (c) => c,
}) {
  if (str == null || str === "") return null;

  const s = canvasState;
  const scale = s.scale || 1;
  const baseFontSize = Number(s.fontSize) || 12;
  const isHtml = format === "html" || /<[a-zA-Z!/]/.test(String(str));

  const parsedLines = parseRichTextLines(
    String(str),
    {
      fontSize: baseFontSize,
      fontFamily: s.fontFamily || "Helvetica, Arial, sans-serif",
      fontColor: resolveColor(s.fontColor) || "#000000",
      fontStyle: s.fontStyle || 0,
    },
    isHtml
  );

  if (parsedLines.length === 0) return null;

  const hasVisibleContent = parsedLines.some(
    (l) => l.isHr || l.spans.some((sp) => sp.text && sp.text.length > 0)
  );
  if (!hasVisibleContent) return null;

  const wrapWidth = wrap && w > 0 ? w : 0;
  const lines = wrapRichTextLines(parsedLines, wrapWidth, wrap && w > 0);
  const { lineMetrics, maxWidth, totalHeight } = computeLinesMetrics(lines, baseFontSize, 1.2);

  // Compute top Y in unscaled canvas coordinates (matching mxSvgCanvas2D.prototype.plainText)
  let topY = y;
  if (valign === "top") {
    topY += 3;
  } else if (valign === "middle") {
    if (overflow === "fill") {
      topY -= h / 2;
    } else {
      const dy = (clip && h > 0 ? Math.min(totalHeight, h) : totalHeight) / 2;
      topY -= dy;
    }
  } else if (valign === "bottom") {
    if (overflow === "fill") {
      topY -= h;
    } else {
      const dy = clip && h > 0 ? Math.min(totalHeight, h) : totalHeight;
      topY -= dy + 3;
    }
  }

  // Compute unscaled horizontal box origin for block-level alignment overrides & backgrounds
  let boxLeftX = x;
  if (align === "center") {
    boxLeftX = x - (w > 0 ? w / 2 : maxWidth / 2);
  } else if (align === "right") {
    boxLeftX = x - (w > 0 ? w : maxWidth);
  }
  const effectiveBoxWidth = w > 0 ? w : maxWidth;

  const group = new XmlNode(1, "g", doc);
  group.setAttribute("pointer-events", "none");

  let tr = s.transform || "";
  if (rotation && Number(rotation) !== 0) {
    const rx = Number((x * scale).toFixed(2));
    const ry = Number((y * scale).toFixed(2));
    tr += `rotate(${Number(Number(rotation).toFixed(2))},${rx},${ry})`;
  }
  if (tr.length > 0) {
    group.setAttribute("transform", tr);
  }
  if (s.alpha < 1) {
    group.setAttribute("opacity", String(s.alpha));
  }
  if (dir && !String(dir).startsWith("vertical-")) {
    group.setAttribute("direction", dir);
  }

  // Optional label background & border (`labelBackgroundColor` / `labelBorderColor`)
  const bgColor = resolveColor(s.fontBackgroundColor);
  const borderColor = resolveColor(s.fontBorderColor);
  if (bgColor || borderColor) {
    const padX = 1.5;
    const padY = 0.5;
    let bgX = x;
    const bgW = Math.max(4, maxWidth + padX * 2);
    if (align === "center") {
      bgX = x - bgW / 2;
    } else if (align === "right") {
      bgX = x - bgW;
    } else {
      bgX = x - padX;
    }
    const bgY = topY - padY + 1;
    const bgH = Math.max(4, totalHeight + padY * 2 - 1);

    const rect = new XmlNode(1, "rect", doc);
    rect.setAttribute("x", String(Number((bgX * scale).toFixed(2))));
    rect.setAttribute("y", String(Number((bgY * scale).toFixed(2))));
    rect.setAttribute("width", String(Number((bgW * scale).toFixed(2))));
    rect.setAttribute("height", String(Number((bgH * scale).toFixed(2))));
    rect.setAttribute("fill", bgColor || "none");
    rect.setAttribute("stroke", borderColor || "none");
    if (borderColor) {
      rect.setAttribute("stroke-width", String(Math.max(1, Number(scale.toFixed(2)))));
    }
    group.appendChild(rect);
  }

  // Render each line
  for (const lm of lineMetrics) {
    const { line, fontSize, lineHeight, yOffset, width: lineWidth } = lm;
    const effectiveAlign = line.align || align || "left";
    const anchor =
      effectiveAlign === "right"
        ? "end"
        : effectiveAlign === "center"
          ? "middle"
          : "start";

    let lineAnchorX = x;
    if (line.align && line.align !== align && effectiveBoxWidth > 0) {
      if (effectiveAlign === "left") {
        lineAnchorX = boxLeftX + 2;
      } else if (effectiveAlign === "center") {
        lineAnchorX = boxLeftX + effectiveBoxWidth / 2;
      } else if (effectiveAlign === "right") {
        lineAnchorX = boxLeftX + effectiveBoxWidth - 2;
      }
    }

    if (line.isHr) {
      const hrY = topY + yOffset + lineHeight / 2;
      const hrW = Math.max(20, effectiveBoxWidth > 0 ? effectiveBoxWidth : maxWidth);
      const hrX1 =
        anchor === "middle"
          ? lineAnchorX - hrW / 2
          : anchor === "end"
            ? lineAnchorX - hrW
            : lineAnchorX;
      const hrLine = new XmlNode(1, "line", doc);
      hrLine.setAttribute("x1", String(Number((hrX1 * scale).toFixed(2))));
      hrLine.setAttribute("y1", String(Number((hrY * scale).toFixed(2))));
      hrLine.setAttribute("x2", String(Number(((hrX1 + hrW) * scale).toFixed(2))));
      hrLine.setAttribute("y2", String(Number((hrY * scale).toFixed(2))));
      hrLine.setAttribute("stroke", resolveColor(s.fontColor) || "#888888");
      hrLine.setAttribute("stroke-width", String(Math.max(1, Number(scale.toFixed(2)))));
      group.appendChild(hrLine);
      continue;
    }

    if (line.spans.length === 0) continue;

    // Baseline Y for this line (~0.82 of fontSize from top of line box)
    const baselineY = topY + yOffset + fontSize * 0.84;

    // Check if any span has an inline background-color
    if (line.spans.some((sp) => sp.backgroundColor)) {
      let runStartX =
        anchor === "middle"
          ? lineAnchorX - lineWidth / 2
          : anchor === "end"
            ? lineAnchorX - lineWidth
            : lineAnchorX;
      for (const sp of line.spans) {
        const spW = estimateTextWidth(sp.text, sp.fontSize, sp.bold);
        const spBg = resolveColor(sp.backgroundColor);
        if (spBg && spW > 0) {
          const hlRect = new XmlNode(1, "rect", doc);
          hlRect.setAttribute("x", String(Number((runStartX * scale).toFixed(2))));
          hlRect.setAttribute("y", String(Number(((topY + yOffset) * scale).toFixed(2))));
          hlRect.setAttribute("width", String(Number((spW * scale).toFixed(2))));
          hlRect.setAttribute("height", String(Number((lineHeight * scale).toFixed(2))));
          hlRect.setAttribute("fill", spBg);
          group.appendChild(hlRect);
        }
        runStartX += spW;
      }
    }

    const lineHasCjk = line.spans.some((sp) => hasCjkCharacters(sp.text));
    const textEl = new XmlNode(1, "text", doc);
    textEl.setAttribute("x", String(Number((lineAnchorX * scale).toFixed(2))));
    textEl.setAttribute("y", String(Number((baselineY * scale).toFixed(2))));
    textEl.setAttribute("text-anchor", anchor);
    textEl.setAttribute("font-family", normalizeFontFamily(s.fontFamily, lineHasCjk));
    textEl.setAttribute("font-size", `${Number((fontSize * scale).toFixed(2))}px`);
    textEl.setAttribute("fill", resolveColor(s.fontColor) || "#000000");

    if (line.spans.length === 1) {
      const sp = line.spans[0];
      applySpanAttributes(textEl, sp, scale, resolveColor);
      textEl.appendChild(doc.createTextNode(sp.text));
    } else {
      for (const sp of line.spans) {
        const tspan = new XmlNode(1, "tspan", doc);
        applySpanAttributes(tspan, sp, scale, resolveColor);
        tspan.appendChild(doc.createTextNode(sp.text));
        textEl.appendChild(tspan);
      }
    }

    group.appendChild(textEl);
  }

  return group;
}

function hasCjkCharacters(text) {
  if (!text) return false;
  for (const ch of text) {
    if (isFullWidthCodePoint(ch.codePointAt(0))) return true;
  }
  return false;
}

function normalizeFontFamily(family, preferCjk = false) {
  const cjkFonts = "Hiragino Kaku Gothic ProN, Hiragino Sans, Yu Gothic, Meiryo";
  if (!family) {
    return preferCjk
      ? `${cjkFonts}, Helvetica, Arial, sans-serif`
      : `Helvetica, Arial, ${cjkFonts}, sans-serif`;
  }
  const clean = String(family).replace(/['"]/g, "").trim();
  if (
    clean.toLowerCase().includes("hiragino") ||
    clean.toLowerCase().includes("gothic") ||
    clean.toLowerCase().includes("meiryo")
  ) {
    return clean;
  }
  return preferCjk
    ? `${cjkFonts}, ${clean}, Helvetica, Arial, sans-serif`
    : `${clean}, Helvetica, Arial, ${cjkFonts}, sans-serif`;
}

function applySpanAttributes(el, sp, scale, resolveColor) {
  const spanHasCjk = hasCjkCharacters(sp.text);
  if (sp.fontFamily || spanHasCjk) {
    el.setAttribute("font-family", normalizeFontFamily(sp.fontFamily, spanHasCjk));
  }
  if (sp.fontSize) {
    el.setAttribute("font-size", `${Number((sp.fontSize * scale).toFixed(2))}px`);
  }
  if (sp.color) {
    el.setAttribute("fill", resolveColor(sp.color) || "#000000");
  }
  if (sp.bold) {
    el.setAttribute("font-weight", "bold");
  }
  if (sp.italic) {
    el.setAttribute("font-style", "italic");
  }
  const decors = [];
  if (sp.underline) decors.push("underline");
  if (sp.strikethrough) decors.push("line-through");
  if (decors.length > 0) {
    el.setAttribute("text-decoration", decors.join(" "));
  }
  if (sp.baselineShift) {
    el.setAttribute("dy", String(Number((sp.baselineShift * scale).toFixed(2))));
  }
}
