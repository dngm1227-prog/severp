const fs = require("node:fs");
const path = require("node:path");

function emptyDatabase() {
  return {
    orders: {},
    events: []
  };
}

class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = emptyDatabase();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.persist();
      return;
    }

    const raw = fs.readFileSync(this.file, "utf8");
    this.data = raw.trim() ? JSON.parse(raw) : emptyDatabase();
    this.data.orders ||= {};
    this.data.events ||= [];
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  createOrder(order) {
    if (this.data.orders[order.orderId]) {
      const error = new Error("Duplicate orderId");
      error.code = "DUPLICATE_ORDER";
      throw error;
    }
    this.data.orders[order.orderId] = order;
    this.addEvent(order.orderId, "ORDER_CREATED", { status: order.status });
    this.persist();
    return order;
  }

  getOrder(orderId) {
    return this.data.orders[orderId] || null;
  }

  listOrders(filters = {}) {
    return Object.values(this.data.orders)
      .filter((order) => !filters.status || order.status === filters.status)
      .filter((order) => !filters.clientId || order.clientId === filters.clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  updateOrder(orderId, patch, eventType = "ORDER_UPDATED", metadata = {}) {
    const order = this.getOrder(orderId);
    if (!order) return null;
    Object.assign(order, patch, { updatedAt: new Date().toISOString() });
    this.addEvent(orderId, eventType, metadata);
    this.persist();
    return order;
  }

  addEvent(orderId, type, metadata = {}) {
    this.data.events.push({
      id: `${Date.now()}-${this.data.events.length + 1}`,
      orderId,
      type,
      metadata,
      createdAt: new Date().toISOString()
    });
  }

  eventsForOrder(orderId) {
    return this.data.events.filter((event) => event.orderId === orderId);
  }
}

module.exports = { JsonStore };
