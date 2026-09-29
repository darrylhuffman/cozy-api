import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ConfirmDialogHost } from "@/components/confirm-dialog-host"
import { confirmAction, useConfirmStore } from "./confirm"

afterEach(() => {
  cleanup()
  useConfirmStore.setState({ pending: null })
})

describe("confirmAction", () => {
  it("resolves with the user's answer from the dialog", async () => {
    render(<ConfirmDialogHost />)
    const result = confirmAction({
      title: "Discard changes?",
      description: "Unsaved edits will be lost.",
      confirmLabel: "Discard",
      destructive: true,
    })
    expect(await screen.findByText("Discard changes?")).toBeInTheDocument()
    expect(screen.getByText("Unsaved edits will be lost.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    await expect(result).resolves.toBe(true)
    expect(useConfirmStore.getState().pending).toBeNull()
  })

  it("Cancel resolves false", async () => {
    render(<ConfirmDialogHost />)
    const result = confirmAction({ title: "Sure?" })
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    await expect(result).resolves.toBe(false)
  })

  it("a newer request cancels an unanswered one", async () => {
    const first = confirmAction({ title: "one" })
    const second = confirmAction({ title: "two" })
    await expect(first).resolves.toBe(false)
    useConfirmStore.getState().answer(true)
    await expect(second).resolves.toBe(true)
  })
})
