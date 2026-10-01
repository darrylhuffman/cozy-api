{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/store/catalog",
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
    "GetInventory": {
      "uses": "./nodes/store/get-inventory",
      "after": [
        "Request"
      ]
    },
    "ToCatalogPage": {
      "uses": "./nodes/store/to-catalog-page",
      "in": {
        "pets": "ListPets.pets",
        "inventory": "GetInventory.inventory",
        "page": "Request.query.page",
        "pageSize": "Request.query.pageSize"
      }
    },
    "Response": {
      "uses": "@core/http-response",
      "in": {
        "body": "ToCatalogPage.page"
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 120
    },
    "ListPets": {
      "x": 349,
      "y": 40
    },
    "GetInventory": {
      "x": 349,
      "y": 260
    },
    "ToCatalogPage": {
      "x": 662,
      "y": 120
    },
    "Response": {
      "x": 975,
      "y": 120
    }
  }
}
