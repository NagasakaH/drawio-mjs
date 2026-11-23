/**
 * Single-file ESM (.mjs) bundler for drawio-mjs.
 * Bundles all src/*.mjs modules, bin/drawio2png.mjs CLI, vendor/drawio-oss/* assets,
 * and @resvg/resvg-wasm (with synchronous WebAssembly instantiation + OS font loader)
 * into a single zero-dependency standalone file: `dist/drawio2png.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), "utf8");
}

function readDeflatedBase64(relPath) {
  const raw = fs.readFileSync(path.join(ROOT_DIR, relPath));
  return zlib.deflateRawSync(raw, { level: 9 }).toString("base64");
}

function stripImportsAndExports(code) {
  return code
    .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+\{[\s\S]*?\};?\s*$/gm, "")
    .replace(/^export\s+(async\s+function|function|class|const|let|var)\s+/gm, "$1 ");
}

function buildSingleMjs() {
  console.log("Compressing draw.io OSS assets and resvg-wasm binary...");
  const shapesB64 = readDeflatedBase64("vendor/drawio-oss/drawio-shapes-bundle.js");
  const defaultStyleB64 = readDeflatedBase64("vendor/drawio-oss/default-style.xml");
  const darkStyleB64 = readDeflatedBase64("vendor/drawio-oss/dark-default-style.xml");
  const wasmB64 = readDeflatedBase64("node_modules/@resvg/resvg-wasm/index_bg.wasm");
  const stencilsJsonStr = readText("vendor/drawio-oss/stencils-map.json").trim();

  const pngMetaCode = stripImportsAndExports(readText("src/png-meta.mjs"));
  const xmlCode = stripImportsAndExports(readText("src/xml.mjs"));
  const htmlTextCode = stripImportsAndExports(readText("src/html-text.mjs"));
  const rendererCode = stripImportsAndExports(readText("src/renderer.mjs"));

  // Prepare oss-runtime.mjs without fs.readFileSync from vendor/drawio-oss
  let ossRuntimeCode = stripImportsAndExports(readText("src/oss-runtime.mjs"));
  ossRuntimeCode = ossRuntimeCode
    .replace(
      /const __dirname =[\s\S]*?const VENDOR_DIR =[^;]+;/m,
      ""
    )
    .replace(
      /const shapesBundlePath =[\s\S]*?const darkStyleXml = fs\.readFileSync\(darkStylePath, "utf8"\);/m,
      `const shapesCode = __inflateEmbeddedAsset(EMBEDDED_SHAPES_B64);
  const stencilCompressedMap = EMBEDDED_STENCILS_MAP;
  const defaultStyleXml = __inflateEmbeddedAsset(EMBEDDED_DEFAULT_STYLE_B64);
  const darkStyleXml = __inflateEmbeddedAsset(EMBEDDED_DARK_STYLE_B64);`
    );

  // Prepare resvg-wasm bindings for synchronous initialization
  let resvgWasmJs = readText("node_modules/@resvg/resvg-wasm/index.mjs");
  resvgWasmJs = resvgWasmJs
    .replace(/export\s+\{\s*Resvg2 as Resvg,\s*initWasm\s*\};?/, "")
    .replace(/var Resvg = class \{/, "var WasmResvgRaw = class {")
    .replace(/var Resvg2 = class extends Resvg \{/, "var WasmResvg = class extends WasmResvgRaw {");

  const bundleSource = `#!/usr/bin/env node
/**
 * drawio2png.mjs — Single-File Pure Node.js (.mjs) draw.io XML to PNG/SVG Generator
 * Repository: https://github.com/NagasakaH/drawio-mjs
 *
 * ============================================================================
 * LICENSE & ATTRIBUTION NOTICE (Apache-2.0 / MPL-2.0 / draw.io Stencil Terms)
 * ============================================================================
 * 1. Source Code & Embedded draw.io Core Engine (mxGraph / draw.io v29.6.6):
 *    Copyright (c) 2006-2025, JGraph Holdings Ltd (draw.io Ltd)
 *    Copyright (c) 2006-2025, draw.io AG
 *    Copyright (c) 2026, NagasakaH
 *    Licensed under the Apache License, Version 2.0:
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * 2. Embedded Icon Sets & Stencil Libraries Restriction (from draw.io stencils/LICENSE):
 *    The icon sets and stencil libraries included in this software, and any
 *    derivatives thereof (including conversions to other formats, traced
 *    reproductions, substantially similar visual representations, or AI-generated
 *    images created using these icons as reference or training input), may not be
 *    used as software assets in, distributed for use with, or incorporated into
 *    Atlassian products or products distributed through the Atlassian marketplace
 *    or plugin ecosystem, without explicit written permission.
 *    This restriction does not apply to end-user diagram output (such as exported
 *    images or documents) created using this software.
 *
 * 3. Embedded WebAssembly SVG Rasterizer (@resvg/resvg-wasm v2.6.2):
 *    Licensed under the Mozilla Public License 2.0 (MPL-2.0).
 *
 * 4. Trademark Disclaimer:
 *    "draw.io" is a registered EU trademark (#018062448) of draw.io AG.
 *    This project is an independent, unofficial open-source tool and is NOT
 *    affiliated with, endorsed by, or sponsored by draw.io Ltd or draw.io AG.
 * ============================================================================
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================================================
// 1. Embedded Compressed Assets (draw.io OSS shapes, styles, stencils, resvg-wasm)
// ============================================================================
const EMBEDDED_SHAPES_B64 = "${shapesB64}";
const EMBEDDED_DEFAULT_STYLE_B64 = "${defaultStyleB64}";
const EMBEDDED_DARK_STYLE_B64 = "${darkStyleB64}";
const EMBEDDED_RESVG_WASM_B64 = "${wasmB64}";
const EMBEDDED_STENCILS_MAP = ${stencilsJsonStr};

function __inflateEmbeddedAsset(b64) {
  return zlib.inflateRawSync(Buffer.from(b64, "base64")).toString("utf8");
}

// ============================================================================
// 2. Embedded @resvg/resvg-wasm + Native @resvg/resvg-js Hybrid Loader
// ============================================================================
${resvgWasmJs}

let __resvgBackend = null;
let __cachedSystemFontBuffers = null;

function __discoverSystemFontBuffers(extraFontFiles = []) {
  if (__cachedSystemFontBuffers && extraFontFiles.length === 0) {
    return __cachedSystemFontBuffers;
  }
  const candidates = [
    ...extraFontFiles,
    // macOS core Latin & Japanese fonts
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    // Linux common Latin & CJK fonts
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    // Windows common Latin & Japanese fonts
    "C:\\\\Windows\\\\Fonts\\\\arial.ttf",
    "C:\\\\Windows\\\\Fonts\\\\arialbd.ttf",
    "C:\\\\Windows\\\\Fonts\\\\msgothic.ttc",
    "C:\\\\Windows\\\\Fonts\\\\YuGothR.ttc",
    "C:\\\\Windows\\\\Fonts\\\\YuGothB.ttc",
    "C:\\\\Windows\\\\Fonts\\\\meiryo.ttc",
    "C:\\\\Windows\\\\Fonts\\\\meiryob.ttc",
  ];

  const buffers = [];
  const seen = new Set();
  for (const fp of candidates) {
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    try {
      if (fs.existsSync(fp)) {
        buffers.push(new Uint8Array(fs.readFileSync(fp)));
      }
    } catch {
      // ignore unreadable font file
    }
  }
  if (extraFontFiles.length === 0) {
    __cachedSystemFontBuffers = buffers;
  }
  return buffers;
}

function __getResvgRenderer() {
  if (__resvgBackend) return __resvgBackend;

  // 1. Try native @resvg/resvg-js if installed in local node_modules
  try {
    const req = createRequire(import.meta.url);
    const nativeMod = req("@resvg/resvg-js");
    if (nativeMod && nativeMod.Resvg) {
      __resvgBackend = {
        type: "native",
        renderSvgToPng(svg, { loadSystemFonts = true, fontFiles = [] } = {}) {
          const r = new nativeMod.Resvg(svg, {
            fitTo: { mode: "original" },
            font: {
              loadSystemFonts,
              fontFiles,
              defaultFontFamily: "Helvetica",
              sansSerifFamily: "Helvetica",
            },
          });
          const rendered = r.render();
          return {
            png: Buffer.from(rendered.asPng()),
            width: rendered.width,
            height: rendered.height,
          };
        },
      };
      return __resvgBackend;
    }
  } catch {
    // Native @resvg/resvg-js not installed; use embedded @resvg/resvg-wasm
  }

  // 2. Initialize embedded @resvg/resvg-wasm synchronously via WebAssembly.Instance
  if (!initialized) {
    const wasmBytes = zlib.inflateRawSync(Buffer.from(EMBEDDED_RESVG_WASM_B64, "base64"));
    const imports = __wbg_get_imports();
    __wbg_init_memory(imports);
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const wasmInstance = new WebAssembly.Instance(wasmModule, imports);
    __wbg_finalize_init(wasmInstance, wasmModule);
    initialized = true;
  }

  __resvgBackend = {
    type: "wasm",
    renderSvgToPng(svg, { loadSystemFonts = true, fontFiles = [] } = {}) {
      const fontBuffers = loadSystemFonts
        ? __discoverSystemFontBuffers(fontFiles)
        : fontFiles.map((f) => new Uint8Array(fs.readFileSync(f)));
      const r = new WasmResvg(svg, {
        fitTo: { mode: "original" },
        font: {
          fontBuffers,
          defaultFontFamily: "Helvetica",
          sansSerifFamily: "Helvetica",
        },
      });
      const rendered = r.render();
      const out = {
        png: Buffer.from(rendered.asPng()),
        width: rendered.width,
        height: rendered.height,
      };
      rendered.free();
      r.free();
      return out;
    },
  };
  return __resvgBackend;
}

// ============================================================================
// 3. PNG Metadata Chunk Writer/Reader (src/png-meta.mjs)
// ============================================================================
${pngMetaCode}

// ============================================================================
// 4. XML DOM Parser & draw.io Decompressor (src/xml.mjs)
// ============================================================================
${xmlCode}

// ============================================================================
// 5. HTML & Rich-Text to SVG <text>/<tspan> Layout Engine (src/html-text.mjs)
// ============================================================================
${htmlTextCode}

// ============================================================================
// 6. draw.io OSS Shape & Stencil Runtime (src/oss-runtime.mjs)
// ============================================================================
${ossRuntimeCode}

// ============================================================================
// 7. draw.io mxGraphModel -> SVG Renderer (src/renderer.mjs)
// ============================================================================
${rendererCode}

// ============================================================================
// 8. Public ESM API (src/index.mjs)
// ============================================================================
function selectPage(pages, { pageIndex, page, pageId, pageName } = {}) {
  if (pageId != null) {
    const found = pages.find((p) => p.id === pageId);
    if (found) return found;
  }
  if (pageName != null) {
    const found = pages.find(
      (p) => p.name === pageName || p.name.toLowerCase() === String(pageName).toLowerCase()
    );
    if (found) return found;
  }
  if (pageIndex != null && Number.isFinite(Number(pageIndex))) {
    const idx = Math.max(0, Math.min(pages.length - 1, Number(pageIndex)));
    return pages[idx];
  }
  if (page != null) {
    const num = Number(page);
    if (Number.isFinite(num) && num >= 1) {
      const idx = Math.max(0, Math.min(pages.length - 1, num - 1));
      return pages[idx];
    }
    const found = pages.find(
      (p) => p.id === String(page) || p.name.toLowerCase() === String(page).toLowerCase()
    );
    if (found) return found;
  }
  return pages[0];
}

export function convertXmlToSvg(input, options = {}) {
  const { xml, pages } = extractDrawioPages(input);
  const selected = selectPage(pages, options);

  const res = renderGraphModelToSvg(selected.modelNode, {
    ...options,
    fullXml: xml,
    pageId: selected.id,
    pageName: selected.name,
    pageIndex: selected.index,
    pageCount: pages.length,
  });

  return {
    ...res,
    xml,
  };
}

export function convertXmlToPng(input, options = {}) {
  const {
    scale = 2,
    border = 10,
    background = "#ffffff",
    transparent = false,
    theme = "light",
    embedXml = true,
    dpi = null,
    fontFiles = [],
    loadSystemFonts = true,
  } = options;

  const svgResult = convertXmlToSvg(input, {
    ...options,
    scale,
    border,
    background,
    transparent,
    theme,
    embedXml,
  });

  const renderer = __getResvgRenderer();
  const rendered = renderer.renderSvgToPng(svgResult.svg, {
    loadSystemFonts,
    fontFiles,
  });

  let pngBuffer = rendered.png;

  if (embedXml || (dpi != null && Number(dpi) > 0)) {
    pngBuffer = embedDrawioXmlInPng(
      pngBuffer,
      embedXml ? svgResult.xml : null,
      {
        dpi,
        compressed: true,
      }
    );
  }

  return {
    png: pngBuffer,
    svg: svgResult.svg,
    width: rendered.width,
    height: rendered.height,
    bounds: svgResult.bounds,
    pageId: svgResult.pageId,
    pageName: svgResult.pageName,
    pageIndex: svgResult.pageIndex,
    pageCount: svgResult.pageCount,
    xml: svgResult.xml,
  };
}

export function convertAllPagesToPng(input, options = {}) {
  const { pages } = extractDrawioPages(input);
  return pages.map((p) =>
    convertXmlToPng(input, {
      ...options,
      pageIndex: p.index,
    })
  );
}

export async function convertDrawioFile(inputPath, outputPath, options = {}) {
  const inputBuf = await fsp.readFile(inputPath);
  const ext = outputPath ? path.extname(outputPath).toLowerCase() : ".png";
  const format = (options.format || (ext === ".svg" ? "svg" : "png")).toLowerCase();

  if (options.allPages) {
    const { pages } = extractDrawioPages(inputBuf);
    const outResults = [];
    const baseOut =
      outputPath ||
      path.join(
        path.dirname(inputPath),
        path.basename(inputPath, path.extname(inputPath))
      );
    const baseExt = \`.\${format}\`;
    const stem = baseOut.endsWith(baseExt)
      ? baseOut.slice(0, -baseExt.length)
      : baseOut;

    for (const p of pages) {
      const pageOutPath =
        pages.length === 1
          ? \`\${stem}\${baseExt}\`
          : \`\${stem}-\${p.index + 1}-\${p.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}\${baseExt}\`;
      const res =
        format === "svg"
          ? convertXmlToSvg(inputBuf, { ...options, pageIndex: p.index })
          : convertXmlToPng(inputBuf, { ...options, pageIndex: p.index });
      await fsp.mkdir(path.dirname(path.resolve(pageOutPath)), { recursive: true });
      await fsp.writeFile(pageOutPath, format === "svg" ? res.svg : res.png);
      outResults.push({ ...res, outputPath: pageOutPath });
    }
    return outResults;
  }

  const finalOutputPath =
    outputPath ||
    path.join(
      path.dirname(inputPath),
      \`\${path.basename(inputPath, path.extname(inputPath))}.\${format}\`
    );

  await fsp.mkdir(path.dirname(path.resolve(finalOutputPath)), { recursive: true });

  if (format === "svg") {
    const res = convertXmlToSvg(inputBuf, options);
    await fsp.writeFile(finalOutputPath, res.svg, "utf8");
    return { ...res, outputPath: finalOutputPath };
  } else {
    const res = convertXmlToPng(inputBuf, options);
    await fsp.writeFile(finalOutputPath, res.png);
    return { ...res, outputPath: finalOutputPath };
  }
}

export {
  extractDrawioPages,
  parseXml,
  serializeXml,
  decompressDiagramContent,
  embedDrawioXmlInPng,
  extractDrawioXmlFromPng,
  writePngWithText,
  isPngBuffer,
  renderGraphModelToSvg,
};

// ============================================================================
// 9. CLI Runner (when executed directly via \`node drawio2png.mjs ...\`)
// ============================================================================
const HELP_TEXT = \`
drawio2png.mjs - Standalone Single-File Pure Node.js (.mjs) draw.io XML to PNG/SVG Generator

Usage:
  node drawio2png.mjs <input.drawio|input.xml|input.drawio.png|-> [options]

Options:
  -o, --output <path>       Output file path (default: <input>.png or <input>.svg)
  -f, --format <fmt>        Output format: png | svg (default: inferred from -o or png)
  -s, --scale <number>      Scale factor (default: 2 for PNG, 1 for SVG)
  -b, --border <px>         Border padding in pixels (default: 10)
  -t, --transparent         Transparent background (default: false, uses #ffffff)
      --bg <color>          Background color (e.g. "#ffffff", "#18141d", "none")
      --theme <theme>       Color theme: light | dark (default: light)
  -p, --page <index|name>   Page number (1-based), page ID, or page name (default: 1)
  -a, --all-pages           Export all pages in multi-page .drawio files
  -e, --embed-xml           Embed draw.io XML into PNG zTXt chunk (default: true)
      --no-embed-xml        Do not embed draw.io XML into output PNG
      --dpi <number>        Embed DPI metadata (pHYs chunk) into PNG
      --list-pages          List all diagram pages in the input file and exit
      --extract-xml         Extract embedded draw.io XML from a .drawio.png file
  -h, --help                Show this help message
\`.trim();

async function __readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function __runCli() {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      scale: { type: "string", short: "s" },
      border: { type: "string", short: "b" },
      transparent: { type: "boolean", short: "t", default: false },
      bg: { type: "string" },
      theme: { type: "string", default: "light" },
      page: { type: "string", short: "p" },
      "all-pages": { type: "boolean", short: "a", default: false },
      "embed-xml": { type: "boolean", short: "e", default: true },
      "no-embed-xml": { type: "boolean", default: false },
      dpi: { type: "string" },
      "list-pages": { type: "boolean", default: false },
      "extract-xml": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || (positionals.length === 0 && process.stdin.isTTY)) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const inputArg = positionals[0] || "-";
  const isStdin = inputArg === "-";
  const inputBuf = isStdin ? await __readStdin() : await fsp.readFile(inputArg);

  if (values["extract-xml"]) {
    const xml = extractDrawioXmlFromPng(inputBuf);
    if (!xml) {
      console.error("Error: No embedded draw.io XML found in PNG.");
      process.exit(1);
    }
    if (values.output) {
      await fsp.writeFile(values.output, xml, "utf8");
      console.log(\`Extracted XML -> \${values.output}\`);
    } else {
      process.stdout.write(xml + "\\n");
    }
    return;
  }

  if (values["list-pages"]) {
    const { pages } = extractDrawioPages(inputBuf);
    for (const p of pages) {
      console.log(\`\${p.index + 1}: \${p.name} (id=\${p.id})\`);
    }
    return;
  }

  const outExt = values.output ? path.extname(values.output).toLowerCase() : "";
  const format = (
    values.format || (outExt === ".svg" ? "svg" : "png")
  ).toLowerCase();

  const scale =
    values.scale != null
      ? parseFloat(values.scale)
      : format === "svg"
        ? 1
        : 2;
  const border = values.border != null ? parseInt(values.border, 10) : 10;
  const transparent = values.transparent || values.bg === "none";
  const background = transparent
    ? null
    : values.bg || (values.theme === "dark" ? "#18141d" : "#ffffff");
  const embedXml = values["no-embed-xml"] ? false : values["embed-xml"];
  const dpi = values.dpi != null ? parseInt(values.dpi, 10) : null;

  const opts = {
    format,
    scale,
    border,
    transparent,
    background,
    theme: values.theme,
    page: values.page,
    allPages: values["all-pages"],
    embedXml,
    dpi,
  };

  if (isStdin) {
    const res =
      format === "svg"
        ? convertXmlToSvg(inputBuf, opts)
        : convertXmlToPng(inputBuf, opts);
    if (values.output) {
      await fsp.writeFile(values.output, format === "svg" ? res.svg : res.png);
      console.error(
        \`Converted stdin -> \${values.output} (\${res.width}x\${res.height}px, page="\${res.pageName}")\`
      );
    } else {
      process.stdout.write(format === "svg" ? res.svg : res.png);
    }
    return;
  }

  const result = await convertDrawioFile(inputArg, values.output, opts);
  if (Array.isArray(result)) {
    for (const r of result) {
      console.log(
        \`\${inputArg} [\${r.pageName}] -> \${r.outputPath} (\${r.width}x\${r.height}px)\`
      );
    }
  } else {
    console.log(
      \`\${inputArg} [\${result.pageName}] -> \${result.outputPath} (\${result.width}x\${result.height}px)\`
    );
  }
}

const __isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;

if (__isDirectRun) {
  __runCli().catch((err) => {
    console.error("Error:", err.message || err);
    process.exit(1);
  });
}
`;

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const outPath = path.join(DIST_DIR, "drawio2png.mjs");
  fs.writeFileSync(outPath, bundleSource, "utf8");
  fs.chmodSync(outPath, 0o755);

  const sizeBytes = fs.statSync(outPath).size;
  console.log(
    `Built single-file bundle: ${outPath} (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)`
  );
}

buildSingleMjs();
