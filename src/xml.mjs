/**
 * Pure Node.js (.mjs) XML DOM parser & draw.io (.drawio / .xml / .drawio.png) extractor.
 * Modeled after draw.io OSS (Graph.decompress, Editor.parseDiagramNode, Editor.extractGraphModel).
 */
import zlib from "node:zlib";
import { extractDrawioXmlFromPng, isPngBuffer } from "./png-meta.mjs";

const HTML_ENTITIES = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  mdash: "\u2014",
  ndash: "\u2013",
  bull: "\u2022",
  hellip: "\u2026",
  rarr: "\u2192",
  larr: "\u2190",
  uarr: "\u2191",
  darr: "\u2193",
  harr: "\u2194",
  times: "\u00d7",
  divide: "\u00f7",
  plusmn: "\u00b1",
  le: "\u2264",
  ge: "\u2265",
  ne: "\u2260",
  asymp: "\u2248",
};

export function decodeXmlEntities(str) {
  if (!str || typeof str !== "string" || !str.includes("&")) return str || "";
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (match, code) => {
    if (code[0] === "#") {
      const cp =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, code)
      ? HTML_ENTITIES[code]
      : match;
  });
}

export function escapeXml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Lightweight W3C-compatible XML DOM node implementation for mxGraph / mxStencil / mxGraphModel.
 */
export class XmlNode {
  constructor(nodeType, nodeName, ownerDocument = null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = nodeType === 1 ? nodeName : undefined;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.firstChild = null;
    this.lastChild = null;
    this.previousSibling = null;
    this.nextSibling = null;
    this.attrs = Object.create(null);
    this.nodeValue = null;
    this.data = null;
    this.style = Object.create(null);
  }

  get attributes() {
    return Object.entries(this.attrs).map(([name, value]) => ({
      name,
      nodeName: name,
      value,
      nodeValue: value,
    }));
  }

  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 4) {
      return this.nodeValue || "";
    }
    let out = "";
    for (const child of this.childNodes) {
      out += child.textContent;
    }
    return out;
  }

  set textContent(val) {
    this.childNodes = [];
    this.firstChild = null;
    this.lastChild = null;
    if (val != null && val !== "") {
      const txt = new XmlNode(3, "#text", this.ownerDocument);
      txt.nodeValue = String(val);
      txt.data = txt.nodeValue;
      this.appendChild(txt);
    }
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.previousSibling = this.lastChild;
    child.nextSibling = null;
    if (this.lastChild) {
      this.lastChild.nextSibling = child;
    } else {
      this.firstChild = child;
    }
    this.lastChild = child;
    this.childNodes.push(child);
    if (this.nodeType === 9 && child.nodeType === 1 && !this.documentElement) {
      this.documentElement = child;
    }
    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx === -1) return child;
    this.childNodes.splice(idx, 1);
    if (child.previousSibling) {
      child.previousSibling.nextSibling = child.nextSibling;
    } else {
      this.firstChild = child.nextSibling;
    }
    if (child.nextSibling) {
      child.nextSibling.previousSibling = child.previousSibling;
    } else {
      this.lastChild = child.previousSibling;
    }
    child.parentNode = null;
    child.previousSibling = null;
    child.nextSibling = null;
    return child;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name)
      ? this.attrs[name]
      : null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  setAttributeNS(_ns, name, value) {
    this.attrs[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  cloneNode(deep = false) {
    const copy = new XmlNode(this.nodeType, this.nodeName, this.ownerDocument);
    copy.nodeValue = this.nodeValue;
    copy.data = this.data;
    for (const [k, v] of Object.entries(this.attrs)) {
      copy.attrs[k] = v;
    }
    for (const [k, v] of Object.entries(this.style)) {
      copy.style[k] = v;
    }
    if (deep) {
      for (const c of this.childNodes) {
        copy.appendChild(c.cloneNode(true));
      }
    }
    return copy;
  }

  getElementsByTagName(tagName) {
    const results = [];
    const target = tagName === "*" ? "*" : tagName.toLowerCase();
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (target === "*" || child.nodeName.toLowerCase() === target) {
            results.push(child);
          }
          visit(child);
        }
      }
    };
    visit(this);
    return results;
  }

  createElement(tagName) {
    return new XmlNode(1, tagName, this.nodeType === 9 ? this : this.ownerDocument);
  }

  createElementNS(_ns, tagName) {
    return new XmlNode(1, tagName, this.nodeType === 9 ? this : this.ownerDocument);
  }

  createTextNode(text) {
    const n = new XmlNode(3, "#text", this.nodeType === 9 ? this : this.ownerDocument);
    n.nodeValue = String(text ?? "");
    n.data = n.nodeValue;
    return n;
  }
}

