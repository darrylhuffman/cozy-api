import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { detectPackageManager } from "./detect-package-manager.js"

describe("detectPackageManager", () => {
  it("detects pnpm", () => {
    expect(detectPackageManager("pnpm/8.15.0 npm/? node/v20.10.0")).toBe("pnpm")
  })

  it("detects yarn", () => {
    expect(detectPackageManager("yarn/4.0.2 npm/? node/v20.10.0")).toBe("yarn")
  })

  it("detects bun", () => {
    expect(detectPackageManager("bun/1.0.20")).toBe("bun")
  })

  it("detects npm", () => {
    expect(detectPackageManager("npm/10.2.0 node/v20.10.0 linux x64")).toBe("npm")
  })

  describe("when npm_config_user_agent is absent", () => {
    let savedAgent: string | undefined

    beforeEach(() => {
      savedAgent = process.env["npm_config_user_agent"]
      delete process.env["npm_config_user_agent"]
    })

    afterEach(() => {
      if (savedAgent !== undefined) {
        process.env["npm_config_user_agent"] = savedAgent
      }
    })

    it("defaults to npm when user agent is missing", () => {
      expect(detectPackageManager(undefined)).toBe("npm")
    })
  })

  it("defaults to npm when user agent is unrecognized", () => {
    expect(detectPackageManager("yarn-classic-fork/0.0.1")).toBe("npm") // doesn't start with yarn/
  })
})
