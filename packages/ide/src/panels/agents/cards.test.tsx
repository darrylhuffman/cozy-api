import { render, screen, cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  AssistantText,
  AssistantError,
  ToolUseRead,
  ToolUseEdit,
  ToolUseBash,
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

  it("ToolUseEdit shows path and a 'view diff' button", () => {
    render(<ToolUseEdit path="nodes/save-user.ts" />)
    expect(screen.getByText("nodes/save-user.ts")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /view diff/i })).toBeInTheDocument()
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
