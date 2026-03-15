console.log('🏁 Bot script starting...');
const { Client, GatewayIntentBits, Events } = require('discord.js');
console.log('📦 discord.js loaded.');
const database = require('./database');
console.log('🗄️ Database module required.');
const http = require('http');
const https = require('https');
require('dotenv').config();
console.log('📄 .env loaded.');

// Create a dummy server for Render's health check
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`🌐 Port ${PORT} opened for Render health check.`);
});

// --- SELF-PINGER (Keep-Alive) ---
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (EXTERNAL_URL) {
    console.log(`🚀 Self-pinger active for: ${EXTERNAL_URL}`);
    setInterval(() => {
        const client = EXTERNAL_URL.startsWith('https') ? https : http;
        client.get(EXTERNAL_URL, (res) => {
            console.log(`📡 Self-ping successful: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`📡 Self-ping failed: ${err.message}`);
        });
    }, 1 * 60 * 1000); // Ping every 1 minute
} else {
    console.log("⚠️ RENDER_EXTERNAL_URL not set. Self-pinger disabled.");
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once(Events.ClientReady, async c => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    console.log(`⚙️ Config: Delay=${process.env.DELETE_DELAY_HOURS || 'Default(24)'}h, Channel=#${process.env.TARGET_CHANNEL_NAME || 'All'}`);
    
    // Explicitly load DB only after login
    console.log('🔄 Initializing database cache...');
    database.loadDb(); 
    
    // Scan channels for existing webhook messages
    await backfillMessages();

    // Start the cleanup scheduler
    const interval = (process.env.DELETE_DELAY_HOURS === "0") ? 5000 : 60000;
    console.log(`⏰ Scheduler started (Interval: ${interval / 1000}s)`);
    setInterval(cleanupExpiredMessages, interval); // Check every 5s if immediate, else 1m
});

/**
 * Scans all visible channels for existing webhook messages to track
 */
async function backfillMessages() {
    console.log(`🔍 Scanning for existing webhook messages...`);
    const guilds = await client.guilds.fetch();
    
    for (const [guildId, guildBase] of guilds) {
        const guild = await guildBase.fetch();
        const channels = await guild.channels.fetch();
        
        for (const [channelId, channel] of channels) {
            // Scan all text-based channels
            if (channel.isTextBased()) {
                try {
                    console.log(`🔎 Checking channel: #${channel.name}`);
                    const messages = await channel.messages.fetch({ limit: 100 });
                    
                    let webhookCount = 0;
                    for (const [msgId, msg] of messages) {
                        if (msg.webhookId) {
                            // Use skipSave=true for bulk insertions
                            database.addMessage(msg.id, msg.channelId, msg.createdTimestamp, true);
                            webhookCount++;
                        }
                    }
                    
                    if (webhookCount > 0) {
                        console.log(`✅ Tracked ${webhookCount} existing messages in #${channel.name}`);
                    }
                } catch (e) {
                    // Skip channels where bot lacks permissions
                }
            }
        }
    }
    // Save once after all channels are scanned
    database.saveDb();
    console.log(`💾 Startup scan complete. Database saved.`);
}

client.on(Events.MessageCreate, async message => {
    // DIAGNOSTIC LOG (You can see this in Render logs)
    console.log(`📩 Received: "${message.content}" from ${message.author.tag} in #${message.channel.name}`);

    // 1. Manual Cleanup Command
    if (message.content === '!clear') {
        console.log(`🧹 Manual cleanup triggered by ${message.author.tag} in #${message.channel.name}`);
        try {
            const fetched = await message.channel.messages.fetch({ limit: 100 });
            
            // Delete ALL messages in the fetched batch
            await message.channel.bulkDelete(fetched, true);
            console.log(`✅ Cleanup successful: Deleted ${fetched.size} messages.`);
            
            // Remove all entries for this channel from the tracking database
            database.clearChannel(message.channelId);
        } catch (err) {
            console.error('❌ Error during manual cleanup:', err.message);
        }
        return;
    }

    // 2. Track webhook messages
    if (message.webhookId) {
        console.log(`📝 Tracking new webhook message: ${message.id} in #${message.channel.name}`);
        database.addMessage(message.id, message.channelId, Date.now());
    }
});

/**
 * Periodically checks for and deletes expired messages
 */
async function cleanupExpiredMessages() {
    const expired = database.getExpiredMessages();
    if (expired.length === 0) return;

    console.log(`🧹 Attempting to delete ${expired.length} expired messages...`);

    for (const msg of expired) {
        try {
            const channel = await client.channels.fetch(msg.channel_id);
            if (channel) {
                await channel.messages.delete(msg.message_id);
                console.log(`🗑️ Deleted message: ${msg.message_id}`);
            }
        } catch (error) {
            // If the message is already gone or the bot lacks permission
            if (error.code === 10008) {
                console.log(`ℹ️ Message ${msg.message_id} already deleted or not found.`);
            } else {
                console.error(`❌ Error deleting message ${msg.message_id}:`, error.message);
            }
        } finally {
            // Always remove from database to avoid repeated failure
            database.removeMessage(msg.message_id);
        }
    }
}

client.on('error', console.error);

process.on('unhandledRejection', error => {
    console.error('📋 Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('📋 Uncaught exception:', error);
    process.exit(1);
});

console.log('🔌 Attempting to login to Discord...');
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN is missing in environment variables!');
} else {
    // Log token metadata for debugging (safe)
    const sanitizedToken = token.trim();
    console.log(`ℹ️ Token info: length=${token.length}, trimmed_length=${sanitizedToken.length}, startsWith=${token.substring(0, 4)}...`);
    if (token !== sanitizedToken) {
        console.warn('⚠️ WARNING: Token contains leading or trailing whitespace! Trimming it...');
    }
}

// Enable library debug logs
client.on('debug', info => {
    if (info.includes('Heartbeat') || info.includes('Latency')) return; // Filter spam
    console.log(`⚙️ [DJS Debug] ${info}`);
});

client.login(token?.trim()).then(() => {
    console.log('🔑 Login request sent successfully.');
}).catch(err => {
    console.error('❌ Failed to login to Discord:', err.message);
    if (err.message.includes('privileged intents')) {
        console.error('🚨 TIP: You MUST enable "Message Content Intent" in the Discord Developer Portal (Bot tab)!');
    }
});
