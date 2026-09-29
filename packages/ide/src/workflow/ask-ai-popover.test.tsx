import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AskAiPopover } from "./ask-ai-popover"

afterEach(cleanup)

describe("AskAiPopover", () => {
  it("sends the trimmed question on Enter and closes", () => {
    const onAsk = vi.fn()
    render(<AskAiPopover selectedNodeId="save" onAsk={onAsk} />)
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }))
    expect(screen.getByText(/and node save as context/)).toBeInTheDocument()
    const box = screen.getByLabelText("Question for the AI")
    fireEvent.change(box, { target: { value: "  add a welcome email  " } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(onAsk).toHaveBeenCalledWith("add a welcome email")
    expect(screen.queryByLabelText("Question for the AI")).not.toBeInTheDocument()
  })

  it("does nothing for an empty question", () => {
    const onAsk = vi.fn()
    render(<AskAiPopover selectedNodeId={null} onAsk={onAsk} />)
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }))
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText("Question for the AI"), { key: "Enter" })
    expect(onAsk).not.toHaveBeenCalled()
  })
})
