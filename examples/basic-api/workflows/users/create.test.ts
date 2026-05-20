import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseWorkflowFromString } from "@cozy/runtime"
import { testWorkflow, traceWorkflow } from "@cozy/runtime/testing"
import { describe, expect, it } from "vitest"
import parseCredentials from "../../nodes/parse-credentials.js"
import saveUser from "../../nodes/save-user.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const workflow = parseWorkflowFromString(readFileSync(join(__dirname, "create.workflow"), "utf-8"))

const nodes = {
  "./nodes/parse-credentials": parseCredentials,
  "./nodes/save-user": saveUser,
}

const services = {
  db: {
    async createUser(email: string) {
      return { id: "test-id", email }
    },
  },
  logger: { info: () => {} },
}

describe("POST /users workflow", () => {
  it("creates a user from valid credentials", async () => {
    const res = await testWorkflow(workflow, {
      request: { body: { email: "ada@example.com", password: "hunter2" } },
      nodes,
      services,
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: "test-id", email: "ada@example.com" })
  })

  it("rejects malformed credentials by throwing", async () => {
    await expect(
      testWorkflow(workflow, {
        request: { body: { email: "not-an-email", password: "x" } },
        nodes,
        services,
      }),
    ).rejects.toThrow()
  })

  it("traceWorkflow exposes intermediate node outputs", async () => {
    const trace = await traceWorkflow(workflow, {
      request: { body: { email: "ada@example.com", password: "hunter2" } },
      nodes,
      services,
    })
    expect(trace.at("creds").output).toEqual({ email: "ada@example.com", password: "hunter2" })
    expect(trace.at("save").output).toEqual({ user: { id: "test-id", email: "ada@example.com" } })
  })
})
