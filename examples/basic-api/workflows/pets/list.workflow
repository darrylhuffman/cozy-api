{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/pets",
        "method": "GET"
      }
    },
    "ListPets": {
      "uses": "./nodes/pets/list-pets",
      "in": {
        "status": "Request.query.status",
        "species": "Request.query.species"
      }
    },
    "Response": {
      "uses": "@core/response",
      "in": {
        "body": "ListPets.pets"
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "ListPets": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 40
    }
  }
}
