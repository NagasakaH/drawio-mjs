/**
 * Pure Node.js (.mjs) draw.io mxGraphModel -> SVG Renderer.
 * Implements draw.io OSS's graph state validation, coordinate resolution,
 * edge routing, perimeter intersection, swimlane/table layout, and SVG export
 * (modeled on mxGraph, mxGraphView, mxCellRenderer, mxImageExport, and Graph.prototype.getSvg).
 */
import { getDrawioOssRuntime } from "./oss-runtime.mjs";
import { parseXml, serializeXml, XmlNode } from "./xml.mjs";
import {
  parseRichTextLines,
  wrapRichTextLines,
  computeLinesMetrics,
} from "./html-text.mjs";

/**
 * Decodes an `<mxGraphModel>` XmlNode into an `mxGraphModel` with `mxCell` and `mxGeometry` instances.
 */
function decodeGraphModel(modelNode, runtime, pageInfo) {
  const { ctx } = runtime;
  const { mxGraphModel, mxCell, mxGeometry, mxPoint, mxRectangle } = ctx;

  const model = new mxGraphModel();
  const rootEl = modelNode.getElementsByTagName("root")[0] || modelNode;

  const cellsById = new Map();
  const rawRecords = [];

  for (const child of rootEl.childNodes) {
    if (child.nodeType !== 1) continue;

    let cellEl = child;
    let wrapperEl = null;

    if (
      child.nodeName === "UserObject" ||
      child.nodeName === "object" ||
      child.nodeName === "Object"
    ) {
      wrapperEl = child;
      const innerCells = child.getElementsByTagName("mxCell");
      if (innerCells.length === 0) continue;
      cellEl = innerCells[0];
    } else if (child.nodeName !== "mxCell") {
      continue;
    }

    const id =
      (wrapperEl && wrapperEl.getAttribute("id")) ||
      cellEl.getAttribute("id") ||
      `auto_${rawRecords.length}`;
    const parentId = cellEl.getAttribute("parent");
    const sourceId = cellEl.getAttribute("source");
    const targetId = cellEl.getAttribute("target");
    const styleStr = cellEl.getAttribute("style") || "";
    const vertex = cellEl.getAttribute("vertex") === "1";
    const edge = cellEl.getAttribute("edge") === "1";
    const visible = cellEl.getAttribute("visible") !== "0";
    const collapsed = cellEl.getAttribute("collapsed") === "1";

    let value =
      (wrapperEl &&
        (wrapperEl.getAttribute("label") ?? wrapperEl.getAttribute("value"))) ??
      cellEl.getAttribute("value") ??
      "";

    // Collect custom attributes from UserObject / object wrapper for placeholder substitution
    const metaAttrs = Object.create(null);
    if (wrapperEl) {
      for (const [k, v] of Object.entries(wrapperEl.attrs)) {
        metaAttrs[k] = v;
      }
    }
    for (const [k, v] of Object.entries(cellEl.attrs)) {
      if (!(k in metaAttrs)) metaAttrs[k] = v;
    }

    const placeholdersEnabled =
      (wrapperEl && wrapperEl.getAttribute("placeholders") === "1") ||
      cellEl.getAttribute("placeholders") === "1" ||
      styleStr.includes("placeholders=1");

    const geo = decodeGeometry(cellEl, { mxGeometry, mxPoint, mxRectangle });

    const cell = new mxCell(value, geo, styleStr);
    cell.setId(id);
    cell.setVertex(vertex);
    cell.setEdge(edge);
    cell.setVisible(visible);
    cell.setCollapsed(collapsed);
    cell.__metaAttrs = metaAttrs;
    cell.__placeholders = placeholdersEnabled;

    cellsById.set(id, cell);
    rawRecords.push({
      id,
      cell,
      parentId,
      sourceId,
      targetId,
    });
  }

  // Build parent-child hierarchy and wire source/target terminals
  let rootCell = null;
  for (const rec of rawRecords) {
    if (rec.parentId == null) {
      if (!rootCell) {
        rootCell = rec.cell;
      }
    }
  }
  if (!rootCell) {
    rootCell = new mxCell();
    rootCell.setId("0");
    cellsById.set("0", rootCell);
  }

  // Ensure default layer exists if referenced
  for (const rec of rawRecords) {
    if (rec.cell === rootCell) continue;
    let parent = rec.parentId != null ? cellsById.get(rec.parentId) : null;
    if (!parent && rec.parentId != null) {
      parent = new mxCell();
      parent.setId(rec.parentId);
      rootCell.insert(parent);
      cellsById.set(rec.parentId, parent);
    }
    if (parent) {
      parent.insert(rec.cell);
    } else if (rec.cell !== rootCell) {
      rootCell.insert(rec.cell);
    }

    if (rec.sourceId != null) {
      const src = cellsById.get(rec.sourceId);
      if (src) src.insertEdge(rec.cell, true);
    }
    if (rec.targetId != null) {
      const trg = cellsById.get(rec.targetId);
      if (trg) trg.insertEdge(rec.cell, false);
    }
  }

  model.setRoot(rootCell);

  // Resolve placeholders (%name%, %page%, %pagenumber%, etc.) walking up ancestor hierarchy
  for (const rec of rawRecords) {
    const c = rec.cell;
    if (typeof c.value === "string" && c.value.includes("%")) {
      if (c.__placeholders || c.value.includes("%page%") || c.value.includes("%pagenumber%")) {
        c.value = c.value.replace(/%([a-zA-Z0-9_.-]+)%/g, (match, varName) => {
          if (varName === "page") return pageInfo.pageName || "Page-1";
          if (varName === "pagenumber") return String((pageInfo.pageIndex || 0) + 1);
          let cur = c;
          while (cur != null) {
            if (cur.__metaAttrs && cur.__metaAttrs[varName] != null) {
              return cur.__metaAttrs[varName];
            }
            cur = model.getParent(cur);
          }
          return match;
        });
      }
    }
  }

  return { model, cellsById };
}

function decodeGeometry(cellEl, { mxGeometry, mxPoint, mxRectangle }) {
  let geoEl = null;
  for (const child of cellEl.childNodes) {
    if (child.nodeType === 1 && child.nodeName === "mxGeometry") {
      geoEl = child;
      break;
    }
  }
  if (!geoEl) return null;

  const x = parseFloat(geoEl.getAttribute("x") || "0") || 0;
  const y = parseFloat(geoEl.getAttribute("y") || "0") || 0;
  const width = parseFloat(geoEl.getAttribute("width") || "0") || 0;
  const height = parseFloat(geoEl.getAttribute("height") || "0") || 0;
  const geo = new mxGeometry(x, y, width, height);
  geo.relative = geoEl.getAttribute("relative") === "1";

  const parsePointNode = (ptNode) => {
    const px = parseFloat(ptNode.getAttribute("x") || "0") || 0;
    const py = parseFloat(ptNode.getAttribute("y") || "0") || 0;
    return new mxPoint(px, py);
  };

  for (const child of geoEl.childNodes) {
    if (child.nodeType !== 1) continue;
    const asAttr = child.getAttribute("as");

    if (child.nodeName === "mxPoint") {
      const pt = parsePointNode(child);
      if (asAttr === "sourcePoint") {
        geo.setTerminalPoint(pt, true);
      } else if (asAttr === "targetPoint") {
        geo.setTerminalPoint(pt, false);
      } else if (asAttr === "offset") {
        geo.offset = pt;
      }
    } else if (child.nodeName === "Array" && asAttr === "points") {
      geo.points = [];
      for (const ptChild of child.childNodes) {
        if (ptChild.nodeType === 1 && ptChild.nodeName === "mxPoint") {
          geo.points.push(parsePointNode(ptChild));
        }
      }
    } else if (child.nodeName === "mxRectangle" && asAttr === "alternateBounds") {
      const rx = parseFloat(child.getAttribute("x") || "0") || 0;
      const ry = parseFloat(child.getAttribute("y") || "0") || 0;
      const rw = parseFloat(child.getAttribute("width") || "0") || 0;
      const rh = parseFloat(child.getAttribute("height") || "0") || 0;
      geo.alternateBounds = new mxRectangle(rx, ry, rw, rh);
    }
  }

  return geo;
}

