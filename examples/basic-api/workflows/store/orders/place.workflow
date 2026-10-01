{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": {
        "path": "/store/orders",
        "method": "POST"
      }
    },
    "PlaceOrder": {
      "uses": "./nodes/store/place-order",
      "in": {
        "petId": "Request.body.petId",
        "quantity": "Request.body.quantity"
      }
    },
    "Response": {
      "uses": "@core/http-response",
      "in": {
        "body": "PlaceOrder.body",
        "status": "PlaceOrder.status"
      }
    }
  },
  "view": {
    "Request": {
      "x": 40,
      "y": 40
    },
    "PlaceOrder": {
      "x": 349,
      "y": 40
    },
    "Response": {
      "x": 662,
      "y": 40
    }
  }
}
