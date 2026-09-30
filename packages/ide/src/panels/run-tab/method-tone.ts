/** Text colour for an HTTP method label: reads stay calm, writes stand out. */
export function methodTone(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return "text-info"
    case "POST":
      return "text-success"
    case "PUT":
    case "PATCH":
      return "text-warning"
    case "DELETE":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}
