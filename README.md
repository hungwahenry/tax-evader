# Simple Verification Bot

A minimal Telegram bot that verifies users when they join your group. Users must message the bot privately to gain access to the group chat, allowing you to broadcast messages to them later.

## Features

- **User Verification**: New users must verify through bot DM to access group
- **Deep Link System**: Verification uses Telegram deep links for seamless UX
- **Auto Removal**: Unverified users are removed after timeout (5 minutes)
- **Clean Interface**: Automatic cleanup of join messages after verification
- **Database Tracking**: MongoDB storage of users and verification sessions

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your bot token, username, and MongoDB URI.

3. **Build and start:**
   ```bash
   npm run build
   npm start
   ```

   For development:
   ```bash
   npm run dev
   ```

## Environment Variables

- `BOT_TOKEN` - Your Telegram bot token from @BotFather
- `BOT_USERNAME` - Your bot's username (without @)
- `MONGODB_URI` - MongoDB connection string

## How It Works

1. **User joins group** ’ Bot restricts their permissions
2. **Bot sends welcome message** with verification button
3. **User clicks button** ’ Opens bot DM with verification link
4. **User completes verification** ’ Bot restores group permissions
5. **Timeout handling** ’ Unverified users are removed after 5 minutes

## Bot Commands

- `/start verify_xxxxx` - Complete verification (auto-triggered by button)

The bot is designed to be minimal and focused solely on verification to enable future broadcasts to verified users.