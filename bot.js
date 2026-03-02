const { Client, GatewayIntentBits, Events } = require('discord.js');
const { addMessage, getExpiredMessages, removeMessage } = require('./database');
const http = require('http');
require('dotenv').config();

// Create a dummy server for Render's health check
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`🌐 Port ${PORT} opened for Render health check.`);
});

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
    
    // Scan channels for existing webhook messages
    await backfillMessages();

    // Start the cleanup scheduler
    console.log(`⏰ Scheduler started (Interval: 1m)`);
    setInterval(cleanupExpiredMessages, 60000); // Check every minute
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
            // Only scan the target channel
            if (channel.isTextBased() && channel.name === process.env.TARGET_CHANNEL_NAME) {
                try {
                    console.log(`🔎 Checking channel: #${channel.name}`);
                    const messages = await channel.messages.fetch({ limit: 100 });
                    console.log(`📊 Fetched ${messages.size} total messages in #${channel.name}`);
                    
                    for (const [msgId, msg] of messages) {
                        if (msg.webhookId) {
                            console.log(`📎 Found webhook message: ${msg.id}`);
                            addMessage(msg.id, msg.channelId, msg.createdTimestamp);
                        } else {
                            console.log(`⏩ Skipping message ${msg.id} (Sent by: ${msg.author.tag})`);
                        }
                    }
                    
                    const webhookCount = messages.filter(m => m.webhookId).size;
                    if (webhookCount > 0) {
                        console.log(`✅ Tracked ${webhookCount} existing messages in #${channel.name}`);
                    }
                } catch (e) {
                    // Skip channels where bot lacks permissions
                }
            }
        }
    }
}

client.on(Events.MessageCreate, async message => {
    // DIAGNOSTIC LOG (You can see this in Render logs)
    console.log(`📩 Received: "${message.content}" from ${message.author.tag} in #${message.channel.name}`);

    // 1. Manual Cleanup Command
    if (message.content === '!clear' && message.channel.name === process.env.TARGET_CHANNEL_NAME) {
        console.log(`🧹 Manual cleanup triggered by ${message.author.tag}`);
        try {
            const fetched = await message.channel.messages.fetch({ limit: 100 });
            // FILTER: Only delete webhooks, bots, or the !clear command itself
            const toDelete = fetched.filter(m => m.webhookId || m.author.bot || m.id === message.id);
            
            await message.channel.bulkDelete(toDelete, true);
            console.log(`✅ Selective cleanup: Deleted ${toDelete.size} junk/webhook messages.`);
            
            // Also clear our tracking database since those messages are gone
            const { saveDb } = require('./database');
            saveDb([]); 
        } catch (err) {
            console.error('❌ Error during manual cleanup:', err.message);
        }
        return;
    }

    // 2. Track webhook messages in the target channel
    if (message.webhookId && message.channel.name === process.env.TARGET_CHANNEL_NAME) {
        console.log(`📝 Tracking new webhook message: ${message.id} in #${message.channel.name}`);
        addMessage(message.id, message.channelId, Date.now());
    }
});

/**
 * Periodically checks for and deletes expired messages
 */
async function cleanupExpiredMessages() {
    const expired = getExpiredMessages();
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
            removeMessage(msg.message_id);
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

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Failed to login to Discord:', err.message);
    if (err.message.includes('privileged intents')) {
        console.error('🚨 TIP: You MUST enable "Message Content Intent" in the Discord Developer Portal (Bot tab)!');
    }
});
