declare module "node:fs" {
  export const promises: {
    readFile(path: string, encoding: "utf8"): Promise<string>;
  };
}

declare module "node:path" {
  const path: {
    resolve(...paths: string[]): string;
  };
  export default path;
}
