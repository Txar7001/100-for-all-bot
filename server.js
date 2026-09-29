require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply(
    "💯 100 For All\n\n" +
    "Get your Digital Member Card 👇",
    Markup.inlineKeyboard([
      [
        Markup.button.webApp(
          "🪪 Get Member Card",
          "https://one00-for-all-bot.onrender.com"
        )
      ]
    ])
  );
});

bot.command("id", async (ctx) => {
  await ctx.reply(`Your Telegram ID: ${ctx.from.id}`);
});

const ADMIN_ID = "6287249334";

bot.command("members", async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) {
    return;
  }

  const members = db
    .prepare(`
      SELECT member_number, display_name, status
      FROM members
      ORDER BY id ASC
    `)
    .all();

  if (members.length === 0) {
    return ctx.reply("💯 No members yet.");
  }

  let message = "💯 100 For All Members\n\n";

  for (const member of members) {
    message +=
      `${member.member_number} — ${member.display_name} — ${member.status}\n`;
  }

  message += `\nTotal Members: ${members.length}`;

  await ctx.reply(message);
});

bot.command("menu", async (ctx) => {
  await ctx.reply(
    "💯 100 For All\n\n" +
    "🪪 Get your Digital Member Card\n\n" +
    "Tap the button below to open your member card.",
    Markup.inlineKeyboard([
      [
        Markup.button.url(
          "🪪 Get Member Card",
          "https://t.me/forallmember_bot"
        )
      ]
    ])
  );
});

const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database("100fa.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT NOT NULL,
    member_number TEXT UNIQUE NOT NULL,
    joined_at TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE'
  )
`);
bot.on("new_chat_members", async (ctx) => {
  try {
    for (const user of ctx.message.new_chat_members) {
      const telegramId = String(user.id);

      const existing = db
        .prepare("SELECT * FROM members WHERE telegram_id = ?")
        .get(telegramId);

      if (existing) {
        continue;
      }

      const next = db
        .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM members")
        .get();

      const memberNumber =
        `100FA-${String(next.nextId).padStart(4, "0")}`;

      const displayName =
        [user.first_name, user.last_name]
          .filter(Boolean)
          .join(" ") || "Member";

      const joinedAt = new Date().toISOString();

      db.prepare(`
        INSERT INTO members
        (
          telegram_id,
          username,
          display_name,
          member_number,
          joined_at,
          status
        )
        VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `).run(
        telegramId,
        user.username || null,
        displayName,
        memberNumber,
        joinedAt
      );
    }

    // Delete the group join notification
    await ctx.deleteMessage();

  } catch (error) {
    console.error("Silent member registration error:", error);
  }
});
function validateTelegramInitData(initData) {
  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");

  if (!receivedHash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== receivedHash) {
    return null;
  }

  const userString = params.get("user");

  if (!userString) {
    return null;
  }

  try {
    return JSON.parse(userString);
  } catch {
    return null;
  }
}

app.use(express.json());

app.use(express.static(path.join(__dirname, "miniapp")));

app.get("/api/member", (req, res) => {
  const initData = req.headers["x-telegram-init-data"];

  if (!initData) {
    return res.status(401).json({
      success: false,
      error: "Telegram initData missing"
    });
  }

  const user = validateTelegramInitData(initData);

  if (!user || !user.id) {
    return res.status(403).json({
      success: false,
      error: "Invalid Telegram authentication"
    });
  }

  let member = db
    .prepare("SELECT * FROM members WHERE telegram_id = ?")
    .get(String(user.id));

  if (!member) {
    const displayName =
      [user.first_name, user.last_name]
        .filter(Boolean)
        .join(" ") || "Member";

    const next = db
      .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM members")
      .get();

    const memberNumber =
      `100FA-${String(next.nextId).padStart(4, "0")}`;

    const joinedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO members
      (
        telegram_id,
        username,
        display_name,
        member_number,
        joined_at,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      String(user.id),
      user.username || null,
      displayName,
      memberNumber,
      joinedAt
    );

    member = db
      .prepare("SELECT * FROM members WHERE telegram_id = ?")
      .get(String(user.id));
  }

  res.json({
    success: true,
    member: {
      member_number: member.member_number,
      display_name: member.display_name,
      joined_at: member.joined_at,
      status: member.status
    }
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "miniapp", "index.html"));
});

app.listen(PORT, () => {
  console.log(`100 For All server running on port ${PORT}`);
});
bot.launch();

console.log("💯 100 For All Bot is running...");