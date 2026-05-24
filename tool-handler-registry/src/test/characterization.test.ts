import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HANDLER_IMPLEMENTATION_SOURCES,
  TOOL_HANDLER_BINDINGS,
  bindHandlers,
  handlerImplementationSourceBySymbol,
  handlerImplementationSources,
  handlerSymbolByTool,
  handlerSymbols,
  handlerSourcesByPackage,
  toolNames,
  toolsForHandlerSymbol,
} from "../main/index.js";
import type { ToolHandler } from "../main/index.js";

describe("tool-handler-registry legacy characterization", () => {
  it("preserves the bundled handler registry order and size", () => {
    assert.equal(TOOL_HANDLER_BINDINGS.length, 64);
    assert.deepEqual(TOOL_HANDLER_BINDINGS.slice(0, 8), [
      ["doctor", "doctor"],
      ["project_info", "projectInfo"],
      ["expo_router_sitemap", "expoRouterSitemap"],
      ["list_devices", "listDevices"],
      ["session", "sessionCommand"],
      ["target", "targetCommand"],
      ["snapshot", "snapshotCommand"],
      ["refs", "refsCommand"],
    ]);
    assert.deepEqual(TOOL_HANDLER_BINDINGS.slice(-8), [
      ["policy", "policyCommand"],
      ["redact", "redactCommand"],
      ["skills", "skillsCommand"],
      ["install", "installCommand"],
      ["upgrade", "upgradeCommand"],
      ["release", "releaseCommand"],
      ["live_backlog", "liveBacklogCommand"],
      ["trace_interaction", "traceInteraction"],
    ]);
  });

  it("preserves command-domain tool to implementation-symbol mappings", () => {
    assert.equal(handlerSymbolByTool("ref_action"), "refActionCommand");
    assert.equal(handlerSymbolByTool("runtime_inspector"), "runtimeInspector");
    assert.equal(handlerSymbolByTool("review_overlay"), "reviewOverlay");
    assert.equal(handlerSymbolByTool("annotation_server"), "annotationServer");
    assert.equal(handlerSymbolByTool("debug_inspect"), "debugInspectCommand");
    assert.equal(handlerSymbolByTool("perf"), "perfCommand");
    assert.equal(handlerSymbolByTool("trace_interaction"), "traceInteraction");
    assert.equal(handlerSymbolByTool("missing"), null);
  });

  it("returns defensive copies for tool and handler symbol lists", () => {
    const tools = toolNames();
    const symbols = handlerSymbols();

    assert.equal(tools.length, 64);
    assert.equal(symbols.length, 64);
    assert.equal(tools[0], "doctor");
    assert.equal(symbols[0], "doctor");
    tools.pop();
    symbols.pop();
    assert.equal(toolNames().length, 64);
    assert.equal(handlerSymbols().length, 64);
  });

  it("can find tools by implementation symbol", () => {
    assert.deepEqual(toolsForHandlerSymbol("refActionCommand"), ["ref_action"]);
    assert.deepEqual(toolsForHandlerSymbol("projectInfo"), ["project_info"]);
    assert.deepEqual(toolsForHandlerSymbol("notAHandler"), []);
  });

  it("maps every handler symbol to one transformed package export", () => {
    const symbols = handlerSymbols();
    const sources = handlerImplementationSources();

    assert.equal(HANDLER_IMPLEMENTATION_SOURCES.length, 64);
    assert.deepEqual(sources.map((item) => item.handlerSymbol), symbols);
    assert.equal(new Set(sources.map((item) => item.handlerSymbol)).size, symbols.length);
    assert.deepEqual(handlerImplementationSourceBySymbol("policyCommand"), {
      handlerSymbol: "policyCommand",
      packageName: "@expo98/policy-redaction",
      exportName: "policyCommand",
    });
    assert.deepEqual(handlerImplementationSourceBySymbol("traceInteraction"), {
      handlerSymbol: "traceInteraction",
      packageName: "@expo98/interaction-trace-expression",
      exportName: "traceInteraction",
    });
    assert.equal(handlerImplementationSourceBySymbol("missing"), null);
    assert.deepEqual(
      handlerSourcesByPackage("@expo98/plugin-self-management").map((item) => item.handlerSymbol),
      ["skillsCommand", "installCommand", "upgradeCommand", "releaseCommand"],
    );

    sources.pop();
    assert.equal(handlerImplementationSources().length, 64);
  });

  it("points handler implementation sources at real package manifests and public exports", async () => {
    const modernizedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

    for (const source of handlerImplementationSources()) {
      const packageDir = source.packageName.replace("@expo98/", "");
      const packageJson = JSON.parse(await readFile(resolve(modernizedRoot, packageDir, "package.json"), "utf8"));
      const publicIndex = await readFile(resolve(modernizedRoot, packageDir, "src", "main", "index.ts"), "utf8");

      assert.equal(packageJson.name, source.packageName, source.handlerSymbol);
      assert.match(publicIndex, new RegExp(`\\b${source.exportName}\\b`), source.handlerSymbol);
    }
  });

  it("binds injected implementations into the legacy tool-keyed registry", async () => {
    const calls: string[] = [];
    const implementations = Object.fromEntries(handlerSymbols().map((symbol) => [
      symbol,
      async (args: Record<string, unknown>) => {
        calls.push(`${symbol}:${args.command ?? ""}`);
        return { symbol, args };
      },
    ])) as Record<string, ToolHandler>;

    const registry = bindHandlers(implementations);

    assert.equal(Object.keys(registry).length, 64);
    assert.equal(registry.project_info, implementations.projectInfo);
    assert.equal(registry.ref_action, implementations.refActionCommand);
    assert.equal(registry.live_backlog, implementations.liveBacklogCommand);
    assert.deepEqual(await registry.project_info({ command: "project-info" }), {
      symbol: "projectInfo",
      args: { command: "project-info" },
    });
    assert.deepEqual(calls, ["projectInfo:project-info"]);
  });

  it("rejects missing implementations with a stable diagnostic", () => {
    assert.throws(
      () => bindHandlers({ doctor: async () => ({ ok: true }) }),
      /Missing handler implementations: projectInfo, expoRouterSitemap, listDevices/,
    );
  });
});
