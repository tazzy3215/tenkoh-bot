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

// ★ partials を追加（リアクション取得の必須設定）
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Discord再接続耐性
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

// 起動時に Sheets API が使えるか確認
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

client.once('ready', async () => {
  console.log('Bot is ready!');

  try {
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);

    for (const col of TARGET_COLUMNS) {
      // POSTED 判定
      const postedRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `点呼表!${col}1`,
      });

      const posted = postedRes.data.values?.[0]?.[0] || '';
      if (posted !== 'POSTED') continue;

      // 投稿ID取得
      const idRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `点呼表!${col}2`,
      });

      const postId = idRes.data.values?.[0]?.[0] || null;
      if (!postId) continue;

      let message = null;

      // メッセージ取得（通常）
      try {
        message = await channel.messages.fetch(postId);
      } catch {
        console.log(`fetch 失敗 → fallbackへ：${postId}`);
      }

      // fallback（100件取得して探す）
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

      // リアクション付与
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
    console.error("❌ ready 内でエラー:", err);
  }
});

// ===============================
// 7. リアクション処理（行ズレ修正版 + 他リアクション自動削除）
// ===============================
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;

    // partials 対応
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const message = reaction.message;
    const emoji = reaction.emoji.name;
    const userId = user.id;

    // 点呼マーク変換
    let mark = '';
    if (emoji === '⭕') mark = '〇';
    else if (emoji === '🔺') mark = '△';
    else if (emoji === '❌') mark = '×';
    else return;

    // ===============================
    // ★ 他のリアクションを自動で消す（常に1つだけ）
    // ===============================
    const allEmojis = ['⭕', '🔺', '❌'];

    for (const e of allEmojis) {
      if (e !== emoji) {
        const r = message.reactions.cache.get(e);
        if (r) {
          try {
            await r.users.remove(user.id);
          } catch (err) {
            console.log(`他リアクション削除失敗: ${e}`, err);
          }
        }
      }
    }

    // ===============================
    // どの列の点呼か判定
    // ===============================
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

    // ===============================
    // A列（ID一覧）取得
    // ===============================
    const sheetData = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: '点呼表!A:A',
    });
    const ids = sheetData.data.values?.flat() || [];
    let rowIndex = ids.indexOf(userId);

    let targetRow = null;

    // ===============================
    // 新規ユーザー → 名簿から追加
    // ===============================
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

      // append → 追加された行番号を取得
      const appendRes = await sheetsClient.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: '点呼表!A:C',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [found] },
      });

      const updatedRange = appendRes.data.updates.updatedRange;
      const match = updatedRange.match(/!(?:[A-Z]+)(\d+):/);
      targetRow = match ? parseInt(match[1], 10) : null;

      console.log("新規追加 → 行番号:", targetRow);
    } else {
      // 既存ユーザー
      targetRow = rowIndex + 1;
    }

    // ===============================
    // 点呼マークを書き込む
    // ===============================
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `点呼表!${targetColumn}${targetRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[mark]],
      },
    });

    console.log(`書き込み完了 → ${targetColumn}${targetRow} = ${mark}`);

  } catch (err) {
    console.error('Error in messageReactionAdd:', err);
  }
});

// ===============================
// 8. Discordログイン
// ===============================
console.log("Before client.login");
client.login(process.env.DISCORD_TOKEN);
console.log("After client.login");
