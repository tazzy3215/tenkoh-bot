// =============================
// Render 用：HTTP サーバー（必須）
// =============================
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running');
}).listen(process.env.PORT || 3000);

// =============================
// エラーを確実にログに出す（超重要）
// =============================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

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
// Google Sheets API 認証
// =============================
let auth;
try {
  auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} catch (err) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT_JSON の解析に失敗:", err);
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
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: '点呼表!A:A',
    });
    const ids = sheetData.data.values?.flat() || [];
    let rowIndex = ids.indexOf(userId);

    // 見つからなければ名簿から探して追加
    if (rowIndex === -1) {
      const roster = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: '名簿!A:C',
      });
      const rosterRows = roster.data.values || [];
      let found = null;

      for (let i = 0; i < rosterRows.length; i++) {
        if (rosterRows[i][0] === userId) {
          found = rosterRows[i];
          break;
        }
      }

      if (!found) return;

      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: '点呼表!A:C',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [found] },
      });

      const updated = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: '点呼表!A:A',
      });
      const updatedIds = updated.data.values?.flat() || [];
      rowIndex = updatedIds.indexOf(userId);
    }

    const targetRow = rowIndex + 1;

    // スプレッドシートに書き込み
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `点呼表!${targetColumn}${targetRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[mark]],
      },
    });

  } catch (err) {
    console.error('Error in messageReactionAdd:', err);
  }
});

// =============================
// Bot 起動
// =============================
client.login(process.env.DISCORD_TOKEN);
