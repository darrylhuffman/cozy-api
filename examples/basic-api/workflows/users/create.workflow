{
  "lorien": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "config": { "path": "/users", "method": "POST" }
    },
    "save": {
      "uses": "./nodes/users/save-user",
      "in": {
        "email": "request.body.email",
        "password": "request.body.password"
      }
    },
    "response": {
      "uses": "@core/response",
      "in": { "body": "save.user", "status": 201 }
    }
  }
}
