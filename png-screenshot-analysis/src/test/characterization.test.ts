import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";

type NodeBuffer = ReturnType<typeof Buffer.from>;

import {
  analyzePngBuffer,
  analyzePngScreenshot,
  averageColor,
  colorDistance,
  compositionStats,
  dominantPalette,
  luminanceStats,
  paeth,
  parsePng,
  pngDimensions,
  pngDimensionsFromBuffer,
  rgbToHex,
  samplePixels,
  unfilterScanline,
} from "../main/index.js";
import type { ParsedPng, PixelSample } from "../main/index.js";

describe("png-screenshot-analysis legacy characterization", () => {
  it("analyzes PNG screenshots into dimensions, appearance, luminance, palette, and composition", () => {
    const png = pngFromRows(3, 3, 2, [
      [255, 255, 255, 255, 0, 0, 255, 0, 0],
      [255, 0, 0, 255, 0, 0, 255, 0, 0],
      [255, 0, 0, 255, 0, 0, 255, 0, 0],
    ]);

    assert.deepEqual(analyzePngBuffer(png), {
      dimensions: { width: 3, height: 3 },
      sampleCount: 9,
      appearanceGuess: "dark",
      luminance: {
        average: 76.5,
        standardDeviation: 63.1,
        p10: 54.2,
        p50: 54.2,
        p90: 255,
      },
      dominantColors: [
        { hex: "#ff0000", rgb: [255, 0, 0], percentage: 0.889 },
        { hex: "#ffffff", rgb: [255, 255, 255], percentage: 0.111 },
      ],
      composition: {
        estimatedBackground: "#ffffff",
        activePixelRatio: 0.889,
        activeContentBounds: {
          x: 0,
          y: 0,
          width: 3,
          height: 3,
          widthRatio: 1,
          heightRatio: 1,
        },
        densityByRegion: {
          "top-left": 0,
          "top-center": 1,
          "top-right": 1,
          "middle-left": 1,
          "middle-center": 1,
          "middle-right": 1,
          "bottom-left": 1,
          "bottom-center": 1,
          "bottom-right": 1,
        },
      },
      designerUse:
        "Use this to detect visual density, dominant palette, contrast risk, empty-state composition, and whether content is concentrated in nav/header/body/tab regions before deeper human review.",
    });
  });

  it("reads PNG dimensions from buffers and files without inflating image data", async () => {
    const buffer = pngFromRows(2, 1, 2, [[0, 0, 0, 255, 255, 255]]);
    assert.deepEqual(pngDimensionsFromBuffer(buffer), { width: 2, height: 1 });
    assert.equal(pngDimensionsFromBuffer(Buffer.from("not a png")), null);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "expo98-png-analysis-"));
    const file = path.join(dir, "fixture.png");
    await fs.writeFile(file, buffer);
    assert.deepEqual(await pngDimensions(file), { width: 2, height: 1 });
    assert.deepEqual(await analyzePngScreenshot(file), analyzePngBuffer(buffer));
  });

  it("parses grayscale, grayscale-alpha, RGB, and RGBA pixels using the legacy channel mapping", () => {
    assert.deepEqual([...parsePng(pngFromRows(1, 1, 0, [[128]])).pixels], [128, 128, 128, 255]);
    assert.deepEqual([...parsePng(pngFromRows(1, 1, 4, [[64, 200]])).pixels], [64, 64, 64, 200]);
    assert.deepEqual([...parsePng(pngFromRows(1, 1, 2, [[1, 2, 3]])).pixels], [1, 2, 3, 255]);
    assert.deepEqual([...parsePng(pngFromRows(1, 1, 6, [[4, 5, 6, 7]])).pixels], [4, 5, 6, 7]);
  });

  it("skips transparent samples and summarizes palette/luminance from sampled opaque pixels", () => {
    const parsed = parsePng(pngFromRows(2, 1, 6, [[1, 2, 3, 0, 200, 210, 220, 255]]));
    const samples = samplePixels(parsed, 6000);

    assert.deepEqual(samples, [{ x: 1, y: 0, r: 200, g: 210, b: 220, luma: 208.596 }]);
    assert.deepEqual(dominantPalette(samples), [{ hex: "#c0e0e0", rgb: [192, 224, 224], percentage: 1 }]);
    assert.deepEqual(luminanceStats(samples), { average: 208.6, standardDeviation: 0, p10: 208.6, p50: 208.6, p90: 208.6 });
  });

  it("preserves scanline unfiltering, Paeth selection, and unsupported filter errors", () => {
    const sub = Buffer.from([10, 5, 4, 4]);
    unfilterScanline(sub, Buffer.alloc(4), 2, 1);
    assert.deepEqual([...sub], [10, 5, 14, 9]);

    const up = Buffer.from([3, 4, 5]);
    unfilterScanline(up, Buffer.from([10, 20, 30]), 1, 2);
    assert.deepEqual([...up], [13, 24, 35]);

    const average = Buffer.from([10, 10, 10]);
    unfilterScanline(average, Buffer.from([10, 20, 30]), 1, 3);
    assert.deepEqual([...average], [15, 27, 38]);

    const paethLine = Buffer.from([10, 10, 10]);
    unfilterScanline(paethLine, Buffer.from([9, 20, 30]), 1, 4);
    assert.deepEqual([...paethLine], [19, 30, 40]);
    assert.equal(paeth(10, 20, 5), 20);
    assert.throws(() => unfilterScanline(Buffer.from([1]), Buffer.from([0]), 1, 9), /Unsupported PNG filter: 9/);
  });

  it("rejects unsupported PNG encodings and non-PNG buffers with legacy messages", () => {
    assert.throws(() => parsePng(Buffer.from("not a png")), /Screenshot is not a PNG file\./);
    assert.throws(() => parsePng(pngFromRows(1, 1, 2, [[0, 0, 0]], { bitDepth: 16 })), /Unsupported PNG bit depth: 16/);
    assert.throws(() => parsePng(pngFromRows(1, 1, 3, [[0]])), /Unsupported PNG color type: 3/);
    assert.throws(() => parsePng(pngFromRows(1, 1, 2, [[0, 0, 0]], { interlace: 1 })), /Interlaced PNG screenshots are not supported\./);
  });

  it("preserves composition and color helper behavior for empty or sparse samples", () => {
    const empty: ParsedPng = { width: 4, height: 4, pixels: Buffer.alloc(4 * 4 * 4) };
    assert.deepEqual(samplePixels(empty, 6000), []);
    assert.deepEqual(averageColor([]), { r: 0, g: 0, b: 0 });
    assert.deepEqual(compositionStats(empty, []), {
      estimatedBackground: "#000000",
      activePixelRatio: 0,
      activeContentBounds: null,
      densityByRegion: {},
    });
    assert.equal(colorDistance({ r: 3, g: 4, b: 0 }, { r: 0, g: 0, b: 0 }), 5);
    assert.equal(rgbToHex(-1, 16, 300), "#0010ff");
  });
});

function pngFromRows(
  width: number,
  height: number,
  colorType: number,
  rows: number[][],
  options: { bitDepth?: number; interlace?: number } = {},
): NodeBuffer {
  const bitDepth = options.bitDepth ?? 8;
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const scanlines = Buffer.concat(rows.map((row) => Buffer.from([0, ...row])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = options.interlace ?? 0;
  assert.equal(rows.length, height);
  for (const row of rows) assert.equal(row.length, width * (channels[colorType] ?? 1));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: NodeBuffer): NodeBuffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}
