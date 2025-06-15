// src/voiceManager.js
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const https = require('https');
const { log } = require('./utils/logger');
const config = require('./utils/config');

const voiceManager = new Map();

/**
 * Sends a message to the designated text channel safely.
 * @param {import('discord.js').Client} client The Discord client.
 * @param {string} message The message content.
 */
async function safeSendMessage(client, message) {
    try {
        const channel = await client.channels.fetch(config.TEXT_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            await channel.send(message);
        } else {
            log('Error: Text channel not found or is not a text-based channel.');
        }
    } catch (error) {
        log('Error sending message to text channel', { error: error.message });
    }
}

/**
 * Creates and verifies an audio stream from the STREAM_URL.
 * This function is critical to ensure we don't join and play silence.
 * @returns {Promise<import('@discordjs/voice').AudioResource>}
 */
function createVerifiedAudioResource() {
    return new Promise((resolve, reject) => {
        const request = https.get(config.STREAM_URL, (response) => {
            // Follow redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                https.get(response.headers.location, (redirectResponse) => {
                    handleStream(redirectResponse, resolve, reject);
                }).on('error', (err) => reject(new Error(`Stream redirect error: ${err.message}`)));
                return;
            }
            handleStream(response, resolve, reject);
        });

        request.on('error', (err) => reject(new Error(`Stream request error: ${err.message}`)));
        request.end();
    });
}

function handleStream(stream, resolve, reject) {
    const dataTimeout = setTimeout(() => {
        stream.destroy();
        reject(new Error('Stream validation failed: No data received in 10 seconds.'));
    }, 10000); // 10-second timeout

    stream.once('readable', () => {
        clearTimeout(dataTimeout);
        log('Stream is readable and data is flowing.');
        const resource = createAudioResource(stream, {
            inlineVolume: true,
        });
        resolve(resource);
    });

    stream.once('error', (err) => {
        clearTimeout(dataTimeout);
        reject(new Error(`Stream error: ${err.message}`));
    });

    stream.once('end', () => {
        clearTimeout(dataTimeout);
        log('Stream ended unexpectedly during validation.');
        reject(new Error('Stream ended before audio could be played.'));
    });
}


/**
 * Connects to the voice channel, creates a player, and starts streaming.
 * @param {import('discord.js').Guild} guild The guild to connect in.
 */
async function connectAndPlay(guild) {
    if (voiceManager.has(guild.id)) {
        log('Connection attempt ignored, already connected or connecting.');
        return;
    }

    log(`Attempting to connect to voice channel: ${config.VOICE_CHANNEL_ID}`);
    const client = guild.client;
    let connection;

    try {
        // 1. Create and verify the audio resource BEFORE joining the channel
        await safeSendMessage(client, '📻 Accessing wTed Radio stream...');
        const resource = await createVerifiedAudioResource();
        log('Audio stream verified successfully.');
        await safeSendMessage(client, '✅ Stream verified. Connecting to voice...');

        // 2. Join the voice channel
        connection = joinVoiceChannel({
            channelId: config.VOICE_CHANNEL_ID,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
        });

        // Store connection immediately to prevent race conditions
        voiceManager.set(guild.id, {
            connection,
            player: null,
            subscription: null,
            intentionalDisconnect: false
        });

        // 3. Set up connection state handling
        connection.on(VoiceConnectionStatus.Ready, () => {
            log('Voice connection is Ready.');
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            log('Voice connection was disconnected.');
            try {
                // Wait 5 seconds before attempting to reconnect
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
                // Connection recovered
            } catch (error) {
                log('Connection could not be recovered, destroying connection.');
                await safeSendMessage(client, '⚠️ Connection lost. Could not reconnect automatically.');
                disconnect(guild, true); // Mark as intentional to prevent auto-reconnect
            }
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

        // 4. Create and configure the audio player
        const player = createAudioPlayer();
        const subscription = connection.subscribe(player);
        
        // Update the manager with the player and subscription
        voiceManager.get(guild.id).player = player;
        voiceManager.get(guild.id).subscription = subscription;
        
        player.on(AudioPlayerStatus.Playing, () => {
            log('Audio player is now in Playing status.');
            safeSendMessage(client, '🎶 **Now playing wTed Radio!** Enjoy the tunes.');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            const session = voiceManager.get(guild.id);
            if (session && !session.intentionalDisconnect) {
                log('Audio player is Idle. This should not happen with a live stream. Attempting to reconnect.');
                safeSendMessage(client, '⚠️ Stream interrupted. Attempting to reconnect...');
                
                // Disconnect gracefully but don't immediately give up.
                disconnect(guild, false); // Pass false to allow potential reconnect
                setTimeout(() => {
                    log('Retrying connection...');
                    connectAndPlay(guild).catch(err => {
                        log('Reconnect failed', { error: err.message });
                        safeSendMessage(client, '❌ **Reconnect failed.** Please try starting the bot again with `/wted play`.');
                    });
                }, 5000); // 5-second delay before reconnecting
            } else {
                log('Audio player is Idle due to an intentional disconnect. Not reconnecting.');
            }
        });

        player.on('error', error => {
            log('Audio player error', { error: error.message });
            safeSendMessage(client, '🔥 An error occurred with the audio player. The bot will disconnect.');
            disconnect(guild, true); // Mark as intentional
        });

        // 5. Play the resource
        player.play(resource);
        log('Playing resource.');

    } catch (error) {
        log('Error in connectAndPlay', { error: error.message, stack: error.stack });
        await safeSendMessage(client, `❌ **Failed to start radio:** ${error.message}`);
        if (connection) {
            connection.destroy();
        }
        voiceManager.delete(guild.id);
    }
}

/**
 * Disconnects from the voice channel and cleans up resources.
 * @param {import('discord.js').Guild} guild The guild to disconnect from.
 * @param {boolean} intentional - Whether the disconnect is intentional.
 */
function disconnect(guild, intentional = false) {
    const session = voiceManager.get(guild.id);
    if (!session) {
        log('Disconnect called but no active session found.');
        return;
    }

    if (intentional) {
        session.intentionalDisconnect = true;
    }

    const { connection, player, subscription } = session;

    log('Disconnecting and cleaning up resources.');

    if (player) {
        player.stop(true); // Stop the player and destroy its resource
    }
    if (subscription) {
        subscription.unsubscribe();
    }
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
    }

    voiceManager.delete(guild.id);
    log('Cleanup complete.');
}

module.exports = {
    connectAndPlay,
    disconnect,
    voiceManager,
    safeSendMessage,
}; 