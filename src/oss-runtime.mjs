/**
 * Pure Node.js (.mjs) runtime for draw.io OSS shapes (772 JS shape classes),
 * stencils (202 XML stencil libraries / 10,000+ shapes), edge styles, perimeters,
 * markers, and SvgCanvas2D (implementing mxAbstractCanvas2D / mxSvgCanvas2D).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { parseXml, XmlNode } from "./xml.mjs";
import { renderTextToSvgNodes } from "./html-text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.resolve(__dirname, "../vendor/drawio-oss");

let cachedRuntime = null;

/**
 * Initializes and returns the singleton draw.io OSS shape & stencil runtime.
 */
export function getDrawioOssRuntime() {
  if (cachedRuntime) return cachedRuntime;

  const shapesBundlePath = path.join(VENDOR_DIR, "drawio-shapes-bundle.js");
  const stencilsMapPath = path.join(VENDOR_DIR, "stencils-map.json");
  const defaultStylePath = path.join(VENDOR_DIR, "default-style.xml");
  const darkStylePath = path.join(VENDOR_DIR, "dark-default-style.xml");

  const shapesCode = fs.readFileSync(shapesBundlePath, "utf8");
  const stencilCompressedMap = JSON.parse(fs.readFileSync(stencilsMapPath, "utf8"));
  const defaultStyleXml = fs.readFileSync(defaultStylePath, "utf8");
  const darkStyleXml = fs.readFileSync(darkStylePath, "utf8");

  const dummyDoc = new XmlNode(9, "#document", null);
  dummyDoc.ownerDocument = dummyDoc;
  dummyDoc.documentMode = 0;
  dummyDoc.compatMode = "CSS1Compat";

  const ctx = {
    console,
    document: dummyDoc,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Date,
    JSON,
    Map,
    Set,
    WeakMap,
    Uint8Array,
    Int32Array,
    Float64Array,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    SHAPES_PATH: "shapes",
    STENCIL_PATH: "stencils",
    STYLE_PATH: "styles",
    mxClient: {
      IS_IE: false,
      IS_IE6: false,
      IS_IE11: false,
      IS_EDGE: false,
      IS_EM: false,
      IS_SVG: true,
      IS_VML: false,
      IS_FF: false,
      IS_SF: false,
      IS_GC: true,
      IS_OT: false,
      NO_FO: true,
    },
    mxResources: {
      get: (k, params, defaultVal) => defaultVal ?? k,
    },
    mxEvent: {
      addListener: () => {},
      removeListener: () => {},
      Menu: () => {},
    },
    mxEventObject: function () {},
    mxEventSource: function () {
      this.fireEvent = () => {};
      this.addListener = () => {};
      this.removeListener = () => {};
    },
    mxUndoableEdit: function (source) {
      this.source = source;
      this.changes = [];
      this.add = (change) => {
        this.changes.push(change);
      };
      this.isEmpty = () => this.changes.length === 0;
      this.notify = () => {};
    },
    mxUrlConverter: function () {
      this.convert = (url) => url;
    },
    Graph: function () {},
    Editor: {
      guid: () => Math.random().toString(36).slice(2, 10),
    },
    __parseXml: parseXml,
    __XmlNode: XmlNode,
    __renderTextToSvgNodes: renderTextToSvgNodes,
    __inflateStencilXml: (key) => {
      const b64 = stencilCompressedMap[key];
      if (!b64) return null;
      return zlib.inflateRawSync(Buffer.from(b64, "base64")).toString("utf8");
    },
  };

  ctx.Graph.prototype = {};
  ctx.Graph.handleFactory = {};
  ctx.Graph.createHandle = () => {};
  ctx.window = ctx;
  ctx.self = ctx;

  vm.createContext(ctx);

  // Define mxUtils with all geometry, XML, color, and math utilities from draw.io OSS
  vm.runInContext(
    `
var mxUtils = {
  extend: function(ctor, superCtor) {
    var f = function() {};
    f.prototype = superCtor.prototype;
    ctor.prototype = new f();
    ctor.prototype.constructor = ctor;
  },
  bind: function(scope, funct) {
    return function() { return funct.apply(scope, arguments); };
  },
  clone: function(obj, transients, shallow) {
    shallow = (shallow != null) ? shallow : false;
    var clone = null;
    if (obj != null && typeof(obj.constructor) == 'function') {
      clone = new obj.constructor();
      for (var i in obj) {
        if (i != mxObjectIdentity.FIELD_NAME && (transients == null || mxUtils.indexOf(transients, i) < 0)) {
          if (!shallow && typeof(obj[i]) == 'object') {
            clone[i] = mxUtils.clone(obj[i]);
          } else {
            clone[i] = obj[i];
          }
        }
      }
    }
    return clone;
  },
  indexOf: function(array, obj) {
    if (array != null && obj != null) {
      for (var i = 0; i < array.length; i++) {
        if (array[i] == obj) return i;
      }
    }
    return -1;
  },
  getValue: function(dict, key, defaultValue) {
    var value = (dict != null) ? dict[key] : null;
    if (value == null) { value = defaultValue; }
    return value;
  },
  getNumber: function(dict, key, defaultValue) {
    var value = (dict != null) ? dict[key] : null;
    if (value == null) { value = defaultValue || 0; }
    return Number(value);
  },
  toRadians: function(deg) { return Math.PI * deg / 180; },
  toDegree: function(rad) { return rad * 180 / Math.PI; },
  mod: function(n, m) { return ((n % m) + m) % m; },
  getRotatedPoint: function(pt, cos, sin, c) {
    c = (c != null) ? c : new mxPoint();
    var x = pt.x - c.x;
    var y = pt.y - c.y;
    var x1 = x * cos - y * sin;
    var y1 = y * cos + x * sin;
    return new mxPoint(x1 + c.x, y1 + c.y);
  },
  getBoundingBox: function(rect, rotation, cx) {
    var result = null;
    if (rect != null && rotation != null && rotation != 0) {
      var rad = mxUtils.toRadians(rotation);
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      cx = (cx != null) ? cx : new mxPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      var p1 = new mxPoint(rect.x, rect.y);
      var p2 = new mxPoint(rect.x + rect.width, rect.y);
      var p3 = new mxPoint(p2.x, rect.y + rect.height);
      var p4 = new mxPoint(rect.x, p3.y);
      p1 = mxUtils.getRotatedPoint(p1, cos, sin, cx);
      p2 = mxUtils.getRotatedPoint(p2, cos, sin, cx);
      p3 = mxUtils.getRotatedPoint(p3, cos, sin, cx);
      p4 = mxUtils.getRotatedPoint(p4, cos, sin, cx);
      result = new mxRectangle(p1.x, p1.y, 0, 0);
      result.add(new mxRectangle(p2.x, p2.y, 0, 0));
      result.add(new mxRectangle(p3.x, p3.y, 0, 0));
      result.add(new mxRectangle(p4.x, p4.y, 0, 0));
    } else if (rect != null) {
      result = rect.clone();
    }
    return result;
  },
  getPortConstraints: function(terminal, edge, source, defaultValue) {
    var value = mxUtils.getValue(edge.style, (source) ? mxConstants.STYLE_SOURCE_PORT_CONSTRAINT :
      mxConstants.STYLE_TARGET_PORT_CONSTRAINT, null);
    if (value == null) {
      value = mxUtils.getValue(terminal.style, mxConstants.STYLE_PORT_CONSTRAINT, null);
    }
    if (value == null) {
      return defaultValue;
    } else {
      var directions = value.toString();
      var returnValue = mxConstants.DIRECTION_MASK_NONE;
      var constraintRotationEnabled = mxUtils.getValue(terminal.style, mxConstants.STYLE_PORT_CONSTRAINT_ROTATION, 0);
      var rotation = 0;
      if (constraintRotationEnabled == 1) {
        rotation = mxUtils.getValue(terminal.style, mxConstants.STYLE_ROTATION, 0);
      }
      var quad = 0;
      if (rotation > 45) {
        quad = 1;
        if (rotation >= 135) {
          quad = 2;
        }
      } else if (rotation < -45) {
        quad = 3;
        if (rotation <= -135) {
          quad = 2;
        }
      }
      if (directions.indexOf(mxConstants.DIRECTION_NORTH) >= 0) {
        switch (quad) {
          case 0: returnValue |= mxConstants.DIRECTION_MASK_NORTH; break;
          case 1: returnValue |= mxConstants.DIRECTION_MASK_EAST; break;
          case 2: returnValue |= mxConstants.DIRECTION_MASK_SOUTH; break;
          case 3: returnValue |= mxConstants.DIRECTION_MASK_WEST; break;
        }
      }
      if (directions.indexOf(mxConstants.DIRECTION_WEST) >= 0) {
        switch (quad) {
          case 0: returnValue |= mxConstants.DIRECTION_MASK_WEST; break;
          case 1: returnValue |= mxConstants.DIRECTION_MASK_NORTH; break;
          case 2: returnValue |= mxConstants.DIRECTION_MASK_EAST; break;
          case 3: returnValue |= mxConstants.DIRECTION_MASK_SOUTH; break;
        }
      }
      if (directions.indexOf(mxConstants.DIRECTION_SOUTH) >= 0) {
        switch (quad) {
          case 0: returnValue |= mxConstants.DIRECTION_MASK_SOUTH; break;
          case 1: returnValue |= mxConstants.DIRECTION_MASK_WEST; break;
          case 2: returnValue |= mxConstants.DIRECTION_MASK_NORTH; break;
          case 3: returnValue |= mxConstants.DIRECTION_MASK_EAST; break;
        }
      }
      if (directions.indexOf(mxConstants.DIRECTION_EAST) >= 0) {
        switch (quad) {
          case 0: returnValue |= mxConstants.DIRECTION_MASK_EAST; break;
          case 1: returnValue |= mxConstants.DIRECTION_MASK_SOUTH; break;
          case 2: returnValue |= mxConstants.DIRECTION_MASK_WEST; break;
          case 3: returnValue |= mxConstants.DIRECTION_MASK_NORTH; break;
        }
      }
      return returnValue;
    }
  },
  reversePortConstraints: function(constraint) {
    var result = 0;
    result = (constraint & mxConstants.DIRECTION_MASK_WEST) << 3;
    result |= (constraint & mxConstants.DIRECTION_MASK_NORTH) << 1;
    result |= (constraint & mxConstants.DIRECTION_MASK_SOUTH) >> 1;
    result |= (constraint & mxConstants.DIRECTION_MASK_EAST) >> 3;
    return result;
  },
  findNearestSegment: function(state, x, y) {
    var index = -1;
    if (state.absolutePoints.length > 0) {
      var last = state.absolutePoints[0];
      var min = null;
      for (var i = 1; i < state.absolutePoints.length; i++) {
        var current = state.absolutePoints[i];
        var dist = mxUtils.ptSegDistSq(last.x, last.y, current.x, current.y, x, y);
        if (min == null || dist < min) {
          min = dist;
          index = i - 1;
        }
        last = current;
      }
    }
    return index;
  },
  ptSegDistSq: function(x1, y1, x2, y2, px, py) {
    x2 -= x1;
    y2 -= y1;
    px -= x1;
    py -= y1;
    var dotprod = px * x2 + py * y2;
    var projlenSq;
    if (dotprod <= 0.0) {
      projlenSq = 0.0;
    } else {
      px = x2 - px;
      py = y2 - py;
      dotprod = px * x2 + py * y2;
      if (dotprod <= 0.0) {
        projlenSq = 0.0;
      } else {
        projlenSq = dotprod * dotprod / (x2 * x2 + y2 * y2);
      }
    }
    var lenSq = px * px + py * py - projlenSq;
    if (lenSq < 0) {
      lenSq = 0;
    }
    return lenSq;
  },
  ptLineDist: function(x1, y1, x2, y2, px, py) {
    return Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) /
      Math.sqrt((y2 - y1) * (y2 - y1) + (x2 - x1) * (x2 - x1));
  },
   relativeCcw: function(x1, y1, x2, y2, px, py) {
    x2 -= x1;
    y2 -= y1;
    px -= x1;
    py -= y1;
    var ccw = px * y2 - py * x2;
    if (ccw == 0.0) {
      ccw = px * x2 + py * y2;
      if (ccw > 0.0) {
        px -= x2;
        py -= y2;
        ccw = px * x2 + py * y2;
        if (ccw < 0.0) {
          ccw = 0.0;
        }
      }
    }
    return (ccw < 0.0) ? -1 : ((ccw > 0.0) ? 1 : 0);
  },
  intersection: function(x0, y0, x1, y1, x2, y2, x3, y3) {
    var denom = ((y3 - y2) * (x1 - x0)) - ((x3 - x2) * (y1 - y0));
    var nume_a = ((x3 - x2) * (y0 - y2)) - ((y3 - y2) * (x0 - x2));
    var nume_b = ((x1 - x0) * (y0 - y2)) - ((y1 - y0) * (x0 - x2));
    var ua = nume_a / denom;
    var ub = nume_b / denom;
    if (ua >= 0.0 && ua <= 1.0 && ub >= 0.0 && ub <= 1.0) {
      var x = x0 + ua * (x1 - x0);
      var y = y0 + ua * (y1 - y0);
      return new mxPoint(x, y);
    }
    return null;
  },
  contains: function(bounds, x, y) {
    return (bounds.x <= x && bounds.x + bounds.width >= x &&
      bounds.y <= y && bounds.y + bounds.height >= y);
  },
  intersects: function(a, b) {
    var tw = a.width;
    var th = a.height;
    var rw = b.width;
    var rh = b.height;
    if (rw <= 0 || rh <= 0 || tw <= 0 || th <= 0) {
      return false;
    }
    var tx = a.x;
    var ty = a.y;
    var rx = b.x;
    var ry = b.y;
    rw += rx;
    rh += ry;
    tw += tx;
    th += ty;
    return ((rw < rx || rw > tx) &&
      (rh < ry || rh > ty) &&
      (tw < tx || tw > rx) &&
      (th < ty || th > ry));
  },
  getAlignmentAsPoint: function(align, valign) {
    var dx = -0.5;
    var dy = -0.5;
    if (align == mxConstants.ALIGN_LEFT) dx = 0;
    else if (align == mxConstants.ALIGN_RIGHT) dx = -1;
    if (valign == mxConstants.ALIGN_TOP) dy = 0;
    else if (valign == mxConstants.ALIGN_BOTTOM) dy = -1;
    return new mxPoint(dx, dy);
  },
  arcToCurves: function(x0, y0, r1, r2, angle, largeArcFlag, sweepFlag, x, y) {
    x -= x0;
    y -= y0;
    if (r1 === 0 || r2 === 0) return [];
    var fS = sweepFlag;
    var psai = angle;
    r1 = Math.abs(r1);
    r2 = Math.abs(r2);
    var ctx = -x / 2;
    var cty = -y / 2;
    var cpsi = Math.cos(psai * Math.PI / 180);
    var spsi = Math.sin(psai * Math.PI / 180);
    var rxd = cpsi * ctx + spsi * cty;
    var ryd = -1 * spsi * ctx + cpsi * cty;
    var rxdd = rxd * rxd;
    var rydd = ryd * ryd;
    var r1x = r1 * r1;
    var r2y = r2 * r2;
    var lamda = rxdd / r1x + rydd / r2y;
    var sds;
    if (lamda > 1) {
      r1 = Math.sqrt(lamda) * r1;
      r2 = Math.sqrt(lamda) * r2;
      sds = 0;
    } else {
      var seif = (largeArcFlag === fS) ? -1 : 1;
      sds = seif * Math.sqrt(Math.max(0, (r1x * r2y - r1x * rydd - r2y * rxdd) / (r1x * rydd + r2y * rxdd)));
    }
    var txd = sds * r1 * ryd / r2;
    var tyd = -1 * sds * r2 * rxd / r1;
    var tx = cpsi * txd - spsi * tyd + x / 2;
    var ty = spsi * txd + cpsi * tyd + y / 2;
    var rad = Math.atan2((ryd - tyd) / r2, (rxd - txd) / r1) - Math.atan2(0, 1);
    var s1 = (rad >= 0) ? rad : 2 * Math.PI + rad;
    rad = Math.atan2((-ryd - tyd) / r2, (-rxd - txd) / r1) - Math.atan2((ryd - tyd) / r2, (rxd - txd) / r1);
    var dr = (rad >= 0) ? rad : 2 * Math.PI + rad;
    if (fS == 0 && dr > 0) dr -= 2 * Math.PI;
    else if (fS != 0 && dr < 0) dr += 2 * Math.PI;
    var sse = dr * 2 / Math.PI;
    var seg = Math.ceil(sse < 0 ? -1 * sse : sse);
    var segr = dr / seg;
    var t = 8 / 3 * Math.sin(segr / 4) * Math.sin(segr / 4) / Math.sin(segr / 2);
    var cpsir1 = cpsi * r1;
    var cpsir2 = cpsi * r2;
    var spsir1 = spsi * r1;
    var spsir2 = spsi * r2;
    var mc = Math.cos(s1);
    var ms = Math.sin(s1);
    var x2 = -t * (cpsir1 * ms + spsir2 * mc);
    var y2 = -t * (spsir1 * ms - cpsir2 * mc);
    var x3 = 0;
    var y3 = 0;
    var result = [];
    for (var n = 0; n < seg; ++n) {
      s1 += segr;
      mc = Math.cos(s1);
      ms = Math.sin(s1);
      x3 = cpsir1 * mc - spsir2 * ms + tx;
      y3 = spsir1 * mc + cpsir2 * ms + ty;
      var dx = -t * (cpsir1 * ms + spsir2 * mc);
      var dy = -t * (spsir1 * ms - cpsir2 * mc);
      var index = n * 6;
      result[index] = Number(x2 + x0);
      result[index + 1] = Number(y2 + y0);
      result[index + 2] = Number(x3 - dx + x0);
      result[index + 3] = Number(y3 - dy + y0);
      result[index + 4] = Number(x3 + x0);
      result[index + 5] = Number(y3 + y0);
      x2 = x3 + dx;
      y2 = y3 + dy;
    }
    return result;
  },
  isNumeric: function(n) {
    return !isNaN(parseFloat(n)) && isFinite(n) && (typeof(n) != 'string' || n.toLowerCase().indexOf('0x') < 0);
  },
  isInteger: function(n) {
    return String(parseInt(n)) === String(n);
  },
  isNaN: function(value) {
    return typeof(value) == 'number' && isNaN(value);
  },
  equalPoints: function(a, b) {
    if ((a == null && b != null) || (a != null && b == null) ||
      (a != null && b != null && a.length != b.length)) {
      return false;
    } else if (a != null && b != null) {
      for (var i = 0; i < a.length; i++) {
        if ((a[i] != null && b[i] == null) ||
          (a[i] == null && b[i] != null) ||
          (a[i] != null && b[i] != null &&
          (a[i].x != b[i].x || a[i].y != b[i].y))) {
          return false;
        }
      }
    }
    return true;
  },
  equalEntries: function(a, b) {
    var count = 0;
    if ((a == null && b != null) || (a != null && b == null) ||
      (a != null && b != null && a.length != b.length)) {
      return false;
    } else if (a != null && b != null) {
      for (var key in b) count++;
      for (var key in a) {
        count--;
        if ((!mxUtils.isNaN(a[key]) || !mxUtils.isNaN(b[key])) && a[key] != b[key]) {
          return false;
        }
      }
    }
    return count == 0;
  },
  getDirectedBounds: function(rect, m, style, flipH, flipV) {
    var d = mxUtils.getValue(style, mxConstants.STYLE_DIRECTION, mxConstants.DIRECTION_EAST);
    flipH = (flipH != null) ? flipH : mxUtils.getValue(style, mxConstants.STYLE_FLIPH, false);
    flipV = (flipV != null) ? flipV : mxUtils.getValue(style, mxConstants.STYLE_FLIPV, false);
    m.x = Math.round(Math.max(0, Math.min(rect.width, m.x)));
    m.y = Math.round(Math.max(0, Math.min(rect.height, m.y)));
    m.width = Math.round(Math.max(0, Math.min(rect.width, m.width)));
    m.height = Math.round(Math.max(0, Math.min(rect.height, m.height)));
    if ((flipV && (d == mxConstants.DIRECTION_SOUTH || d == mxConstants.DIRECTION_NORTH)) ||
      (flipH && (d == mxConstants.DIRECTION_EAST || d == mxConstants.DIRECTION_WEST))) {
      var tmp = m.x; m.x = m.width; m.width = tmp;
    }
    if ((flipH && (d == mxConstants.DIRECTION_SOUTH || d == mxConstants.DIRECTION_NORTH)) ||
      (flipV && (d == mxConstants.DIRECTION_EAST || d == mxConstants.DIRECTION_WEST))) {
      var tmp2 = m.y; m.y = m.height; m.height = tmp2;
    }
    var m2 = mxRectangle.fromRectangle(m);
    if (d == mxConstants.DIRECTION_SOUTH) {
      m2.y = m.x;
      m2.x = m.height;
      m2.width = m.y;
      m2.height = m.width;
    } else if (d == mxConstants.DIRECTION_WEST) {
      m2.y = m.height;
      m2.x = m.width;
      m2.width = m.x;
      m2.height = m.y;
    } else if (d == mxConstants.DIRECTION_NORTH) {
      m2.y = m.width;
      m2.x = m.y;
      m2.width = m.height;
      m2.height = m.x;
    }
    return new mxRectangle(rect.x + m2.x, rect.y + m2.y, rect.width - m2.width - m2.x, rect.height - m2.height - m2.y);
  },
  getPerimeterPoint: function(pts, center, point) {
    var min = null;
    for (var i = 0; i < pts.length - 1; i++) {
      var pt = mxUtils.intersection(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y,
        center.x, center.y, point.x, point.y);
      if (pt != null) {
        var dx = point.x - pt.x;
        var dy = point.y - pt.y;
        var ip = { p: pt, distSq: dy * dy + dx * dx };
        if (ip != null && (min == null || min.distSq > ip.distSq)) {
          min = ip;
        }
      }
    }
    return (min != null) ? min.p : null;
  },
  rectangleIntersectsSegment: function(bounds, p1, p2) {
    var top = bounds.y;
    var left = bounds.x;
    var bottom = top + bounds.height;
    var right = left + bounds.width;
    var minX = p1.x;
    var maxX = p2.x;
    if (p1.x > p2.x) { minX = p2.x; maxX = p1.x; }
    if (maxX > right) maxX = right;
    if (minX < left) minX = left;
    if (minX > maxX) return false;
    var minY = p1.y;
    var maxY = p2.y;
    var dx = p2.x - p1.x;
    if (Math.abs(dx) > 0.0000001) {
      var a = (p2.y - p1.y) / dx;
      var b = p1.y - a * p1.x;
      minY = a * minX + b;
      maxY = a * maxX + b;
    }
    if (minY > maxY) { var tmp = maxY; maxY = minY; minY = tmp; }
    if (maxY > bottom) maxY = bottom;
    if (minY < top) minY = top;
    if (minY > maxY) return false;
    return true;
  },
  getColorValue: function(array, key, defaultValue) {
    var value = (array != null) ? array[key] : null;
    if (value == null || value == 'default') value = defaultValue;
    return value;
  },
  parseColorList: function(colorString) {
    if (!colorString) return [];
    var tokenizer = /var\\([^)]+\\)|light-dark\\([^)]+\\)|(?:rgba?|hsla?|hwb|lab|lch|color)\\([^)]+\\)|#[0-9a-f]{3,8}|[a-z-]+/gi;
    var matches = String(colorString).match(tokenizer);
    return matches || (String(colorString).trim() ? [String(colorString).trim()] : []);
  },
  getSizeForString: function(text, fontSize) {
    fontSize = parseFloat(fontSize) || 12;
    var lines = String(text || '').split('\\n');
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) {
      maxW = Math.max(maxW, lines[i].length * fontSize * 0.6);
    }
    return new mxRectangle(0, 0, maxW, lines.length * fontSize * 1.2);
  },
  isValidColor: function(str) {
    if (str == null || typeof str !== 'string') return false;
    var s = str.trim().toLowerCase();
    if (s === '' || s === 'none' || s === 'default' || s === 'swimlane' || s === 'inherit') return false;
    return s.startsWith('#') || s.startsWith('rgb') || s.startsWith('hsl') || s.startsWith('light-dark') || /^[a-z]+$/.test(s);
  },
  getLightDarkColor: function(color) {
    if (color == null || color === 'none') return { light: 'none', dark: 'none', cssText: 'none' };
    var str = String(color).trim();
    var m = str.match(/^light-dark\\(([^,]+),\\s*([^)]+)\\)$/i);
    if (m) {
      return { light: m[1].trim(), dark: m[2].trim(), cssText: m[1].trim() };
    }
    return { light: str, dark: str, cssText: str };
  },
  parseCssFontFamily: function(family) {
    return family || 'Helvetica, Arial, sans-serif';
  },
  parseXml: function(xmlStr) {
    return __parseXml(xmlStr);
  },
  getChildNodes: function(node) {
    return (node && node.childNodes) ? node.childNodes.filter(function(c) { return c.nodeType === 1; }) : [];
  },
  getTextContent: function(node) {
    return (node != null) ? (node.textContent || '') : '';
  },
  isNode: function(obj) {
    return obj != null && typeof obj === 'object' && typeof obj.nodeType === 'number';
  },
  htmlEntities: function(s) {
    return String(s || '');
  },
  replaceTrailingNewlines: function(s, r) {
    return String(s || '');
  },
  trim: function(s) {
    return String(s || '').trim();
  },
  write: function(parent, text) {
    var doc = parent.ownerDocument || dummyDoc;
    parent.appendChild(doc.createTextNode(text));
  }
};
`,
    ctx
  );

  // Load all 772 draw.io shape classes, mxEdgeStyle, mxPerimeter, mxMarker, mxStencil, mxCellRenderer
  vm.runInContext(shapesCode, ctx, { filename: "drawio-shapes-bundle.js" });

  // Configure mxStencilRegistry with all library mappings and lazy inflate from stencils-map.json
  vm.runInContext(
    `
mxStencilRegistry.dynamicLoading = true;
mxStencilRegistry.allowEval = false;
mxStencilRegistry.packages = {};
mxStencilRegistry.libraries = {
  "android": ["android/android.xml"],
  "atlassian": ["atlassian.xml"],
  "aws3d": ["aws3d.xml"],
  "aws4": ["aws4.xml"],
  "aws4b": ["aws4.xml"],
  "basic": ["basic.xml"],
  "bootstrap": ["bootstrap.xml"],
  "bpmn": ["bpmn.xml"],
  "bpmn2": ["bpmn.xml"],
  "cabinets": ["cabinets.xml"],
  "cisco19": ["cisco19.xml"],
  "cisco_safe": [
    "cisco_safe/architecture.xml",
    "cisco_safe/business_icons.xml",
    "cisco_safe/capability.xml",
    "cisco_safe/design.xml",
    "cisco_safe/iot_things_icons.xml",
    "cisco_safe/people_places_things_icons.xml",
    "cisco_safe/security_icons.xml",
    "cisco_safe/technology_icons.xml",
    "cisco_safe/threat.xml"
  ],
  "eip": ["eip.xml"],
  "electrical/abstract": ["electrical/abstract.xml"],
  "electrical/logic_gates": ["electrical/logic_gates.xml"],
  "electrical/miscellaneous": ["electrical/miscellaneous.xml"],
  "electrical/signal_sources": ["electrical/signal_sources.xml"],
  "electrical/electro-mechanical": ["electrical/electro-mechanical.xml"],
  "electrical/transmission": ["electrical/transmission.xml"],
  "floorplan": ["floorplan.xml"],
  "flowchart": ["flowchart.xml"],
  "gcp2": ["gcp2.xml"],
  "gmdl": ["gmdl.xml"],
  "ibm": ["ibm.xml"],
  "ibmcloud": ["ibm_cloud.xml"],
  "ios7icons": ["ios7/icons.xml"],
  "ios7ui": ["ios7/misc.xml"],
  "kubernetes": ["kubernetes.xml", "kubernetes2.xml"],
  "lean_mapping": ["lean_mapping.xml"],
  "mockup/graphics": ["mockup/misc.xml"],
  "mockup/misc": ["mockup/misc.xml"],
  "mockup/navigation": ["mockup/misc.xml"],
  "networks": ["networks.xml"],
  "networks2": ["networks2.xml"],
  "pid2misc": ["pid/misc.xml"],
  "pidFlowSensors": ["pid/flow_sensors.xml"],
  "rackGeneral": ["rack/general.xml"],
  "rackF5": ["rack/f5.xml"],
  "salesforce": ["salesforce.xml"],
  "sap": ["sap.xml"],
  "veeam": ["veeam/2d.xml", "veeam/3d.xml", "veeam/veeam.xml"],
  "veeam2": ["veeam/2d.xml", "veeam/3d.xml", "veeam/veeam2.xml"]
};

mxStencilRegistry.getBasenameForStencil = function(name) {
  var tmp = null;
  if (name != null && typeof name === 'string') {
    var parts = name.split('.');
    if (parts.length > 0 && parts[0] === 'mxgraph') {
      tmp = parts[1];
      for (var i = 2; i < parts.length - 1; i++) {
        tmp += '/' + parts[i];
      }
    }
  }
  return tmp;
};

mxStencilRegistry.parseStencilSet = function(root) {
  if (!root) return;
  if (root.nodeName == 'stencils') {
    var shapes = root.firstChild;
    while (shapes != null) {
      if (shapes.nodeName == 'shapes') {
        mxStencilRegistry.parseStencilSet(shapes);
      }
      shapes = shapes.nextSibling;
    }
  } else {
    var shape = root.firstChild;
    var packageName = '';
    var name = root.getAttribute('name');
    if (name != null) {
      packageName = name.toLowerCase() + '.';
    }
    while (shape != null) {
      if (shape.nodeType == mxConstants.NODETYPE_ELEMENT) {
        name = shape.getAttribute('name');
        if (name != null) {
          var stencilName = name.replace(/ /g, '_').toLowerCase();
          mxStencilRegistry.addStencil(packageName + stencilName, new mxStencil(shape));
        }
      }
      shape = shape.nextSibling;
    }
  }
};

mxStencilRegistry.loadStencilSetByKey = function(xmlKey) {
  if (mxStencilRegistry.packages[xmlKey]) return;
  mxStencilRegistry.packages[xmlKey] = true;
  var xmlStr = __inflateStencilXml(xmlKey);
  if (xmlStr != null) {
    var doc = __parseXml(xmlStr);
    if (doc && doc.documentElement) {
      mxStencilRegistry.parseStencilSet(doc.documentElement);
    }
  }
};

mxStencilRegistry.getStencil = function(name) {
  if (!name || typeof name !== 'string') return null;
  var key = name.toLowerCase();
  var result = mxStencilRegistry.stencils[name] || mxStencilRegistry.stencils[key];
  if (result == null && mxCellRenderer.defaultShapes[name] == null) {
    var basename = mxStencilRegistry.getBasenameForStencil(name);
    if (basename != null) {
      var libs = mxStencilRegistry.libraries[basename];
      if (libs != null) {
        for (var i = 0; i < libs.length; i++) {
          mxStencilRegistry.loadStencilSetByKey(libs[i]);
        }
      } else {
        var cleanBase = basename.replace('_-_', '_');
        mxStencilRegistry.loadStencilSetByKey(cleanBase + '.xml');
      }
      result = mxStencilRegistry.stencils[name] || mxStencilRegistry.stencils[key];
    }
  }
  return result;
};

// Also support lineShape=1 on stencils just like app.min.js
var origStencilDrawShape = mxStencil.prototype.drawShape;
mxStencil.prototype.drawShape = function(canvas, shape, x, y, w, h, graph) {
  if (shape && shape.style && mxUtils.getValue(shape.style, 'lineShape', null) == '1') {
    canvas.setFillColor(mxUtils.getValue(shape.style, mxConstants.STYLE_STROKECOLOR, '#000000'));
  }
  return origStencilDrawShape.apply(this, arguments);
};

// Also register isometricEdgeStyle just like Shapes.js
mxStyleRegistry.putValue('elbowEdgeStyle', mxEdgeStyle.ElbowConnector);
mxStyleRegistry.putValue('entityRelationEdgeStyle', mxEdgeStyle.EntityRelation);
mxStyleRegistry.putValue('loopEdgeStyle', mxEdgeStyle.Loop);
mxStyleRegistry.putValue('sideToSideEdgeStyle', mxEdgeStyle.SideToSide);
mxStyleRegistry.putValue('topToBottomEdgeStyle', mxEdgeStyle.TopToBottom);
mxStyleRegistry.putValue('orthogonalEdgeStyle', mxEdgeStyle.OrthConnector);
mxStyleRegistry.putValue('segmentEdgeStyle', mxEdgeStyle.SegmentConnector);

mxStyleRegistry.putValue('ellipsePerimeter', mxPerimeter.EllipsePerimeter);
mxStyleRegistry.putValue('rectanglePerimeter', mxPerimeter.RectanglePerimeter);
mxStyleRegistry.putValue('rhombusPerimeter', mxPerimeter.RhombusPerimeter);
mxStyleRegistry.putValue('trianglePerimeter', mxPerimeter.TrianglePerimeter);
mxStyleRegistry.putValue('hexagonPerimeter', mxPerimeter.HexagonPerimeter);

// Implement SvgCanvas2D extending mxAbstractCanvas2D
function SvgCanvas2D(root, defs, themeOptions) {
  mxAbstractCanvas2D.call(this);
  this.root = root;
  this.defs = defs;
  this.themeOptions = themeOptions || {
    defaultFill: '#ffffff',
    defaultStroke: '#000000',
    defaultFont: '#000000',
    isDark: false
  };
  this.gradients = {};
  this.fillPatterns = {};
  this.refCount = 0;
  this.textEnabled = true;
  this.minStrokeWidth = 1;
  this.imageOffset = 0;
}

mxUtils.extend(SvgCanvas2D, mxAbstractCanvas2D);

SvgCanvas2D.prototype.format = function(value) {
  return parseFloat(parseFloat(value).toFixed(2));
};

SvgCanvas2D.prototype.createElement = function(tagName) {
  var doc = this.root.ownerDocument;
  return new __XmlNode(1, tagName, doc);
};

SvgCanvas2D.prototype.resolveColor = function(color, kind) {
  if (color == null || color === 'none') return null;
  var str = String(color).trim();
  if (str === '' || str === 'none') return null;
  if (str === 'default') {
    if (kind === 'fill') return this.themeOptions.defaultFill;
    if (kind === 'font') return this.themeOptions.defaultFont;
    return this.themeOptions.defaultStroke;
  }
  var ld = mxUtils.getLightDarkColor(str);
  return this.themeOptions.isDark ? ld.dark : ld.light;
};

SvgCanvas2D.prototype.getSvgGradient = function(start, end, alpha1, alpha2, direction) {
  var sColor = this.resolveColor(start, 'fill') || '#ffffff';
  var eColor = this.resolveColor(end, 'fill') || '#ffffff';
  var a1 = (alpha1 != null) ? alpha1 : 1;
  var a2 = (alpha2 != null) ? alpha2 : 1;
  var dir = direction || 'south';
  var key = sColor + '_' + a1 + '_' + eColor + '_' + a2 + '_' + dir;
  if (this.gradients[key]) return this.gradients[key];

  var id = 'mx-grad-' + (++this.refCount);
  var isRadial = (dir == mxConstants.DIRECTION_RADIAL || dir == 'radial');
  var grad = this.createElement(isRadial ? 'radialGradient' : 'linearGradient');
  grad.setAttribute('id', id);

  if (!isRadial) {
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '0%');
    grad.setAttribute('y2', '0%');
    if (dir == mxConstants.DIRECTION_SOUTH || dir == 'south') {
      grad.setAttribute('y2', '100%');
    } else if (dir == mxConstants.DIRECTION_EAST || dir == 'east') {
      grad.setAttribute('x2', '100%');
    } else if (dir == mxConstants.DIRECTION_NORTH || dir == 'north') {
      grad.setAttribute('y1', '100%');
    } else if (dir == mxConstants.DIRECTION_WEST || dir == 'west') {
      grad.setAttribute('x1', '100%');
    }
  }

  var stop1 = this.createElement('stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', sColor);
  if (a1 < 1) stop1.setAttribute('stop-opacity', a1);
  grad.appendChild(stop1);

  var stop2 = this.createElement('stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', eColor);
  if (a2 < 1) stop2.setAttribute('stop-opacity', a2);
  grad.appendChild(stop2);

  if (this.defs) {
    this.defs.appendChild(grad);
  }
  this.gradients[key] = id;
  return id;
};

SvgCanvas2D.prototype.getShadowFilterId = function() {
  if (this.shadowFilterId) return this.shadowFilterId;
  var id = 'mx-drop-shadow';
  this.shadowFilterId = id;
  if (this.defs) {
    var filter = this.createElement('filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '-20%');
    filter.setAttribute('y', '-20%');
    filter.setAttribute('width', '150%');
    filter.setAttribute('height', '150%');

    var feDrop = this.createElement('feDropShadow');
    feDrop.setAttribute('dx', String(mxConstants.SHADOW_OFFSET_X || 2));
    feDrop.setAttribute('dy', String(mxConstants.SHADOW_OFFSET_Y || 3));
    feDrop.setAttribute('stdDeviation', '1.5');
    feDrop.setAttribute('flood-color', mxConstants.SHADOWCOLOR || '#000000');
    feDrop.setAttribute('flood-opacity', String(mxConstants.SHADOW_OPACITY || 0.25));
    filter.appendChild(feDrop);
    this.defs.appendChild(filter);
  }
  return id;
};

SvgCanvas2D.prototype.rotate = function(theta, flipH, flipV, cx, cy) {
  if (theta != 0 || flipH || flipV) {
    var s = this.state;
    cx += s.dx;
    cy += s.dy;
    cx *= s.scale;
    cy *= s.scale;
    s.transform = s.transform || '';

    if (flipH && flipV) {
      theta += 180;
    } else if (flipH != flipV) {
      var tx = (flipH) ? cx : 0;
      var sx = (flipH) ? -1 : 1;
      var ty = (flipV) ? cy : 0;
      var sy = (flipV) ? -1 : 1;
      s.transform += 'translate(' + this.format(tx) + ',' + this.format(ty) + ')' +
        'scale(' + this.format(sx) + ',' + this.format(sy) + ')' +
        'translate(' + this.format(-tx) + ',' + this.format(-ty) + ')';
    }

    if (flipH ? !flipV : flipV) {
      theta *= -1;
    }

    if (theta != 0) {
      s.transform += 'rotate(' + this.format(theta) + ',' + this.format(cx) + ',' + this.format(cy) + ')';
    }

    s.rotation = s.rotation + theta;
    s.rotationCx = cx;
    s.rotationCy = cy;
  }
};

SvgCanvas2D.prototype.begin = function() {
  mxAbstractCanvas2D.prototype.begin.apply(this, arguments);
  this.node = this.createElement('path');
};

SvgCanvas2D.prototype.rect = function(x, y, w, h) {
  var s = this.state;
  var n = this.createElement('rect');
  n.setAttribute('x', this.format((x + s.dx) * s.scale));
  n.setAttribute('y', this.format((y + s.dy) * s.scale));
  n.setAttribute('width', this.format(Math.max(0, w * s.scale)));
  n.setAttribute('height', this.format(Math.max(0, h * s.scale)));
  this.node = n;
};

SvgCanvas2D.prototype.roundrect = function(x, y, w, h, dx, dy) {
  this.rect(x, y, w, h);
  if (dx > 0) {
    this.node.setAttribute('rx', this.format(dx * this.state.scale));
  }
  if (dy > 0) {
    this.node.setAttribute('ry', this.format(dy * this.state.scale));
  }
};

SvgCanvas2D.prototype.ellipse = function(x, y, w, h) {
  var s = this.state;
  var n = this.createElement('ellipse');
  n.setAttribute('cx', this.format((x + w / 2 + s.dx) * s.scale));
  n.setAttribute('cy', this.format((y + h / 2 + s.dy) * s.scale));
  n.setAttribute('rx', this.format(Math.max(0, w / 2 * s.scale)));
  n.setAttribute('ry', this.format(Math.max(0, h / 2 * s.scale)));
  this.node = n;
};

SvgCanvas2D.prototype.image = function(x, y, w, h, src, aspect, flipH, flipV) {
  if (!src) return;
  aspect = (aspect != null) ? aspect : true;
  flipH = (flipH != null) ? flipH : false;
  flipV = (flipV != null) ? flipV : false;
  var s = this.state;
  x += s.dx;
  y += s.dy;
  var node = this.createElement('image');
  node.setAttribute('x', this.format(x * s.scale));
  node.setAttribute('y', this.format(y * s.scale));
  node.setAttribute('width', this.format(Math.max(0, w * s.scale)));
  node.setAttribute('height', this.format(Math.max(0, h * s.scale)));
  node.setAttribute('href', src);
  node.setAttribute('xlink:href', src);
  if (!aspect) {
    node.setAttribute('preserveAspectRatio', 'none');
  }
  if (s.alpha < 1 || s.fillAlpha < 1) {
    node.setAttribute('opacity', s.alpha * s.fillAlpha);
  }
  var tr = this.state.transform || '';
  if (flipH || flipV) {
    var sx = flipH ? -1 : 1;
    var sy = flipV ? -1 : 1;
    var dx = flipH ? -w - 2 * x : 0;
    var dy = flipV ? -h - 2 * y : 0;
    tr += 'scale(' + sx + ',' + sy + ')translate(' + (dx * s.scale) + ',' + (dy * s.scale) + ')';
  }
  if (tr.length > 0) {
    node.setAttribute('transform', tr);
  }
  this.root.appendChild(node);
};

SvgCanvas2D.prototype.text = function(x, y, w, h, str, align, valign, wrap, format, overflow, clip, rotation, dir) {
  if (!this.textEnabled || str == null || str === '') return;
  var s = this.state;
  var self = this;
  var textGroup = __renderTextToSvgNodes({
    doc: this.root.ownerDocument,
    x: x + s.dx,
    y: y + s.dy,
    w: w,
    h: h,
    str: str,
    align: align || 'center',
    valign: valign || 'middle',
    wrap: Boolean(wrap),
    format: format || '',
    overflow: overflow || '',
    clip: Boolean(clip),
    rotation: rotation || 0,
    dir: dir || '',
    canvasState: s,
    resolveColor: function(c) { return self.resolveColor(c, 'font'); }
  });
  if (textGroup != null) {
    this.root.appendChild(textGroup);
  }
};

SvgCanvas2D.prototype.createDashPattern = function(scale) {
  var pat = [];
  if (typeof(this.state.dashPattern) === 'string') {
    var dash = this.state.dashPattern.trim().split(/\\s+/);
    for (var i = 0; i < dash.length; i++) {
      var val = Number(dash[i]);
      if (isFinite(val)) {
        pat.push(Math.round(val * scale * 100) / 100);
      }
    }
  }
  return pat.join(' ');
};

SvgCanvas2D.prototype.addNode = function(filled, stroked) {
  var node = this.node;
  var s = this.state;
  if (node == null) return;

  if (node.nodeName == 'path') {
    if (this.path != null && this.path.length > 0) {
      node.setAttribute('d', this.path.join(' '));
    } else {
      this.node = null;
      return;
    }
  }

  var fillColor = this.resolveColor(s.fillColor, 'fill');
  if (filled && fillColor != null) {
    if (s.alpha < 1 || s.fillAlpha < 1) {
      node.setAttribute('fill-opacity', Number((s.alpha * s.fillAlpha).toFixed(3)));
    }
    var gradColor = this.resolveColor(s.gradientColor, 'fill');
    if (gradColor != null) {
      var gradId = this.getSvgGradient(fillColor, gradColor, s.gradientFillAlpha, s.gradientAlpha, s.gradientDirection);
      node.setAttribute('fill', 'url(#' + gradId + ')');
    } else {
      node.setAttribute('fill', fillColor);
    }
  } else {
    node.setAttribute('fill', 'none');
    filled = false;
  }

  var strokeColor = this.resolveColor(s.strokeColor, 'stroke');
  if (stroked && strokeColor != null) {
    node.setAttribute('stroke', strokeColor);
    if (s.alpha < 1 || s.strokeAlpha < 1) {
      node.setAttribute('stroke-opacity', Number((s.alpha * s.strokeAlpha).toFixed(3)));
    }
    var sw = Math.max(this.minStrokeWidth, Math.max(0.01, this.format(s.strokeWidth * s.scale)));
    if (sw != 1) {
      node.setAttribute('stroke-width', sw);
    }
    if (node.nodeName == 'path') {
      if (s.lineJoin != null && s.lineJoin != 'miter') {
        node.setAttribute('stroke-linejoin', s.lineJoin);
      }
      if (s.lineCap != null) {
        var cap = (s.lineCap == 'flat') ? 'butt' : s.lineCap;
        if (cap != 'butt') {
          node.setAttribute('stroke-linecap', cap);
        }
      }
      if (s.miterLimit != null && s.miterLimit != 10) {
        node.setAttribute('stroke-miterlimit', s.miterLimit);
      }
    }
    if (s.dashed) {
      node.setAttribute('stroke-dasharray', this.createDashPattern(((s.fixDash) ? 1 : s.strokeWidth) * s.scale));
    }
  } else {
    node.setAttribute('stroke', 'none');
    stroked = false;
  }

  if (s.transform != null && s.transform.length > 0) {
    node.setAttribute('transform', s.transform);
  }

  if (s.shadow && (filled || stroked)) {
    node.setAttribute('filter', 'url(#' + this.getShadowFilterId() + ')');
  }

  if (filled || stroked) {
    this.root.appendChild(node);
  }
  this.node = null;
};

SvgCanvas2D.prototype.stroke = function() {
  this.addNode(false, true);
};

SvgCanvas2D.prototype.fill = function() {
  this.addNode(true, false);
};

SvgCanvas2D.prototype.fillAndStroke = function() {
  this.addNode(true, true);
};
`,
    ctx
  );

  // Parse default.xml and dark-default.xml stylesheets
  const lightStyles = parseStylesheetXml(defaultStyleXml);
  const darkStyles = parseStylesheetXml(darkStyleXml);

  cachedRuntime = {
    ctx,
    lightStyles,
    darkStyles,
    createSvgCanvas(rootNode, defsNode, themeOptions) {
      return new ctx.SvgCanvas2D(rootNode, defsNode, themeOptions);
    },
  };

  return cachedRuntime;
}

/**
 * Parses a draw.io `<mxStylesheet>` XML document (`styles/default.xml` or `styles/dark-default.xml`)
 * into a dictionary of named style maps.
 */
function parseStylesheetXml(xmlStr) {
  const doc = parseXml(xmlStr);
  const styles = Object.create(null);
  if (!doc.documentElement) return styles;

  for (const addNode of doc.documentElement.childNodes) {
    if (addNode.nodeType !== 1 || addNode.nodeName !== "add") continue;
    const styleName = addNode.getAttribute("as");
    if (!styleName) continue;
    const extendName = addNode.getAttribute("extend");
    const map = extendName && styles[extendName] ? { ...styles[extendName] } : {};

    for (const prop of addNode.childNodes) {
      if (prop.nodeType !== 1 || prop.nodeName !== "add") continue;
      const key = prop.getAttribute("as");
      const val = prop.getAttribute("value");
      if (key) {
        map[key] = val;
      }
    }
    styles[styleName] = map;
  }
  return styles;
}
