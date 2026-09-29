import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { parseWorkflow } from "../workflow/parse.js"
import type { LoadedWorkflow } from "./load.js"
import type { DebugIntegration } from "./server.js"
import { mountWorkflows } from "./server.js"

describe("mountWorkflows", () => {
  it("registers HTTP routes from workflows and responds to fetch", async () => {
    const add = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })

    const wf: LoadedWorkflow = {
      absolutePath: "/fake/workflows/add.workflow",
      relativePath: "add.workflow",
      file: parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/add", method: "POST" } },
          add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
          res: { uses: "@core/response", in: { body: "add.sum" }, values: { status: 200 } },
        },
      }),
    }

    const app = new Hono()
    mountWorkflows(app, [wf], {
      nodes: { "./add": add },
      services: {},
    })

    const res = await app.request("/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 3, b: 4 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBe(7)
  })

  it("registers multiple triggers in a single workflow as independent routes", async () => {
    const wf: LoadedWorkflow = {
      absolutePath: "/fake/users.workflow",
      relativePath: "users.workflow",
      file: parseWorkflow({
        lorien: 1,
        nodes: {
          getReq: { uses: "@core/http-request", values: { path: "/users", method: "GET" } },
          postReq: { uses: "@core/http-request", values: { path: "/users", method: "POST" } },
          getRes: { uses: "@core/response", values: { body: "list" } },
          postRes: { uses: "@core/response", in: { body: "postReq.body" } },
        },
      }),
    }
    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: {}, services: {} })

    const getRes = await app.request("/users", { method: "GET" })
    expect(await getRes.json()).toBe("list")

    const postRes = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ada" }),
    })
    expect(await postRes.json()).toEqual({ name: "ada" })
  })
})

describe("mountWorkflows with debug integration", () => {
  function makeEchoWorkflow(): LoadedWorkflow {
    return {
      absolutePath: "/fake/echo.workflow",
      relativePath: "echo.workflow",
      file: parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/echo", method: "POST" } },
          res: { uses: "@core/response", in: { body: "req.body.msg" }, values: { status: 200 } },
        },
      }),
    }
  }

  function makeThrowingWorkflow(): LoadedWorkflow {
    return {
      absolutePath: "/fake/throw.workflow",
      relativePath: "throw.workflow",
      file: parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/throw", method: "POST" } },
          boom: { uses: "./throw-node", in: { msg: "req.body.msg" } },
          res: { uses: "@core/response", in: { body: "boom.result" }, values: { status: 200 } },
        },
      }),
    }
  }

  it("calls debug.newRunId, buildRun, onResult on success", async () => {
    const wf = makeEchoWorkflow()

    const newRunId = vi.fn(() => "test-run-42")
    const lifecycle = new LifecycleEmitter()
    const buildRun = vi.fn((_runId: string, _workflowPath: string) => ({ lifecycle }))
    const onResult = vi.fn()
    const onError = vi.fn()

    const debug: DebugIntegration = { newRunId, buildRun, onResult, onError }

    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: {}, services: {}, debug })

    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "hello" }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBe("hello")

    expect(newRunId).toHaveBeenCalledOnce()
    expect(buildRun).toHaveBeenCalledOnce()
    expect(buildRun).toHaveBeenCalledWith(
      "test-run-42",
      "echo.workflow",
      "req",
      expect.objectContaining({ method: "POST", path: "/echo", body: { msg: "hello" } }),
    )
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult.mock.calls[0][0]).toBe("test-run-42")
    expect(onResult.mock.calls[0][1]).toMatchObject({ status: 200, body: "hello" })
    expect(typeof onResult.mock.calls[0][2]).toBe("number")
    expect(onError).not.toHaveBeenCalled()
  })

  it("calls debug.onError when the workflow throws and returns HTTP 500", async () => {
    const throwNode = defineNode({
      inputs: z.object({ msg: z.string() }),
      outputs: z.object({ result: z.string() }),
      async run({ msg }) {
        throw new Error(`boom: ${msg}`)
      },
    })

    const wf = makeThrowingWorkflow()

    const newRunId = vi.fn(() => "run-error-99")
    const lifecycle = new LifecycleEmitter()
    const buildRun = vi.fn(() => ({ lifecycle }))
    const onResult = vi.fn()
    const onError = vi.fn()

    const debug: DebugIntegration = { newRunId, buildRun, onResult, onError }

    const app = new Hono()
    mountWorkflows(app, [wf], {
      nodes: { "./throw-node": throwNode },
      services: {},
      debug,
    })

    const res = await app.request("/throw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "kaboom" }),
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ error: expect.stringContaining("boom: kaboom") })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBe("run-error-99")
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error)
    expect(typeof onError.mock.calls[0][2]).toBe("number")
    expect(onResult).not.toHaveBeenCalled()
  })

  it("buildRun receives triggerNodeId and the full request envelope", async () => {
    const wf = makeEchoWorkflow()

    const newRunId = vi.fn(() => "test-run-77")
    const lifecycle = new LifecycleEmitter()
    const buildRun = vi.fn(() => ({ lifecycle }))
    const onResult = vi.fn()
    const onError = vi.fn()

    const debug: DebugIntegration = { newRunId, buildRun, onResult, onError }
    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: {}, services: {}, debug })

    const res = await app.request("/echo?lang=en", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test": "hi" },
      body: JSON.stringify({ msg: "hello" }),
    })
    expect(res.status).toBe(200)

    expect(buildRun).toHaveBeenCalledOnce()
    const [runId, workflowPath, triggerNodeId, request] = buildRun.mock.calls[0]
    expect(runId).toBe("test-run-77")
    expect(workflowPath).toBe("echo.workflow")
    expect(triggerNodeId).toBe("req")
    expect(request).toMatchObject({
      method: "POST",
      path: "/echo",
      query: { lang: "en" },
      headers: expect.objectContaining({ "x-test": "hi" }),
      body: { msg: "hello" },
    })
  })

  it("works without debug integration (regression guard)", async () => {
    const wf = makeEchoWorkflow()

    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: {}, services: {} })

    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "no debug" }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBe("no debug")
  })
})
