const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const webhook = require("../api/webhook");

const originalEnvironment = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_OWNER_ID: process.env.TELEGRAM_OWNER_ID,
  TELEGRAM_GROUP_ID: process.env.TELEGRAM_GROUP_ID,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
};
const originalFetch = global.fetch;
const originalConsoleError = console.error;
const secret = "test-webhook-secret";

function configureEnvironment() {
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  process.env.TELEGRAM_OWNER_ID = "123456789";
  delete process.env.TELEGRAM_GROUP_ID;
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
}

function createResponse() {
  return {
    headers: {},
    statusCode: undefined,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invokeWebhook({ method = "POST", body, headers = {} } = {}) {
  const res = createResponse();
  await webhook({ method, body, headers }, res);
  return res;
}

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  global.fetch = originalFetch;
  console.error = originalConsoleError;
});

test("forwards an incoming message to the configured group", async () => {
  configureEnvironment();
  process.env.TELEGRAM_GROUP_ID = "-553766030001";
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const res = await invokeWebhook({
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: { message: { chat: { id: 42 }, message_id: 7 } },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(
    request.url,
    "https://api.telegram.org/bottest-bot-token/forwardMessage",
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    chat_id: "-553766030001",
    from_chat_id: 42,
    message_id: 7,
  });
});

test("falls back to the owner when the group ID is unset or empty", async (t) => {
  for (const groupId of [undefined, ""]) {
    await t.test(`group ID ${groupId === undefined ? "unset" : "empty"}`, async () => {
      configureEnvironment();
      if (groupId !== undefined) {
        process.env.TELEGRAM_GROUP_ID = groupId;
      }
      let request;
      global.fetch = async (_url, options) => {
        request = options;
        return { ok: true, json: async () => ({ ok: true }) };
      };

      const res = await invokeWebhook({
        headers: { "x-telegram-bot-api-secret-token": secret },
        body: { message: { chat: { id: 42 }, message_id: 7 } },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(request.body).chat_id, "123456789");
    });
  }
});

test("rejects requests with an invalid webhook secret", async () => {
  configureEnvironment();
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  const res = await invokeWebhook({
    headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
    body: { message: { chat: { id: 42 }, message_id: 7 } },
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Unauthorized" });
});

test("acknowledges updates that do not contain a message", async () => {
  configureEnvironment();
  global.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  const res = await invokeWebhook({
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: { update_id: 1 },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("rejects methods other than POST", async () => {
  const res = await invokeWebhook({ method: "GET" });

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});

test("reports Telegram forwarding failures so Telegram can retry", async () => {
  configureEnvironment();
  process.env.TELEGRAM_GROUP_ID = "-553766030001";
  const errors = [];
  console.error = (...args) => errors.push(args);
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: false }),
  });

  const res = await invokeWebhook({
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: { message: { chat: { id: 42 }, message_id: 7 } },
  });

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: "Failed to forward message" });
  assert.equal(errors.length, 1);
});
