{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/pets/:id",
        "method": "PATCH"
      }
    },
    "UpdatePetStatus": {
      "uses": "./nodes/pets/update-pet-status",
      "in": {
        "id": "Request.params.id",
        "status": "Request.body.status"
      }
    },
    "Response": {
      "uses": "@core/http-response",
      "in": {
        "body": "UpdatePetStatus.body",
        "status": "UpdatePetStatus.status"
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "UpdatePetStatus": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 40
    }
  }
}
