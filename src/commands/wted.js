const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    VoiceConnectionStatus,
    getVoiceConnection
} = require('@discordjs/voice');
const https = require('https');
const { GUILD_ID, USER_ROLE_ID, ADMIN_ROLE_ID, VOICE_CHANNEL_ID, TEXT_CHANNEL_ID, ACTIVE_TEXT_CHANNEL_ID, STREAM_URL, TESTING_MODE } = require('../config');

// Store active connections and timers
const voiceManager = new Map();

// Enhanced logging function
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

// Safe Discord message sending function for testing
function safeSendMessage(textChannel, message) {
    if (TESTING_MODE) {
        log(`[DISCORD MESSAGE DISABLED] ${message}`);
        return Promise.resolve();
    }
    
    if (textChannel) {
        return textChannel.send(message).catch(error => {
            log('Failed to send Discord message', { error: error.message, message });
        });
    }
    
    return Promise.resolve();
}

// Async function to handle voice connection
async function connectToVoice(guild, textChannel) {
    try {
        log('Starting voice connection process');
        
        // Safety check - ensure we have a valid guild and client
        if (!guild || !guild.client || !guild.client.user) {
            throw new Error('Bot is not ready or guild is invalid');
        }
        
        // Additional safety check - ensure bot is fully ready
        if (!guild.client.isReady()) {
            throw new Error('Bot is not fully ready yet');
        }
        
        const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) {
            throw new Error('Voice channel not found or invalid');
        }

        log('Joining voice channel', { channelName: voiceChannel.name, channelId: voiceChannel.id });

        // Check if there are users in the voice channel
        const members = voiceChannel.members.filter(member => !member.user.bot);
        log('Voice channel status', {
            totalMembers: voiceChannel.members.size,
            humanMembers: members.size,
            memberNames: members.map(m => m.user.username)
        });

        if (members.size === 0) {
            log('Warning: No users currently in voice channel');
            safeSendMessage(textChannel, '⚠️ Starting wTed Radio, but no users are currently in the voice channel. Join the channel to hear the stream!');
        }

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        log('Voice connection established');

        // Simple connection state logging without complex checks
        connection.on('stateChange', (oldState, newState) => {
            log('Connection state changed', { 
                from: oldState.status, 
                to: newState.status
            });
            
            // Handle connection failures
            if (newState.status === 'disconnected') {
                log('Connection disconnected', { reason: newState.reason });
                safeSendMessage(textChannel, '❌ Voice connection was disconnected. Please try again.');
            }
        });

        const player = createAudioPlayer();
        log('Audio player created');

        // Add more detailed player state logging
        player.on('stateChange', (oldState, newState) => {
            log('Player state changed', { 
                from: oldState.status, 
                to: newState.status,
                resource: newState.resource ? 'present' : 'missing'
            });
            
            // Handle autopaused state
            if (newState.status === 'autopaused') {
                log('Player autopaused - checking voice channel for users');
                const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
                if (voiceChannel) {
                    const members = voiceChannel.members.filter(member => !member.user.bot);
                    log('Voice channel members', { 
                        totalMembers: voiceChannel.members.size,
                        humanMembers: members.size,
                        memberNames: members.map(m => m.user.username)
                    });
                    
                    if (members.size > 0) {
                        log('Users found in channel, attempting to unpause');
                        // Try to unpause the player
                        player.unpause();
                    } else {
                        log('No users in voice channel, keeping paused');
                        safeSendMessage(textChannel, '⏸️ wTed Radio paused - no users in voice channel. Join the voice channel to resume!');
                    }
                }
            }
            
            // Handle when player resumes
            if (oldState.status === 'autopaused' && newState.status === 'playing') {
                log('Player resumed from autopaused state');
                safeSendMessage(textChannel, '▶️ wTed Radio resumed - welcome back!');
            }
            
            // Handle idle state (might indicate stream ended or failed)
            if (newState.status === 'idle' && oldState.status !== 'idle') {
                log('Player went idle - stream may have ended or failed');
                safeSendMessage(textChannel, '⚠️ Audio stream stopped. Attempting to restart...');
                
                // Try to restart the stream
                setTimeout(() => {
                    if (voiceManager.has(guild.id)) {
                        try {
                            const newResource = createAudioResource(STREAM_URL, {
                                inputType: 'arbitrary',
                                inlineVolume: true,
                                metadata: { title: 'wTed Radio Stream' }
                            });
                            player.play(newResource);
                            log('Attempted to restart audio stream');
                        } catch (error) {
                            log('Failed to restart audio stream', { error: error.message });
                        }
                    }
                }, 1000);
            }
        });

        // Set up error handling for player
        player.on('error', error => {
            log('Audio player error', { error: error.message, stack: error.stack });
            if (voiceManager.has(guild.id)) {
                const { connection, subscription, voiceStateHandler, player } = voiceManager.get(guild.id);
                
                // Stop the player
                if (player) {
                    player.stop();
                }
                
                // Clean up subscription
                if (subscription) {
                    subscription.unsubscribe();
                }
                
                // Remove voice state handler
                if (voiceStateHandler) {
                    guild.client.off('voiceStateUpdate', voiceStateHandler);
                }
                
                // Destroy connection
                if (connection) {
                    connection.destroy();
                }
                
                voiceManager.delete(guild.id);
            }
            safeSendMessage(textChannel, '❌ Audio player encountered an error and stopped.');
        });

        log('Creating audio resource by piping stream from Node.js');

        let resource;
        let resourceCreationMethod = 'node-stream-pipe';

                try {
            const stream = await Promise.race([
                new Promise((resolve, reject) => {
                    const request = https.get(STREAM_URL, (response) => {
                        // Handle redirects
                        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                            log('Stream redirected', { from: STREAM_URL, to: response.headers.location });
                            https.get(response.headers.location, (redirectedResponse) => {
                                if (redirectedResponse.statusCode === 200) {
                                    resolve(redirectedResponse);
                                } else {
                                    redirectedResponse.resume(); // Consume data to free up memory
                                    reject(new Error(`Redirect failed with status code: ${redirectedResponse.statusCode}`));
                                }
                            }).on('error', reject);
                        } else if (response.statusCode === 200) {
                            resolve(response);
                        } else {
                            response.resume(); // Consume data to free up memory
                            reject(new Error(`Request failed with status code: ${response.statusCode}`));
                        }
                    });
                    
                    request.on('error', (error) => {
                        log('Node.js stream request error', { error: error.message });
                        reject(error);
                    });

                    request.setTimeout(15000, () => {
                        request.destroy();
                        reject(new Error('Request timed out after 15 seconds'));
                    });
                }),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Stream connection timeout after 10 seconds')), 10000);
                })
            ]);

            resource = createAudioResource(stream, {
                inputType: 'arbitrary',
                inlineVolume: true,
                metadata: {
                    title: 'wTed Radio Stream',
                    url: STREAM_URL
                }
            });

            log('Audio resource created successfully from Node.js stream');

        } catch (error) {
            log('Failed to create audio resource from Node.js stream', { error: error.message, stack: error.stack });
            if (textChannel) {
                safeSendMessage(textChannel, `❌ Failed to create audio stream: ${error.message}. The radio service may be temporarily down.`);
            }
            performCleanup(guild, 'resource creation failed');
            return; // Exit command since we couldn't create the resource
        }
        
        // Enhanced stream monitoring with detailed diagnostics
        let dataReceived = false;
        let firstDataTime = null;
        let totalBytesReceived = 0;
        
        resource.playStream.on('error', error => {
            log('Stream playStream error detected', { 
                error: error.message, 
                stack: error.stack,
                code: error.code,
                errno: error.errno,
                resourceMethod: resourceCreationMethod,
                dataReceived: dataReceived,
                totalBytes: totalBytesReceived
            });
            
            if (voiceManager.has(guild.id)) {
                const voiceData = voiceManager.get(guild.id);
                voiceData.retryCount = (voiceData.retryCount || 0) + 1;
                
                log('Stream retry attempt', { 
                    retryCount: voiceData.retryCount,
                    maxRetries: 5,
                    lastMethod: resourceCreationMethod
                });
                
                if (voiceData.retryCount >= 5) {
                    log('Maximum retry attempts reached, performing automatic cleanup');
                    safeSendMessage(textChannel, '❌ Stream failed after 5 retry attempts. Automatically ending wTed Radio session.');
                    
                    performCleanup(guild, 'max retries reached').then(() => {
                        safeSendMessage(textChannel, '🔄 wTed Radio session ended due to connection issues. Use `/wted play` to try again.');
                    });
                    return;
                }
                
                safeSendMessage(textChannel, `❌ Stream error: ${error.message}. Attempting to reconnect... (${voiceData.retryCount}/5)`);
                
                // After a primary failure, we can fall back to the old method as a retry strategy.
                // This gives us a chance to recover if the new method fails for some reason.
                log('Falling back to FFmpeg URL method for retry');
                setTimeout(() => {
                    if (voiceManager.has(guild.id)) {
                        log('Attempting to recreate stream after error', { 
                            retryAttempt: voiceData.retryCount,
                            previousMethod: resourceCreationMethod
                        });
                        
                        try {
                            const retryResource = createAudioResource(STREAM_URL, {
                                inputType: 'arbitrary',
                                inlineVolume: true,
                                metadata: { title: 'wTed Radio Stream (Retry)' },
                                inputArgs: [
                                    '-reconnect', '1',
                                    '-reconnect_streamed', '1',
                                    '-reconnect_delay_max', '5'
                                ]
                            });
                            
                            const { player } = voiceManager.get(guild.id);
                            player.play(retryResource);
                            log('Fallback stream recreated successfully');
                            
                            // Do NOT reset retry counter, let it cycle through attempts.
                            
                            safeSendMessage(textChannel, `✅ Stream reconnected successfully! (Attempt ${voiceData.retryCount}/5)`);
                        } catch (recreateError) {
                            log('Failed to recreate stream with fallback method', { 
                                error: recreateError.message, 
                                retryAttempt: voiceData.retryCount 
                            });
                            safeSendMessage(textChannel, `❌ Failed to reconnect stream (attempt ${voiceData.retryCount}/5).`);
                        }
                    }
                }, 5000); // 5-second delay before retrying
            }
        });

        // Enhanced stream event monitoring with diagnostics
        resource.playStream.on('data', (chunk) => {
            if (!dataReceived) {
                dataReceived = true;
                firstDataTime = Date.now();
                log('First stream data received!', { 
                    chunkSize: chunk.length,
                    resourceMethod: resourceCreationMethod,
                    timeToFirstData: firstDataTime - Date.now()
                });
                safeSendMessage(textChannel, '✅ Stream data flowing - audio should be working!');
            }
            totalBytesReceived += chunk.length;
            
            // Log every 1MB of data
            if (totalBytesReceived % (1024 * 1024) === 0) {
                log('Stream data milestone', { 
                    totalMB: Math.floor(totalBytesReceived / (1024 * 1024)),
                    chunkSize: chunk.length 
                });
            }
        });

        resource.playStream.on('end', () => {
            log('Stream ended', { 
                dataWasReceived: dataReceived,
                totalBytesReceived: totalBytesReceived,
                resourceMethod: resourceCreationMethod
            });
            safeSendMessage(textChannel, '⚠️ Stream ended unexpectedly. This may indicate a connection issue.');
        });

        resource.playStream.on('close', () => {
            log('Stream closed', { 
                dataWasReceived: dataReceived,
                totalBytesReceived: totalBytesReceived,
                resourceMethod: resourceCreationMethod
            });
            safeSendMessage(textChannel, '⚠️ Stream connection closed.');
        });

        resource.playStream.on('readable', () => {
            log('Stream is readable - data is available for consumption');
        });
        
        // Monitor for stream startup timeout
        const startupTimeout = setTimeout(() => {
            if (!dataReceived) {
                log('Stream startup timeout - no data received within 15 seconds', {
                    resourceMethod: resourceCreationMethod,
                    streamReadable: resource.playStream.readable
                });
                safeSendMessage(textChannel, '⚠️ Stream startup timeout - no audio data received within 15 seconds. The stream may be unavailable.');
            }
        }, 15000);

        // Subscribe the connection to the player
        const subscription = connection.subscribe(player);
        log('Connection subscribed to player', { 
            subscribed: !!subscription,
            subscriptionId: subscription ? 'present' : 'missing'
        });

        // Play the resource
        player.play(resource);
        log('Audio player started playing resource', {
            playerState: player.state.status,
            resourceAttached: !!player.state.resource
        });

        // Set up error handling
        connection.on('error', error => {
            log('Voice connection error', { error: error.message, stack: error.stack });
            if (voiceManager.has(guild.id)) {
                const { connection, subscription, voiceStateHandler, player } = voiceManager.get(guild.id);
                
                // Stop the player
                if (player) {
                    player.stop();
                }
                
                // Clean up subscription
                if (subscription) {
                    subscription.unsubscribe();
                }
                
                // Remove voice state handler
                if (voiceStateHandler) {
                    guild.client.off('voiceStateUpdate', voiceStateHandler);
                }
                
                // Destroy connection
                if (connection) {
                    connection.destroy();
                }
                
                voiceManager.delete(guild.id);
            }
            safeSendMessage(textChannel, '❌ Voice connection encountered an error and stopped.');
        });

        // Check bot permissions for the voice channel (quick check)
        const botMember = guild.members.cache.get(guild.client.user.id);
        if (!botMember) {
            log('ERROR: Bot member not found in guild');
            safeSendMessage(textChannel, '❌ Bot not found in server. Please re-invite the bot.');
            return false;
        }

        const permissions = voiceChannel.permissionsFor(botMember);
        if (!permissions) {
            log('ERROR: Could not check permissions for voice channel');
            safeSendMessage(textChannel, '❌ Could not verify bot permissions. Please check bot roles.');
            return false;
        }

        log('Bot voice channel permissions', {
            connect: permissions.has('Connect'),
            speak: permissions.has('Speak')
        });

        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            log('ERROR: Bot lacks required voice permissions');
            safeSendMessage(textChannel, '❌ Bot lacks required permissions to connect or speak in the voice channel!');
            return false;
        }

        // Set up the timer
        const timer = setTimeout(() => {
            log('Timer expired, disconnecting bot');
            if (voiceManager.has(guild.id)) {
                const { connection, subscription, voiceStateHandler, player } = voiceManager.get(guild.id);
                
                log('Starting automatic cleanup after timer expiration');
                
                // Stop the player first
                if (player) {
                    player.stop();
                    log('Player stopped due to timer expiration');
                }
                
                // Clean up subscription
                if (subscription) {
                    subscription.unsubscribe();
                    log('Subscription cleaned up');
                }
                
                // Remove voice state handler
                if (voiceStateHandler) {
                    guild.client.off('voiceStateUpdate', voiceStateHandler);
                    log('Voice state handler removed');
                }
                
                // Destroy connection (this removes bot from voice channel)
                if (connection) {
                    connection.destroy();
                    log('Voice connection destroyed - bot should leave channel');
                }
                
                // Clean up voice manager
                voiceManager.delete(guild.id);
                log('Voice manager cleaned up');
            }
            
            // Notify in text channel
            safeSendMessage(textChannel, '⏰ wTed bot 3-hour session has ended. The bot has left the voice channel. Use `/wted play` to start again.');
        }, 3 * 60 * 60 * 1000); // 3 hours

        // Set up voice state update listener for this guild
        const client = guild.client;
        const voiceStateHandler = (oldState, newState) => {
            // Only handle changes for our target voice channel
            if (newState.channelId === VOICE_CHANNEL_ID || oldState.channelId === VOICE_CHANNEL_ID) {
                // Don't handle bot state changes
                if (newState.member.user.bot) return;
                
                log('Voice state change detected', {
                    user: newState.member.user.username,
                    oldChannel: oldState.channelId,
                    newChannel: newState.channelId,
                    action: newState.channelId === VOICE_CHANNEL_ID ? 'joined' : 'left'
                });
                
                // Check current members in the voice channel
                const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
                if (voiceChannel && voiceManager.has(guild.id)) {
                    const members = voiceChannel.members.filter(member => !member.user.bot);
                    log('Updated voice channel status', {
                        humanMembers: members.size,
                        memberNames: members.map(m => m.user.username)
                    });
                    
                    const { player } = voiceManager.get(guild.id);
                    
                    if (members.size > 0 && player.state.status === 'autopaused') {
                        log('Users joined, resuming player');
                        player.unpause();
                        safeSendMessage(textChannel, '▶️ wTed Radio resumed - welcome back!');
                    } else if (members.size === 0 && player.state.status === 'playing') {
                        log('All users left, player will auto-pause');
                        safeSendMessage(textChannel, '⏸️ wTed Radio paused - no users in voice channel.');
                    }
                }
            }
        };
        
        client.on('voiceStateUpdate', voiceStateHandler);
        
        // Store all data in voice manager including the handler and retry counter
        voiceManager.set(guild.id, { connection, player, timer, subscription, voiceStateHandler, retryCount: 0 });
        log('Voice manager entry created', { guildId: guild.id });

        // Send success message to text channel
        safeSendMessage(textChannel, '🎵 wTed Radio is now live! Playing for 3 hours.');

        // All diagnostic checks happen asynchronously (non-blocking)
        setImmediate(() => {
            // Check for deafen status after a delay
            setTimeout(() => {
                const currentChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
                if (currentChannel) {
                    const botMember = currentChannel.members.find(member => member.user.bot && member.user.id === guild.client.user.id);
                    if (botMember && (botMember.voice.selfDeaf || botMember.voice.deaf)) {
                        log('Bot is deafened in voice channel');
                        safeSendMessage(textChannel, '⚠️ Bot is deafened in voice channel. Right-click the bot and select "Undeafen" to hear audio.');
                    }
                }
            }, 3000);

            // Test stream URL accessibility
            setTimeout(() => {
                log('Testing stream URL accessibility');
                const https = require('https');
                const url = require('url');
                
                try {
                    const parsedUrl = url.parse(STREAM_URL);
                    const req = https.request(parsedUrl, (res) => {
                        log('Stream URL test response', { 
                            statusCode: res.statusCode, 
                            contentType: res.headers['content-type'],
                            icyName: res.headers['icy-name']
                        });
                        req.destroy();
                    });
                    
                    req.on('error', (error) => {
                        log('Stream URL test error', { error: error.message });
                        safeSendMessage(textChannel, '❌ Stream URL is not accessible. Please check the stream.');
                    });
                    
                    req.setTimeout(5000, () => {
                        log('Stream URL test timeout');
                        req.destroy();
                    });
                    
                    req.end();
                } catch (error) {
                    log('Error testing stream URL', { error: error.message });
                }
            }, 2000);
        });

        return true;
    } catch (error) {
        log('Error in voice connection', { error: error.message, stack: error.stack });
        safeSendMessage(textChannel, '❌ Failed to connect to voice channel. Please try again.');
        return false;
    }
}

