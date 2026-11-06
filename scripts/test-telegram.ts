import "dotenv/config";
import {
  formatTelegramTradeDeskAlert,
  getVerifiedTelegramChatId,
  sendTelegramMessage,
} from "../server/telegramDispatcher";

async function main() {
  console.log("=================================================");
  console.log("🚀 CHIZZLE TELEGRAM BOT: DIAGNOSTIC PING CHECK");
  console.log("=================================================");

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("❌ CRITICAL: Missing TELEGRAM_BOT_TOKEN in environment (.env).");
    process.exit(1);
  }

  const chatId = getVerifiedTelegramChatId();
  if (!chatId) {
    console.error("❌ CRITICAL: Invalid or missing numeric TELEGRAM_TARGET_CHAT_ID.");
    process.exit(1);
  }

  console.log(`📡 Verified Target Chat ID: ${chatId}`);
  console.log(`🔑 Bot Token Prefix: ${botToken.slice(0, 10)}...`);

  // Diagnostic Ping Payload (without running scanner loops)
  const pingPayload = {
    ticker: "SMH",
    event: "CONFIRMED 1H CLOSE",
    regime: "Pullback Valid (4H 20-SMA)",
    entryPrice: 245.5,
    stopLoss: 239.0,
    target1: 255.25,
    target2: 258.5,
    shares: 38,
    status: "ACTIONABLE (Diagnostic Ping)",
  };

  const messageText = formatTelegramTradeDeskAlert(pingPayload);

  console.log("\n--- Outbound Telegram Message Payload ---");
  console.log(messageText);
  console.log("-----------------------------------------\n");

  console.log("⏳ Dispatching diagnostic ping to Telegram API...");
  const result = await sendTelegramMessage(messageText, chatId);

  console.log("\n📦 Full Telegram API Response:");
  console.log(JSON.stringify(result.responseData || result, null, 2));

  if (!result.ok) {
    console.error(`\n❌ Diagnostic ping failed: ${result.error}`);
    process.exit(1);
  }

  console.log("\n✅ Diagnostic ping successfully delivered to target device!");
  console.log("=================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Unexpected error during Telegram diagnostic:", err);
  process.exit(1);
});

