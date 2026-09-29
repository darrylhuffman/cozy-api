import type { BodyKind } from "@/store/debug-session"

export interface RequestFormSnapshot {
  bodyKind: BodyKind
  body: string
  formBody: Array<[string, string]>
}

export interface SerializedBody {
  body?: unknown
  error?: string
}

/**
 * Convert the request-form body fields into the wire-level envelope body
 * for a debug `fire` message. Mirrors how server.ts:mountWorkflows builds
 * the trigger's body output from real HTTP traffic so a workflow sees the
 * same request.body shape for debug runs and production traffic.
 */
export function serializeBody(form: RequestFormSnapshot): SerializedBody {
  switch (form.bodyKind) {
    case "none":
      return {}
    case "json": {
      const trimmed = form.body.trim()
      if (trimmed.length === 0) return {}
      try {
        return { body: JSON.parse(trimmed) }
      } catch (e) {
        return { error: (e as Error).message }
      }
    }
    case "xml":
    case "text":
      return form.body.length > 0 ? { body: form.body } : {}
    case "form": {
      const params = new URLSearchParams()
      for (const [k, v] of form.formBody) {
        if (k.length === 0) continue
        params.append(k, v)
      }
      const s = params.toString()
      return s.length > 0 ? { body: s } : {}
    }
  }
}
