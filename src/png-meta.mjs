/**
 * Pure Node.js (.mjs) PNG metadata chunk writer & reader for draw.io XML embedding.
 * Direct port of draw.io OSS `writePngWithText` and `readPngXml` (from drawio-desktop/src/main/electron.js
 * and drawio/src/main/webapp/js/diagramly/Editor.js).
 */
import zlib from "node:zlib";

const PNG_MAGIC_1 = 0x89504e47;
const PNG_MAGIC_2 = 0x0d0a1a0a;
const PNG_CHUNK_IDAT = 0x49444154; // "IDAT"
const PNG_CHUNK_IEND = 0x49454e44; // "IEND"

// Precompute IEEE 802.3 CRC-32 lookup table (matches crc.crcjam used in draw.io OSS)
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crcJam(bufOrStr, crc = 0xffffffff) {
  const buf = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(bufOrStr, "latin1");
  let c = crc >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

export function isPngBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  return buf.readUInt32BE(0) === PNG_MAGIC_1 && buf.readUInt32BE(4) === PNG_MAGIC_2;
}

/**
 * Port of draw.io OSS `writePngWithText(origBuff, key, text, compressed, base64encoded)`
 * Inserts a `zTXt` (compressed), `tEXt` (uncompressed), or `pHYs` (when key === 'dpi')
 * chunk right before the first `IDAT` chunk of a PNG buffer.
 */
export function writePngWithText(
  origBuff,
  key,
  text,
  compressed = false,
  base64encoded = false
) {
  const isDpi = key === "dpi";
  let inOffset = 0;
  let outOffset = 0;
  let data = isDpi ? String(text) : Buffer.from(String(text), "utf8");
  let dataLen = isDpi ? 9 : Buffer.byteLength(key, "latin1") + data.length + 1;

  if (compressed && !isDpi) {
    data = zlib.deflateRawSync(encodeURIComponent(String(text)));
    dataLen = Buffer.byteLength(key, "latin1") + data.length + 2;
  }

  const outBuff = Buffer.allocUnsafe(origBuff.length + dataLen + 12);

  const magic1 = origBuff.readUInt32BE(inOffset);
  inOffset += 4;
  const magic2 = origBuff.readUInt32BE(inOffset);
  inOffset += 4;

  if (magic1 !== PNG_MAGIC_1 || magic2 !== PNG_MAGIC_2) {
    throw new Error("Invalid PNG header (PNGImageDecoder0)");
  }

  outBuff.writeUInt32BE(magic1, outOffset);
  outOffset += 4;
  outBuff.writeUInt32BE(magic2, outOffset);
  outOffset += 4;

  while (inOffset < origBuff.length) {
    const length = origBuff.readInt32BE(inOffset);
    inOffset += 4;
    const type = origBuff.readUInt32BE(inOffset);
    inOffset += 4;

    if (type === PNG_CHUNK_IDAT) {
      // Insert custom chunk before first IDAT chunk
      outBuff.writeInt32BE(dataLen, outOffset);
      outOffset += 4;

      const typeSignature = isDpi ? "pHYs" : compressed ? "zTXt" : "tEXt";
      const chunkStart = outOffset;
      outBuff.write(typeSignature, outOffset, 4, "latin1");
      outOffset += 4;

      if (isDpi) {
        // One inch is 0.0254 meters; 3937 dpm is ~100 dpi
        const dpm = Math.round(parseInt(String(text), 10) / 0.0254) || 3937;
        outBuff.writeInt32BE(dpm, outOffset);
        outBuff.writeInt32BE(dpm, outOffset + 4);
        outBuff.writeInt8(1, outOffset + 8);
        outOffset += 9;
      } else {
        outBuff.write(key, outOffset, key.length, "latin1");
        outOffset += key.length;
        outBuff.writeInt8(0, outOffset);
        outOffset += 1;

        if (compressed) {
          outBuff.writeInt8(0, outOffset); // compression method 0 (deflate)
          outOffset += 1;
          data.copy(outBuff, outOffset);
        } else {
          data.copy(outBuff, outOffset);
        }
        outOffset += data.length;
      }

      const crcSlice = outBuff.subarray(chunkStart, outOffset);
      const crcVal = (crcJam(crcSlice) ^ 0xffffffff) >>> 0;
      outBuff.writeUInt32BE(crcVal, outOffset);
      outOffset += 4;

      // Write the IDAT chunk header & remainder of the PNG
      outBuff.writeInt32BE(length, outOffset);
      outOffset += 4;
      outBuff.writeUInt32BE(type, outOffset);
      outOffset += 4;

      origBuff.copy(outBuff, outOffset, inOffset);
      outOffset += origBuff.length - inOffset;

      const finalBuff = outBuff.subarray(0, outOffset);
      return base64encoded ? finalBuff.toString("base64") : finalBuff;
    }

    outBuff.writeInt32BE(length, outOffset);
    outOffset += 4;
    outBuff.writeUInt32BE(type, outOffset);
    outOffset += 4;

    origBuff.copy(outBuff, outOffset, inOffset, inOffset + length + 4);
    inOffset += length + 4;
    outOffset += length + 4;
  }

  return base64encoded ? origBuff.toString("base64") : origBuff;
}

