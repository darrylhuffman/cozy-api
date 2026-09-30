export class WorkflowError extends Error {
  public override readonly cause?: unknown

  constructor(
    message: string,
    public readonly nodeId: string | null,
    cause?: unknown,
  ) {
    super(message)
    this.name = "WorkflowError"
    if (cause !== undefined) this.cause = cause
  }
}

export class NodeRunError extends WorkflowError {
  constructor(nodeId: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    super(`Node \`${nodeId}\` failed: ${msg}`, nodeId, cause)
    this.name = "NodeRunError"
  }
}

/**
 * The run finished without any @core/response node running: every Response
 * was skipped by its `when` (or the workflow has none). Answering 200 with a
 * null body would hide the missing branch, so the route answers 500.
 */
export class NoResponseError extends WorkflowError {
  constructor(skipped: string[]) {
    super(
      skipped.length > 0
        ? `no Response node ran (skipped: ${skipped.join(", ")}); add a Response for this case`
        : "the workflow has no Response node",
      null,
    )
    this.name = "NoResponseError"
  }
}

/** One reason a request was rejected, located in the request ("query.minCapacity"). */
export interface RequestIssue {
  path: string
  message: string
}

/**
 * A node's input failed its schema, and the bad value came straight from the
 * HTTP request (a path param, query value, header or body field). That's the
 * client's mistake, so the route answers 400 with the issues instead of 500.
 */
export class RequestValidationError extends WorkflowError {
  constructor(
    nodeId: string,
    public readonly issues: RequestIssue[],
  ) {
    super(
      `invalid request: ${issues.map((i) => `${i.path || "<request>"}: ${i.message}`).join("; ")}`,
      nodeId,
    )
    this.name = "RequestValidationError"
  }
}