// Helper function to perform complete cleanup (equivalent to /wted end)
async function performCleanup(guild, reason = 'cleanup') {
    log(`Performing cleanup for guild ${guild.id}`, { reason });
    
    if (voiceManager.has(guild.id)) {
        const { connection, subscription, voiceStateHandler, player, timer } = voiceManager.get(guild.id);
        
        log('Starting cleanup process');
        
        // Clear timer
        if (timer) {
            clearTimeout(timer);
            log('Timer cleared');
        }
        
        // Stop the player
        if (player) {
            player.stop();
            log('Player stopped');
        }
        
        // Clean up subscription
        if (subscription) {
            subscription.unsubscribe();
            log('Subscription cleaned up');
        }
        
        // Remove voice state handler
        if (voiceStateHandler) {
            guild.client.off('voiceStateUpdate', voiceStateHandler);
            log('Voice state handler removed');
        }
        
        // Destroy connection (this removes bot from voice channel)
        if (connection) {
            connection.destroy();
            log('Voice connection destroyed - bot should leave channel');
        }
        
        // Clean up voice manager
        voiceManager.delete(guild.id);
        log('Voice manager cleaned up');
        
        return true;
    }
    
    return false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wted')
        .setDescription('Control the wTed radio bot')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Start playing wTed radio'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('Stop the wTed radio bot'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restart')
                .setDescription('Restart the 3-hour timer')),

    async execute(interaction) {
        log('Command received', {
            command: interaction.commandName,
            subcommand: interaction.options.getSubcommand(),
            user: interaction.user.tag,
            guild: interaction.guild.name
        });

        const { guild, member } = interaction;
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'play') {
                // Check permissions FIRST before any Discord API calls
                if (!member.roles.cache.has(USER_ROLE_ID)) {
                    return interaction.reply({ 
                        content: '❌ You do not have the required role to use this command.',
                        ephemeral: true
                    });
                }

                if (voiceManager.has(guild.id)) {
                    return interaction.reply({ 
                        content: '🎵 The bot is already playing!',
                        ephemeral: true
                    });
                }

                // IMMEDIATE response - absolutely first thing after checks
                await interaction.reply({ 
                    content: '🔄 Starting wTed Radio...',
                    ephemeral: true
                });

                // Get text channel for updates (using test channel if provided)
                const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);

                // Handle ALL voice operations completely asynchronously - no await
                setImmediate(async () => {
                    try {
                        log('Starting async voice connection process');
                        await connectToVoice(guild, textChannel);
                        log('Voice connection process completed successfully');
                    } catch (error) {
                        log('Error in async voice connection', { error: error.message, stack: error.stack });
                        safeSendMessage(textChannel, '❌ Failed to start wTed Radio. Please try again.');
                    }
                });

            } else if (subcommand === 'end') {
                // Check permissions FIRST before any Discord API calls
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ 
                        content: '❌ You do not have the required role to use this command.',
                        ephemeral: true
                    });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.reply({ 
                        content: '❌ The bot is not currently playing.',
                        ephemeral: true
                    });
                }

                // IMMEDIATE response - absolutely first thing after checks
                await interaction.reply({ 
                    content: '🛑 Stopping wTed Radio...',
                    ephemeral: true
                });

                // Perform cleanup asynchronously to avoid interaction timeouts
                setImmediate(async () => {
                    try {
                        log('Starting cleanup process for /wted end');
                        
                        const success = await performCleanup(guild, 'manual end command');
                        
                        if (success) {
                            // Send confirmation to text channel
                            const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                            safeSendMessage(textChannel, '🛑 wTed Radio has been stopped by an admin.');
                            log('Manual cleanup completed successfully');
                        } else {
                            log('No active session found to clean up');
                        }
                        
                    } catch (error) {
                        log('Error during manual cleanup', { error: error.message, stack: error.stack });
                        const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                        safeSendMessage(textChannel, '⚠️ Error occurred while stopping. Bot may need manual disconnect.');
                    }
                });

            } else if (subcommand === 'restart') {
                // Check permissions FIRST before any Discord API calls
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ 
                        content: '❌ You do not have the required role to use this command.',
                        ephemeral: true
                    });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.reply({ 
                        content: '❌ The bot is not currently playing.',
                        ephemeral: true
                    });
                }

                // IMMEDIATE response - absolutely first thing after checks
                await interaction.reply({ 
                    content: '🔄 Restarting timer...',
                    ephemeral: true
                });

                // Restart the timer asynchronously
                setImmediate(() => {
                    try {
                        log('Restarting 3-hour timer');
                        
                        const voiceData = voiceManager.get(guild.id);
                        if (!voiceData) {
                            log('No voice data found for restart');
                            return;
                        }
                        
                        const { timer } = voiceData;
                        
                        // Clear the existing timer
                        if (timer) {
                            clearTimeout(timer);
                            log('Previous timer cleared');
                        }
                        
                        // Create new 3-hour timer
                        const newTimer = setTimeout(() => {
                            log('Timer expired after restart, disconnecting bot');
                            if (voiceManager.has(guild.id)) {
                                const { connection, subscription, voiceStateHandler, player } = voiceManager.get(guild.id);
                                
                                log('Starting automatic cleanup after timer expiration');
                                
                                // Stop the player first
                                if (player) {
                                    player.stop();
                                    log('Player stopped due to timer expiration');
                                }
                                
                                // Clean up subscription
                                if (subscription) {
                                    subscription.unsubscribe();
                                    log('Subscription cleaned up');
                                }
                                
                                // Remove voice state handler
                                if (voiceStateHandler) {
                                    guild.client.off('voiceStateUpdate', voiceStateHandler);
                                    log('Voice state handler removed');
                                }
                                
                                // Destroy connection (this removes bot from voice channel)
                                if (connection) {
                                    connection.destroy();
                                    log('Voice connection destroyed - bot should leave channel');
                                }
                                
                                // Clean up voice manager
                                voiceManager.delete(guild.id);
                                log('Voice manager cleaned up');
                            }
                            
                            // Notify in text channel
                            const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                            if (textChannel) {
                                safeSendMessage(textChannel, '⏰ wTed bot 3-hour session has ended. The bot has left the voice channel. Use `/wted play` to start again.');
                            }
                        }, 3 * 60 * 60 * 1000); // 3 hours

                        // Update the timer in voice manager
                        voiceManager.get(guild.id).timer = newTimer;
                        log('New 3-hour timer set');

                        // Send confirmation to text channel
                        const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                        if (textChannel) {
                            safeSendMessage(textChannel, '🔄 wTed Radio timer has been restarted for another 3 hours.');
                        }
                        
                    } catch (error) {
                        log('Error during timer restart', { error: error.message, stack: error.stack });
                        const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                        if (textChannel) {
                            safeSendMessage(textChannel, '⚠️ Error occurred while restarting timer.');
                        }
                    }
                });
            }

        } catch (error) {
            log('Error in wted command', { error: error.message, stack: error.stack });
            
            // Try to respond with error
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: '❌ An error occurred while executing this command.', 
                        ephemeral: true
                    });
                } else {
                    await interaction.editReply({ 
                        content: '❌ An error occurred while executing this command.'
                    });
                }
            } catch (replyError) {
                log('Error sending error message', { error: replyError.message });
            }
        }
    },
}; 