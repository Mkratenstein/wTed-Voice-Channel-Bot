require('dotenv').config();
const { log } = require('./logger');

const requiredVariables = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'GUILD_ID',
    'STREAM_URL',
    'VOICE_CHANNEL_ID',
    'ADMIN_ROLE_ID',
    'USER_ROLE_ID',
    'TEXT_CHANNEL_ID'
];

const config = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    STREAM_URL: process.env.STREAM_URL || 'https://s4.radio.co/s3c11c85d6/listen',
    VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID || '1383789563817754634',
    ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID || '680100291806363673',
    USER_ROLE_ID: process.env.USER_ROLE_ID, // No default, must be provided
    TEXT_CHANNEL_ID: process.env.TEXT_CHANNEL_ID || '1383827890696753162',
    TESTING_MODE: process.env.TESTING_MODE === 'true',
};

let missingVariables = false;
for (const variable of requiredVariables) {
    if (!config[variable]) {
        log(`Error: Missing required environment variable: ${variable}`);
        missingVariables = true;
    }
}

if (missingVariables) {
    log('Application cannot start due to missing environment variables. Please check your .env file or Railway configuration.');
    process.exit(1);
}

// Log loaded config, obscuring the token
const loggedConfig = { ...config, DISCORD_TOKEN: '********' };
log('Configuration loaded successfully:', loggedConfig);


module.exports = config; 