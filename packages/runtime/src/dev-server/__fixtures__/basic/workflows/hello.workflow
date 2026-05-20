{
  "cozy": 1,
  "nodes": {
    "req": { "uses": "@core/http-request", "config": { "path": "/hello", "method": "GET" } },
    "res": { "uses": "@core/response", "in": { "body": { "$literal": "hello" } } }
  }
}
