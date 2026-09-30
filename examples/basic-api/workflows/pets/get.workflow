{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/pets/:id",
        "method": "GET"
      }
    },
    "FindPet": {
      "uses": "./nodes/pets/find-pet",
      "in": {
        "id": "Request.params.id"
      }
    },
    "Response": {
      "uses": "@core/response",
      "in": {
        "body": "FindPet.body",
        "status": "FindPet.status"
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "FindPet": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 40
    }
  }
}
