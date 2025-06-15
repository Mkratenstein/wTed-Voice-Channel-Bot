# wTed Voice Channel Bot

A Discord bot that plays wTed radio stream in a voice channel with time-limited sessions.

## Features

- Plays wTed radio stream in a specified voice channel
- 3-hour time limit per session
- Role-based access control
- Admin commands for stream management

## Railway Deployment

1. Fork this repository
2. Create a new Railway project
3. Connect your forked repository
4. Add the following environment variables in Railway:
   - `DISCORD_TOKEN` - Your Discord bot token
   - `CLIENT_ID` - Your Discord bot client ID
   - `GUILD_ID` - Your Discord server ID
   - `USER_ROLE_ID` - Role ID for regular users
   - `ADMIN_ROLE_ID` - Role ID for administrators
   - `VOICE_CHANNEL_ID` - ID of the voice channel to play in
   - `TEXT_CHANNEL_ID` - ID of the text channel for notifications
   - `STREAM_URL` - URL of the wTed radio stream

## Commands

- `/wted play` - Starts playing the radio stream
- `/wted end` - Stops the radio stream (Admin only)
- `/wted restart` - Restarts the 3-hour timer (Admin only)

## Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with the required environment variables
4. Deploy commands:
   ```bash
   npm run deploy
   ```
5. Start the bot:
   ```bash
   npm start
   ```

## Requirements

- Node.js >= 16.9.0
- Discord.js v14
- FFmpeg (handled by ffmpeg-static) 