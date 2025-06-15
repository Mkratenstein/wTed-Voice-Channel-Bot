const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { GUILD_ID, USER_ROLE_ID, ADMIN_ROLE_ID, VOICE_CHANNEL_ID, TEXT_CHANNEL_ID, ACTIVE_TEXT_CHANNEL_ID, STREAM_URL } = require('../config');

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

// Async function to handle voice connection
async function connectToVoice(guild, textChannel) {
    try {
        log('Starting voice connection process');
        
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
            if (textChannel) {
                textChannel.send('⚠️ Starting wTed Radio, but no users are currently in the voice channel. Join the channel to hear the stream!').catch(console.error);
            }
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
                if (textChannel) {
                    textChannel.send('❌ Voice connection was disconnected. Please try again.').catch(console.error);
                }
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
                        if (textChannel) {
                            textChannel.send('⏸️ wTed Radio paused - no users in voice channel. Join the voice channel to resume!').catch(console.error);
                        }
                    }
                }
            }
            
            // Handle when player resumes
            if (oldState.status === 'autopaused' && newState.status === 'playing') {
                log('Player resumed from autopaused state');
                if (textChannel) {
                    textChannel.send('▶️ wTed Radio resumed - welcome back!').catch(console.error);
                }
            }
            
            // Handle idle state (might indicate stream ended or failed)
            if (newState.status === 'idle' && oldState.status !== 'idle') {
                log('Player went idle - stream may have ended or failed');
                if (textChannel) {
                    textChannel.send('⚠️ Audio stream stopped. Attempting to restart...').catch(console.error);
                }
                
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
            if (textChannel) {
                textChannel.send('❌ Audio player encountered an error and stopped.').catch(console.error);
            }
        });

        log('Creating audio resource', { streamUrl: STREAM_URL });
        
        // Enhanced stream URL testing with detailed diagnostics
        log('Testing stream URL accessibility and format');
        const https = require('https');
        const http = require('http');
        const url = require('url');
        
        let streamInfo = null;
        try {
            const parsedUrl = url.parse(STREAM_URL);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            // Create a promise for the stream test
            const streamTest = new Promise((resolve, reject) => {
                const testReq = protocol.request(parsedUrl, (res) => {
                    const info = {
                        statusCode: res.statusCode,
                        contentType: res.headers['content-type'],
                        icyName: res.headers['icy-name'],
                        icyGenre: res.headers['icy-genre'],
                        icyBr: res.headers['icy-br'],
                        icyMetaint: res.headers['icy-metaint'],
                        server: res.headers['server'],
                        connection: res.headers['connection']
                    };
                    
                    log('Stream URL detailed response', info);
                    
                    if (res.statusCode === 200) {
                        log('Stream URL is accessible and responding correctly');
                        resolve(info);
                    } else {
                        log('Stream URL returned non-200 status', { statusCode: res.statusCode });
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    testReq.destroy();
                });
                
                testReq.on('error', (error) => {
                    log('Stream URL test error', { error: error.message, code: error.code });
                    reject(error);
                });
                
                testReq.setTimeout(10000, () => {
                    log('Stream URL test timeout');
                    testReq.destroy();
                    reject(new Error('Connection timeout'));
                });
                
                testReq.end();
            });
            
            // Wait for stream test (but don't block if it fails)
            try {
                streamInfo = await streamTest;
            } catch (testError) {
                log('Stream test failed, but continuing anyway', { error: testError.message });
                if (textChannel) {
                    textChannel.send(`⚠️ Stream test failed: ${testError.message}. Attempting to play anyway...`).catch(console.error);
                }
            }
        } catch (error) {
            log('Error during stream URL testing', { error: error.message });
        }
        
        // Create audio resource with radio-optimized settings
        let resource;
        let resourceCreationMethod = 'unknown';
        
        try {
            log('Creating audio resource with radio-optimized settings');
            
            // Method 1: Try with specific radio stream settings
            try {
                log('Attempt 1: Creating resource with radio-specific FFmpeg args');
                resource = createAudioResource(STREAM_URL, {
                    inputType: 'arbitrary',
                    inlineVolume: true,
                    metadata: {
                        title: 'wTed Radio Stream',
                        url: STREAM_URL
                    },
                    // Radio-specific FFmpeg arguments
                    inputArgs: [
                        '-reconnect', '1',
                        '-reconnect_streamed', '1',
                        '-reconnect_delay_max', '5',
                        '-user_agent', 'wTed-Discord-Bot/1.0',
                        '-headers', 'Icy-MetaData: 1',
                        '-f', 'mp3'
                    ]
                });
                resourceCreationMethod = 'radio-optimized';
                log('Audio resource created successfully with radio-optimized settings');
            } catch (error1) {
                log('Radio-optimized creation failed, trying basic URL method', { error: error1.message });
                
                // Method 2: Try basic URL input type
                try {
                    log('Attempt 2: Creating resource with URL input type');
                    resource = createAudioResource(STREAM_URL, {
                        inputType: 'url',
                        inlineVolume: true,
                        metadata: {
                            title: 'wTed Radio Stream'
                        }
                    });
                    resourceCreationMethod = 'url-input';
                    log('Audio resource created successfully with URL input type');
                } catch (error2) {
                    log('URL input creation failed, trying arbitrary with minimal args', { error: error2.message });
                    
                    // Method 3: Minimal arbitrary input
                    resource = createAudioResource(STREAM_URL, {
                        inputType: 'arbitrary',
                        inlineVolume: true,
                        metadata: {
                            title: 'wTed Radio Stream'
                        }
                    });
                    resourceCreationMethod = 'arbitrary-minimal';
                    log('Audio resource created successfully with minimal arbitrary settings');
                }
            }
            
            log('Final audio resource details', {
                method: resourceCreationMethod,
                readable: resource.readable,
                volume: resource.volume ? 'present' : 'missing',
                metadata: resource.metadata,
                playStreamType: typeof resource.playStream,
                playStreamReadable: resource.playStream ? resource.playStream.readable : 'no playStream'
            });
            
        } catch (finalError) {
            log('All audio resource creation methods failed', { error: finalError.message, stack: finalError.stack });
            if (textChannel) {
                textChannel.send('❌ Failed to create audio resource. The stream URL may be incompatible or unavailable.').catch(console.error);
            }
            throw finalError;
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
                    if (textChannel) {
                        textChannel.send('❌ Stream failed after 5 retry attempts. Automatically ending wTed Radio session.').catch(console.error);
                    }
                    
                    performCleanup(guild, 'max retries reached').then(() => {
                        if (textChannel) {
                            textChannel.send('🔄 wTed Radio session ended due to connection issues. Use `/wted play` to try again.').catch(console.error);
                        }
                    });
                    return;
                }
                
                if (textChannel) {
                    textChannel.send(`❌ Stream error: ${error.message}. Attempting to reconnect... (${voiceData.retryCount}/5)`).catch(console.error);
                }
                
                // Attempt to recreate the stream with a different method
                setTimeout(() => {
                    if (voiceManager.has(guild.id)) {
                        log('Attempting to recreate stream after error', { 
                            retryAttempt: voiceData.retryCount,
                            previousMethod: resourceCreationMethod
                        });
                        
                        try {
                            // Try a different method for retry
                            let retryResource;
                            if (resourceCreationMethod === 'radio-optimized') {
                                // Try URL input type
                                retryResource = createAudioResource(STREAM_URL, {
                                    inputType: 'url',
                                    inlineVolume: true,
                                    metadata: { title: 'wTed Radio Stream' }
                                });
                                log('Retry using URL input type');
                            } else {
                                // Try radio-optimized
                                retryResource = createAudioResource(STREAM_URL, {
                                    inputType: 'arbitrary',
                                    inlineVolume: true,
                                    metadata: { title: 'wTed Radio Stream' },
                                    inputArgs: ['-reconnect', '1', '-reconnect_streamed', '1']
                                });
                                log('Retry using radio-optimized settings');
                            }
                            
                            const { player } = voiceManager.get(guild.id);
                            player.play(retryResource);
                            log('Stream recreated successfully with alternative method');
                            
                            // Reset retry counter on successful reconnection
                            voiceManager.get(guild.id).retryCount = 0;
                            
                            if (textChannel) {
                                textChannel.send('✅ Stream reconnected successfully!').catch(console.error);
                            }
                        } catch (recreateError) {
                            log('Failed to recreate stream', { 
                                error: recreateError.message, 
                                retryAttempt: voiceData.retryCount 
                            });
                            if (textChannel) {
                                textChannel.send(`❌ Failed to reconnect stream (attempt ${voiceData.retryCount}/5).`).catch(console.error);
                            }
                        }
                    }
                }, 5000); // Increased delay to 5 seconds
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
                if (textChannel) {
                    textChannel.send('✅ Stream data flowing - audio should be working!').catch(console.error);
                }
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
            if (textChannel) {
                textChannel.send('⚠️ Stream ended unexpectedly. This may indicate a connection issue.').catch(console.error);
            }
        });

        resource.playStream.on('close', () => {
            log('Stream closed', { 
                dataWasReceived: dataReceived,
                totalBytesReceived: totalBytesReceived,
                resourceMethod: resourceCreationMethod
            });
            if (textChannel) {
                textChannel.send('⚠️ Stream connection closed.').catch(console.error);
            }
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
                if (textChannel) {
                    textChannel.send('⚠️ Stream startup timeout - no audio data received within 15 seconds. The stream may be unavailable.').catch(console.error);
                }
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
            if (textChannel) {
                textChannel.send('❌ Voice connection encountered an error and stopped.').catch(console.error);
            }
        });

        // Check bot permissions for the voice channel (quick check)
        const botMember = guild.members.cache.get(guild.client.user.id);
        if (!botMember) {
            log('ERROR: Bot member not found in guild');
            if (textChannel) {
                textChannel.send('❌ Bot not found in server. Please re-invite the bot.').catch(console.error);
            }
            return false;
        }

        const permissions = voiceChannel.permissionsFor(botMember);
        if (!permissions) {
            log('ERROR: Could not check permissions for voice channel');
            if (textChannel) {
                textChannel.send('❌ Could not verify bot permissions. Please check bot roles.').catch(console.error);
            }
            return false;
        }

        log('Bot voice channel permissions', {
            connect: permissions.has('Connect'),
            speak: permissions.has('Speak')
        });

        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            log('ERROR: Bot lacks required voice permissions');
            if (textChannel) {
                textChannel.send('❌ Bot lacks required permissions to connect or speak in the voice channel!').catch(console.error);
            }
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
            if (textChannel) {
                textChannel.send('⏰ wTed bot 3-hour session has ended. The bot has left the voice channel. Use `/wted play` to start again.').catch(console.error);
            }
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
                        if (textChannel) {
                            textChannel.send('▶️ wTed Radio resumed - welcome back!').catch(console.error);
                        }
                    } else if (members.size === 0 && player.state.status === 'playing') {
                        log('All users left, player will auto-pause');
                        if (textChannel) {
                            textChannel.send('⏸️ wTed Radio paused - no users in voice channel.').catch(console.error);
                        }
                    }
                }
            }
        };
        
        client.on('voiceStateUpdate', voiceStateHandler);
        
        // Store all data in voice manager including the handler and retry counter
        voiceManager.set(guild.id, { connection, player, timer, subscription, voiceStateHandler, retryCount: 0 });
        log('Voice manager entry created', { guildId: guild.id });

        // Send success message to text channel
        if (textChannel) {
            textChannel.send('🎵 wTed Radio is now live! Playing for 3 hours.').catch(console.error);
        }

        // All diagnostic checks happen asynchronously (non-blocking)
        setImmediate(() => {
            // Check for deafen status after a delay
            setTimeout(() => {
                const currentChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
                if (currentChannel) {
                    const botMember = currentChannel.members.find(member => member.user.bot && member.user.id === guild.client.user.id);
                    if (botMember && (botMember.voice.selfDeaf || botMember.voice.deaf)) {
                        log('Bot is deafened in voice channel');
                        if (textChannel) {
                            textChannel.send('⚠️ Bot is deafened in voice channel. Right-click the bot and select "Undeafen" to hear audio.').catch(console.error);
                        }
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
                        if (textChannel) {
                            textChannel.send('❌ Stream URL is not accessible. Please check the stream.').catch(console.error);
                        }
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
        if (textChannel) {
            textChannel.send('❌ Failed to connect to voice channel. Please try again.').catch(console.error);
        }
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
                // IMMEDIATE response - absolutely first thing
                await interaction.reply({ 
                    content: '🔄 Checking permissions and starting wTed Radio...', 
                    flags: [4096] 
                });

                // Check permissions after response
                if (!member.roles.cache.has(USER_ROLE_ID)) {
                    return interaction.editReply({ 
                        content: '❌ You do not have the required role to use this command.'
                    });
                }

                if (voiceManager.has(guild.id)) {
                    return interaction.editReply({ 
                        content: '🎵 The bot is already playing!'
                    });
                }

                // Update status
                await interaction.editReply({ 
                    content: '🔄 Starting wTed Radio...'
                });

                // Get text channel for updates (using test channel if provided)
                const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);

                // Handle ALL voice operations asynchronously
                setImmediate(async () => {
                    try {
                        await connectToVoice(guild, textChannel);
                    } catch (error) {
                        log('Error in async voice connection', { error: error.message });
                        if (textChannel) {
                            textChannel.send('❌ Failed to start wTed Radio. Please try again.').catch(console.error);
                        }
                    }
                });

            } else if (subcommand === 'end') {
                // IMMEDIATE response - absolutely first thing
                await interaction.reply({ 
                    content: '🛑 Checking permissions and stopping wTed Radio...', 
                    flags: [4096] 
                });

                // Check permissions after response
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.editReply({ 
                        content: '❌ You do not have the required role to use this command.'
                    });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.editReply({ 
                        content: '❌ The bot is not currently playing.'
                    });
                }

                // Update status
                await interaction.editReply({ 
                    content: '🛑 Stopping wTed Radio...'
                });

                // Perform cleanup asynchronously to avoid interaction timeouts
                setImmediate(async () => {
                    try {
                        log('Starting cleanup process for /wted end');
                        
                        const success = await performCleanup(guild, 'manual end command');
                        
                        if (success) {
                            // Send confirmation to text channel
                            const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                            if (textChannel) {
                                textChannel.send('🛑 wTed Radio has been stopped by an admin.').catch(console.error);
                            }
                            log('Manual cleanup completed successfully');
                        } else {
                            log('No active session found to clean up');
                        }
                        
                    } catch (error) {
                        log('Error during manual cleanup', { error: error.message, stack: error.stack });
                        const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                        if (textChannel) {
                            textChannel.send('⚠️ Error occurred while stopping. Bot may need manual disconnect.').catch(console.error);
                        }
                    }
                });

            } else if (subcommand === 'restart') {
                // IMMEDIATE response - absolutely first thing
                await interaction.reply({ 
                    content: '🔄 Checking permissions and restarting timer...', 
                    flags: [4096] 
                });

                // Check permissions after response
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.editReply({ 
                        content: '❌ You do not have the required role to use this command.'
                    });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.editReply({ 
                        content: '❌ The bot is not currently playing.'
                    });
                }

                // Update status
                await interaction.editReply({ 
                    content: '🔄 Restarting timer...'
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
                                textChannel.send('⏰ wTed bot 3-hour session has ended. The bot has left the voice channel. Use `/wted play` to start again.').catch(console.error);
                            }
                        }, 3 * 60 * 60 * 1000); // 3 hours

                        // Update the timer in voice manager
                        voiceManager.get(guild.id).timer = newTimer;
                        log('New 3-hour timer set');

                        // Send confirmation to text channel
                        const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                        if (textChannel) {
                            textChannel.send('🔄 wTed Radio timer has been restarted for another 3 hours.').catch(console.error);
                        }
                        
                    } catch (error) {
                        log('Error during timer restart', { error: error.message, stack: error.stack });
                        const textChannel = guild.channels.cache.get(ACTIVE_TEXT_CHANNEL_ID);
                        if (textChannel) {
                            textChannel.send('⚠️ Error occurred while restarting timer.').catch(console.error);
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
                        flags: [4096] 
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