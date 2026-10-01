{
  "lorien": 1,
  "nodes": {
    "Request": {
      "uses": "@core/http-request",
      "values": { "path": "/events/:id/orders", "method": "POST" }
    },
    "ReserveSeats": {
      "uses": "./nodes/orders/reserve-seats",
      "in": { "eventId": "Request.params.id", "quantity": "Request.body.quantity" }
    },
    "Create": {
      "uses": "./nodes/orders/create-order",
      "when": "ReserveSeats.available",
      "in": { "eventId": "ReserveSeats.event.id", "totalCents": "ReserveSeats.totalCents" }
    },
    "Created": {
      "uses": "@core/response",
      "in": { "body": "Create.order" },
      "values": { "status": 201 }
    }
  }
}
