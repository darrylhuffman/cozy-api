{
  "lorien": 1,
  "nodes": {
    "req": { "uses": "@core/http-request", "values": { "path": "/hello", "method": "GET" } },
    "say": { "uses": "./nodes/say-hello", "in": {} },
    "res": { "uses": "@core/response", "in": { "body": "say.greeting" } }
  }
}
