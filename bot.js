require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const Database = require("better-sqlite3");

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Database("members.db");

// ===============================
// DATABASE
// ===============================

db.prepare(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT,
    display_name TEXT NOT NULL,
    member_number TEXT UNIQUE NOT NULL,
    joined_at TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE'
  )
`).run();


// ===============================
// GET MEMBER
// ===============================

function getMember(telegramId) {
  return db
    .prepare("SELECT * FROM members WHERE telegram_id = ?")
    .get(String(telegramId));
}


// ===============================
// REGISTER MEMBER
// ===============================

function registerMember(user) {

  const telegramId = String(user.id);

  // Already registered
  const existing = getMember(telegramId);

  if (existing) {
    return existing;
  }

  // Next permanent ID
  const nextId = db
    .prepare(
      "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM members"
    )
    .get().next_id;

  const memberNumber =
    `100FA-${String(nextId).padStart(4, "0")}`;

  const displayName =
    [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ") || "Member";

  const username = user.username || null;

  const joinedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO members
    (
      telegram_id,
      username,
      display_name,
      member_number,
      joined_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    telegramId,
    username,
    displayName,
    memberNumber,
    joinedAt
  );

  console.log(
    `New Member: ${displayName} → ${memberNumber}`
  );

  return getMember(telegramId);
}


// ===============================
// GROUP JOIN
// ===============================

bot.on("new_chat_members", async (ctx) => {

  for (const user of ctx.message.new_chat_members) {

    // Ignore bots
    if (user.is_bot) continue;

    registerMember(user);

    // IMPORTANT:
    // No group welcome message.
  }
});


// ===============================
// /START
// ===============================

bot.start(async (ctx) => {

  const member = getMember(ctx.from.id);

  if (!member) {

    return ctx.reply(
      `👋 Welcome to 100 For All!\n\n` +
      `You are not registered yet.\n\n` +
      `Please join our official 100 For All group first.`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "🪪 Check My Member Number",
            "MY_MEMBER_NUMBER"
          )
        ]
      ])
    );
  }

  await ctx.reply(
    `💯 *100 For All*\n\n` +
    `Welcome, ${member.display_name}!\n\n` +
    `Tap the button below to view your Member Number.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "🪪 My Member Number",
            "MY_MEMBER_NUMBER"
          )
        ]
      ])
    }
  );
});


// ===============================
// MY MEMBER NUMBER BUTTON
// ===============================

bot.action("MY_MEMBER_NUMBER", async (ctx) => {

  try {
    const member = getMember(ctx.from.id);

    if (!member) {
      await ctx.reply(
        `❌ You are not registered yet.\n\n` +
        `Please join the 100 For All group first.`
      );
      return;
    }

    await ctx.reply(
      `🪪 *100 For All Member*\n\n` +
      `👤 ${member.display_name}\n\n` +
      `Member Number:\n` +
      `*${member.member_number}*\n\n` +
      `🟢 Status: ${member.status}\n\n` +
      `Please keep your Member Number safe.`,
      {
        parse_mode: "Markdown"
      }
    );

    try {
      await ctx.answerCbQuery();
    } catch (error) {
      console.log("Callback expired - ignored");
    }

  } catch (error) {
    console.error("Member button error:", error);
  }
});
// ===============================
// /ID
// ===============================

bot.command("id", async (ctx) => {

  const member = getMember(ctx.from.id);

  if (!member) {

    return ctx.reply(
      `❌ You are not registered yet.\n\n` +
      `Join the 100 For All group first.`
    );
  }

  await ctx.reply(
    `🪪 *100 For All Member*\n\n` +
    `Member Number:\n` +
    `*${member.member_number}*\n\n` +
    `👤 ${member.display_name}\n` +
    `🟢 ${member.status}`,
    {
      parse_mode: "Markdown"
    }
  );
});


// ===============================
// /MEMBERS
// ===============================

bot.command("members", (ctx) => {

  const result = db
    .prepare(
      "SELECT COUNT(*) AS total FROM members"
    )
    .get();

  ctx.reply(
    `💯 *100 For All*\n\n` +
    `👥 Total Members: *${result.total}*`,
    {
      parse_mode: "Markdown"
    }
  );
});
// ===============================
// /GETMEMBER
// ===============================

bot.command("getmember", async (ctx) => {

  await ctx.reply(
    `💯 *100 For All*\n\n` +
    `🪪 Member Number ရယူရန် အောက်က Button ကိုနှိပ်ပါ။`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.url(
            "🪪 Get Member Number",
            "https://t.me/forallmenber_bot?start=member"
          )
        ]
      ])
    }
  );
});


// ===============================
// ERROR HANDLER
// ===============================

bot.catch((err, ctx) => {
  console.error("Bot Error:", err);
});


// ===============================
// START BOT
// ===============================

bot.launch();

console.log("💯 100 For All Bot is running...");