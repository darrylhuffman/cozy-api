import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  AssistantError,
  AssistantText,
  ToolUseBash,
  ToolUseEdit,
  ToolUseRead,
  UserMessage,
} from "./cards"

afterEach(cleanup)

describe("cards", () => {
  it("AssistantText renders markdown", () => {
    render(<AssistantText text="Hello **world**" />)
    expect(screen.getByText("world").tagName).toBe("STRONG")
  })

  it("UserMessage shows the user's text with a 'You' label", () => {
    render(<UserMessage text="do the thing" />)
    expect(screen.getByText(/do the thing/)).toBeInTheDocument()
    expect(screen.getByText(/You/)).toBeInTheDocument()
  })

  it("ToolUseRead shows the file path", () => {
    render(<ToolUseRead path="nodes/users/save-user.ts" />)
    expect(screen.getByText("nodes/users/save-user.ts")).toBeInTheDocument()
  })

  it("ToolUseEdit shows the path and opens the diff", () => {
    render(<ToolUseEdit path="nodes/save-user.ts" before={"a\nb"} after="c" />)
    expect(screen.getByText("nodes/save-user.ts")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /view diff/i }))
    const diff = screen.getByTestId("edit-diff")
    expect(diff.textContent).toContain("- a")
    expect(diff.textContent).toContain("- b")
    expect(diff.textContent).toContain("+ c")
    fireEvent.click(screen.getByRole("button", { name: /hide diff/i }))
    expect(screen.queryByTestId("edit-diff")).toBeNull()
  })

  it("ToolUseEdit has no diff button without before/after text", () => {
    render(<ToolUseEdit path="nodes/save-user.ts" />)
    expect(screen.queryByRole("button", { name: /view diff/i })).toBeNull()
  })

  it("ToolUseBash shows the command", () => {
    render(<ToolUseBash command="pnpm test" />)
    expect(screen.getByText(/pnpm test/)).toBeInTheDocument()
  })

  it("AssistantError shows the message", () => {
    render(<AssistantError message="Claude CLI not installed" />)
    expect(screen.getByText(/Claude CLI not installed/)).toBeInTheDocument()
  })
})
