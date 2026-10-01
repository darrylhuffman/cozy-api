import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { ScheduleEditor } from "./schedule-editor"

const TAB = "tab-1"

function seed(values: Record<string, unknown>) {
  const wf: WorkflowFile = { lorien: 1, nodes: { Nightly: { uses: "@core/schedule", values } } }
  useWorkflowDrafts.getState().load(TAB, "workflows/nightly.workflow", wf)
}

function current() {
  return useWorkflowDrafts.getState().drafts[TAB]!.workflow.nodes.Nightly!
}

function renderEditor() {
  return render(
    <ScheduleEditor
      nodeId="Nightly"
      instance={current()}
      tabId={TAB}
      workflowPath="workflows/nightly.workflow"
    />,
  )
}

/** Re-render with the draft's current node, as the inspector does after an edit. */
function rerender(r: ReturnType<typeof render>) {
  r.rerender(
    <ScheduleEditor
      nodeId="Nightly"
      instance={current()}
      tabId={TAB}
      workflowPath="workflows/nightly.workflow"
    />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-01T10:07:00Z"))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useWorkflowDrafts.getState().drop(TAB)
})

describe("ScheduleEditor", () => {
  it("describes the schedule and lists the next runs", () => {
    seed({ cron: "0 9 * * 1-5", timezone: "UTC" })
    renderEditor()
    expect(screen.getByTestId("schedule-summary").textContent).toBe("Every weekday at 09:00")
    expect(screen.getByRole("button", { name: "Weekly" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("schedule-upcoming").querySelectorAll("li")).toHaveLength(5)
  })

  it("writes the cron when a day is toggled or the time changes", () => {
    seed({ cron: "0 9 * * 1-5", timezone: "UTC" })
    const r = renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }))
    expect(current().values?.cron).toBe("0 9 * * 1-6")
    rerender(r)
    fireEvent.change(screen.getByLabelText("Time of day"), { target: { value: "17:30" } })
    expect(current().values?.cron).toBe("30 17 * * 1-6")
  })

  it("switches modes, keeping the time of day", () => {
    seed({ cron: "30 7 * * *" })
    const r = renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }))
    expect(current().values?.cron).toBe("30 7 1 * *")
    rerender(r)
    fireEvent.click(screen.getByRole("button", { name: "15" }))
    expect(current().values?.cron).toBe("30 7 15 * *")
    rerender(r)
    fireEvent.click(screen.getByRole("button", { name: "Minutes" }))
    expect(current().values?.cron).toBe("*/15 * * * *")
  })

  it("stays on Weekly when every day is ticked", () => {
    seed({ cron: "0 9 * * 1-5" })
    const r = renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Every day" }))
    expect(current().values?.cron).toBe("0 9 * * *")
    rerender(r)
    expect(screen.getByRole("button", { name: "Weekly" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("edits custom cron, applying only a valid one", () => {
    seed({ cron: "0 9 * * *" })
    renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Custom" }))
    const input = screen.getByLabelText("Cron expression")
    fireEvent.change(input, { target: { value: "0 25 * * *" } })
    expect(screen.getByRole("alert").textContent).toBe("Hour: 25 is out of range (0-23)")
    fireEvent.blur(input)
    expect(current().values?.cron).toBe("0 9 * * *")
    fireEvent.change(input, { target: { value: "0 9,17 * * *" } })
    fireEvent.blur(input)
    expect(current().values?.cron).toBe("0 9,17 * * *")
  })

  it("sets the time zone", () => {
    seed({ cron: "0 9 * * *" })
    renderEditor()
    const input = screen.getByLabelText("Time zone")
    fireEvent.change(input, { target: { value: "Europe/Paris" } })
    expect(current().values?.timezone).toBe("Europe/Paris")
  })
})
