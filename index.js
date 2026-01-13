// ===============================
// 1. Webサーバー（Render用）
// ===============================
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.status(200).send('Bot is running');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Web server is running');
});

// ===============================
// 2. エラーハンドリング
// ===============================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ===============================
// 3. 環境変数チェック
// ===============================
console.log("ENV CHECK START");
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "OK" : "MISSING");
console.log("GOOGLE_JSON:", process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "OK" : "MISSING");
console.log("SPREADSHEET_ID:", process.env.SPREADSHEET_ID ? "OK" : "MISSING");
console.log("CHANNEL_ID:", process.env.CHANNEL_ID ? "OK" : "MISSING");
console.log("ENV CHECK END");

// ===============================
// 4. Discord & Google API
// ===============================
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { google } = require('googleapis');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.on("error", console.error);
client.on("shardError", console.error);

// ===============================
// 5. Google Sheets 認証
// ===============================
let auth;
try {
  auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  console.log("GoogleAuth OK");
} catch (err) {
  console.error("❌ GoogleAuth ERROR:", err);
}

const sheetsClient = google.sheets({ version: 'v4', auth });

(async () => {
  try {
    await sheetsClient.spreadsheets.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
    });
    console.log("Sheets API OK");
  } catch (err) {
    console.error("❌ Sheets API ERROR:", err);
  }
})();

// ===============================
// 6. 点呼処理（リアクション付与）
// ===============================
const TARGET_COLUMNS = ['E', 'F', 'G', 'H', 'I', 'J', 'K'];

// ★★★ 追加：リアクション付与処理を関数化 ★★★
async function addReactionsIfNeeded() {
  try {
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);

    for (const col of TARGET_COLUMNS) {
      const postedRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `点呼表!${col}1`,
      });

      const posted = postedRes.data.values?.[0]?.[0] || '';
      if (posted !== 'POSTED') continue;

      const idRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `点呼表!${col}2`,
      });

      const postId = idRes.data.values?.[0]?.[0] || null;
      if (!postId) continue;

      let message = null;

      try {
        message = await channel.messages.fetch(postId);
      } catch {
        console.log(`fetch 失敗 → fallbackへ：${postId}`);
      }

      if (!message) {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });
          message = messages.get(postId);
        } catch {
          console.log(`fallback 取得失敗：${postId}`);
        }
      }

      if (!message) {
        console.log(`メッセージ取得失敗（完全に見つからず）：${postId}`);
        continue;
      }

      // ★ すでにリアクションが付いている場合はスキップ
      if (message.reactions.cache.size > 0) {
        continue;
      }

      try {
        await message.react('⭕');
        await message.react('🔺');
        await message.react('❌');
        console.log(`リアクション付与完了：${col}列`);
      } catch (err) {
        console.log(`リアクション付与失敗：${postId}`, err);
      }
    }
  } catch (err) {
    console.error("❌ addReactionsIfNeeded 内でエラー:", err);
  }
}

// ===============================
// 7. ready（起動時 + 定期実行）
// ===============================
client.once('ready', async () => {
  console.log('Bot is ready!');

  // 起動時に1回実行
  await addReactionsIfNeeded();

  // ★★★ 追加：30秒ごとにチェック ★★★
  setInterval(addReactionsIfNeeded, 30 * 1000);
});

// ===============================
// 8. リアクション処理（既存）
// ===============================
client.on('messageReactionAdd', async (reaction, user) => {
  // （ここはあなたのコードをそのまま残しています）
  // 省略
});

// ===============================
// 9. Discordログイン
// ===============================
console.log("Before client.login");
client.login(process.env.DISCORD_TOKEN);
console.log("After client.login");
