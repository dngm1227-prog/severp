const { randomUUID } = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { config } = require("./config");
const { JsonStore } = require("./store");
const { Status, VerificationStatus } = require("./statuses");
const { validateOrderPayload, normalizeOrderPayload } = require("./validation");
const {
  postJson,
  toCustomsPayload,
  toInternalPayload,
  toVerificationMessage
} = require("./integrations");

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function html(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sanitizeOrder(order, includeSensitive = false) {
  if (!order) return null;
  const copy = JSON.parse(JSON.stringify(order));
  if (!includeSensitive && copy.verification?.code) {
    copy.verification.code = "********";
  }
  return copy;
}

function hasKey(req, validKeys) {
  const key = req.headers["x-api-key"];
  return typeof key === "string" && validKeys.includes(key);
}

function requireClient(req, res) {
  if (hasKey(req, config.clientApiKeys)) return true;
  json(res, 401, { error: "Unauthorized client API key." });
  return false;
}

function requireAdmin(req, res) {
  if (hasKey(req, config.adminApiKeys)) return true;
  json(res, 401, { error: "Unauthorized admin API key." });
  return false;
}

function createInitialOrder(payload, validationErrors = []) {
  const now = new Date().toISOString();
  const normalized = validationErrors.length ? payload : normalizeOrderPayload(payload);
  return {
    id: randomUUID(),
    ...normalized,
    status: validationErrors.length ? Status.VALIDATION_FAILED : Status.RECEIVED,
    validationErrors,
    customs: {
      attempts: 0,
      lastStatusCode: null,
      lastResponse: null,
      sentAt: null
    },
    verification: {
      status: VerificationStatus.NOT_REQUESTED,
      code: null,
      requestedAt: null,
      expiresAt: null,
      receivedAt: null,
      messageAttempts: 0,
      lastMessageResponse: null
    },
    internal: {
      attempts: 0,
      lastStatusCode: null,
      lastResponse: null,
      sentAt: null
    },
    createdAt: now,
    updatedAt: now
  };
}

async function sendToCustoms(store, orderId) {
  const order = store.getOrder(orderId);
  if (!order) return { status: 404, body: { error: "Order not found." } };
  if (order.validationErrors?.length) {
    return { status: 422, body: { error: "Order has validation errors.", validationErrors: order.validationErrors } };
  }

  try {
    const result = await postJson(config.customsApiUrl, toCustomsPayload(order), config.externalTimeoutMs);
    const patch = {
      customs: {
        attempts: order.customs.attempts + 1,
        lastStatusCode: result.status,
        lastResponse: result.body,
        sentAt: result.ok ? new Date().toISOString() : order.customs.sentAt
      },
      status: result.ok ? Status.WAITING_VERIFICATION_CODE : Status.CUSTOMS_SEND_FAILED
    };
    store.updateOrder(orderId, patch, result.ok ? "CUSTOMS_SENT" : "CUSTOMS_FAILED", { statusCode: result.status });
    return { status: result.ok ? 200 : 502, body: sanitizeOrder(store.getOrder(orderId), true) };
  } catch (error) {
    store.updateOrder(orderId, {
      customs: {
        attempts: order.customs.attempts + 1,
        lastStatusCode: null,
        lastResponse: { error: error.message },
        sentAt: order.customs.sentAt
      },
      status: Status.CUSTOMS_SEND_FAILED
    }, "CUSTOMS_FAILED", { error: error.message });
    return { status: 502, body: sanitizeOrder(store.getOrder(orderId), true) };
  }
}

async function sendVerificationRequest(store, orderId) {
  const order = store.getOrder(orderId);
  if (!order) return { status: 404, body: { error: "Order not found." } };
  if (![Status.WAITING_VERIFICATION_CODE, Status.CUSTOMS_SEND_FAILED, Status.VERIFICATION_REQUEST_SENT].includes(order.status)) {
    return { status: 409, body: { error: `Cannot request verification in status ${order.status}.` } };
  }

  const expiresAt = new Date(Date.now() + config.verificationTtlMinutes * 60 * 1000).toISOString();
  const message = toVerificationMessage(order, config.publicBaseUrl);
  try {
    const result = await postJson(config.messageApiUrl, message, config.externalTimeoutMs);
    const patch = {
      status: result.ok ? Status.VERIFICATION_REQUEST_SENT : order.status,
      verification: {
        ...order.verification,
        status: result.ok ? VerificationStatus.SENT : VerificationStatus.NEEDS_RETRY,
        requestedAt: new Date().toISOString(),
        expiresAt,
        messageAttempts: order.verification.messageAttempts + 1,
        lastMessageResponse: result.body
      }
    };
    store.updateOrder(orderId, patch, result.ok ? "VERIFICATION_REQUEST_SENT" : "VERIFICATION_REQUEST_FAILED", {
      statusCode: result.status
    });
    return { status: result.ok ? 200 : 502, body: sanitizeOrder(store.getOrder(orderId), true) };
  } catch (error) {
    store.updateOrder(orderId, {
      verification: {
        ...order.verification,
        status: VerificationStatus.NEEDS_RETRY,
        messageAttempts: order.verification.messageAttempts + 1,
        lastMessageResponse: { error: error.message }
      }
    }, "VERIFICATION_REQUEST_FAILED", { error: error.message });
    return { status: 502, body: sanitizeOrder(store.getOrder(orderId), true) };
  }
}

async function sendToInternal(store, orderId) {
  const order = store.getOrder(orderId);
  if (!order) return { status: 404, body: { error: "Order not found." } };
  if (!order.verification?.code) {
    return { status: 409, body: { error: "Verification code is required before internal send." } };
  }

  try {
    const result = await postJson(config.internalApiUrl, toInternalPayload(order), config.externalTimeoutMs);
    const patch = {
      internal: {
        attempts: order.internal.attempts + 1,
        lastStatusCode: result.status,
        lastResponse: result.body,
        sentAt: result.ok ? new Date().toISOString() : order.internal.sentAt
      },
      status: result.ok ? Status.COMPLETED : Status.INTERNAL_SEND_FAILED
    };
    store.updateOrder(orderId, patch, result.ok ? "INTERNAL_SENT" : "INTERNAL_FAILED", { statusCode: result.status });
    return { status: result.ok ? 200 : 502, body: sanitizeOrder(store.getOrder(orderId), true) };
  } catch (error) {
    store.updateOrder(orderId, {
      internal: {
        attempts: order.internal.attempts + 1,
        lastStatusCode: null,
        lastResponse: { error: error.message },
        sentAt: order.internal.sentAt
      },
      status: Status.INTERNAL_SEND_FAILED
    }, "INTERNAL_FAILED", { error: error.message });
    return { status: 502, body: sanitizeOrder(store.getOrder(orderId), true) };
  }
}

function verificationPage(order) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>일회용 인증번호 입력</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #172033; }
    main { max-width: 480px; margin: 8vh auto; padding: 28px; background: #fff; border: 1px solid #d9dee8; border-radius: 8px; }
    label, input, button { display: block; width: 100%; box-sizing: border-box; }
    input { margin: 8px 0 16px; padding: 12px; border: 1px solid #c8ced8; border-radius: 6px; font-size: 16px; }
    button { padding: 12px; border: 0; border-radius: 6px; background: #1f6feb; color: #fff; font-weight: 700; }
    p { line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>일회용 인증번호 입력</h1>
    <p>${order.buyer.name}님, 관세청에서 이메일로 받은 일회용 인증번호를 입력해주세요.</p>
    <form method="post" action="/api/buyer/verification-code">
      <input type="hidden" name="orderId" value="${order.orderId}">
      <label for="verificationCode">인증번호</label>
      <input id="verificationCode" name="verificationCode" autocomplete="one-time-code" required>
      <button type="submit">제출</button>
    </form>
  </main>
</body>
</html>`;
}

async function createApp(options = {}) {
  const store = options.store || new JsonStore(config.databaseFile);

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    try {
      if (req.method === "GET" && path === "/health") {
        return json(res, 200, { ok: true, service: "customs-api-relay" });
      }

      if (req.method === "POST" && path === "/api/client/orders") {
        if (!requireClient(req, res)) return;
        const payload = await readJson(req);
        const validationErrors = validateOrderPayload(payload);
        const order = createInitialOrder(payload, validationErrors);
        try {
          store.createOrder(order);
        } catch (error) {
          if (error.code === "DUPLICATE_ORDER") return json(res, 409, { error: "Duplicate orderId." });
          throw error;
        }
        if (validationErrors.length) return json(res, 422, sanitizeOrder(order, true));
        return json(res, 201, sanitizeOrder(order, true));
      }

      const clientStatusMatch = path.match(/^\/api\/client\/orders\/([^/]+)\/status$/);
      if (req.method === "GET" && clientStatusMatch) {
        if (!requireClient(req, res)) return;
        const order = store.getOrder(decodeURIComponent(clientStatusMatch[1]));
        if (!order) return json(res, 404, { error: "Order not found." });
        return json(res, 200, {
          orderId: order.orderId,
          status: order.status,
          validationErrors: order.validationErrors,
          customs: order.customs,
          verification: { ...order.verification, code: order.verification.code ? "********" : null },
          internal: order.internal
        });
      }

      if (req.method === "POST" && path === "/api/customs/orders") {
        if (!requireAdmin(req, res)) return;
        const payload = await readJson(req);
        const result = await sendToCustoms(store, payload.orderId);
        return json(res, result.status, result.body);
      }

      if (req.method === "POST" && path === "/api/messages/verification-request") {
        if (!requireAdmin(req, res)) return;
        const payload = await readJson(req);
        const result = await sendVerificationRequest(store, payload.orderId);
        return json(res, result.status, result.body);
      }

      if (req.method === "POST" && path === "/api/buyer/verification-code") {
        const contentType = req.headers["content-type"] || "";
        let payload;
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          payload = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
        } else {
          payload = await readJson(req);
        }
        const order = store.getOrder(payload.orderId);
        if (!order) return json(res, 404, { error: "Order not found." });
        if (!payload.verificationCode || String(payload.verificationCode).trim().length < 4) {
          return json(res, 422, { error: "verificationCode is required." });
        }
        if (order.verification.expiresAt && new Date(order.verification.expiresAt).getTime() < Date.now()) {
          store.updateOrder(order.orderId, {
            verification: { ...order.verification, status: VerificationStatus.EXPIRED },
            status: Status.VERIFICATION_REQUEST_SENT
          }, "VERIFICATION_EXPIRED");
          return json(res, 410, { error: "Verification request expired." });
        }
        const updated = store.updateOrder(order.orderId, {
          status: Status.VERIFICATION_CODE_RECEIVED,
          verification: {
            ...order.verification,
            status: VerificationStatus.RECEIVED,
            code: String(payload.verificationCode).trim(),
            receivedAt: new Date().toISOString()
          }
        }, "VERIFICATION_CODE_RECEIVED");
        const result = await sendToInternal(store, updated.orderId);
        if (contentType.includes("application/x-www-form-urlencoded")) {
          return html(res, 200, "<!doctype html><html lang=\"ko\"><body><h1>제출 완료</h1><p>인증번호가 접수되었습니다.</p></body></html>");
        }
        return json(res, result.status, result.body);
      }

      if (req.method === "POST" && path === "/api/internal/orders") {
        if (!requireAdmin(req, res)) return;
        const payload = await readJson(req);
        const result = await sendToInternal(store, payload.orderId);
        return json(res, result.status, result.body);
      }

      if (req.method === "GET" && path === "/api/admin/orders") {
        if (!requireAdmin(req, res)) return;
        return json(res, 200, {
          orders: store.listOrders({
            status: url.searchParams.get("status") || "",
            clientId: url.searchParams.get("clientId") || ""
          }).map((order) => sanitizeOrder(order))
        });
      }

      const retryMatch = path.match(/^\/api\/admin\/retry\/([^/]+)$/);
      if (req.method === "POST" && retryMatch) {
        if (!requireAdmin(req, res)) return;
        const orderId = decodeURIComponent(retryMatch[1]);
        const order = store.getOrder(orderId);
        if (!order) return json(res, 404, { error: "Order not found." });
        let result;
        if ([Status.RECEIVED, Status.CUSTOMS_SEND_FAILED].includes(order.status)) {
          result = await sendToCustoms(store, orderId);
        } else if ([Status.WAITING_VERIFICATION_CODE, Status.VERIFICATION_REQUEST_SENT].includes(order.status)) {
          result = await sendVerificationRequest(store, orderId);
        } else if ([Status.VERIFICATION_CODE_RECEIVED, Status.INTERNAL_SEND_FAILED].includes(order.status)) {
          result = await sendToInternal(store, orderId);
        } else {
          return json(res, 409, { error: `No retry action for status ${order.status}.` });
        }
        return json(res, result.status, result.body);
      }

      const buyerPageMatch = path.match(/^\/buyer\/verification\/([^/]+)$/);
      if (req.method === "GET" && buyerPageMatch) {
        const order = store.getOrder(decodeURIComponent(buyerPageMatch[1]));
        if (!order) return html(res, 404, "<!doctype html><html><body><h1>주문을 찾을 수 없습니다.</h1></body></html>");
        return html(res, 200, verificationPage(order));
      }

      return json(res, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof SyntaxError) return json(res, 400, { error: "Invalid JSON body." });
      return json(res, 500, { error: "Internal server error.", detail: error.message });
    }
  }

  return { handler, store };
}

async function startServer() {
  const { handler } = await createApp();
  const server = http.createServer(handler);
  server.listen(config.port, () => {
    console.log(`Customs API relay listening on http://localhost:${config.port}`);
  });
  return server;
}

module.exports = {
  createApp,
  startServer,
  sendToCustoms,
  sendVerificationRequest,
  sendToInternal
};
