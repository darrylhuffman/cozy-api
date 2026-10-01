{
  "lorien": 1,
  "label": "Reserve seats",
  "nodes": {
    "Input": {
      "uses": "@core/input",
      "values": { "fields": { "eventId": "string", "quantity": "number" } }
    },
    "FindEvent": { "uses": "./nodes/events/find-event", "in": { "id": "Input.eventId" } },
    "NoEvent": {
      "uses": "@core/response",
      "when": "!FindEvent.found",
      "values": { "status": 404, "body": { "error": "event not found" } }
    },
    "Capacity": {
      "uses": "./nodes/orders/check-capacity",
      "when": "FindEvent.found",
      "in": { "event": "FindEvent.event", "quantity": "Input.quantity" }
    },
    "SoldOut": {
      "uses": "@core/response",
      "when": "!Capacity.available",
      "in": { "body": "Capacity.error" },
      "values": { "status": 409 }
    },
    "Output": {
      "uses": "@core/output",
      "in": {
        "event": "FindEvent.event",
        "available": "Capacity.available",
        "totalCents": "Capacity.totalCents"
      }
    }
  }
}
