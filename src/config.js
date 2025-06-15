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

// Optional environment variables
const optionalEnvVars = [
    'TEST_CHANNEL_ID'
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
    STREAM_URL: process.env.STREAM_URL,
    // TESTING MODE - disable Discord messages to focus on audio debugging
    ACTIVE_TEXT_CHANNEL_ID: null, // Disable Discord messages during testing
    TESTING_MODE: true // Enable testing mode
};

// Log testing mode configuration
console.log(`[CONFIG] TESTING MODE ENABLED: Discord messages disabled - using console logs only`);
console.log(`[CONFIG] This prevents permission errors and focuses on audio stream debugging`); 