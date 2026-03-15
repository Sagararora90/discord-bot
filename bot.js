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
    ],
    ws: { version: 10 }
});

// Shard & Gateway Debugging
client.on('shardReady', (id) => console.log(`💎 Shard ${id} is ready.`));
client.on('shardDisconnect', (event, id) => console.warn(`🔌 Shard ${id} disconnected:`, event));
client.on('shardError', (error, id) => console.error(`❌ Shard ${id} error:`, error.message));
client.on('shardReconnecting', (id) => console.log(`🔄 Shard ${id} reconnecting...`));
client.on('invalidated', () => console.error('🚫 Session invalidated.'));

/**
 * Checks connectivity to Discord's API
 */
async function checkNetworking() {
    console.log('📡 Testing connectivity to Discord API...');
    return new Promise((resolve) => {
        const req = https.get('https://discord.com/api/v10/gateway', (res) => {
            console.log(`🌐 Gateway check: Result Status ${res.statusCode}`);
            resolve(res.statusCode);
        });
        req.on('error', (err) => {
            console.error(`🌐 Gateway check: FAILED! Error: ${err.message}`);
            resolve(500);
        });
        req.setTimeout(5000, () => {
            console.error('🌐 Gateway check: TIMEOUT after 5 seconds.');
            req.destroy();
            resolve(408);
        });
    });
}

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
        try {
            const channels = await guild.channels.fetch();
            for (const [channelId, channel] of channels) {
                if (channel && channel.isTextBased()) {
                    try {
                        console.log(`🔎 Checking channel: #${channel.name}`);
                        const messages = await channel.messages.fetch({ limit: 100 });
                        
                        let webhookCount = 0;
                        for (const [msgId, msg] of messages) {
                            if (msg.webhookId) {
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
        } catch (e) {
            console.warn(`⚠️ Failed to fetch channels for guild ${guild.name}`);
        }
    }
    database.saveDb();
    console.log(`💾 Startup scan complete. Database saved.`);
}

client.on(Events.MessageCreate, async message => {
    console.log(`📩 Received: "${message.content}" from ${message.author.tag} in #${message.channel.name}`);

    if (message.content === '!clear') {
        processManualClear(message);
        return;
    }

    if (message.webhookId) {
        console.log(`📝 Tracking new webhook message: ${message.id} in #${message.channel.name}`);
        database.addMessage(message.id, message.channelId, Date.now());
    }
});

async function processManualClear(message) {
    console.log(`🧹 Manual cleanup triggered by ${message.author.tag} in #${message.channel.name}`);
    try {
        const fetched = await message.channel.messages.fetch({ limit: 100 });
        await message.channel.bulkDelete(fetched, true);
        console.log(`✅ Cleanup successful: Deleted ${fetched.size} messages.`);
        database.clearChannel(message.channelId);
    } catch (err) {
        console.error('❌ Error during manual cleanup:', err.message);
    }
}

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
            if (error.code === 10008) {
                console.log(`ℹ️ Message ${msg.message_id} already deleted or not found.`);
            } else {
                console.error(`❌ Error deleting message ${msg.message_id}:`, error.message);
            }
        } finally {
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

async function start() {
    console.log('🏁 Bot script starting...');
    console.log(`💻 Node Info: version=${process.version}, platform=${process.platform}`);
    
    let status = await checkNetworking();
    
    if (status === 429) {
        console.warn('⚠️ ALERT: You are being RATE LIMITED (429) by Discord.');
        console.warn('⏳ Waiting 65 seconds before attempting login to cooldown...');
        await new Promise(r => setTimeout(r, 65000));
        console.log('🔄 Cooldown finished. Attempting login anyway...');
    } else if (status !== 200) {
        console.warn(`⚠️ Warning: Gateway check returned non-200 status (${status}). Connection might fail.`);
    }
    
    console.log('🔌 Attempting to login to Discord...');
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ DISCORD_TOKEN is missing in environment variables!');
        return;
    }
    
    const sanitizedToken = token.trim();
    console.log(`ℹ️ Token info: length=${token.length}, startsWith=${token.substring(0, 4)}...`);

    client.on('debug', info => {
        if (info.includes('Heartbeat') || info.includes('Latency')) return; 
        console.log(`⚙️ [DJS Debug] ${info}`);
    });

    let loginFinished = false;
    const hangInterval = setInterval(() => {
        if (!loginFinished) {
            console.warn('⚠️ HANGING ALERT: client.login() has not finished in 30 seconds...');
            console.warn('💡 Tip: In Render Dashboard, try "Clear Build Cache & Deploy" or change your Region.');
        } else {
            clearInterval(hangInterval);
        }
    }, 30000);

    client.login(sanitizedToken).then(() => {
        loginFinished = true;
        console.log('🔑 client.login() promise resolved.');
    }).catch(err => {
        loginFinished = true;
        console.error('❌ client.login() rejected with error:', err.message);
    });
}

start();
