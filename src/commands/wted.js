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
                log('Play command executed', {
                    user: member.user.tag,
                    roles: member.roles.cache.map(r => ({ id: r.id, name: r.name })),
                    requiredRoleId: USER_ROLE_ID
                });

                if (!member.roles.cache.has(USER_ROLE_ID)) {
                    log('User does not have required role');
                    return interaction.reply({ content: 'You do not have the required role to use this command.', flags: [4096] });
                }

                if (voiceManager.has(guild.id)) {
                    log('Bot is already playing in this guild');
                    return interaction.reply({ content: 'The bot is already playing.', flags: [4096] });
                }

                const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
                log('Voice channel lookup', {
                    channelId: VOICE_CHANNEL_ID,
                    found: !!voiceChannel,
                    channelName: voiceChannel?.name
                });

                if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                    log('Invalid voice channel');
                    return interaction.reply({ content: 'Could not find the specified voice channel.', flags: [4096] });
                }

                // Reply immediately
                await interaction.reply({ content: 'Starting the wTed radio bot...', flags: [4096] });

                try {
                    log('Attempting to join voice channel');
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                    });

                    log('Voice connection established');

                    const player = createAudioPlayer();
                    log('Audio player created');

                    const resource = createAudioResource(STREAM_URL, {
                        inputType: 'arbitrary',
                        inlineVolume: true
                    });

                    log('Audio resource created', { streamUrl: STREAM_URL });

                    connection.subscribe(player);
                    player.play(resource);

                    log('Audio player started');

                    // Set up error handling
                    player.on('error', error => {
                        log('Audio player error', { error: error.message });
                        if (voiceManager.has(guild.id)) {
                            voiceManager.get(guild.id).connection.destroy();
                            voiceManager.delete(guild.id);
                        }
                    });

                    connection.on('error', error => {
                        log('Voice connection error', { error: error.message });
                        if (voiceManager.has(guild.id)) {
                            voiceManager.get(guild.id).connection.destroy();
                            voiceManager.delete(guild.id);
                        }
                    });

                    // Store the connection and set up the timer
                    const timer = setTimeout(() => {
                        log('Timer expired, disconnecting bot');
                        if (voiceManager.has(guild.id)) {
                            voiceManager.get(guild.id).connection.destroy();
                            voiceManager.delete(guild.id);
                        }
                    }, 3 * 60 * 60 * 1000);

                    voiceManager.set(guild.id, { connection, player, timer });
                    log('Voice manager entry created', { guildId: guild.id });

                    // Send a follow-up message
                    await interaction.followUp({ content: 'Successfully connected to voice channel!', flags: [4096] });

                } catch (error) {
                    log('Error during voice setup', { error: error.message });
                    await interaction.followUp({ content: 'Failed to connect to voice channel. Please try again.', flags: [4096] });
                }

            } else if (subcommand === 'end') {
                log('End command executed', {
                    user: member.user.tag,
                    roles: member.roles.cache.map(r => ({ id: r.id, name: r.name })),
                    requiredRoleId: ADMIN_ROLE_ID
                });

                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    log('User does not have admin role');
                    return interaction.reply({ content: 'You do not have the required role to use this command.', flags: [4096] });
                }

                if (!voiceManager.has(guild.id)) {
                    log('No active voice connection found');
                    return interaction.reply({ content: 'The bot is not currently playing.', flags: [4096] });
                }

                // Reply immediately
                await interaction.reply({ content: 'Stopping the wTed radio bot...', flags: [4096] });

                log('Stopping bot and cleaning up resources');
                const { connection, timer } = voiceManager.get(guild.id);
                clearTimeout(timer);
                connection.destroy();
                voiceManager.delete(guild.id);

                await interaction.followUp({ content: 'The wTed bot has been stopped.', flags: [4096] });

            } else if (subcommand === 'restart') {
                log('Restart command executed', {
                    user: member.user.tag,
                    roles: member.roles.cache.map(r => ({ id: r.id, name: r.name })),
                    requiredRoleId: ADMIN_ROLE_ID
                });

                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    log('User does not have admin role');
                    return interaction.reply({ content: 'You do not have the required role to use this command.', flags: [4096] });
                }

                if (!voiceManager.has(guild.id)) {
                    log('No active voice connection found');
                    return interaction.reply({ content: 'The bot is not currently playing.', flags: [4096] });
                }

                // Reply immediately
                await interaction.reply({ content: 'Restarting the timer...', flags: [4096] });

                log('Restarting timer');
                const { timer } = voiceManager.get(guild.id);
                clearTimeout(timer);
                const newTimer = setTimeout(() => {
                    log('Timer expired, disconnecting bot');
                    if (voiceManager.has(guild.id)) {
                        voiceManager.get(guild.id).connection.destroy();
                        voiceManager.delete(guild.id);
                    }
                }, 3 * 60 * 60 * 1000);

                voiceManager.get(guild.id).timer = newTimer;

                await interaction.followUp({ content: 'The timer has been restarted for 3 hours.', flags: [4096] });
                const textChannel = guild.channels.cache.get(TEXT_CHANNEL_ID);
                if (textChannel) {
                    await textChannel.send('The wTed bot timer has been restarted for another 3 hours.');
                }
            }
        } catch (error) {
            log('Error in wted command', { error: error.message, stack: error.stack });
            try {
                if (!interaction.replied) {
                    await interaction.reply({ content: 'There was an error executing this command.', flags: [4096] });
                } else {
                    await interaction.followUp({ content: 'There was an error executing this command.', flags: [4096] });
                }
            } catch (replyError) {
                log('Error sending error message', { error: replyError.message });
            }
        }
    },
}; 