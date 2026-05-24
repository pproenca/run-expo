declare module "node:fs" {
  export const promises: {
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
    writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  };
}

declare module "node:path" {
  const path: {
    resolve(path: string): string;
    join(...segments: string[]): string;
    dirname(path: string): string;
  };
  export default path;
}
