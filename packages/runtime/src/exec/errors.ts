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
