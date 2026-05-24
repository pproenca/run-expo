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
    throws(fn: () => unknown, expected?: RegExp | object, message?: string): void;
    rejects(fn: () => unknown | Promise<unknown>, expected?: RegExp | object, message?: string): Promise<void>;
  };
  export default assert;
}

declare module "node:fs/promises" {
  export function access(path: string): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function stat(path: string): Promise<{ isDirectory(): boolean }>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: string[],
    options: { timeout?: number; maxBuffer?: number },
    callback: (error: { message: string; code?: string | number; signal?: string | null } | null, stdout: string, stderr: string) => void,
  ): void;
}