/**
 * Resolves a cell's style dictionary from its style string and the active stylesheet.
 */
function computeCellStyle(cell, model, baseStyles, themeOptions, runtime, globalShadow) {
  const { ctx } = runtime;
  const { mxConstants, mxCellRenderer, mxStencilRegistry } = ctx;
  const isEdge = model.isEdge(cell);

  // Start from defaultVertex or defaultEdge in default.xml
  const baseDefault = isEdge
    ? {
        ...(baseStyles.defaultEdge || {}),
        // Graph.prototype.defaultEdgeStyle in draw.io
        rounded: "0",
        jettySize: "auto",
        orthogonalLoop: "1",
      }
    : { ...(baseStyles.defaultVertex || {}) };

  let style = { ...baseDefault };
  const rawStyle = cell.getStyle() || "";

  if (rawStyle) {
    const parts = rawStyle.split(";");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) {
        // Named style or shorthand shape name
        if (baseStyles[part]) {
          style = { ...style, ...baseStyles[part] };
        } else if (
          mxCellRenderer.defaultShapes[part] != null ||
          mxStencilRegistry.getStencil(part) != null
        ) {
          style[mxConstants.STYLE_SHAPE] = part;
        } else {
          style[mxConstants.STYLE_SHAPE] = part;
        }
      } else {
        const key = part.slice(0, eqIdx).trim();
        const val = part.slice(eqIdx + 1).trim();
        if (key) {
          if (val === "default") {
            style[key] = "default";
          } else {
            style[key] = val;
          }
        }
      }
    }
  }

  // In draw.io, defaultVertex has shape=label, which renders as a rectangle unless an image is present.
  // If shape is "label" and no image is specified, use "rectangle" so spacingLeft=52 from named "label" isn't applied unless explicitly styled as "label".
  if (!isEdge && style.shape === "label" && !style.image && !rawStyle.startsWith("label;")) {
    style.shape = "rectangle";
  }

  // Handle edgeStyle="none" or noEdgeStyle="1"
  if (style.edgeStyle === "none" || style.noEdgeStyle === "1") {
    delete style.edgeStyle;
  }

  // Resolve "default" and "swimlane" color keywords
  const resolveThemeColor = (val, kind) => {
    if (val == null) return val;
    if (val === "default") {
      if (kind === "fill") return themeOptions.defaultFill;
      if (kind === "font") return themeOptions.defaultFont;
      return themeOptions.defaultStroke;
    }
    if (val === "swimlane") {
      // Walk up parents to find enclosing swimlane color
      let p = model.getParent(cell);
      while (p != null && p !== model.getRoot()) {
        const pRaw = p.getStyle() || "";
        const m = pRaw.match(
          new RegExp(`(?:^|;)${kind === "fill" ? "fillColor" : "strokeColor"}=([^;]+)`)
        );
        if (m && m[1] !== "swimlane" && m[1] !== "none") {
          return m[1] === "default"
            ? kind === "fill"
              ? themeOptions.defaultFill
              : themeOptions.defaultStroke
            : m[1];
        }
        p = model.getParent(p);
      }
      return kind === "fill" ? themeOptions.defaultFill : themeOptions.defaultStroke;
    }
    return val;
  };

  style.fillColor = resolveThemeColor(style.fillColor, "fill");
  style.strokeColor = resolveThemeColor(style.strokeColor, "stroke");
  style.fontColor = resolveThemeColor(style.fontColor, "font");
  style.gradientColor = resolveThemeColor(style.gradientColor, "fill");
  if (style.swimlaneFillColor) {
    style.swimlaneFillColor = resolveThemeColor(style.swimlaneFillColor, "fill");
  }
  if (style.separatorColor) {
    style.separatorColor = resolveThemeColor(style.separatorColor, "stroke");
  }

  // In defaultEdge, labelBackgroundColor is "default" (#ffffff), but for vertices only if explicitly set
  if (isEdge) {
    if (style.labelBackgroundColor === "default") {
      style.labelBackgroundColor = themeOptions.defaultFill;
    }
  } else if (style.labelBackgroundColor === "default") {
    style.labelBackgroundColor = themeOptions.defaultFill;
  }
  if (style.labelBorderColor === "default") {
    style.labelBorderColor = themeOptions.defaultStroke;
  }

  if (globalShadow && style.shadow == null && !isEdge && style.fillColor !== "none") {
    style.shadow = "1";
  }

  return style;
}

/**
 * Headless Graph + GraphView implementation matching draw.io OSS's mxGraph & mxGraphView.
 */
