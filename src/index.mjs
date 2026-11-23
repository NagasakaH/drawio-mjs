/**
 * Pure Node.js (.mjs) draw.io XML -> PNG / SVG Generator.
 * Public ESM API entry point.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import {
  extractDrawioPages,
  parseXml,
  serializeXml,
  decompressDiagramContent,
} from "./xml.mjs";
import {
  embedDrawioXmlInPng,
  extractDrawioXmlFromPng,
  writePngWithText,
  isPngBuffer,
} from "./png-meta.mjs";
import { renderGraphModelToSvg } from "./renderer.mjs";

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

/**
 * Selects a target page from `pages` by 0-based `pageIndex`, 1-based `page`, `pageId`, or `pageName`.
 */
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

/**
 * Converts draw.io XML (or Buffer / .drawio.png Buffer) into an SVG string and metadata.
 */
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

/**
 * Converts draw.io XML (or Buffer / .drawio.png Buffer) into a PNG Buffer (and SVG).
 * Automatically embeds the original draw.io XML into the PNG `zTXt` ("mxGraphModel") chunk
 * when `embedXml` is true (default: true), making the PNG directly editable in draw.io!
 */
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

  const resvg = new Resvg(svgResult.svg, {
    fitTo: {
      mode: "original",
    },
    font: {
      loadSystemFonts,
      fontFiles,
      defaultFontFamily: "Helvetica",
      sansSerifFamily: "Helvetica",
    },
  });

  const rendered = resvg.render();
  let pngBuffer = rendered.asPng();

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

/**
 * Converts all pages of a multi-page `.drawio` XML document into an array of PNG results.
 */
export function convertAllPagesToPng(input, options = {}) {
  const { pages } = extractDrawioPages(input);
  return pages.map((p) =>
    convertXmlToPng(input, {
      ...options,
      pageIndex: p.index,
    })
  );
}

/**
 * High-level file converter: reads a `.drawio` / `.xml` / `.drawio.png` file
 * and writes `.png` or `.svg` output file(s).
 */
export async function convertDrawioFile(inputPath, outputPath, options = {}) {
  const inputBuf = await fs.readFile(inputPath);
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
    const baseExt = `.${format}`;
    const stem = baseOut.endsWith(baseExt)
      ? baseOut.slice(0, -baseExt.length)
      : baseOut;

    for (const p of pages) {
      const pageOutPath =
        pages.length === 1
          ? `${stem}${baseExt}`
          : `${stem}-${p.index + 1}-${p.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}${baseExt}`;
      const res =
        format === "svg"
          ? convertXmlToSvg(inputBuf, { ...options, pageIndex: p.index })
          : convertXmlToPng(inputBuf, { ...options, pageIndex: p.index });
      await fs.mkdir(path.dirname(path.resolve(pageOutPath)), { recursive: true });
      await fs.writeFile(pageOutPath, format === "svg" ? res.svg : res.png);
      outResults.push({ ...res, outputPath: pageOutPath });
    }
    return outResults;
  }

  const finalOutputPath =
    outputPath ||
    path.join(
      path.dirname(inputPath),
      `${path.basename(inputPath, path.extname(inputPath))}.${format}`
    );

  await fs.mkdir(path.dirname(path.resolve(finalOutputPath)), { recursive: true });

  if (format === "svg") {
    const res = convertXmlToSvg(inputBuf, options);
    await fs.writeFile(finalOutputPath, res.svg, "utf8");
    return { ...res, outputPath: finalOutputPath };
  } else {
    const res = convertXmlToPng(inputBuf, options);
    await fs.writeFile(finalOutputPath, res.png);
    return { ...res, outputPath: finalOutputPath };
  }
}
