import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseWorkflowFromString } from "@darrylondil/lorien-runtime";
import { testWorkflow } from "@darrylondil/lorien-runtime/testing";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBuild } from "../build/run-build.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const basicApiRoot = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "examples",
  "basic-api",
);
const distDir = join(basicApiRoot, "dist-test");

beforeAll(async () => {
  await runBuild({ root: basicApiRoot, outDir: distDir, skipTypes: true });
}, 30000);

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true });
});

describe("equivalence: interpreter == codegen", () => {
  it("POST /users with valid credentials produces identical responses", async () => {
    // --- Load the workflow file & user nodes (shared between both sides) ---
    const wfPath = join(basicApiRoot, "workflows", "users", "create.workflow");
    const wfSource = await readFile(wfPath, "utf-8");
    const workflow = parseWorkflowFromString(wfSource);

    const parseCredentials = (
      await import(
        pathToFileURL(join(basicApiRoot, "nodes", "parse-credentials.ts")).href
      )
    ).default;
    const saveUser = (
      await import(
        pathToFileURL(join(basicApiRoot, "nodes", "save-user.ts")).href
      )
    ).default;

    // Deterministic services so both sides return the same id.
    const services = {
      db: {
        async createUser(email: string) {
          return { id: "equivalence-id", email };
        },
      },
      logger: { info: () => {} },
    };

    const requestBody = { email: "ada@example.com", password: "hunter2" };

    // --- Interpreter side ---
    const interpreterRes = await testWorkflow(workflow, {
      request: { body: requestBody },
      nodes: {
        "./nodes/parse-credentials": parseCredentials,
        "./nodes/save-user": saveUser,
      },
      services,
    });

    // --- Codegen side ---
    // The generated .gen.ts imports `../../../lorien.config.js` and uses
    // its services directly. To keep the two sides comparable, monkey-patch
    // the example's in-memory db so it returns the same id as the interpreter.
    const configMod = await import(
      pathToFileURL(join(basicApiRoot, "lorien.config.ts")).href
    );
    const config = configMod.default as {
      services: {
        db: { createUser: (e: string, p: string) => Promise<unknown> };
      };
    };
    const originalCreateUser = config.services.db.createUser;
    config.services.db.createUser = async (email: string) => ({
      id: "equivalence-id",
      email,
    });

    let codegenRes: Response;
    try {
      const genPath = join(distDir, "workflows", "users", "create.gen.ts");
      const genMod = await import(pathToFileURL(genPath).href);
      const app = new Hono();
      genMod.register(app);
      codegenRes = await app.request("/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } finally {
      config.services.db.createUser = originalCreateUser;
    }

    // --- Assertions ---
    expect(codegenRes.status).toBe(interpreterRes.status);
    const codegenBody = await codegenRes.json();
    expect(codegenBody).toEqual(interpreterRes.body);
    // (Headers diverge by design — interpreter returns a plain object, codegen
    // returns a real Response with hono-injected headers. Skip.)
  });
});
