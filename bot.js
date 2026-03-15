console.log('🏁 Bot script starting...');
const { Client, GatewayIntentBits, Events } = require('discord.js');
console.log('📦 discord.js loaded.');
const database = require('./database');
console.log('🗄️ Database module required.');
const http = require('http');
const https = require('https');
require('dotenv').config();
console.log('📄 .env loaded.');

// Create a dummy server for Railway/Render health check
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`🌐 Port ${PORT} opened for health check.`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

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
    console.log('🤖 Bot is in MANUAL MODE. Automatic deletion is DISABLED.');
    console.log('💡 Use !clear in any channel to delete the last 100 messages.');
});

client.on(Events.MessageCreate, async message => {
    // DIAGNOSTIC LOG
    console.log(`📩 Received: "${message.content}" from ${message.author.tag} in #${message.channel.name}`);

    // Manual Cleanup Command
    if (message.content === '!clear') {
        console.log(`🧹 Manual cleanup triggered by ${message.author.tag} in #${message.channel.name}`);
        try {
            const fetched = await message.channel.messages.fetch({ limit: 100 });
            await message.channel.bulkDelete(fetched, true);
            console.log(`✅ Cleanup successful: Deleted ${fetched.size} messages.`);
            
            // Optional: Still clear the database if anything was tracked before
            database.clearChannel(message.channelId);
        } catch (err) {
            console.error('❌ Error during manual cleanup:', err.message);
        }
    }
});

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
    
    // Handle 429 if it happens again
    if (status === 429) {
        console.warn('⚠️ ALERT: You are being RATE LIMITED (429) by Discord.');
        console.warn('⏳ Waiting 65 seconds before attempting login...');
        await new Promise(r => setTimeout(r, 65000));
    }
    
    console.log('🔌 Attempting to login to Discord...');
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ DISCORD_TOKEN is missing!');
        return;
    }
    
    const sanitizedToken = token.trim();
    
    client.login(sanitizedToken).then(() => {
        console.log('🔑 client.login() promise resolved.');
    }).catch(err => {
        console.error('❌ client.login() rejected:', err.message);
    });
}

start();