/**
 * Embeds draw.io XML (`mxGraphModel` chunk) and optional DPI (`pHYs` chunk) into a PNG buffer.
 */
export function embedDrawioXmlInPng(
  pngBuffer,
  xml,
  { dpi = null, compressed = true } = {}
) {
  let out = pngBuffer;
  if (dpi != null && Number(dpi) > 0) {
    out = writePngWithText(out, "dpi", String(dpi), false, false);
  }
  if (xml != null && String(xml).length > 0) {
    out = writePngWithText(out, "mxGraphModel", String(xml), compressed, false);
  }
  return out;
}

/**
 * Extracts embedded `mxGraphModel` draw.io XML from a `.drawio.png` buffer.
 * Supports both `zTXt` (raw deflate or zlib inflate + URI decode) and `tEXt` chunks.
 */
export function extractDrawioXmlFromPng(pngBuffer) {
  if (!isPngBuffer(pngBuffer)) return null;

  let offset = 8;
  while (offset + 8 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    offset += 4;
    const typeCode = pngBuffer.readUInt32BE(offset);
    const typeStr = pngBuffer.toString("latin1", offset, offset + 4);
    offset += 4;

    if (offset + length > pngBuffer.length) break;

    if (typeStr === "tEXt" || typeStr === "zTXt" || typeStr === "iTXt") {
      const chunkData = pngBuffer.subarray(offset, offset + length);
      const zeroIdx = chunkData.indexOf(0);
      if (zeroIdx > 0) {
        const key = chunkData.toString("latin1", 0, zeroIdx);
        if (key === "mxGraphModel" || key === "mxfile") {
          if (typeStr === "tEXt") {
            const raw = chunkData.toString("utf8", zeroIdx + 1);
            try {
              return decodeURIComponent(raw);
            } catch {
              return raw;
            }
          } else if (typeStr === "zTXt") {
            // byte at zeroIdx + 1 is compression method (0)
            const compressedPayload = chunkData.subarray(zeroIdx + 2);
            try {
              const str = zlib.inflateRawSync(compressedPayload).toString("utf8");
              try {
                return decodeURIComponent(str);
              } catch {
                return str;
              }
            } catch {
              try {
                const str = zlib.inflateSync(compressedPayload).toString("utf8");
                try {
                  return decodeURIComponent(str);
                } catch {
                  return str;
                }
              } catch {
                return null;
              }
            }
          }
        }
      }
    }

    if (typeCode === PNG_CHUNK_IEND) break;
    offset += length + 4; // skip chunk data + 4-byte CRC
  }

  return null;
}
