import { createServer } from "node:net"

export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort
  while (!(await isPortAvailable(port))) {
    port += 1
  }
  return port
}

export function parseStartingPort(value: number | string | undefined, fallback: number): number {
  const port = Number(value)
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port
  }
  return fallback
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once("error", () => resolve(false))
    server.listen(port, () => {
      server.close(() => resolve(true))
    })
  })
}
