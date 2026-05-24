declare module "node:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | object | ((error: unknown) => boolean), message?: string): void;
  };
  export default assert;
}

declare module "node:fs/promises" {
  export function access(path: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function writeFile(path: string, data: string | Uint8Array, encoding?: "utf8"): Promise<void>;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:child_process" {
  type EventHandler = (...args: any[]) => void;
  type Readable = {
    on(event: string, handler: EventHandler): void;
    setEncoding?(encoding: "utf8"): void;
  };

  export function execFile(
    file: string,
    args: string[],
    options: { timeout?: number; maxBuffer?: number },
    callback: (error: unknown, stdout: unknown, stderr: unknown) => void,
  ): void;
  export function spawn(
    file: string,
    args: string[],
    options: { stdio: ["ignore", "pipe", "pipe"] },
  ): {
    stdout: Readable;
    stderr: Readable;
    on(event: string, handler: EventHandler): void;
    kill(): void;
  };
}

declare class Buffer extends Uint8Array {
  static concat(chunks: Uint8Array[], totalLength?: number): Buffer;
}

declare function setTimeout(handler: () => void, timeout: number): unknown;
declare function clearTimeout(timeout: unknown): void;
