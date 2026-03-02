# Discord Webhook Cleanup Bot

A Node.js bot that automatically deletes webhook messages in a specific channel after a set delay.

## Features
- **Auto-Cleanup**: Deletes messages after X hours (configurable in `.env`).
- **Manual Cleanup**: Type `!clear` to wipe webhooks and bot messages while keeping human chat.
- **Channel Restricted**: Only operates in the designated channel.
- **Persistent**: Tracking database ensures messages aren't missed across restarts.

## Setup
1. `npm install`
2. Create a `.env` file with:
   - `DISCORD_TOKEN`
   - `DELETE_DELAY_HOURS`
   - `TARGET_CHANNEL_NAME`
3. `npm start`
