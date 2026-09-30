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
