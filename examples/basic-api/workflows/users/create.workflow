{
  "cozy": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "config": { "path": "/users", "method": "POST" }
    },
    "creds": {
      "uses": "./nodes/parse-credentials",
      "in": { "raw": "request.body" }
    },
    "save": {
      "uses": "./nodes/save-user",
      "in": {
        "email": "creds.email",
        "passwordHash": "creds.password"
      }
    },
    "response": {
      "uses": "@core/response",
      "in": { "body": "save.user", "status": 201 }
    }
  }
}
