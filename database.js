const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(__dirname, process.env.DATABASE_PATH || './data.json');

// In-memory cache
let messagesCache = [];

/**
 * Loads the database from JSON file into memory cache
 */
function loadDb() {
    try {
        if (!fs.existsSync(dbPath)) {
            fs.writeFileSync(dbPath, JSON.stringify([]));
            messagesCache = [];
            return [];
        }
        const data = fs.readFileSync(dbPath, 'utf8');
        messagesCache = JSON.parse(data);
        return messagesCache;
    } catch (err) {
        console.error('❌ Error loading database:', err.message);
        messagesCache = [];
        return [];
    }
}

/**
 * Saves the in-memory cache to JSON file
 */
function saveDb(data = null) {
    if (data !== null) {
        messagesCache = data;
    }
    try {
        fs.writeFileSync(dbPath, JSON.stringify(messagesCache, null, 2));
    } catch (err) {
        console.error('❌ Error saving database:', err.message);
    }
}

/**
 * Adds a message to the tracking database (In-memory)
 */
function addMessage(messageId, channelId, timestamp, skipSave = false) {
    let hoursRaw = process.env.DELETE_DELAY_HOURS || "24";
    let hours;
    
    if (hoursRaw.includes('/')) {
        const parts = hoursRaw.split('/');
        hours = parseFloat(parts[0]) / parseFloat(parts[1]);
    } else {
        hours = parseFloat(hoursRaw);
    }
    
    if (isNaN(hours)) hours = 24; 
    const deleteAt = timestamp + (hours * 60 * 60 * 1000);
    
    if (!messagesCache.some(m => m.message_id === messageId)) {
        messagesCache.push({ message_id: messageId, channel_id: channelId, delete_at: deleteAt });
        if (!skipSave) saveDb();
    }
}

/**
 * Gets all messages from cache that are ready to be deleted
 */
function getExpiredMessages() {
    const now = Date.now();
    const expired = messagesCache.filter(m => m.delete_at <= now);
    
    console.log(`🔍 DB Check: ${messagesCache.length} total, ${expired.length} expired (Now: ${now})`);
    
    if (messagesCache.length > 0 && expired.length === 0) {
        // Find the next deletion time by sorting or using Math.min
        const nextDelete = Math.min(...messagesCache.map(m => m.delete_at));
        console.log(`⏳ Next deletion in: ${Math.round((nextDelete - now) / 1000)}s`);
    }
    return expired;
}

/**
 * Removes a message from the database
 */
function removeMessage(messageId, skipSave = false) {
    messagesCache = messagesCache.filter(m => m.message_id !== messageId);
    if (!skipSave) saveDb();
}

/**
 * Removes all tracked messages for a specific channel
 */
function clearChannel(channelId) {
    const initialCount = messagesCache.length;
    messagesCache = messagesCache.filter(m => m.channel_id !== channelId);
    console.log(`🧹 DB Pruned: Removed ${initialCount - messagesCache.length} entries for channel ${channelId}`);
    saveDb();
}

// Initial load
loadDb();

module.exports = {
    addMessage,
    getExpiredMessages,
    removeMessage,
    clearChannel,
    saveDb
};
