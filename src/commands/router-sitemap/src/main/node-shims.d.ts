declare module "node:fs" {
  export const promises: {
    access(path: string): Promise<void>;
    readdir(path: string, options: { withFileTypes: true }): Promise<Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    stat(path: string): Promise<{ isDirectory(): boolean }>;
  };
}

declare module "node:path" {
  const path: {
    sep: string;
    resolve(...paths: string[]): string;
    join(...paths: string[]): string;
    relative(from: string, to: string): string;
  };
  export default path;
}
