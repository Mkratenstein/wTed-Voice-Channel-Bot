const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');

const USER_ROLE_ID = process.env.USER_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const TEXT_CHANNEL_ID = process.env.TEXT_CHANNEL_ID;
const STREAM_URL = process.env.STREAM_URL;
const PLAY_DURATION = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wted')
        .setDescription('wTed Radio Bot commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Starts playing the wTed radio stream.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('Stops the wTed radio stream (Admin only).'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restart')
                .setDescription('Restarts the 3-hour timer for the stream (Admin only).')),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const member = interaction.member;
        const guild = interaction.guild;
        const voiceManager = interaction.client.voiceManager;

        if (subcommand === 'play') {
            if (!member.roles.cache.has(USER_ROLE_ID)) {
                return interaction.reply({ content: 'You do not have the required role to use this command.', ephemeral: true });
            }

            if (voiceManager.has(guild.id)) {
                return interaction.reply({ content: 'The bot is already playing.', ephemeral: true });
            }

            const voiceChannel = await guild.channels.fetch(VOICE_CHANNEL_ID);
            const textChannel = await guild.channels.fetch(TEXT_CHANNEL_ID);

            if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                return interaction.reply({ content: 'Could not find the specified voice channel.', ephemeral: true });
            }

            await interaction.reply({ content: 'Starting the wTed radio bot...', ephemeral: true });

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(STREAM_URL);

            player.play(resource);
            connection.subscribe(player);

            const timer = setTimeout(() => {
                if (voiceManager.has(guild.id)) {
                    connection.destroy();
                    voiceManager.delete(guild.id);
                    textChannel.send('wTed bot 3 hour session has ended. To reactivate, use the `/wted play` command to start it again.');
                }
            }, PLAY_DURATION);

            voiceManager.set(guild.id, { connection, player, timer });

            connection.on(VoiceConnectionStatus.Ready, () => {
                 textChannel.send('The wTed bot is now Live. It will be active for 3 hours.');
            });

            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                    // Seems to be reconnecting to a new channel - ignore
                } catch (error) {
                    // Seems to be a real disconnect which SHOULDN'T be happening unless manually disconnected
                    if (voiceManager.has(guild.id)) {
                        const { timer } = voiceManager.get(guild.id);
                        clearTimeout(timer);
                        voiceManager.delete(guild.id);
                        connection.destroy();
                    }
                }
            });


        } else if (subcommand === 'end') {
            if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                return interaction.reply({ content: 'You do not have the required role to use this command.', ephemeral: true });
            }

            if (!voiceManager.has(guild.id)) {
                return interaction.reply({ content: 'The bot is not currently playing.', ephemeral: true });
            }

            const { connection, timer } = voiceManager.get(guild.id);
            clearTimeout(timer);
            connection.destroy();
            voiceManager.delete(guild.id);

            return interaction.reply({ content: 'The wTed bot has been stopped.', ephemeral: true });

        } else if (subcommand === 'restart') {
            if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
                return interaction.reply({ content: 'You do not have the required role to use this command.', ephemeral: true });
            }

            if (!voiceManager.has(guild.id)) {
                return interaction.reply({ content: 'The bot is not currently playing.', ephemeral: true });
            }
            
            const textChannel = await guild.channels.fetch(TEXT_CHANNEL_ID);
            const { timer } = voiceManager.get(guild.id);
            clearTimeout(timer);

            const newTimer = setTimeout(() => {
                if (voiceManager.has(guild.id)) {
                    const { connection } = voiceManager.get(guild.id);
                    connection.destroy();
                    voiceManager.delete(guild.id);
                    textChannel.send('wTed bot 3 hour session has ended. To reactivate, use the `/wted play` command to start it again.');
                }
            }, PLAY_DURATION);

            voiceManager.get(guild.id).timer = newTimer;

            await interaction.reply({ content: 'The timer has been restarted for 3 hours.', ephemeral: true });
            await textChannel.send('The wTed bot timer has been restarted for another 3 hours.');
        }
    },
}; 