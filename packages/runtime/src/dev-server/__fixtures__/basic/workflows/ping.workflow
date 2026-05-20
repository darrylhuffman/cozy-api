{
  "lorien": 1,
  "nodes": {
    "req": { "uses": "@core/http-request", "config": { "path": "/ping", "method": "GET" } },
    "read": { "uses": "./nodes/read-db", "in": {} },
    "res": { "uses": "@core/response", "in": { "body": "read.value" } }
  }
}
