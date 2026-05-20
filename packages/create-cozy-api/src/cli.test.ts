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

describe("install command names", () => {
  // Re-test the install commands here so failures point at the install module
  it("matches expected commands per pm", async () => {
    const { installCommand } = await import("./install.js")
    expect(installCommand("npm").cmd).toBe("npm")
    expect(installCommand("pnpm").cmd).toBe("pnpm")
    expect(installCommand("yarn").cmd).toBe("yarn")
    expect(installCommand("bun").cmd).toBe("bun")
  })
})
