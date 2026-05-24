declare module "node:child_process" {
  export function execFile(
    file: string,
    args: string[],
    options: { timeout?: number },
    callback: (error: unknown, stdout: string, stderr: string) => void,
  ): void;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}
