const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(__dirname, process.env.DATABASE_PATH || './data.json');

/**
 * Loads the database from JSON file
 */
function loadDb() {
    if (!fs.existsSync(dbPath)) {
        fs.writeFileSync(dbPath, JSON.stringify([]));
        return [];
    }
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
}

/**
 * Saves the database to JSON file
 */
function saveDb(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

/**
 * Adds a message to the tracking database
 */
function addMessage(messageId, channelId, timestamp) {
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
    
    const db = loadDb();
    if (!db.some(m => m.message_id === messageId)) {
        db.push({ message_id: messageId, channel_id: channelId, delete_at: deleteAt });
        saveDb(db);
    }
}

/**
 * Gets all messages that are ready to be deleted
 */
function getExpiredMessages() {
    const now = Date.now();
    const db = loadDb();
    const expired = db.filter(m => m.delete_at <= now);
    console.log(`🔍 DB Check: ${db.length} total, ${expired.length} expired (Now: ${now})`);
    if (db.length > 0 && expired.length === 0) {
        console.log(`⏳ Next deletion in: ${Math.round((db[0].delete_at - now) / 1000)}s`);
    }
    return expired;
}

/**
 * Removes a message from the database
 */
function removeMessage(messageId) {
    const db = loadDb();
    const filtered = db.filter(m => m.message_id !== messageId);
    saveDb(filtered);
}

module.exports = {
    addMessage,
    getExpiredMessages,
    removeMessage,
    saveDb
};
