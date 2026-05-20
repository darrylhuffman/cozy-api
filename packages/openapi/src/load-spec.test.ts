import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOpenApiSpec, OpenAPIError, validateOpenApi } from "./load-spec.js";

describe("validateOpenApi", () => {
  it("accepts a minimal 3.0 spec with empty paths", () => {
    const spec = validateOpenApi({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
    });
    expect(spec.openapi).toBe("3.0.0");
  });

  it("accepts 3.1", () => {
    expect(() =>
      validateOpenApi({
        openapi: "3.1.0",
        info: { title: "x", version: "1" },
        paths: {},
      }),
    ).not.toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => validateOpenApi("not-an-object")).toThrow(OpenAPIError);
  });

  it("rejects when openapi field is missing", () => {
    expect(() => validateOpenApi({ paths: {} })).toThrow(/openapi/i);
  });

  it("rejects 2.x (Swagger)", () => {
    expect(() => validateOpenApi({ openapi: "2.0", paths: {} })).toThrow(
      /3\.x/,
    );
  });

  it("rejects when paths is missing", () => {
    expect(() => validateOpenApi({ openapi: "3.0.0" })).toThrow(/paths/i);
  });
});

describe("loadOpenApiSpec", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-oas-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a valid spec file", async () => {
    const path = join(dir, "spec.json");
    writeFileSync(
      path,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "t", version: "1" },
        paths: {},
      }),
    );
    const spec = await loadOpenApiSpec(path);
    expect(spec.openapi).toBe("3.0.0");
  });

  it("errors with file context on bad JSON", async () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not json");
    await expect(loadOpenApiSpec(path)).rejects.toThrow(OpenAPIError);
    await expect(loadOpenApiSpec(path)).rejects.toThrow(/Invalid JSON/);
  });

  it("errors with file context when file doesn't exist", async () => {
    await expect(loadOpenApiSpec(join(dir, "missing.json"))).rejects.toThrow(
      OpenAPIError,
    );
    await expect(loadOpenApiSpec(join(dir, "missing.json"))).rejects.toThrow(
      /Failed to read/,
    );
  });
});
