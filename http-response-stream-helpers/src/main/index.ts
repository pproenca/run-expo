import { promises as fs } from "node:fs";

export interface HttpResponseLike {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: unknown): void;
}

export interface RequestLike {
  setEncoding(encoding: "utf8"): void;
  on(event: "data", listener: (chunk: unknown) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  destroy(): void;
}

export interface SendFileDependencies {
  readFile?: (file: string) => Promise<unknown> | unknown;
}

export async function sendFile(
  response: HttpResponseLike,
  file: string,
  contentType: string,
  deps: SendFileDependencies = {},
): Promise<void> {
  const bytes = await (deps.readFile ?? fs.readFile)(file);
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(bytes);
}

export function sendJson(response: HttpResponseLike, payload: unknown, status = 200): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function readRequestBody(request: RequestLike, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
