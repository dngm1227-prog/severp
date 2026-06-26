async function postJson(url, payload, timeoutMs) {
  if (!url) {
    return {
      ok: true,
      status: 200,
      body: {
        simulated: true,
        receivedAt: new Date().toISOString()
      }
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function toCustomsPayload(order) {
  return {
    orderId: order.orderId,
    buyer: {
      name: order.buyer.name,
      email: order.buyer.email,
      personalCustomsCode: order.buyer.personalCustomsCode
    },
    shipping: order.shipping,
    items: order.items
  };
}

function toInternalPayload(order) {
  return {
    orderId: order.orderId,
    clientId: order.clientId,
    buyer: order.buyer,
    shipping: order.shipping,
    items: order.items,
    verificationCode: order.verification.code,
    customs: order.customs
  };
}

function toVerificationMessage(order, publicBaseUrl) {
  const url = `${publicBaseUrl}/buyer/verification/${encodeURIComponent(order.orderId)}`;
  return {
    orderId: order.orderId,
    channelPriority: ["KAKAO", "SMS"],
    to: order.buyer.phone,
    message: `관세청에서 이메일로 받은 일회용 인증번호를 입력해주세요: ${url}`,
    url
  };
}

module.exports = {
  postJson,
  toCustomsPayload,
  toInternalPayload,
  toVerificationMessage
};
