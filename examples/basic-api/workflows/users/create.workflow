{
  "lorien": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/users",
        "method": "POST"
      }
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
      "in": {
        "body": "save.user",
        "status": 201
      }
    }
  },
  "view": {
    "request": {
      "x": -42,
      "y": 0
    },
    "save": {
      "x": 246,
      "y": 118
    },
    "response": {
      "x": 535,
      "y": 15
    }
  }
}
