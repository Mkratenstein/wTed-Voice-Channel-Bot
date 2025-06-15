const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { USER_ROLE_ID, ADMIN_ROLE_ID, VOICE_CHANNEL_ID, TEXT_CHANNEL_ID, STREAM_URL } = require('../config');

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
        const resource = createAudioResource(STREAM_URL, {
            inputType: 'arbitrary',
            inlineVolume: true,
            metadata: {
                title: 'wTed Radio Stream'
            }
        });

        log('Audio resource created successfully', {
            readable: resource.readable,
            volume: resource.volume ? 'present' : 'missing',
            metadata: resource.metadata
        });

        // Add detailed resource error handling
        resource.playStream.on('error', error => {
            log('Stream error', { error: error.message, stack: error.stack });
            if (textChannel) {
                textChannel.send('❌ Stream encountered an error. Please check the stream URL.').catch(console.error);
            }
        });

        // Monitor stream events (async, non-blocking)
        setImmediate(() => {
            resource.playStream.on('end', () => {
                log('Stream ended');
            });

            resource.playStream.on('close', () => {
                log('Stream closed');
            });

            resource.playStream.on('readable', () => {
                log('Stream is readable');
            });
        });

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
        
        // Store all data in voice manager including the handler
        voiceManager.set(guild.id, { connection, player, timer, subscription, voiceStateHandler });
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
                // Check permissions first
                if (!member.roles.cache.has(USER_ROLE_ID)) {
                    return interaction.reply({ 
                        content: '❌ You do not have the required role to use this command.', 
                        flags: [4096] 
                    });
                }

                if (voiceManager.has(guild.id)) {
                    return interaction.reply({ 
                        content: '🎵 The bot is already playing!', 
                        flags: [4096] 
                    });
                }

                // Respond immediately - no voice operations before this
                await interaction.reply({ 
                    content: '🔄 Starting wTed Radio...', 
                    flags: [4096] 
                });

                // Get text channel for updates
                const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);

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
                // Check permissions first
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ 
                        content: '❌ You do not have the required role to use this command.', 
                        flags: [4096] 
                    });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.reply({ 
                        content: '❌ The bot is not currently playing.', 
                        flags: [4096] 
                    });
                }

                // Respond immediately
                await interaction.reply({ 
                    content: '🛑 Stopping wTed Radio...', 
                    flags: [4096] 
                });

                // Perform cleanup asynchronously to avoid interaction timeouts
                setImmediate(() => {
                    try {
                        log('Starting cleanup process for /wted end');
                        
                        const { connection, timer, subscription, voiceStateHandler, player } = voiceManager.get(guild.id);
                        
                        // Stop the timer
                        if (timer) {
                            clearTimeout(timer);
                            log('Timer cleared');
                        }
                        
                        // Stop the audio player
                        if (player) {
                            player.stop();
                            log('Audio player stopped');
                        }
                        
                        // Unsubscribe from the connection
                        if (subscription) {
                            subscription.unsubscribe();
                            log('Subscription unsubscribed');
                        }
                        
                        // Remove voice state handler
                        if (voiceStateHandler) {
                            guild.client.off('voiceStateUpdate', voiceStateHandler);
                            log('Voice state handler removed');
                        }
                        
                        // Destroy the voice connection (this removes bot from channel)
                        if (connection) {
                            connection.destroy();
                            log('Voice connection destroyed');
                        }
                        
                        // Remove from voice manager
                        voiceManager.delete(guild.id);
                        log('Removed from voice manager');

                        // Send confirmation to text channel
                        const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                        if (textChannel) {
                            textChannel.send('🛑 wTed Radio has been stopped by an admin.').catch(console.error);
                        }
                        
                        log('Cleanup process completed successfully');
                        
                    } catch (error) {
                        log('Error during cleanup', { error: error.message, stack: error.stack });
                        const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                        if (textChannel) {
                            textChannel.send('⚠️ Error occurred while stopping. Bot may need manual disconnect.').catch(console.error);
                        }
                    }
                });

            } else if (subcommand === 'restart') {
                // Check permissions first
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    return interaction.reply({ 
                        content: '❌ You do not have the required role to use this command.', 
                        flags: [4096] 
                    });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.reply({ 
                        content: '❌ The bot is not currently playing.', 
                        flags: [4096] 
                    });
                }

                // Respond immediately
                await interaction.reply({ 
                    content: '🔄 Restarting timer...', 
                    flags: [4096] 
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
                            const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                            if (textChannel) {
                                textChannel.send('⏰ wTed bot 3-hour session has ended. The bot has left the voice channel. Use `/wted play` to start again.').catch(console.error);
                            }
                        }, 3 * 60 * 60 * 1000); // 3 hours

                        // Update the timer in voice manager
                        voiceManager.get(guild.id).timer = newTimer;
                        log('New 3-hour timer set');

                        // Send confirmation to text channel
                        const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                        if (textChannel) {
                            textChannel.send('🔄 wTed Radio timer has been restarted for another 3 hours.').catch(console.error);
                        }
                        
                    } catch (error) {
                        log('Error during timer restart', { error: error.message, stack: error.stack });
                        const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
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
                if (!interaction.replied) {
                    await interaction.reply({ 
                        content: '❌ An error occurred while executing this command.', 
                        flags: [4096] 
                    });
                }
            } catch (replyError) {
                log('Error sending error message', { error: replyError.message });
            }
        }
    },
}; 