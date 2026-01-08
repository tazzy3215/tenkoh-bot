// =============================
// Render 用：HTTP サーバー（必須）
// =============================
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running');
}).listen(process.env.PORT || 3000);

// =============================
// エラーを確実にログに出す
// =============================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// =============================
// 環境変数チェック
// =============================
console.log("ENV CHECK START");
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "OK" : "MISSING");
console.log("GOOGLE_JSON:", process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "OK" : "MISSING");
console.log("SPREADSHEET_ID:", process.env.SPREADSHEET_ID ? "OK" : "MISSING");
console.log("CHANNEL_ID:", process.env.CHANNEL_ID ? "OK" : "MISSING");
console.log("ENV CHECK END");

// =============================
// Discord & Google API 読み込み
// =============================
const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
require('dotenv').config();

// =============================
// Discord Bot 初期化
// =============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// =============================
// Google Sheets API 認証（try/catch追加）
// =============================
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

// =============================
// 設定：対象列（E〜K）
// =============================
const TARGET_COLUMNS = ['E', 'F', 'G', 'H', 'I', 'J', 'K'];

// =============================
// Bot 起動時：投稿IDにリアクション付与（A）
// =============================
client.once('ready', async () => {
  console.log('Bot is ready!');

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

      try {
        const message = await channel.messages.fetch(postId);
        await message.react('⭕');
        await message.react('△');
        await message.react('❌');
        console.log(`リアクション付与完了：${col}列`);
      } catch {
        console.log(`メッセージ取得失敗：${postId}`);
      }
    }
  } catch (err) {
    console.error("❌ ready 内でエラー:", err);
  }
});

// =============================
// リアクション検知 → スプレッドシート書き込み（B）
// =============================
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;

    const message = reaction.message;
    const emoji = reaction.emoji.name;
    const userId = user.id;

    let mark = '';
    if (emoji === '⭕') mark = '〇';
    else if (emoji === '△') mark = '△';
    else if (emoji === '❌') mark = '×';
    else return;

    // 投稿IDがどの列か判定
    let targetColumn = null;
    for (const col of TARGET_COLUMNS) {
      const res = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `点呼表!${col}2`,
      });
      const postId = res.data.values?.[0]?.[0] || null;
      if (postId === message.id) {
        targetColumn = col;
        break;
      }
    }
    if (!targetColumn) return;

    // 点呼表の A列で Discord ID を検索
    const sheetData = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: process.env.SP
