{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/pets",
        "method": "POST"
      }
    },
    "AddPet": {
      "uses": "./nodes/pets/add-pet",
      "in": {
        "name": "Request.body.name",
        "species": "Request.body.species",
        "status": "Request.body.status"
      }
    },
    "Response": {
      "uses": "@core/response",
      "in": {
        "body": "AddPet.pet"
      },
      "values": {
        "status": 201
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "AddPet": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 40
    }
  }
}
