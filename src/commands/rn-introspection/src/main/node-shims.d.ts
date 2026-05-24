declare module "node:fs/promises" {
  export function readdir(
    path: string,
    options?: { withFileTypes?: boolean },
  ): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare const process: {
  cwd(): string;
};
