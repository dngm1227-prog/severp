function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value) {
  return /^\+?[0-9-]{8,20}$/.test(value);
}

function isPersonalCustomsCode(value) {
  return /^P[0-9]{12}$/i.test(value);
}

function validateOrderPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["Request body must be a JSON object."];
  }

  if (!isNonEmptyString(payload.orderId)) errors.push("orderId is required.");
  if (!isNonEmptyString(payload.clientId)) errors.push("clientId is required.");
  if (!payload.buyer || typeof payload.buyer !== "object") errors.push("buyer is required.");
  if (!payload.shipping || typeof payload.shipping !== "object") errors.push("shipping is required.");
  if (!Array.isArray(payload.items) || payload.items.length === 0) errors.push("items must contain at least one item.");

  if (payload.buyer) {
    if (!isNonEmptyString(payload.buyer.name)) errors.push("buyer.name is required.");
    if (!isEmail(payload.buyer.email || "")) errors.push("buyer.email must be valid.");
    if (!isPhone(payload.buyer.phone || "")) errors.push("buyer.phone must be valid.");
    if (!isPersonalCustomsCode(payload.buyer.personalCustomsCode || "")) {
      errors.push("buyer.personalCustomsCode must match P followed by 12 digits.");
    }
  }

  if (payload.shipping && !isNonEmptyString(payload.shipping.address)) {
    errors.push("shipping.address is required.");
  }

  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, index) => {
      if (!isNonEmptyString(item?.name)) errors.push(`items[${index}].name is required.`);
      if (!Number.isFinite(Number(item?.quantity)) || Number(item.quantity) <= 0) {
        errors.push(`items[${index}].quantity must be greater than 0.`);
      }
      if (!Number.isFinite(Number(item?.amount)) || Number(item.amount) < 0) {
        errors.push(`items[${index}].amount must be 0 or greater.`);
      }
    });
  }

  return errors;
}

function normalizeOrderPayload(payload) {
  return {
    orderId: String(payload.orderId).trim(),
    clientId: String(payload.clientId).trim(),
    buyer: {
      name: String(payload.buyer.name).trim(),
      email: String(payload.buyer.email).trim().toLowerCase(),
      phone: String(payload.buyer.phone).trim(),
      personalCustomsCode: String(payload.buyer.personalCustomsCode).trim().toUpperCase()
    },
    shipping: {
      address: String(payload.shipping.address).trim(),
      postalCode: payload.shipping.postalCode ? String(payload.shipping.postalCode).trim() : ""
    },
    items: payload.items.map((item) => ({
      name: String(item.name).trim(),
      quantity: Number(item.quantity),
      amount: Number(item.amount),
      currency: item.currency ? String(item.currency).trim().toUpperCase() : "KRW"
    })),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
  };
}

module.exports = { validateOrderPayload, normalizeOrderPayload };