function createHeadlessGraphAndView(model, baseStyles, themeOptions, runtime, globalShadow) {
  const { ctx } = runtime;
  const {
    mxConstants,
    mxUtils,
    mxPoint,
    mxRectangle,
    mxCellState,
    mxConnectionConstraint,
    mxStyleRegistry,
    mxCellRenderer,
    mxStencilRegistry,
    mxEdgeStyle,
    mxPerimeter,
    mxText,
  } = ctx;

  const styleCache = new Map();
  const statesMap = new Map();

  const graph = {
    model,
    shapeBackgroundColor: themeOptions.defaultFill,
    shapeForegroundColor: themeOptions.defaultStroke,
    defaultLoopStyle: mxEdgeStyle.Loop,
    keepEdgesInForeground: false,
    keepEdgesInBackground: false,

    getModel() {
      return this.model;
    },

    getCellStyle(cell) {
      if (!cell) return null;
      if (styleCache.has(cell)) return styleCache.get(cell);
      const st = computeCellStyle(cell, model, baseStyles, themeOptions, runtime, globalShadow);
      styleCache.set(cell, st);
      return st;
    },

    getCurrentCellStyle(cell) {
      return this.getCellStyle(cell);
    },

    getCellGeometry(cell) {
      return model.getGeometry(cell);
    },

    isCellVisible(cell) {
      return cell != null ? model.isVisible(cell) : false;
    },

    isCellCollapsed(cell) {
      return cell != null ? model.isCollapsed(cell) : false;
    },

    getChildOffsetForCell(_cell) {
      return null;
    },

    isSwimlane(cell) {
      if (cell != null && model.getParent(cell) !== model.getRoot() && !model.isEdge(cell)) {
        const style = this.getCellStyle(cell);
        if (style != null) {
          return (
            style[mxConstants.STYLE_SHAPE] === mxConstants.SHAPE_SWIMLANE ||
            style[mxConstants.STYLE_SHAPE] === "table" ||
            style[mxConstants.STYLE_SHAPE] === "tableRow"
          );
        }
      }
      return false;
    },

    isTable(cell) {
      const style = this.getCellStyle(cell);
      return (
        style != null &&
        (style.childLayout === "tableLayout" || style[mxConstants.STYLE_SHAPE] === "table")
      );
    },

    isTableRow(cell) {
      return model.isVertex(cell) && this.isTable(model.getParent(cell));
    },

    isTableCell(cell) {
      return model.isVertex(cell) && this.isTableRow(model.getParent(cell));
    },

    getStartSize(swimlane) {
      const result = new mxRectangle();
      const style = this.getCellStyle(swimlane);
      if (style != null) {
        const size = parseInt(
          mxUtils.getValue(style, mxConstants.STYLE_STARTSIZE, mxConstants.DEFAULT_STARTSIZE),
          10
        );
        if (mxUtils.getValue(style, mxConstants.STYLE_HORIZONTAL, true) != 0) {
          result.height = size;
        } else {
          result.width = size;
        }
      }
      return result;
    },

    getSwimlaneDirection(style) {
      const dir = mxUtils.getValue(
        style,
        mxConstants.STYLE_DIRECTION,
        mxConstants.DIRECTION_EAST
      );
      const flipH = mxUtils.getValue(style, mxConstants.STYLE_FLIPH, 0) == 1;
      const flipV = mxUtils.getValue(style, mxConstants.STYLE_FLIPV, 0) == 1;
      const h = mxUtils.getValue(style, mxConstants.STYLE_HORIZONTAL, true) != 0;
      let n = h ? 0 : 3;
      if (dir === mxConstants.DIRECTION_NORTH) n--;
      else if (dir === mxConstants.DIRECTION_WEST) n += 2;
      else if (dir === mxConstants.DIRECTION_SOUTH) n += 1;
      const mod = mxUtils.mod(n, 2);
      if (flipH && mod === 1) n += 2;
      if (flipV && mod === 0) n += 2;
      return [
        mxConstants.DIRECTION_NORTH,
        mxConstants.DIRECTION_EAST,
        mxConstants.DIRECTION_SOUTH,
        mxConstants.DIRECTION_WEST,
      ][mxUtils.mod(n, 4)];
    },

    getActualStartSize(swimlane) {
      const result = new mxRectangle();
      if (this.isSwimlane(swimlane)) {
        const style = this.getCellStyle(swimlane);
        const size = parseInt(
          mxUtils.getValue(style, mxConstants.STYLE_STARTSIZE, mxConstants.DEFAULT_STARTSIZE),
          10
        );
        const dir = this.getSwimlaneDirection(style);
        if (dir === mxConstants.DIRECTION_NORTH) result.y = size;
        else if (dir === mxConstants.DIRECTION_WEST) result.x = size;
        else if (dir === mxConstants.DIRECTION_SOUTH) result.height = size;
        else result.width = size;
      }
      return result;
    },

    visitTableCells(cell, visitor) {
      let lastRow = null;
      const rows = model.getChildCells(cell, true);
      const start = this.getActualStartSize(cell);

      for (let i = 0; i < rows.length; i++) {
        const rowStart = this.getActualStartSize(rows[i]);
        const cols = model.getChildCells(rows[i], true);
        const rowStyle = this.getCellStyle(rows[i]);
        let lastCol = null;
        const row = [];

        for (let j = 0; j < cols.length; j++) {
          let geo = this.getCellGeometry(cols[j]);
          if (!geo) continue;
          const col = {
            cell: cols[j],
            rowspan: 1,
            colspan: 1,
            row: i,
            col: j,
            geo,
          };
          geo = geo.alternateBounds != null ? geo.alternateBounds : geo;
          col.point = new mxPoint(
            geo.width + (lastCol != null ? lastCol.point.x : start.x + rowStart.x),
            geo.height +
              (lastRow != null && lastRow[0] != null
                ? lastRow[0].point.y
                : start.y + rowStart.y)
          );
          col.actual = col;

          if (lastRow != null && lastRow[j] != null && lastRow[j].rowspan > 1) {
            col.rowspan = lastRow[j].rowspan - 1;
            col.colspan = lastRow[j].colspan;
            col.actual = lastRow[j].actual;
          } else if (lastCol != null && lastCol.colspan > 1) {
            col.rowspan = lastCol.rowspan;
            col.colspan = lastCol.colspan - 1;
            col.actual = lastCol.actual;
          } else {
            const style = this.getCellStyle(cols[j]);
            if (style != null) {
              col.rowspan = parseInt(style.rowspan || "1", 10);
              col.colspan = parseInt(style.colspan || "1", 10);
            }
          }

          const head =
            mxUtils.getValue(rowStyle, mxConstants.STYLE_SWIMLANE_HEAD, 1) == 1 &&
            mxUtils.getValue(rowStyle, mxConstants.STYLE_STROKECOLOR, mxConstants.NONE) !=
              mxConstants.NONE;

          visitor(
            col,
            cols.length,
            rows.length,
            start.x + (head ? rowStart.x : 0),
            start.y + (head ? rowStart.y : 0)
          );
          row.push(col);
          lastCol = col;
        }
        lastRow = row;
      }
    },

    getTableLines(cell, horizontal, vertical) {
      const hl = [];
      const vl = [];
      if (horizontal || vertical) {
        this.visitTableCells(cell, (iter, colCount, rowCount, x0, y0) => {
          if (horizontal && iter.row < rowCount - 1) {
            if (hl[iter.row] == null) {
              hl[iter.row] = [new mxPoint(x0, iter.point.y)];
            }
            if (iter.rowspan > 1) {
              hl[iter.row].push(null);
            }
            hl[iter.row].push(iter.point);
          }
          if (vertical && iter.col < colCount - 1) {
            if (vl[iter.col] == null) {
              vl[iter.col] = [new mxPoint(iter.point.x, y0)];
            }
            if (iter.colspan > 1) {
              vl[iter.col].push(null);
            }
            vl[iter.col].push(iter.point);
          }
        });
      }
      return hl.concat(vl).filter(Boolean);
    },

    isOrthogonal(edge) {
      const style = edge.style;
      if (style != null) {
        const tmp = style[mxConstants.STYLE_ORTHOGONAL];
        if (tmp != null) return tmp == "1" || tmp === true;
        const es = view.getEdgeStyle(edge);
        return (
          es === mxEdgeStyle.SegmentConnector ||
          es === mxEdgeStyle.ElbowConnector ||
          es === mxEdgeStyle.SideToSide ||
          es === mxEdgeStyle.TopToBottom ||
          es === mxEdgeStyle.EntityRelation ||
          es === mxEdgeStyle.OrthConnector
        );
      }
      return false;
    },

    getConnectionConstraint(edge, _terminal, source) {
      let point = null;
      const x = edge.style[source ? mxConstants.STYLE_EXIT_X : mxConstants.STYLE_ENTRY_X];
      if (x != null) {
        const y = edge.style[source ? mxConstants.STYLE_EXIT_Y : mxConstants.STYLE_ENTRY_Y];
        if (y != null) {
          point = new mxPoint(parseFloat(x), parseFloat(y));
        }
      }
      let perimeter = false;
      let dx = 0;
      let dy = 0;
      if (point != null) {
        perimeter =
          mxUtils.getValue(
            edge.style,
            source ? mxConstants.STYLE_EXIT_PERIMETER : mxConstants.STYLE_ENTRY_PERIMETER,
            1
          ) != 0;
        dx = parseFloat(
          edge.style[source ? mxConstants.STYLE_EXIT_DX : mxConstants.STYLE_ENTRY_DX]
        );
        dy = parseFloat(
          edge.style[source ? mxConstants.STYLE_EXIT_DY : mxConstants.STYLE_ENTRY_DY]
        );
        dx = Number.isFinite(dx) ? dx : 0;
        dy = Number.isFinite(dy) ? dy : 0;
      }
      return new mxConnectionConstraint(point, perimeter, null, dx, dy);
    },

    getConnectionPoint(vertex, constraint) {
      let point = null;
      if (vertex != null && constraint.point != null) {
        const bounds = view.getPerimeterBounds(vertex);
        const direction = vertex.style[mxConstants.STYLE_DIRECTION];
        const cx = new mxPoint(bounds.getCenterX(), bounds.getCenterY());
        const scale = view.scale;

        if (
          direction === mxConstants.DIRECTION_NORTH ||
          direction === mxConstants.DIRECTION_SOUTH
        ) {
          bounds.rotate90();
        }

        point = new mxPoint(
          bounds.x + constraint.point.x * bounds.width + (constraint.dx || 0) * scale,
          bounds.y + constraint.point.y * bounds.height + (constraint.dy || 0) * scale
        );

        let r1 = 0;
        if (
          direction != null &&
          mxUtils.getValue(vertex.style, mxConstants.STYLE_ANCHOR_POINT_DIRECTION, 1) == 1
        ) {
          if (direction === mxConstants.DIRECTION_NORTH) r1 += 270;
          else if (direction === mxConstants.DIRECTION_WEST) r1 += 180;
          else if (direction === mxConstants.DIRECTION_SOUTH) r1 += 90;
          if (r1 !== 0) {
            const rad = mxUtils.toRadians(r1);
            point = mxUtils.getRotatedPoint(point, Math.cos(rad), Math.sin(rad), cx);
          }
        }

        if (constraint.perimeter) {
          if (r1 !== 0 && point != null) {
            let cos = 1;
            let sin = 0;
            if (r1 === 90) {
              cos = 0;
              sin = -1;
            } else if (r1 === 180) {
              cos = -1;
              sin = 0;
            } else if (r1 === 270) {
              cos = 0;
              sin = 1;
            }
            point = mxUtils.getRotatedPoint(point, cos, sin, cx);
          }
          point = view.getPerimeterPoint(vertex, point, false);
        } else {
          r1 += Number(vertex.style[mxConstants.STYLE_ROTATION] || 0);
          if (model.isVertex(vertex.cell)) {
            let flipH = vertex.style[mxConstants.STYLE_FLIPH] == 1;
            let flipV = vertex.style[mxConstants.STYLE_FLIPV] == 1;
            if (vertex.shape != null && vertex.shape.stencil != null) {
              flipH = mxUtils.getValue(vertex.style, "stencilFlipH", 0) == 1 || flipH;
              flipV = mxUtils.getValue(vertex.style, "stencilFlipV", 0) == 1 || flipV;
            }
            if (
              direction === mxConstants.DIRECTION_NORTH ||
              direction === mxConstants.DIRECTION_SOUTH
            ) {
              const temp = flipH;
              flipH = flipV;
              flipV = temp;
            }
            if (flipH) point.x = 2 * bounds.getCenterX() - point.x;
            if (flipV) point.y = 2 * bounds.getCenterY() - point.y;
          }
          if (r1 !== 0 && point != null) {
            const rad = mxUtils.toRadians(r1);
            point = mxUtils.getRotatedPoint(point, Math.cos(rad), Math.sin(rad), cx);
          }
        }
      }
      return point;
    },
  };

  const view = {
    graph,
    scale: 1,
    translate: new mxPoint(0, 0),
    currentRoot: null,
    EMPTY_POINT: new mxPoint(0, 0),

    getState(cell, create = false) {
      if (!cell) return null;
      let st = statesMap.get(cell);
      if (create && !st && graph.isCellVisible(cell)) {
        st = new mxCellState(this, cell, graph.getCellStyle(cell));
        statesMap.set(cell, st);
      }
      return st || null;
    },

    getStatesMap() {
      return statesMap;
    },

    validate() {
      const root = model.getRoot();
      this.validateCell(root, true);
      this.validateCellState(root, true);
    },

    validateCell(cell, visible = true) {
      if (cell != null) {
        const isVis = visible && graph.isCellVisible(cell);
        const state = this.getState(cell, isVis);
        if (state != null && !isVis) {
          statesMap.delete(cell);
        } else {
          const childCount = model.getChildCount(cell);
          for (let i = 0; i < childCount; i++) {
            this.validateCell(
              model.getChildAt(cell, i),
              isVis && (!graph.isCellCollapsed(cell) || cell === rootOrCurrent(this))
            );
          }
        }
      }
      return cell;
    },

    validateCellState(cell, recurse = true) {
      let state = null;
      if (cell != null) {
        state = this.getState(cell);
        if (state != null) {
          if (state.invalid) {
            state.invalid = false;
            if (state.style == null) {
              state.style = graph.getCellStyle(state.cell);
            }
            if (cell !== model.getRoot()) {
              this.validateCellState(model.getParent(cell), false);
            }
            state.setVisibleTerminalState(
              this.validateCellState(this.getVisibleTerminal(cell, true), false),
              true
            );
            state.setVisibleTerminalState(
              this.validateCellState(this.getVisibleTerminal(cell, false), false),
              false
            );
            this.updateCellState(state);

            if (cell !== model.getRoot() && !state.invalid) {
              createShapesForState(state);
              state.updateCachedBounds();
            }
          }
          if (recurse && !state.invalid) {
            const childCount = model.getChildCount(cell);
            for (let i = 0; i < childCount; i++) {
              this.validateCellState(model.getChildAt(cell, i), true);
            }
          }
        }
      }
      return state;
    },

    updateCellState(state) {
      state.absoluteOffset.x = 0;
      state.absoluteOffset.y = 0;
      state.origin.x = 0;
      state.origin.y = 0;
      state.length = 0;

      if (state.cell !== model.getRoot()) {
        const pState = this.getState(model.getParent(state.cell));
        if (pState != null && pState.cell !== model.getRoot()) {
          state.origin.x += pState.origin.x;
          state.origin.y += pState.origin.y;
        }
        let offset = graph.getChildOffsetForCell(state.cell);
        if (offset != null) {
          state.origin.x += offset.x;
          state.origin.y += offset.y;
        }
        const geo = graph.getCellGeometry(state.cell);
        if (geo != null) {
          if (!model.isEdge(state.cell)) {
            offset = geo.offset != null ? geo.offset : this.EMPTY_POINT;
            if (geo.relative && pState != null) {
              if (model.isEdge(pState.cell)) {
                const origin = this.getPoint(pState, geo);
                if (origin != null) {
                  state.origin.x += origin.x / this.scale - pState.origin.x - this.translate.x;
                  state.origin.y += origin.y / this.scale - pState.origin.y - this.translate.y;
                }
              } else {
                state.origin.x += geo.x * pState.unscaledWidth + offset.x;
                state.origin.y += geo.y * pState.unscaledHeight + offset.y;
              }
            } else {
              state.absoluteOffset.x = this.scale * offset.x;
              state.absoluteOffset.y = this.scale * offset.y;
              state.origin.x += geo.x;
              state.origin.y += geo.y;
            }
          }

          state.x = this.scale * (this.translate.x + state.origin.x);
          state.y = this.scale * (this.translate.y + state.origin.y);
          state.width = this.scale * geo.width;
          state.unscaledWidth = geo.width;
          state.height = this.scale * geo.height;
          state.unscaledHeight = geo.height;

          if (model.isVertex(state.cell)) {
            this.updateVertexState(state, geo);
          }
          if (model.isEdge(state.cell)) {
            this.updateEdgeState(state, geo);
          }
        }
      }
      state.updateCachedBounds();
    },

    updateVertexState(state, geo) {
      const pState = this.getState(model.getParent(state.cell));
      if (geo.relative && pState != null && !model.isEdge(pState.cell)) {
        const alpha = mxUtils.toRadians(pState.style[mxConstants.STYLE_ROTATION] || "0");
        if (alpha !== 0) {
          const cos = Math.cos(alpha);
          const sin = Math.sin(alpha);
          const ct = new mxPoint(state.getCenterX(), state.getCenterY());
          const cx = new mxPoint(pState.getCenterX(), pState.getCenterY());
          const pt = mxUtils.getRotatedPoint(ct, cos, sin, cx);
          state.x = pt.x - state.width / 2;
          state.y = pt.y - state.height / 2;
        }
      }
      this.updateVertexLabelOffset(state);
    },

    updateVertexLabelOffset(state) {
      const h = mxUtils.getValue(
        state.style,
        mxConstants.STYLE_LABEL_POSITION,
        mxConstants.ALIGN_CENTER
      );
      if (h === mxConstants.ALIGN_LEFT) {
        let lw = mxUtils.getValue(state.style, mxConstants.STYLE_LABEL_WIDTH, null);
        lw = lw != null ? lw * this.scale : state.width;
        state.absoluteOffset.x -= lw;
      } else if (h === mxConstants.ALIGN_RIGHT) {
        state.absoluteOffset.x += state.width;
      } else if (h === mxConstants.ALIGN_CENTER) {
        const lw = mxUtils.getValue(state.style, mxConstants.STYLE_LABEL_WIDTH, null);
        if (lw != null) {
          const align = mxUtils.getValue(
            state.style,
            mxConstants.STYLE_ALIGN,
            mxConstants.ALIGN_CENTER
          );
          let dx = 0;
          if (align === mxConstants.ALIGN_CENTER) dx = 0.5;
          else if (align === mxConstants.ALIGN_RIGHT) dx = 1;
          if (dx !== 0) {
            state.absoluteOffset.x -= (lw * this.scale - state.width) * dx;
          }
        }
      }
      const v = mxUtils.getValue(
        state.style,
        mxConstants.STYLE_VERTICAL_LABEL_POSITION,
        mxConstants.ALIGN_MIDDLE
      );
      if (v === mxConstants.ALIGN_TOP) {
        state.absoluteOffset.y -= state.height;
      } else if (v === mxConstants.ALIGN_BOTTOM) {
        state.absoluteOffset.y += state.height;
      }
    },

    updateEdgeState(state, geo) {
      const source = state.getVisibleTerminalState(true);
      const target = state.getVisibleTerminalState(false);

      if (
        (model.getTerminal(state.cell, true) != null && source == null) ||
        (source == null && geo.getTerminalPoint(true) == null) ||
        (model.getTerminal(state.cell, false) != null && target == null) ||
        (target == null && geo.getTerminalPoint(false) == null)
      ) {
        statesMap.delete(state.cell);
      } else {
        this.updateFixedTerminalPoints(state, source, target);
        this.updatePoints(state, geo.points, source, target);
        this.updateFloatingTerminalPoints(state, source, target);

        const pts = state.absolutePoints;
        if (
          pts == null ||
          pts.length < 2 ||
          pts[0] == null ||
          pts[pts.length - 1] == null
        ) {
          statesMap.delete(state.cell);
        } else {
          this.updateEdgeBounds(state);
          this.updateEdgeLabelOffset(state);
        }
      }
    },

    updateFixedTerminalPoints(edge, source, target) {
      this.updateFixedTerminalPoint(
        edge,
        source,
        true,
        graph.getConnectionConstraint(edge, source, true)
      );
      this.updateFixedTerminalPoint(
        edge,
        target,
        false,
        graph.getConnectionConstraint(edge, target, false)
      );
    },

    updateFixedTerminalPoint(edge, terminal, source, constraint) {
      edge.setAbsoluteTerminalPoint(
        this.getFixedTerminalPoint(edge, terminal, source, constraint),
        source
      );
    },

    getFixedTerminalPoint(edge, terminal, source, constraint) {
      let pt = null;
      if (constraint != null) {
        pt = graph.getConnectionPoint(terminal, constraint, false);
      }
      if (pt == null && terminal == null) {
        const s = this.scale;
        const tr = this.translate;
        const orig = edge.origin;
        const geo = graph.getCellGeometry(edge.cell);
        pt = geo.getTerminalPoint(source);
        if (pt != null) {
          pt = new mxPoint(s * (tr.x + pt.x + orig.x), s * (tr.y + pt.y + orig.y));
        }
      }
      return pt;
    },

    updateBoundsFromStencil(state) {
      let previous = null;
      if (
        state != null &&
        state.shape != null &&
        state.shape.stencil != null &&
        state.shape.stencil.aspect === "fixed"
      ) {
        previous = mxRectangle.fromRectangle(state);
        const asp = state.shape.stencil.computeAspect(
          state.style,
          state.x,
          state.y,
          state.width,
          state.height
        );
        state.setRect(
          asp.x,
          asp.y,
          state.shape.stencil.w0 * asp.width,
          state.shape.stencil.h0 * asp.height
        );
      }
      return previous;
    },

    updatePoints(edge, points, source, target) {
      if (edge != null && edge.absolutePoints != null && edge.absolutePoints.length > 0) {
        const pts = [];
        pts.push(edge.absolutePoints[0]);
        const edgeStyle = this.getEdgeStyle(edge, points, source, target);

        if (edgeStyle != null) {
          const src = this.getTerminalPort(edge, source, true);
          const trg = this.getTerminalPort(edge, target, false);
          const srcBounds = this.updateBoundsFromStencil(src);
          const trgBounds = this.updateBoundsFromStencil(trg);

          edgeStyle(edge, src, trg, points, pts);

          if (srcBounds != null) {
            src.setRect(srcBounds.x, srcBounds.y, srcBounds.width, srcBounds.height);
          }
          if (trgBounds != null) {
            trg.setRect(trgBounds.x, trgBounds.y, trgBounds.width, trgBounds.height);
          }
        } else if (points != null) {
          for (let i = 0; i < points.length; i++) {
            if (points[i] != null) {
              const pt = mxUtils.clone(points[i]);
              pts.push(this.transformControlPoint(edge, pt));
            }
          }
        }

        const tmp = edge.absolutePoints;
        pts.push(tmp[tmp.length - 1]);
        edge.absolutePoints = pts;
      }
    },

    transformControlPoint(state, pt, ignoreScale = false) {
      if (state != null && pt != null) {
        const orig = state.origin;
        const scale = ignoreScale ? 1 : this.scale;
        return new mxPoint(
          scale * (pt.x + this.translate.x + orig.x),
          scale * (pt.y + this.translate.y + orig.y)
        );
      }
      return null;
    },

    isLoopStyleEnabled(edge, points, source, target) {
      const sc = graph.getConnectionConstraint(edge, source, true);
      const tc = graph.getConnectionConstraint(edge, target, false);
      if (
        (points == null || points.length < 2) &&
        (mxUtils.getValue(edge.style, mxConstants.STYLE_ORTHOGONAL_LOOP, 0) != 1 ||
          ((sc == null || sc.point == null) && (tc == null || tc.point == null)))
      ) {
        return source != null && source === target;
      }
      return false;
    },

    getEdgeStyle(edge, points, source, target) {
      let edgeStyle = this.isLoopStyleEnabled(edge, points, source, target)
        ? mxUtils.getValue(edge.style, mxConstants.STYLE_LOOP, graph.defaultLoopStyle)
        : mxUtils.getValue(edge.style, mxConstants.STYLE_NOEDGESTYLE, 0) != 1
          ? edge.style[mxConstants.STYLE_EDGE]
          : null;

      if (typeof edgeStyle === "string") {
        edgeStyle = mxStyleRegistry.getValue(edgeStyle);
      }
      if (typeof edgeStyle === "function") {
        return edgeStyle;
      }
      return null;
    },

    updateFloatingTerminalPoints(state, source, target) {
      const pts = state.absolutePoints;
      if (pts != null) {
        const p0 = pts[0];
        const pe = pts[pts.length - 1];
        if (pe == null && target != null) {
          this.updateFloatingTerminalPoint(state, target, source, false);
        }
        if (p0 == null && source != null) {
          this.updateFloatingTerminalPoint(state, source, target, true);
        }
      }
    },

    updateFloatingTerminalPoint(edge, start, end, source) {
      edge.setAbsoluteTerminalPoint(
        this.getFloatingTerminalPoint(edge, start, end, source),
        source
      );
    },

    getFloatingTerminalPoint(edge, start, end, source) {
      start = this.getTerminalPort(edge, start, source);
      let next = this.getNextPoint(edge, end, source);
      const orth = graph.isOrthogonal(edge);
      const alpha = mxUtils.toRadians(Number(start.style[mxConstants.STYLE_ROTATION] || "0"));
      const center = new mxPoint(start.getCenterX(), start.getCenterY());

      if (alpha !== 0 && next != null) {
        next = mxUtils.getRotatedPoint(next, Math.cos(-alpha), Math.sin(-alpha), center);
      }

      let border = parseFloat(edge.style[mxConstants.STYLE_PERIMETER_SPACING] || "0") || 0;
      border +=
        parseFloat(
          edge.style[
            source
              ? mxConstants.STYLE_SOURCE_PERIMETER_SPACING
              : mxConstants.STYLE_TARGET_PERIMETER_SPACING
          ] || "0"
        ) || 0;
      let pt = this.getPerimeterPoint(start, next, alpha === 0 && orth, border);

      if (alpha !== 0 && pt != null) {
        pt = mxUtils.getRotatedPoint(pt, Math.cos(alpha), Math.sin(alpha), center);
      }
      return pt;
    },

    getTerminalPort(state, terminal, source) {
      const key = source ? mxConstants.STYLE_SOURCE_PORT : mxConstants.STYLE_TARGET_PORT;
      const id = mxUtils.getValue(state.style, key, null);
      if (id != null) {
        const tmp = this.getState(model.getCell(id));
        if (tmp != null) terminal = tmp;
      }
      return terminal;
    },

    getPerimeterPoint(terminal, next, orthogonal, border) {
      let point = null;
      if (terminal != null) {
        const perimeter = this.getPerimeterFunction(terminal);
        if (perimeter != null && next != null) {
          const bounds = this.getPerimeterBounds(terminal, border);
          if (bounds.width > 0 || bounds.height > 0) {
            point = new mxPoint(next.x, next.y);
            let flipH = false;
            let flipV = false;
            if (model.isVertex(terminal.cell)) {
              flipH = mxUtils.getValue(terminal.style, mxConstants.STYLE_FLIPH, 0) == 1;
              flipV = mxUtils.getValue(terminal.style, mxConstants.STYLE_FLIPV, 0) == 1;
              if (terminal.shape != null && terminal.shape.stencil != null) {
                flipH = mxUtils.getValue(terminal.style, "stencilFlipH", 0) == 1 || flipH;
                flipV = mxUtils.getValue(terminal.style, "stencilFlipV", 0) == 1 || flipV;
              }
              if (flipH) point.x = 2 * bounds.getCenterX() - point.x;
              if (flipV) point.y = 2 * bounds.getCenterY() - point.y;
            }
            point = perimeter(bounds, terminal, point, orthogonal);
            if (point != null) {
              if (flipH) point.x = 2 * bounds.getCenterX() - point.x;
              if (flipV) point.y = 2 * bounds.getCenterY() - point.y;
            }
          }
        }
        if (point == null) {
          point = this.getPoint(terminal);
        }
      }
      return point;
    },

    getPerimeterBounds(terminal, border = 0) {
      let b = border;
      if (terminal != null) {
        b += parseFloat(terminal.style[mxConstants.STYLE_PERIMETER_SPACING] || "0") || 0;
      }
      return terminal.getPerimeterBounds(b * this.scale);
    },

    getPerimeterFunction(state) {
      let perimeter = state.style[mxConstants.STYLE_PERIMETER];
      if (typeof perimeter === "string") {
        perimeter = mxStyleRegistry.getValue(perimeter);
      }
      if (typeof perimeter === "function") {
        return perimeter;
      }
      return mxPerimeter.RectanglePerimeter;
    },

    getNextPoint(edge, opposite, source) {
      const pts = edge.absolutePoints;
      let point = null;
      if (pts != null && pts.length >= 2) {
        const count = pts.length;
        point = pts[source ? Math.min(1, count - 1) : Math.max(0, count - 2)];
      }
      if (point == null && opposite != null) {
        point = new mxPoint(opposite.getCenterX(), opposite.getCenterY());
      }
      return point;
    },

    getVisibleTerminal(edge, source) {
      let result = model.getTerminal(edge, source);
      let best = result;
      while (result != null && result !== model.getRoot()) {
        if (!graph.isCellVisible(best) || graph.isCellCollapsed(result)) {
          best = result;
        }
        result = model.getParent(result);
      }
      if (
        best != null &&
        (!model.contains(best) ||
          model.getParent(best) === model.getRoot() ||
          best === model.getRoot())
      ) {
        best = null;
      }
      return best;
    },

    updateEdgeBounds(state) {
      const points = state.absolutePoints;
      const p0 = points[0];
      const pe = points[points.length - 1];
      if (p0.x !== pe.x || p0.y !== pe.y) {
        const dx = pe.x - p0.x;
        const dy = pe.y - p0.y;
        state.terminalDistance = Math.sqrt(dx * dx + dy * dy);
      } else {
        state.terminalDistance = 0;
      }

      let length = 0;
      const segments = [];
      let pt = p0;
      if (pt != null) {
        let minX = pt.x;
        let minY = pt.y;
        let maxX = minX;
        let maxY = minY;
        for (let i = 1; i < points.length; i++) {
          const tmp = points[i];
          if (tmp != null) {
            const dx = pt.x - tmp.x;
            const dy = pt.y - tmp.y;
            const segment = Math.sqrt(dx * dx + dy * dy);
            segments.push(segment);
            length += segment;
            pt = tmp;
            minX = Math.min(pt.x, minX);
            minY = Math.min(pt.y, minY);
            maxX = Math.max(pt.x, maxX);
            maxY = Math.max(pt.y, maxY);
          }
        }
        state.length = length;
        state.segments = segments;
        state.x = minX;
        state.y = minY;
        state.width = Math.max(1, maxX - minX);
        state.height = Math.max(1, maxY - minY);
      }
    },

    getPoint(state, geometry) {
      let x = state.getCenterX();
      let y = state.getCenterY();
      if (state.segments != null && (geometry == null || geometry.relative)) {
        const gx = geometry != null ? geometry.x / 2 : 0;
        const pointCount = state.absolutePoints.length;
        const dist = Math.round((gx + 0.5) * state.length);
        let segment = state.segments[0];
        let length = 0;
        let index = 1;
        while (dist >= Math.round(length + segment) && index < pointCount - 1) {
          length += segment;
          segment = state.segments[index++];
        }
        const factor = segment === 0 ? 0 : (dist - length) / segment;
        const p0 = state.absolutePoints[index - 1];
        const pe = state.absolutePoints[index];
        if (p0 != null && pe != null) {
          let gy = 0;
          let offsetX = 0;
          let offsetY = 0;
          if (geometry != null) {
            gy = geometry.y;
            const offset = geometry.offset;
            if (offset != null) {
              offsetX = offset.x;
              offsetY = offset.y;
            }
          }
          const dx = pe.x - p0.x;
          const dy = pe.y - p0.y;
          const nx = segment === 0 ? 0 : dy / segment;
          const ny = segment === 0 ? 0 : dx / segment;
          x = p0.x + dx * factor + (nx * gy + offsetX) * this.scale;
          y = p0.y + dy * factor - (ny * gy - offsetY) * this.scale;
        }
      } else if (geometry != null) {
        const offset = geometry.offset;
        if (offset != null) {
          x += offset.x;
          y += offset.y;
        }
      }
      return new mxPoint(x, y);
    },

    updateEdgeLabelOffset(state) {
      const points = state.absolutePoints;
      state.absoluteOffset.x = state.getCenterX();
      state.absoluteOffset.y = state.getCenterY();
      if (points != null && points.length > 0 && state.segments != null) {
        const geometry = graph.getCellGeometry(state.cell);
        if (geometry != null) {
          if (geometry.relative) {
            const offset = this.getPoint(state, geometry);
            if (offset != null) {
              state.absoluteOffset = offset;
            }
          } else {
            const p0 = points[0];
            const pe = points[points.length - 1];
            if (p0 != null && pe != null) {
              const dx = pe.x - p0.x;
              const dy = pe.y - p0.y;
              const off = geometry.offset;
              const x0 = off != null ? off.x : 0;
              const y0 = off != null ? off.y : 0;
              state.absoluteOffset.x = p0.x + dx / 2 + x0 * this.scale;
              state.absoluteOffset.y = p0.y + dy / 2 + y0 * this.scale;
            }
          }
        }
      }
    },
  };

  function rootOrCurrent(v) {
    return v.currentRoot || model.getRoot();
  }

  function createShapesForState(state) {
    const isEdge = model.isEdge(state.cell);
    const parent = model.getParent(state.cell);
    // Top-level layers don't get shapes
    if (parent === model.getRoot()) return;

    const style = state.style;
    const shapeName = style[mxConstants.STYLE_SHAPE];
    let shape = null;

    if (shapeName != null) {
      const stencil = mxStencilRegistry.getStencil(shapeName);
      if (stencil != null) {
        shape = new ctx.mxShape(stencil);
      } else {
        const ctor =
          mxCellRenderer.defaultShapes[shapeName] ||
          (isEdge ? mxCellRenderer.defaultShapes.connector : mxCellRenderer.defaultShapes.rectangle);
        if (ctor != null) {
          shape = new ctor();
        }
      }
    } else if (isEdge) {
      shape = new mxCellRenderer.defaultShapes.connector();
    } else {
      shape = new mxCellRenderer.defaultShapes.rectangle();
    }

    if (shape != null) {
      shape.dialect = mxConstants.DIALECT_SVG;
      shape.apply(state);
      shape.bounds = new mxRectangle(state.x, state.y, state.width, state.height);
      shape.points = state.absolutePoints;
      shape.scale = view.scale;
      state.shape = shape;
    }

    // Create mxText if cell has a visible label
    const labelValue = model.getValue(state.cell);
    const noLabel = mxUtils.getValue(style, mxConstants.STYLE_NOLABEL, 0) == 1;
    if (!noLabel && labelValue != null && String(labelValue).trim() !== "") {
      const align = mxUtils.getValue(style, mxConstants.STYLE_ALIGN, mxConstants.ALIGN_CENTER);
      const valign = mxUtils.getValue(
        style,
        mxConstants.STYLE_VERTICAL_ALIGN,
        mxConstants.ALIGN_MIDDLE
      );
      const color = mxUtils.getValue(style, mxConstants.STYLE_FONTCOLOR, "#000000");
      const family = mxUtils.getValue(
        style,
        mxConstants.STYLE_FONTFAMILY,
        mxConstants.DEFAULT_FONTFAMILY
      );
      const size = mxUtils.getNumber(
        style,
        mxConstants.STYLE_FONTSIZE,
        mxConstants.DEFAULT_FONTSIZE
      );
      const fontStyle = mxUtils.getValue(style, mxConstants.STYLE_FONTSTYLE, 0);
      const wrap =
        mxUtils.getValue(style, mxConstants.STYLE_WHITE_SPACE, "nowrap") === "wrap";
      const overflow = mxUtils.getValue(style, mxConstants.STYLE_OVERFLOW, "visible");
      const clip = overflow === "hidden";
      const bg = mxUtils.getValue(style, mxConstants.STYLE_LABEL_BACKGROUNDCOLOR, null);
      const border = mxUtils.getValue(style, mxConstants.STYLE_LABEL_BORDERCOLOR, null);
      const dir = mxUtils.getValue(style, mxConstants.STYLE_TEXT_DIRECTION, "");

      const spacing = mxUtils.getValue(style, mxConstants.STYLE_SPACING, 2);
      const spacingTop = mxUtils.getValue(style, mxConstants.STYLE_SPACING_TOP, 0);
      const spacingRight = mxUtils.getValue(style, mxConstants.STYLE_SPACING_RIGHT, 0);
      const spacingBottom = mxUtils.getValue(style, mxConstants.STYLE_SPACING_BOTTOM, 0);
      const spacingLeft = mxUtils.getValue(style, mxConstants.STYLE_SPACING_LEFT, 0);
      const horizontal = mxUtils.getValue(style, mxConstants.STYLE_HORIZONTAL, 1) != 0;
      const labelPadding = mxUtils.getValue(style, mxConstants.STYLE_LABEL_PADDING, 0);

      const text = new mxText(
        String(labelValue),
        new mxRectangle(),
        align,
        valign,
        color,
        family,
        size,
        fontStyle,
        spacing,
        spacingTop,
        spacingRight,
        spacingBottom,
        spacingLeft,
        horizontal,
        bg,
        border,
        wrap,
        clip,
        overflow,
        labelPadding,
        dir
      );
      text.opacity = mxUtils.getValue(style, mxConstants.STYLE_TEXT_OPACITY, 100);
      text.dialect =
        style.html == "1" ? mxConstants.DIALECT_STRICTHTML : mxConstants.DIALECT_SVG;
      text.apply(state);
      text.horizontal = horizontal;
      text.scale = view.scale;
      state.text = text;

      // Compute label bounds using mxCellRenderer.prototype.getLabelBounds
      const cellRenderer = new mxCellRenderer();
      text.bounds = cellRenderer.getLabelBounds(state, text);
    }
  }

  return { graph, view };
}

