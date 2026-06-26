const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../src/app");
const { JsonStore } = require("../src/store");
const { Status } = require("../src/statuses");

function sampleOrder(overrides = {}) {
  return {
    orderId: overrides.orderId || "ORDER-1001",
    clientId: "CLIENT-A",
    buyer: {
      name: "홍길동",
      email: "buyer@example.com",
      phone: "010-1234-5678",
      personalCustomsCode: "P123456789012"
    },
    shipping: {
      address: "서울시 중구 세종대로 1",
      postalCode: "04524"
    },
    items: [
      {
        name: "Wireless Mouse",
        quantity: 1,
        amount: 25000,
        currency: "KRW"
      }
    ],
    ...overrides
  };
}

async function withServer(fn) {
  const file = path.join(os.tmpdir(), `customs-api-test-${Date.now()}-${Math.random()}.json`);
  const { handler } = await createApp({ store: new JsonStore(file) });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, method, pathname, body, key = "dev-admin-key") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": key
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

test("receives a valid client order", async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, "POST", "/api/client/orders", sampleOrder(), "dev-client-key");

    assert.equal(response.status, 201);
    assert.equal(response.body.orderId, "ORDER-1001");
    assert.equal(response.body.status, Status.RECEIVED);
  });
});

test("rejects invalid order payloads", async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, "POST", "/api/client/orders", sampleOrder({
      buyer: { name: "", email: "bad", phone: "1", personalCustomsCode: "WRONG" }
    }), "dev-client-key");

    assert.equal(response.status, 422);
    assert.equal(response.body.status, Status.VALIDATION_FAILED);
    assert.ok(response.body.validationErrors.length >= 4);
  });
});

test("runs customs, verification, and internal send flow", async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, "POST", "/api/client/orders", sampleOrder(), "dev-client-key");

    const customs = await request(baseUrl, "POST", "/api/customs/orders", { orderId: "ORDER-1001" });
    assert.equal(customs.status, 200);
    assert.equal(customs.body.status, Status.WAITING_VERIFICATION_CODE);

    const message = await request(baseUrl, "POST", "/api/messages/verification-request", { orderId: "ORDER-1001" });
    assert.equal(message.status, 200);
    assert.equal(message.body.status, Status.VERIFICATION_REQUEST_SENT);

    const verification = await request(baseUrl, "POST", "/api/buyer/verification-code", {
      orderId: "ORDER-1001",
      verificationCode: "123456"
    });
    assert.equal(verification.status, 200);
    assert.equal(verification.body.status, Status.COMPLETED);

    const status = await request(baseUrl, "GET", "/api/client/orders/ORDER-1001/status", null, "dev-client-key");
    assert.equal(status.body.status, Status.COMPLETED);
  });
});

test("prevents duplicate order IDs", async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, "POST", "/api/client/orders", sampleOrder(), "dev-client-key");
    const duplicate = await request(baseUrl, "POST", "/api/client/orders", sampleOrder(), "dev-client-key");

    assert.equal(duplicate.status, 409);
  });
});
