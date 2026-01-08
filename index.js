const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running');
}).listen(process.env.PORT || 3000);

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

console.log("ENV CHECK START");
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "OK" : "MISSING");
console.log("GOOGLE_JSON:", process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "OK" : "MISSING");
console.log("SPREADSHEET_ID:", process.env.SPREADSHEET_ID ? "OK" : "MISSING");
console.log("CHANNEL_ID:", process.env.CHANNEL_ID ? "OK" : "MISSING");
console.log("ENV CHECK END");

const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

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

const TARGET_COLUMNS = ['E', 'F', 'G', 'H', 'I', 'J', 'K'];

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

      try {
        await message.react('⭕');
        await message.react('🔺');  // ← 🔺に変更済み
        await message.react('❌');
        console.log(`リアクション付与完了：${col}列`);
      } catch (err) {
        console.log(`リアクション付与失敗：${postId}`, err);
      }
    }
  } catch (err) {
    console.error("❌ ready 内でエラー:", err);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;

    const message = reaction.message;
    const emoji = reaction.emoji.name;
    const userId = user.id;

    let mark = '';
    if (emoji === '⭕') mark = '〇';
    else if (emoji === '🔺') mark = '△';  // ← 🔺を△として記録
    else if (emoji === '❌') mark = '×';
    else return;

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

    const sheetData = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: '点呼表!A:A',
    });
    const ids = sheetData.data.values?.flat() || [];
    let rowIndex = ids.indexOf(userId);

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

console.log("Before client.login");
client.login(process.env.DISCORD_TOKEN);
console.log("After client.login");