/**
 * Computes the tight bounding box across all visible shapes, edges, and text labels.
 */
function computeGraphBounds(view, model, runtime) {
  const { ctx } = runtime;
  const { mxRectangle } = ctx;
  let totalBounds = null;

  const includeRect = (x, y, w, h) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rect = new mxRectangle(x, y, Math.max(0, w || 0), Math.max(0, h || 0));
    if (totalBounds == null) {
      totalBounds = rect;
    } else {
      totalBounds.add(rect);
    }
  };

  for (const [cell, state] of view.getStatesMap().entries()) {
    const parent = model.getParent(cell);
    if (cell === model.getRoot() || parent === model.getRoot()) continue;

    const sw = Number(state.style?.strokeWidth ?? 1) || 1;
    const shadowPad = state.style?.shadow == "1" ? 6 : 0;
    const pad = Math.ceil(sw / 2) + shadowPad;

    if (model.isEdge(cell)) {
      if (state.absolutePoints != null) {
        const markerPad =
          Math.max(
            Number(state.style?.startSize ?? 6),
            Number(state.style?.endSize ?? 6),
            6
          ) + pad;
        for (const pt of state.absolutePoints) {
          if (pt != null) {
            includeRect(pt.x - markerPad, pt.y - markerPad, markerPad * 2, markerPad * 2);
          }
        }
      }
    } else if (state.shape != null) {
      const bbox = state.shape.getShapeBoundingBox() || state;
      includeRect(
        bbox.x - pad,
        bbox.y - pad,
        bbox.width + pad * 2,
        bbox.height + pad * 2
      );
    }

    // Also include text label bounding box (especially for external labels like verticalLabelPosition=bottom)
    if (state.text != null && state.text.bounds != null && state.text.value) {
      const tb = state.text.bounds;
      const fontSize = Number(state.text.size) || 12;
      const isHtml = state.style?.html == "1" || /<[a-zA-Z!/]/.test(String(state.text.value));
      const parsed = parseRichTextLines(
        String(state.text.value),
        {
          fontSize,
          fontFamily: state.text.family,
          fontColor: state.text.color,
          fontStyle: state.text.fontStyle || 0,
        },
        isHtml
      );
      const wrapped = wrapRichTextLines(parsed, tb.width, Boolean(state.text.wrap) && tb.width > 0);
      const { maxWidth, totalHeight } = computeLinesMetrics(wrapped, fontSize, 1.2);

      const align = state.text.align || "center";
      const valign = state.text.valign || "middle";
      let lx = tb.x;
      if (align === "center") lx -= maxWidth / 2;
      else if (align === "right") lx -= maxWidth;

      let ly = tb.y;
      if (valign === "middle") ly -= totalHeight / 2;
      else if (valign === "bottom") ly -= totalHeight;

      includeRect(lx - 4, ly - 4, maxWidth + 8, totalHeight + 8);
    }
  }

  return totalBounds || new mxRectangle(0, 0, 100, 100);
}

