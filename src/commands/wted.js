const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { USER_ROLE_ID, ADMIN_ROLE_ID, VOICE_CHANNEL_ID, TEXT_CHANNEL_ID, STREAM_URL } = require('../config');

// Store active connections and timers
const voiceManager = new Map();

const PLAY_DURATION = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

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
        console.log('Command received:', interaction.commandName, interaction.options.getSubcommand());
        const { guild, member } = interaction;
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'play') {
                console.log('Play command executed by user:', member.user.tag);
                console.log('User roles:', member.roles.cache.map(r => r.name).join(', '));
                console.log('Required role ID:', USER_ROLE_ID);

                if (!member.roles.cache.has(USER_ROLE_ID)) {
                    console.log('User does not have required role');
                    return interaction.reply({ content: 'You do not have the required role to use this command.', flags: [4096] });
                }

                if (voiceManager.has(guild.id)) {
                    console.log('Bot is already playing in this guild');
                    return interaction.reply({ content: 'The bot is already playing.', flags: [4096] });
                }

                const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
                console.log('Voice channel found:', voiceChannel?.name || 'Not found');

                if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                    console.log('Invalid voice channel');
                    return interaction.reply({ content: 'Could not find the specified voice channel.', flags: [4096] });
                }

                await interaction.reply({ content: 'Starting the wTed radio bot...', flags: [4096] });
                console.log('Attempting to join voice channel');

                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                });

                console.log('Voice connection established');

                const player = createAudioPlayer();
                const resource = createAudioResource(STREAM_URL, {
                    inputType: 'arbitrary',
                    inlineVolume: true
                });

                console.log('Audio resource created with URL:', STREAM_URL);

                connection.subscribe(player);
                player.play(resource);

                console.log('Audio player started');

                // Set up error handling
                player.on('error', error => {
                    console.error('Audio player error:', error);
                    if (voiceManager.has(guild.id)) {
                        voiceManager.get(guild.id).connection.destroy();
                        voiceManager.delete(guild.id);
                    }
                });

                connection.on('error', error => {
                    console.error('Voice connection error:', error);
                    if (voiceManager.has(guild.id)) {
                        voiceManager.get(guild.id).connection.destroy();
                        voiceManager.delete(guild.id);
                    }
                });

                // Store the connection and set up the timer
                const timer = setTimeout(() => {
                    console.log('Timer expired, disconnecting bot');
                    if (voiceManager.has(guild.id)) {
                        voiceManager.get(guild.id).connection.destroy();
                        voiceManager.delete(guild.id);
                    }
                }, PLAY_DURATION);

                voiceManager.set(guild.id, { connection, player, timer });
                console.log('Voice manager entry created for guild:', guild.id);

            } else if (subcommand === 'end') {
                console.log('End command executed by user:', member.user.tag);
                console.log('User roles:', member.roles.cache.map(r => r.name).join(', '));
                console.log('Required role ID:', ADMIN_ROLE_ID);

                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    console.log('User does not have admin role');
                    return interaction.reply({ content: 'You do not have the required role to use this command.', flags: [4096] });
                }

                if (!voiceManager.has(guild.id)) {
                    console.log('No active voice connection found');
                    return interaction.reply({ content: 'The bot is not currently playing.', flags: [4096] });
                }

                console.log('Stopping bot and cleaning up resources');
                const { connection, timer } = voiceManager.get(guild.id);
                clearTimeout(timer);
                connection.destroy();
                voiceManager.delete(guild.id);

                return interaction.reply({ content: 'The wTed bot has been stopped.', flags: [4096] });

            } else if (subcommand === 'restart') {
                console.log('Restart command executed by user:', member.user.tag);
                if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                    console.log('User does not have admin role');
                    return interaction.reply({ content: 'You do not have the required role to use this command.', flags: [4096] });
                }

                if (!voiceManager.has(guild.id)) {
                    console.log('No active voice connection found');
                    return interaction.reply({ content: 'The bot is not currently playing.', flags: [4096] });
                }

                console.log('Restarting timer');
                const { timer } = voiceManager.get(guild.id);
                clearTimeout(timer);
                const newTimer = setTimeout(() => {
                    console.log('Timer expired, disconnecting bot');
                    if (voiceManager.has(guild.id)) {
                        voiceManager.get(guild.id).connection.destroy();
                        voiceManager.delete(guild.id);
                    }
                }, PLAY_DURATION);

                voiceManager.get(guild.id).timer = newTimer;

                await interaction.reply({ content: 'The timer has been restarted for 3 hours.', flags: [4096] });
                await textChannel.send('The wTed bot timer has been restarted for another 3 hours.');
            }
        } catch (error) {
            console.error('Error in wted command:', error);
            await interaction.reply({ content: 'There was an error executing this command.', flags: [4096] });
        }
    },
}; 