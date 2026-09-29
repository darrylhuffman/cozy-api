import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DebugSession } from "./debug-session.js"
import type { Breakpoint, ServerMessage } from "./debug-protocol.js"
import { loadWorkspace } from "./load.js"

function makeMockClient() {
  const sent: ServerMessage[] = []
  const ws = {
    send: (data: string) => {
      sent.push(JSON.parse(data) as ServerMessage)
    },
    readyState: 1,
    OPEN: 1,
  } as unknown as import("ws").WebSocket
  return { ws, sent }
}

describe("DebugSession multi-active state", () => {
  it("connect/disconnect tracks clients", () => {
    const s = new DebugSession()
    const a = makeMockClient()
    const b = makeMockClient()
    s.connect(a.ws)
    s.connect(b.ws)
    expect(s.clientCount).toBe(2)
    s.disconnect(a.ws)
    expect(s.clientCount).toBe(1)
  })

  it("hello replaces breakpoints and emits ready", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    const bps: Breakpoint[] = [
      { workflowPath: "a.workflow", nodeId: "n1", kind: "before" },
    ]
    await s.onMessage(ws, { type: "hello", breakpoints: bps })
    expect(sent.some((m) => m.type === "ready")).toBe(true)
    expect(s.getBreakpoints("a.workflow")).toEqual(bps)
  })

  it("set-breakpoints fully replaces registry", async () => {
    const s = new DebugSession()
    const { ws } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [
        { workflowPath: "a", nodeId: "n", kind: "before" },
        { workflowPath: "b", nodeId: "n", kind: "after" },
      ],
    })
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "a", nodeId: "n2", kind: "before" }],
    })
    expect(s.getBreakpoints("a")).toEqual([
      { workflowPath: "a", nodeId: "n2", kind: "before" },
    ])
    expect(s.getBreakpoints("b")).toEqual([])
  })

  it("registerRun creates a runs map entry; unregister removes it", () => {
    const s = new DebugSession()
    s.registerRun("wf", "r1", 1000)
    expect(s.getRunStartedAt("r1")).toBe(1000)
    s.unregisterRun("r1")
    expect(s.getRunStartedAt("r1")).toBeNull()
  })

  it("before-bp pauses in onBeforeNode for the matching run", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "before" }],
    })
    const { onBeforeNode } = s.registerRun("wf", "r1", Date.now())
    const pending = onBeforeNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(
      sent.some(
        (m) =>
          m.type === "paused" &&
          m.runId === "r1" &&
          m.nodeId === "X" &&
          m.phase === "before",
      ),
    ).toBe(true)
    await s.onMessage(ws, { type: "continue", runId: "r1" })
    await pending
  })

  it("port-bp pauses in onAfterNode for the matching run", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:foo" }],
    })
    const { onAfterNode } = s.registerRun("wf", "r1", Date.now())
    const pending = onAfterNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(
      sent.some(
        (m) => m.type === "paused" && m.runId === "r1" && m.phase === "after",
      ),
    ).toBe(true)
    await s.onMessage(ws, { type: "continue", runId: "r1" })
    await pending
  })

  it("step targets the right run by runId", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    const a = s.registerRun("wf", "rA", Date.now())
    const b = s.registerRun("wf", "rB", Date.now())
    s._setStepModeForTest("rA", "step")
    s._setStepModeForTest("rB", "step")
    const pendingA = a.onBeforeNode("X", {})
    const pendingB = b.onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    await s.onMessage(ws, { type: "continue", runId: "rA" })
    await pendingA
    expect(sent.filter((m) => m.type === "resumed").map((m) => m.runId)).toContain("rA")
    expect(sent.filter((m) => m.type === "resumed").map((m) => m.runId)).not.toContain("rB")
    await s.onMessage(ws, { type: "continue", runId: "rB" })
    await pendingB
  })

  it("step-over of rA suppresses port-bps on rA but doesn't affect rB", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:p" }],
    })
    const a = s.registerRun("wf", "rA", Date.now())
    const b = s.registerRun("wf", "rB", Date.now())
    s._setStepModeForTest("rA", "step-over", "X")
    await a.onAfterNode("X", {})
    expect(
      sent.some(
        (m) => m.type === "paused" && m.runId === "rA" && m.phase === "after",
      ),
    ).toBe(false)
    const pendingB = b.onAfterNode("X", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(
      sent.some(
        (m) => m.type === "paused" && m.runId === "rB" && m.phase === "after",
      ),
    ).toBe(true)
    await s.onMessage(ws, { type: "continue", runId: "rB" })
    await pendingB
  })

  it("stop rejects only the targeted run's pause with AbortError", async () => {
    const s = new DebugSession()
    const { ws } = makeMockClient()
    s.connect(ws)
    let rejA: unknown = null
    let resolvedB = false
    s.registerRun("wf", "rA", Date.now())
    s.registerRun("wf", "rB", Date.now())
    s._setActivePauseForTest("rA", {
      resolve: () => {},
      reject: (e) => {
        rejA = e
      },
      frame: { runId: "rA", nodeId: "X", phase: "before" },
    })
    s._setActivePauseForTest("rB", {
      resolve: () => {
        resolvedB = true
      },
      reject: () => {},
      frame: { runId: "rB", nodeId: "Y", phase: "before" },
    })
    await s.onMessage(ws, { type: "stop", runId: "rA" })
    expect((rejA as Error).name).toBe("AbortError")
    expect(resolvedB).toBe(false)
  })

  it("disconnect (last client) rejects all active pauses", () => {
    const s = new DebugSession()
    const a = makeMockClient()
    s.connect(a.ws)
    s.registerRun("wf", "rA", Date.now())
    s.registerRun("wf", "rB", Date.now())
    let rejA: unknown = null
    let rejB: unknown = null
    s._setActivePauseForTest("rA", {
      resolve: () => {},
      reject: (e) => {
        rejA = e
      },
      frame: { runId: "rA", nodeId: "X", phase: "before" },
    })
    s._setActivePauseForTest("rB", {
      resolve: () => {},
      reject: (e) => {
        rejB = e
      },
      frame: { runId: "rB", nodeId: "Y", phase: "before" },
    })
    s.disconnect(a.ws)
    expect((rejA as Error).name).toBe("AbortError")
    expect((rejB as Error).name).toBe("AbortError")
  })

  it("continue with unknown runId is a no-op", async () => {
    const s = new DebugSession()
    const { ws, sent } = makeMockClient()
    s.connect(ws)
    await s.onMessage(ws, { type: "continue", runId: "nonexistent" })
    expect(sent.some((m) => m.type === "resumed")).toBe(false)
  })
})