/**
 * Renders a single `<mxGraphModel>` XmlNode into a standalone SVG string and metadata.
 */
export function renderGraphModelToSvg(
  modelNode,
  {
    scale = 1,
    border = 10,
    background = "#ffffff",
    transparent = false,
    theme = "light",
    embedXml = false,
    fullXml = null,
    pageId = "page-1",
    pageName = "Page-1",
    pageIndex = 0,
    pageCount = 1,
  } = {}
) {
  const runtime = getDrawioOssRuntime();
  const isDark = theme === "dark";
  const baseStyles = isDark ? runtime.darkStyles : runtime.lightStyles;
  const themeOptions = isDark
    ? {
        defaultFill: "#18141d",
        defaultStroke: "#f0f0f0",
        defaultFont: "#f0f0f0",
        isDark: true,
      }
    : {
        defaultFill: "#ffffff",
        defaultStroke: "#000000",
        defaultFont: "#000000",
        isDark: false,
      };

  const globalShadow = modelNode.getAttribute("shadow") === "1";
  const modelBg = modelNode.getAttribute("background");
  const effectiveBg = transparent
    ? null
    : background !== undefined
      ? background === "none"
        ? null
        : background
      : modelBg && modelBg !== "none"
        ? modelBg
        : isDark
          ? "#18141d"
          : "#ffffff";

  const { model } = decodeGraphModel(modelNode, runtime, {
    pageId,
    pageName,
    pageIndex,
    pageCount,
  });

  const { view } = createHeadlessGraphAndView(
    model,
    baseStyles,
    themeOptions,
    runtime,
    globalShadow
  );
  view.validate();

  const bounds = computeGraphBounds(view, model, runtime);
  const numScale = Math.max(0.1, Number(scale) || 1);
  const numBorder = Math.max(0, Number(border) || 0);

  const svgWidth = Math.max(1, Math.ceil(bounds.width * numScale + numBorder * 2));
  const svgHeight = Math.max(1, Math.ceil(bounds.height * numScale + numBorder * 2));

  const svgDoc = new XmlNode(9, "#document", null);
  svgDoc.ownerDocument = svgDoc;

  const svgRoot = new XmlNode(1, "svg", svgDoc);
  svgRoot.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svgRoot.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  svgRoot.setAttribute("version", "1.1");
  svgRoot.setAttribute("width", `${svgWidth}px`);
  svgRoot.setAttribute("height", `${svgHeight}px`);
  svgRoot.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  if (embedXml && fullXml) {
    svgRoot.setAttribute("content", fullXml);
  }
  svgDoc.appendChild(svgRoot);

  const defsNode = new XmlNode(1, "defs", svgDoc);
  svgRoot.appendChild(defsNode);

  if (effectiveBg) {
    const bgRect = new XmlNode(1, "rect", svgDoc);
    bgRect.setAttribute("x", "0");
    bgRect.setAttribute("y", "0");
    bgRect.setAttribute("width", "100%");
    bgRect.setAttribute("height", "100%");
    bgRect.setAttribute("fill", effectiveBg);
    svgRoot.appendChild(bgRect);
  }

  const mainGroup = new XmlNode(1, "g", svgDoc);
  svgRoot.appendChild(mainGroup);

  const svgCanvas = runtime.createSvgCanvas(mainGroup, defsNode, themeOptions);
  svgCanvas.translate(
    numBorder / numScale - bounds.x,
    numBorder / numScale - bounds.y
  );
  svgCanvas.scale(numScale);

  // Paint all cell states recursively in model hierarchy order (matching mxImageExport.prototype.drawState)
  const paintStateRecursive = (cell) => {
    const state = view.getState(cell);
    if (state != null) {
      if (state.shape != null && state.shape.checkBounds()) {
        const savedRoot = svgCanvas.root;
        const cellGroup = new XmlNode(1, "g", svgDoc);
        savedRoot.appendChild(cellGroup);
        svgCanvas.root = cellGroup;
        state.shape.node = cellGroup;

        svgCanvas.save();
        state.shape.beforePaint(svgCanvas);
        state.shape.paint(svgCanvas);
        state.shape.afterPaint(svgCanvas);
        svgCanvas.restore();

        svgCanvas.root = savedRoot;
      }

      if (state.text != null && state.text.checkBounds()) {
        const savedRoot = svgCanvas.root;
        const textGroup = new XmlNode(1, "g", svgDoc);
        savedRoot.appendChild(textGroup);
        svgCanvas.root = textGroup;
        state.text.node = textGroup;

        svgCanvas.save();
        state.text.beforePaint(svgCanvas);
        state.text.paint(svgCanvas);
        state.text.afterPaint(svgCanvas);
        svgCanvas.restore();

        svgCanvas.root = savedRoot;
      }
    }

    const childCount = model.getChildCount(cell);
    for (let i = 0; i < childCount; i++) {
      paintStateRecursive(model.getChildAt(cell, i));
    }
  };

  paintStateRecursive(model.getRoot());

  const svgString =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    serializeXml(svgRoot);

  return {
    svg: svgString,
    width: svgWidth,
    height: svgHeight,
    bounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    },
    pageId,
    pageName,
    pageIndex,
    pageCount,
  };
}
