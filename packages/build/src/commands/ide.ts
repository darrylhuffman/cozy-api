import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import type { Command } from "commander";

export interface IdeOptions {
  port?: number;
  open?: boolean;
}

export function registerIde(program: Command): void {
  program
    .command("ide")
    .description("Open the lorien IDE in your browser")
    .option("--port <number>", "port for the static server", "3737")
    .option("--no-open", "do not open the browser automatically")
    .action(async (opts: IdeOptions) => {
      await runIde(opts);
    });
}

export async function runIde(
  opts: IdeOptions,
): Promise<{ port: number; root: string }> {
  const root = await resolveIdeDistRoot();
  const port =
    typeof opts.port === "string"
      ? parseInt(opts.port, 10)
      : (opts.port ?? 3737);

  const app = new Hono();
  app.use(
    "/*",
    serveStatic({
      root,
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    }),
  );

  // SPA fallback for client-side routes
  app.get("*", serveStatic({ root, path: "index.html" }));

  return new Promise((resolveStarted) => {
    serve({ fetch: app.fetch, port }, ({ port: actualPort }) => {
      const url = `http://localhost:${actualPort}`;
      console.log(`lorien IDE running at ${url}`);
      if (opts.open !== false) {
        openBrowser(url).catch((err: Error) => {
          console.error(`Could not open browser automatically: ${err.message}`);
          console.error(`Open ${url} manually.`);
        });
      }
      resolveStarted({ port: actualPort, root });
    });
  });
}

async function resolveIdeDistRoot(): Promise<string> {
  // Resolve @darrylondil/lorien-ide's package root, then return its dist/
  const require_ = createRequire(import.meta.url);
  try {
    const pkgJsonPath = require_.resolve(
      "@darrylondil/lorien-ide/package.json",
    );
    const pkgRoot = dirname(pkgJsonPath);
    const distPath = join(pkgRoot, "dist");
    if (!(await dirExists(distPath))) {
      throw new Error(
        `@darrylondil/lorien-ide's dist/ folder is missing at ${distPath}. Run \`pnpm --filter @darrylondil/lorien-ide build\` first.`,
      );
    }
    return distPath;
  } catch (e) {
    throw new Error(
      `Could not locate @darrylondil/lorien-ide. Ensure it's installed as a dependency. Original error: ${(e as Error).message}`,
    );
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  return new Promise((resolveSpawn, rejectSpawn) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", rejectSpawn);
    child.unref();
    setTimeout(() => resolveSpawn(), 100);
  });
}
