{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/store/inventory",
        "method": "GET"
      }
    },
    "GetInventory": {
      "uses": "./nodes/store/get-inventory",
      "after": [
        "Request"
      ]
    },
    "Response": {
      "uses": "@core/http-response",
      "in": {
        "body": "GetInventory.inventory"
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "GetInventory": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 40
    }
  }
}
