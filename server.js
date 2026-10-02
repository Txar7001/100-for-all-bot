require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const PORT = Number(process.env.PORT || 10000);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const WEBHOOK_PATH = "/telegram-webhook";
const ADMIN_ID = String(process.env.ADMIN_ID || "6287249334");
const GROUP_ID = process.env.GROUP_ID ? String(process.env.GROUP_ID) : null;
const db = new Database(process.env.DB_PATH || "100fa.db");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "miniapp")));

// Keep existing databases compatible with the new card fields.
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT NOT NULL,
    member_number TEXT UNIQUE NOT NULL,
    joined_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'GROUP_MEMBER',
    verify_token TEXT UNIQUE
  );
`);
const columns = new Set(db.prepare("PRAGMA table_info(members)").all().map((c) => c.name));
if (!columns.has("verify_token")) db.exec("ALTER TABLE members ADD COLUMN verify_token TEXT");
if (!columns.has("status")) db.exec("ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'GROUP_MEMBER'");

function displayName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Member";
}

function nextMemberNumber() {
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM members").get();
  return `100FA-${String(row.next_id).padStart(4, "0")}`;
}

function createToken() {
  return crypto.randomBytes(18).toString("hex");
}

function getMember(telegramId) {
  return db.prepare("SELECT * FROM members WHERE telegram_id = ?").get(String(telegramId));
}

function getMemberByToken(token) {
  return db.prepare("SELECT * FROM members WHERE verify_token = ?").get(String(token));
}

function registerMember(user, status = "GROUP_MEMBER") {
  const telegramId = String(user.id);
  const existing = getMember(telegramId);
  if (existing) return existing;

  const memberNumber = nextMemberNumber();
  const joinedAt = new Date().toISOString();
  const token = createToken();
  db.prepare(`
    INSERT INTO members (telegram_id, username, display_name, member_number, joined_at, status, verify_token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(telegramId, user.username || null, displayName(user), memberNumber, joinedAt, status, token);
  console.log(`New member ${memberNumber}: ${displayName(user)}`);
  return getMember(telegramId);
}

function ensureMember(user) {
  return getMember(user.id) || registerMember(user);
}

function cardUrl(member) {
  return `${PUBLIC_URL || "https://one00-for-all-bot.onrender.com"}/?member=${encodeURIComponent(member.verify_token)}`;
}

async function sendCardMenu(ctx, member) {
  await ctx.reply(
    `💯 *100 Foundation*\n\nWelcome, ${member.display_name}!\n\nYour digital member card is ready.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.webApp("🪪 Open Digital Member Card", cardUrl(member))],
        [Markup.button.callback("🔄 Refresh My Card", "MY_CARD")]
      ])
    }
  );
}

// Group joins reserve a permanent serial. Telegram does not permit a bot to
// start a private chat with a user who has never opened the bot, so the group
// message contains a deep link for the member to open the card privately.
bot.on("new_chat_members", async (ctx) => {
  try {
    for (const user of ctx.message.new_chat_members || []) {
      if (!user.is_bot) registerMember(user, "GROUP_MEMBER");
    }
    await ctx.deleteMessage().catch(() => {});
  } catch (error) {
    console.error("Group join handler error:", error);
  }
});

bot.start(async (ctx) => {
  const member = ensureMember(ctx.from);
  await sendCardMenu(ctx, member);
});

bot.command("mycard", async (ctx) => {
  await sendCardMenu(ctx, ensureMember(ctx.from));
});

bot.action("MY_CARD", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await sendCardMenu(ctx, ensureMember(ctx.from));
  } catch (error) {
    console.error("Card action error:", error);
  }
});

bot.command("members", async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  const members = db.prepare(`
    SELECT member_number, display_name, status
    FROM members
    ORDER BY id ASC
  `).all();

  if (members.length === 0) {
    await ctx.reply("💯 100 Foundation\n\nNo members registered yet.");
    return;
  }

  const header = `💯 100 Foundation\n👥 Total members: ${members.length}\n\n`;
  const lines = members.map((member, index) =>
    `${index + 1}. ${member.member_number} | ${member.display_name} | ${member.status}`
  );

  // Telegram messages have a length limit, so send the complete list in
  // multiple messages when the community grows.
  let message = header;
  for (const line of lines) {
    if ((message + line + "\n").length > 3800) {
      await ctx.reply(message.trim());
      message = "📋 Continued member list\n\n";
    }
    message += `${line}\n`;
  }
  if (message.trim()) await ctx.reply(message.trim());
});

bot.command("id", async (ctx) => {
  const member = ensureMember(ctx.from);
  await ctx.reply(`🪪 Your Member ID: ${member.member_number}\nStatus: ${member.status}`);
});

bot.catch((error) => console.error("Bot error:", error));

function validateTelegramInitData(initData) {
  const params = new URLSearchParams(initData || "");
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(receivedHash))) return null;
  try { return JSON.parse(params.get("user")); } catch { return null; }
}

// Telegram Mini App endpoint: authenticates the Telegram user and creates a
// card record if needed, so a user can recover their card at any time.
app.get("/api/member", async (req, res) => {
  const user = validateTelegramInitData(req.headers["x-telegram-init-data"]);
  if (!user || !user.id) return res.status(401).json({ success: false, error: "Open this card from Telegram." });
  const member = ensureMember(user);
  const verifyUrl = `${PUBLIC_URL || "https://one00-for-all-bot.onrender.com"}/verify/${member.verify_token}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 180 });
  res.json({ success: true, member: {
    member_number: member.member_number,
    display_name: member.display_name,
    joined_at: member.joined_at,
    status: member.status,
    verify_url: verifyUrl,
    qr_data_url: qrDataUrl
  }});
});

app.get("/verify/:token", (req, res) => {
  const member = getMemberByToken(req.params.token);
  if (!member) return res.status(404).send("Member card not found");
  res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>100 Foundation Verification</title><style>body{font-family:Arial,sans-serif;background:#f3f6f8;padding:32px}.box{max-width:420px;margin:auto;background:white;border-radius:20px;padding:28px;box-shadow:0 8px 30px #0001}h1{color:#16324f}.ok{color:#16804b;font-weight:700}.label{color:#64748b;font-size:12px;text-transform:uppercase;margin-top:18px}.value{font-size:19px;margin-top:4px}</style><div class="box"><h1>100 Foundation</h1><p class="ok">✓ Verified member card</p><div class="label">Member ID</div><div class="value">${member.member_number}</div><div class="label">Name</div><div class="value">${escapeHtml(member.display_name)}</div><div class="label">Status</div><div class="value">${escapeHtml(member.status)}</div></div>`);
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "100-foundation-bot" }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "miniapp", "index.html")));

// Webhook only. Do not add bot.launch(): polling causes Telegram 409 conflicts.
app.use(bot.webhookCallback(WEBHOOK_PATH));

app.listen(PORT, async () => {
  console.log(`100 Foundation server running on port ${PORT}`);
  if (PUBLIC_URL) {
    try {
      await bot.telegram.setWebhook(`${PUBLIC_URL}${WEBHOOK_PATH}`);
      console.log(`Telegram webhook configured: ${PUBLIC_URL}${WEBHOOK_PATH}`);
    } catch (error) {
      console.error("Webhook setup failed:", error.message);
    }
  } else {
    console.warn("PUBLIC_URL/RENDER_EXTERNAL_URL missing; webhook was not configured.");
  }
});