describe("DebugSession + loadWorkspace integration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-ds-load-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("workflowPath set by IDE matches relativePath from loadWorkspace (after breakpoint fires)", async () => {
    mkdirSync(join(dir, "workflows", "user"), { recursive: true });
    writeFileSync(
      join(dir, "workflows", "user", "create.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/users", method: "POST" } },
          save: { uses: "./fake-save" },
          res: { uses: "@core/response", in: { body: "save.x" } },
        },
      }),
    );

    const ws = await loadWorkspace(dir);
    const wf = ws.workflows[0]!;

    // The IDE stores breakpoints using workspace-root-relative paths.
    const ideStyleWorkflowPath = "workflows/user/create.workflow";

    // The fix is precisely that these two values match.
    expect(wf.relativePath).toBe(ideStyleWorkflowPath);

    // Belt-and-suspenders: confirm the lookup the runtime does actually finds
    // the IDE-stored breakpoint. We use applyBreakpoints via the WS hello
    // message (the public surface).
    const session = new DebugSession();
    const { ws: fakeWs } = makeMockClient();
    session.connect(fakeWs);
    await session.onMessage(fakeWs, {
      type: "hello",
      breakpoints: [
        { workflowPath: ideStyleWorkflowPath, nodeId: "save", kind: "after" },
      ],
    });
    expect(session.getBreakpoints(wf.relativePath)).toHaveLength(1);
  });
});

describe("DebugSession.abortAllRuns", () => {
  it("rejects the pause promise for each paused run with an AbortError and clears the runs map", async () => {
    const s = new DebugSession();

    // Register two runs and seed an active pause on each via the test seam.
    s.registerRun("wf", "rA", Date.now());
    s.registerRun("wf", "rB", Date.now());

    const rejections: unknown[] = [];
    const pauseA = new Promise<void>((resolve, reject) => {
      s._setActivePauseForTest("rA", {
        resolve,
        reject: (err: unknown) => {
          rejections.push(err);
          reject(err);
        },
        frame: { runId: "rA", nodeId: "n1", phase: "before" },
      });
    });
    const pauseB = new Promise<void>((resolve, reject) => {
      s._setActivePauseForTest("rB", {
        resolve,
        reject: (err: unknown) => {
          rejections.push(err);
          reject(err);
        },
        frame: { runId: "rB", nodeId: "n1", phase: "before" },
      });
    });

    s.abortAllRuns();

    // Both pauses rejected; both runs removed.
    expect(rejections).toHaveLength(2);
    for (const err of rejections) {
      expect((err as Error).name).toBe("AbortError");
      expect((err as Error).message).toMatch(/workflow reloaded/i);
    }
    await expect(pauseA).rejects.toThrow();
    await expect(pauseB).rejects.toThrow();
    expect(s.getRunStartedAt("rA")).toBeNull();
    expect(s.getRunStartedAt("rB")).toBeNull();
  });

  it("is safe to call when there are no runs", () => {
    const s = new DebugSession();
    expect(() => s.abortAllRuns()).not.toThrow();
  });

  it("removes runs that are not paused too (in-flight without active pause)", () => {
    const s = new DebugSession();
    s.registerRun("wf", "r1", Date.now());
    // No active pause seeded.
    s.abortAllRuns();
    expect(s.getRunStartedAt("r1")).toBeNull();
  });
});
