{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/users",
        "method": "POST"
      }
    },
    "SaveUser": {
      "uses": "./nodes/user/save-user",
      "in": {
        "email": "Request.body.email",
        "password": "Request.body.password"
      }
    },
    "Response": {
      "uses": "@core/response",
      "in": {
        "body": "SaveUser.user"
      },
      "values": {
        "status": 200
      }
    },
    "save-user": {
      "uses": "./nodes/user/save-user"
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "SaveUser": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 42
    },
    "save-user": {
      "x": 347,
      "y": 287
    }
  }
}
