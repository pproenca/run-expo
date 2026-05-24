import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as zlib from "node:zlib";

type NodeBuffer = ReturnType<typeof Buffer.from>;

export interface ParsedPng {
  width: number;
  height: number;
  pixels: NodeBuffer;
}

export interface PixelSample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  luma: number;
}

export async function analyzePngScreenshot(file: string): Promise<Record<string, unknown>> {
  return analyzePngBuffer(await fs.readFile(file));
}

export function analyzePngBuffer(buffer: NodeBuffer): Record<string, unknown> {
  const png = parsePng(buffer);
  const samples = samplePixels(png, 6000);
  const palette = dominantPalette(samples);
  const luminance = luminanceStats(samples);
  const composition = compositionStats(png, samples);
  return {
    dimensions: { width: png.width, height: png.height },
    sampleCount: samples.length,
    appearanceGuess: luminance.average < 96 ? "dark" : luminance.average > 180 ? "light" : "mixed",
    luminance,
    dominantColors: palette,
    composition,
    designerUse:
      "Use this to detect visual density, dominant palette, contrast risk, empty-state composition, and whether content is concentrated in nav/header/body/tab regions before deeper human review.",
  };
}

export async function pngDimensions(file: string): Promise<{ width: number; height: number } | null> {
  return pngDimensionsFromBuffer(await fs.readFile(file));
}

export function pngDimensionsFromBuffer(buffer: NodeBuffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function parsePng(buffer: NodeBuffer): ParsedPng {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Screenshot is not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: NodeBuffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  if (interlace !== 0) throw new Error("Interlaced PNG screenshots are not supported.");
  const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type: ${colorType}`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const scanline = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    unfilterScanline(scanline, previous, channels, filter);
    for (let x = 0; x < width; x++) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (colorType === 0) {
        pixels[target] = scanline[source];
        pixels[target + 1] = scanline[source];
        pixels[target + 2] = scanline[source];
        pixels[target + 3] = 255;
      } else if (colorType === 4) {
        pixels[target] = scanline[source];
        pixels[target + 1] = scanline[source];
        pixels[target + 2] = scanline[source];
        pixels[target + 3] = scanline[source + 1];
      } else {
        pixels[target] = scanline[source];
        pixels[target + 1] = scanline[source + 1];
        pixels[target + 2] = scanline[source + 2];
        pixels[target + 3] = colorType === 6 ? scanline[source + 3] : 255;
      }
    }
    previous = scanline;
  }
  return { width, height, pixels };
}

export function unfilterScanline(scanline: NodeBuffer, previous: NodeBuffer, bytesPerPixel: number, filter: number): void {
  for (let i = 0; i < scanline.length; i++) {
    const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] ?? 0 : 0;
    if (filter === 1) scanline[i] = (scanline[i] + left) & 255;
    else if (filter === 2) scanline[i] = (scanline[i] + up) & 255;
    else if (filter === 3) scanline[i] = (scanline[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) scanline[i] = (scanline[i] + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

export function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

export function samplePixels(png: ParsedPng, targetSamples: number): PixelSample[] {
  const step = Math.max(1, Math.floor(Math.sqrt((png.width * png.height) / targetSamples)));
  const samples: PixelSample[] = [];
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const offset = (y * png.width + x) * 4;
      const a = png.pixels[offset + 3];
      if (a < 128) continue;
      const r = png.pixels[offset];
      const g = png.pixels[offset + 1];
      const b = png.pixels[offset + 2];
      samples.push({ x, y, r, g, b, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b });
    }
  }
  return samples;
}

export function dominantPalette(samples: PixelSample[]): Array<{ hex: string; rgb: number[]; percentage: number }> {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const r = Math.round(sample.r / 32) * 32;
    const g = Math.round(sample.g / 32) * 32;
    const b = Math.round(sample.b / 32) * 32;
    const key = `${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [r, g, b] = key.split(",").map(Number);
      return {
        hex: rgbToHex(r, g, b),
        rgb: [r, g, b],
        percentage: Number((count / Math.max(samples.length, 1)).toFixed(3)),
      };
    });
}

export function luminanceStats(samples: PixelSample[]): Record<string, number> {
  const values = samples.map((sample) => sample.luma);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    average: Number(average.toFixed(1)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(1)),
    p10: Number((sorted[Math.floor(sorted.length * 0.1)] ?? 0).toFixed(1)),
    p50: Number((sorted[Math.floor(sorted.length * 0.5)] ?? 0).toFixed(1)),
    p90: Number((sorted[Math.floor(sorted.length * 0.9)] ?? 0).toFixed(1)),
  };
}

export function compositionStats(png: ParsedPng, samples: PixelSample[]): Record<string, unknown> {
  const cornerSamples = samples.filter((sample) =>
    (sample.x < png.width * 0.12 || sample.x > png.width * 0.88) &&
    (sample.y < png.height * 0.12 || sample.y > png.height * 0.88)
  );
  const background = averageColor(cornerSamples.length ? cornerSamples : samples.slice(0, 200));
  const regions: Record<string, { samples: number; active: number }> = {};
  const namesY = ["top", "middle", "bottom"];
  const namesX = ["left", "center", "right"];
  let minX = png.width;
  let minY = png.height;
  let maxX = 0;
  let maxY = 0;
  let active = 0;
  for (const sample of samples) {
    const distance = colorDistance(sample, background);
    const isActive = distance > 36;
    if (isActive) {
      active += 1;
      minX = Math.min(minX, sample.x);
      minY = Math.min(minY, sample.y);
      maxX = Math.max(maxX, sample.x);
      maxY = Math.max(maxY, sample.y);
    }
    const region = `${namesY[Math.min(2, Math.floor((sample.y / png.height) * 3))]}-${namesX[Math.min(2, Math.floor((sample.x / png.width) * 3))]}`;
    const entry = regions[region] ?? { samples: 0, active: 0 };
    entry.samples += 1;
    if (isActive) entry.active += 1;
    regions[region] = entry;
  }
  const densityByRegion = Object.fromEntries(
    Object.entries(regions).map(([region, value]) => [region, Number((value.active / Math.max(value.samples, 1)).toFixed(3))]),
  );
  return {
    estimatedBackground: rgbToHex(background.r, background.g, background.b),
    activePixelRatio: Number((active / Math.max(samples.length, 1)).toFixed(3)),
    activeContentBounds: active
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          widthRatio: Number(((maxX - minX + 1) / png.width).toFixed(3)),
          heightRatio: Number(((maxY - minY + 1) / png.height).toFixed(3)),
        }
      : null,
    densityByRegion,
  };
}

export function averageColor(samples: PixelSample[]): { r: number; g: number; b: number } {
  const total = samples.reduce((acc, sample) => {
    acc.r += sample.r;
    acc.g += sample.g;
    acc.b += sample.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  const count = Math.max(samples.length, 1);
  return {
    r: Math.round(total.r / count),
    g: Math.round(total.g / count),
    b: Math.round(total.b / count),
  };
}

export function colorDistance(sample: Pick<PixelSample, "r" | "g" | "b">, color: { r: number; g: number; b: number }): number {
  return Math.sqrt((sample.r - color.r) ** 2 + (sample.g - color.g) ** 2 + (sample.b - color.b) ** 2);
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}
