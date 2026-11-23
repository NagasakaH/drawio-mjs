#!/usr/bin/env node
/**
 * CLI for Pure Node.js (.mjs) draw.io XML -> PNG / SVG converter.
 * Usage:
 *   node bin/drawio2png.mjs <input.drawio> [-o output.png] [options]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  convertDrawioFile,
  convertXmlToPng,
  convertXmlToSvg,
  extractDrawioPages,
  extractDrawioXmlFromPng,
} from "../src/index.mjs";

const HELP_TEXT = `
drawio2png - Pure Node.js (.mjs) draw.io XML to PNG/SVG Generator

Usage:
  node bin/drawio2png.mjs <input.drawio|input.xml|input.drawio.png|-> [options]

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
`.trim();

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
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
  const inputBuf = isStdin ? await readStdin() : await fs.readFile(inputArg);

  if (values["extract-xml"]) {
    const xml = extractDrawioXmlFromPng(inputBuf);
    if (!xml) {
      console.error("Error: No embedded draw.io XML found in PNG.");
      process.exit(1);
    }
    if (values.output) {
      await fs.writeFile(values.output, xml, "utf8");
      console.log(`Extracted XML -> ${values.output}`);
    } else {
      process.stdout.write(xml + "\n");
    }
    return;
  }

  if (values["list-pages"]) {
    const { pages } = extractDrawioPages(inputBuf);
    for (const p of pages) {
      console.log(`${p.index + 1}: ${p.name} (id=${p.id})`);
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
      await fs.writeFile(values.output, format === "svg" ? res.svg : res.png);
      console.error(
        `Converted stdin -> ${values.output} (${res.width}x${res.height}px, page="${res.pageName}")`
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
        `${inputArg} [${r.pageName}] -> ${r.outputPath} (${r.width}x${r.height}px)`
      );
    }
  } else {
    console.log(
      `${inputArg} [${result.pageName}] -> ${result.outputPath} (${result.width}x${result.height}px)`
    );
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