/**
 * Parses an XML string into an XmlNode document.
 */
export function parseXml(xmlString) {
  const doc = new XmlNode(9, "#document", null);
  doc.ownerDocument = doc;
  doc.documentElement = null;

  if (!xmlString || typeof xmlString !== "string") {
    return doc;
  }

  // Strip UTF-8 BOM if present
  const clean = xmlString.charCodeAt(0) === 0xfeff ? xmlString.slice(1) : xmlString;

  const stack = [doc];
  const tagRe =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/([A-Za-z0-9_.:-]+)\s*>|<([A-Za-z0-9_.:-]+)((?:\s+[A-Za-z0-9_.:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/g;
  const attrRe =
    /([A-Za-z0-9_.:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  let m;
  while ((m = tagRe.exec(clean)) !== null) {
    if (m[1] !== undefined) {
      // CDATA
      const cdata = new XmlNode(4, "#cdata-section", doc);
      cdata.nodeValue = m[1];
      cdata.data = m[1];
      stack[stack.length - 1].appendChild(cdata);
    } else if (m[2] !== undefined) {
      // Closing tag
      const closeName = m[2];
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].nodeName === closeName) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      // Opening tag
      const el = new XmlNode(1, m[3], doc);
      const attrStr = m[4] || "";
      attrRe.lastIndex = 0;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) {
        const rawVal = am[2] ?? am[3] ?? am[4] ?? "";
        el.attrs[am[1]] = decodeXmlEntities(rawVal);
      }
      stack[stack.length - 1].appendChild(el);
      if (!m[5]) {
        stack.push(el);
      }
    } else if (m[6] !== undefined) {
      // Text node
      const rawText = m[6];
      if (rawText.trim().length > 0) {
        const txt = new XmlNode(3, "#text", doc);
        txt.nodeValue = decodeXmlEntities(rawText);
        txt.data = txt.nodeValue;
        stack[stack.length - 1].appendChild(txt);
      }
    }
  }

  return doc;
}

/**
 * Serializes an XmlNode back to an XML string.
 */
export function serializeXml(node) {
  if (!node) return "";
  if (node.nodeType === 9) {
    return node.documentElement ? serializeXml(node.documentElement) : "";
  }
  if (node.nodeType === 3) {
    return escapeXml(node.nodeValue || "");
  }
  if (node.nodeType === 4) {
    return `<![CDATA[${node.nodeValue || ""}]]>`;
  }
  if (node.nodeType === 1) {
    const attrs = { ...node.attrs };
    // Merge inline node.style properties if set
    const styleEntries = Object.entries(node.style || {}).filter(
      ([, v]) => v != null && v !== ""
    );
    if (styleEntries.length > 0 && !attrs.style) {
      const css = styleEntries
        .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${v}`)
        .join("; ");
      if (css) attrs.style = css;
    }

    let attrStr = "";
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) {
        attrStr += ` ${k}="${escapeXml(v)}"`;
      }
    }

    if (node.childNodes.length === 0) {
      return `<${node.nodeName}${attrStr}/>`;
    }
    let childrenStr = "";
    for (const child of node.childNodes) {
      childrenStr += serializeXml(child);
    }
    return `<${node.nodeName}${attrStr}>${childrenStr}</${node.nodeName}>`;
  }
  return "";
}

/**
 * Decompresses draw.io's compressed <diagram> content (Base64 + raw Deflate + encodeURIComponent).
 * Mirrors draw.io OSS `Graph.decompress` and `Editor.parseDiagramNode`.
 */
export function decompressDiagramContent(data) {
  if (!data || typeof data !== "string") return "";
  const trimmed = data.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<")) {
    return trimmed;
  }

  // 1. Base64 decode -> raw inflate -> URI decode (standard draw.io compression)
  try {
    const buf = Buffer.from(trimmed, "base64");
    const inflated = zlib.inflateRawSync(buf).toString("utf8");
    try {
      return decodeURIComponent(inflated);
    } catch {
      return inflated;
    }
  } catch {
    // 2. Fallback: maybe zlib header present or plain URI encoded / base64
    try {
      const buf = Buffer.from(trimmed, "base64");
      const inflated = zlib.inflateSync(buf).toString("utf8");
      try {
        return decodeURIComponent(inflated);
      } catch {
        return inflated;
      }
    } catch {
      try {
        return decodeURIComponent(trimmed);
      } catch {
        return trimmed;
      }
    }
  }
}

/**
 * Parses a <diagram> node from an <mxfile> and returns its <mxGraphModel> element.
 * Mirrors draw.io OSS `Editor.parseDiagramNode`.
 */
export function parseDiagramNode(diagramNode) {
  if (!diagramNode) return null;

  // Check if <diagram> already contains an uncompressed child <mxGraphModel>
  for (const child of diagramNode.childNodes) {
    if (child.nodeType === 1 && child.nodeName === "mxGraphModel") {
      return child;
    }
  }

  const text = diagramNode.textContent.trim();
  if (!text) return null;

  const xmlStr = decompressDiagramContent(text);
  if (!xmlStr) return null;

  const doc = parseXml(xmlStr);
  if (doc.documentElement) {
    if (doc.documentElement.nodeName === "mxGraphModel") {
      return doc.documentElement;
    }
    const models = doc.documentElement.getElementsByTagName("mxGraphModel");
    if (models.length > 0) return models[0];
  }
  return null;
}

/**
 * Extracts draw.io XML and all diagram pages from an XML string, Buffer, or PNG+XML Buffer.
 */
export function extractDrawioPages(input) {
  let xmlString = "";

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (isPngBuffer(buf)) {
      const extracted = extractDrawioXmlFromPng(buf);
      if (!extracted) {
        throw new Error("No embedded draw.io XML (mxGraphModel) found in PNG buffer");
      }
      xmlString = extracted;
    } else {
      xmlString = buf.toString("utf8");
    }
  } else if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("iVBOR")) {
      const buf = Buffer.from(trimmed, "base64");
      const extracted = extractDrawioXmlFromPng(buf);
      if (!extracted) {
        throw new Error("No embedded draw.io XML (mxGraphModel) found in base64 PNG");
      }
      xmlString = extracted;
    } else {
      xmlString = trimmed;
    }
  } else {
    throw new Error("Invalid input: expected XML string or Buffer");
  }

  // Handle IE11 <#document> wrapper just like export.js
  if (xmlString.startsWith("<#document>")) {
    xmlString = xmlString.slice(11, xmlString.length - 12);
  }

  const doc = parseXml(xmlString);
  const root = doc.documentElement;
  if (!root) {
    throw new Error("Invalid draw.io XML: empty document");
  }

  const pages = [];

  if (root.nodeName === "mxfile") {
    const diagrams = root.childNodes.filter(
      (n) => n.nodeType === 1 && n.nodeName === "diagram"
    );
    for (let i = 0; i < diagrams.length; i++) {
      const d = diagrams[i];
      const modelNode = parseDiagramNode(d);
      if (modelNode) {
        pages.push({
          index: i,
          id: d.getAttribute("id") || `page-${i + 1}`,
          name: d.getAttribute("name") || `Page-${i + 1}`,
          modelNode,
          modelXml: serializeXml(modelNode),
        });
      }
    }
  } else if (root.nodeName === "mxGraphModel") {
    pages.push({
      index: 0,
      id: "page-1",
      name: "Page-1",
      modelNode: root,
      modelXml: serializeXml(root),
    });
  } else if (root.nodeName === "diagram") {
    const modelNode = parseDiagramNode(root);
    if (modelNode) {
      pages.push({
        index: 0,
        id: root.getAttribute("id") || "page-1",
        name: root.getAttribute("name") || "Page-1",
        modelNode,
        modelXml: serializeXml(modelNode),
      });
    }
  } else {
    // Check if an <mxfile> or <mxGraphModel> exists inside (e.g. SVG with content attribute)
    const contentAttr = root.getAttribute("content");
    if (contentAttr) {
      return extractDrawioPages(contentAttr);
    }
    const models = root.getElementsByTagName("mxGraphModel");
    if (models.length > 0) {
      pages.push({
        index: 0,
        id: "page-1",
        name: "Page-1",
        modelNode: models[0],
        modelXml: serializeXml(models[0]),
      });
    } else {
      const rawDecompressed = decompressDiagramContent(xmlString);
      if (rawDecompressed !== xmlString && rawDecompressed.startsWith("<")) {
        return extractDrawioPages(rawDecompressed);
      }
      throw new Error(`Unsupported XML root element: <${root.nodeName}>`);
    }
  }

  if (pages.length === 0) {
    throw new Error("No valid <mxGraphModel> diagram pages found in XML");
  }

  return {
    xml: xmlString,
    rootNode: root,
    pages,
  };
}
