import { describe, expect, it } from "vitest"
import { detectPackageManager } from "./detect-package-manager.js"
import { validateName } from "./validate-name.js"

describe("CLI integration smoke", () => {
  // Real spawn-based CLI tests will land in Tasks 32-33 once we have template + install logic.
  // For now, verify the building blocks are wired up and exporting correctly.

  it("validateName is callable", () => {
    expect(typeof validateName).toBe("function")
    expect(validateName("ok-name").ok).toBe(true)
  })

  it("detectPackageManager is callable", () => {
    expect(typeof detectPackageManager).toBe("function")
    expect(detectPackageManager("npm/10.0.0")).toBe("npm")
  })
})
