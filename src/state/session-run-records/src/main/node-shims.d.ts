declare const process: {
  cwd(): string;
};

declare module "node:fs/promises" {
  export type Dirent = {
    name: string;
    isDirectory(): boolean;
  };

  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  export function rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  export function stat(path: string): Promise<{ isDirectory(): boolean }>;
  export function writeFile(path: string, data: string, encoding?: "utf8"): Promise<void>;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}
