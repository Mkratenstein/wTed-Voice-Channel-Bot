// Validate required environment variables
const requiredEnvVars = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'GUILD_ID',
    'USER_ROLE_ID',
    'ADMIN_ROLE_ID',
    'VOICE_CHANNEL_ID',
    'TEXT_CHANNEL_ID',
    'STREAM_URL'
];

// Check for missing environment variables
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    console.error('Missing required environment variables:', missingEnvVars.join(', '));
    process.exit(1);
}

// Export validated environment variables
module.exports = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    USER_ROLE_ID: process.env.USER_ROLE_ID,
    ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID,
    VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID,
    TEXT_CHANNEL_ID: process.env.TEXT_CHANNEL_ID,
    STREAM_URL: process.env.STREAM_URL
}; 