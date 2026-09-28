const { timingSafeEqual } = require("node:crypto");

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

function isValidSecret(received, expected) {
  if (typeof received !== "string") {
    return false;
  }

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

module.exports = async function webhook(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const { TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID, TELEGRAM_WEBHOOK_SECRET } =
    process.env;

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_OWNER_ID ||
    !/^[1-9]\d*$/.test(TELEGRAM_OWNER_ID) ||
    !TELEGRAM_WEBHOOK_SECRET ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(TELEGRAM_WEBHOOK_SECRET)
  ) {
    console.error("Telegram webhook environment variables are missing or invalid");
    return sendJson(res, 500, { error: "Webhook is not configured" });
  }

  if (
    !isValidSecret(
      req.headers["x-telegram-bot-api-secret-token"],
      TELEGRAM_WEBHOOK_SECRET,
    )
  ) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const message = req.body && req.body.message;
  if (!message) {
    return sendJson(res, 200, { ok: true });
  }

  const chatId = message.chat && message.chat.id;
  const validChatId =
    Number.isSafeInteger(chatId) ||
    (typeof chatId === "string" && /^-?\d+$/.test(chatId));
  if (
    !validChatId ||
    !Number.isSafeInteger(message.message_id) ||
    message.message_id < 1
  ) {
    return sendJson(res, 400, { error: "Invalid Telegram update" });
  }

  let telegramResponse;
  let result;
  try {
    telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/forwardMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_OWNER_ID,
          from_chat_id: chatId,
          message_id: message.message_id,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    result = await telegramResponse.json();
  } catch {
    console.error("Telegram forwardMessage request failed");
    return sendJson(res, 502, { error: "Failed to forward message" });
  }

  if (!telegramResponse.ok || !result || result.ok !== true) {
    console.error("Telegram forwardMessage returned an error");
    return sendJson(res, 502, { error: "Failed to forward message" });
  }

  return sendJson(res, 200, { ok: true });
};
