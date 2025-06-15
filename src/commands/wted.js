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

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
        });

        log('Voice connection established');

        // Wait for connection to be ready
        connection.on('stateChange', (oldState, newState) => {
            log('Connection state changed', { 
                from: oldState.status, 
                to: newState.status 
            });
        });

        const player = createAudioPlayer();
        log('Audio player created');

        // Add more detailed player state logging
        player.on('stateChange', (oldState, newState) => {
            log('Player state changed', { 
                from: oldState.status, 
                to: newState.status 
            });
        });

        log('Creating audio resource', { streamUrl: STREAM_URL });
        const resource = createAudioResource(STREAM_URL, {
            inputType: 'arbitrary',
            inlineVolume: true,
            metadata: {
                title: 'wTed Radio Stream'
            }
        });

        log('Audio resource created successfully');

        // Subscribe the connection to the player
        const subscription = connection.subscribe(player);
        log('Connection subscribed to player', { subscribed: !!subscription });

        // Play the resource
        player.play(resource);
        log('Audio player started playing resource');

        // Set up error handling
        player.on('error', error => {
            log('Audio player error', { error: error.message, stack: error.stack });
            if (voiceManager.has(guild.id)) {
                const { connection, subscription } = voiceManager.get(guild.id);
                if (subscription) {
                    subscription.unsubscribe();
                }
                connection.destroy();
                voiceManager.delete(guild.id);
            }
            if (textChannel) {
                textChannel.send('❌ Audio player encountered an error and stopped.').catch(console.error);
            }
        });

        connection.on('error', error => {
            log('Voice connection error', { error: error.message, stack: error.stack });
            if (voiceManager.has(guild.id)) {
                const { connection, subscription } = voiceManager.get(guild.id);
                if (subscription) {
                    subscription.unsubscribe();
                }
                connection.destroy();
                voiceManager.delete(guild.id);
            }
            if (textChannel) {
                textChannel.send('❌ Voice connection encountered an error and stopped.').catch(console.error);
            }
        });

        // Add resource error handling
        resource.playStream.on('error', error => {
            log('Stream error', { error: error.message, stack: error.stack });
            if (textChannel) {
                textChannel.send('❌ Stream encountered an error. Please check the stream URL.').catch(console.error);
            }
        });

        // Set up the timer
        const timer = setTimeout(() => {
            log('Timer expired, disconnecting bot');
            if (voiceManager.has(guild.id)) {
                const { connection, subscription } = voiceManager.get(guild.id);
                if (subscription) {
                    subscription.unsubscribe();
                }
                connection.destroy();
                voiceManager.delete(guild.id);
            }
            if (textChannel) {
                textChannel.send('⏰ wTed bot 3-hour session has ended. Use `/wted play` to start again.').catch(console.error);
            }
        }, 3 * 60 * 60 * 1000);

        voiceManager.set(guild.id, { connection, player, timer, subscription });
        log('Voice manager entry created', { guildId: guild.id });

        // Send success message to text channel
        if (textChannel) {
            textChannel.send('🎵 wTed Radio is now live! Playing for 3 hours.').catch(console.error);
        }

        // Test the stream URL
        log('Testing stream URL accessibility');
        try {
            const https = require('https');
            const http = require('http');
            const url = require('url');
            
            const parsedUrl = url.parse(STREAM_URL);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const req = protocol.request(parsedUrl, (res) => {
                log('Stream URL test response', { 
                    statusCode: res.statusCode, 
                    headers: res.headers,
                    contentType: res.headers['content-type']
                });
                req.destroy();
            });
            
            req.on('error', (error) => {
                log('Stream URL test error', { error: error.message });
            });
            
            req.setTimeout(5000, () => {
                log('Stream URL test timeout');
                req.destroy();
            });
            
            req.end();
        } catch (error) {
            log('Error testing stream URL', { error: error.message });
        }

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

                // Respond immediately
                await interaction.reply({ 
                    content: '🔄 Starting wTed Radio...', 
                    flags: [4096] 
                });

                // Get text channel for updates
                const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);

                // Handle voice connection asynchronously
                setImmediate(async () => {
                    await connectToVoice(guild, textChannel);
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

                // Clean up resources
                const { connection, timer, subscription } = voiceManager.get(guild.id);
                clearTimeout(timer);
                if (subscription) {
                    subscription.unsubscribe();
                }
                connection.destroy();
                voiceManager.delete(guild.id);

                // Send confirmation to text channel
                const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                if (textChannel) {
                    textChannel.send('🛑 wTed Radio has been stopped by an admin.').catch(console.error);
                }

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

                // Restart the timer
                const { timer } = voiceManager.get(guild.id);
                clearTimeout(timer);
                const newTimer = setTimeout(() => {
                    log('Timer expired, disconnecting bot');
                    if (voiceManager.has(guild.id)) {
                        const { connection, subscription } = voiceManager.get(guild.id);
                        if (subscription) {
                            subscription.unsubscribe();
                        }
                        connection.destroy();
                        voiceManager.delete(guild.id);
                    }
                    const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                    if (textChannel) {
                        textChannel.send('⏰ wTed bot 3-hour session has ended. Use `/wted play` to start again.').catch(console.error);
                    }
                }, 3 * 60 * 60 * 1000);

                voiceManager.get(guild.id).timer = newTimer;

                // Send confirmation to text channel
                const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                if (textChannel) {
                    textChannel.send('🔄 wTed Radio timer has been restarted for another 3 hours.').catch(console.error);
                }
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