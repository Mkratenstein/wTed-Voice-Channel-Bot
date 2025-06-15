const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { log } = require('../utils/logger');
const config = require('../utils/config');
const { connectAndPlay, disconnect, voiceManager, safeSendMessage } = require('../voiceManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wted')
        .setDescription('Controls the wTed Radio bot.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Starts playing wTed Radio in the voice channel.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('Stops the radio and disconnects the bot (Admin only).'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restart')
                .setDescription('Restarts the bot connection (Admin only).')),
    
    async execute(interaction) {
        const { guild, member, client } = interaction;
        const subcommand = interaction.options.getSubcommand();
        
        log(`Command received: /wted ${subcommand}`, { user: member.user.tag, guild: guild.name });

        // Use ephemeral reply to acknowledge the command immediately
        await interaction.reply({ content: 'Processing your request...', flags: MessageFlags.Ephemeral });

        try {
            if (subcommand === 'play') {
                // Permission Check
                if (!member.roles.cache.has(config.USER_ROLE_ID)) {
                    log('Permission denied for /wted play', { userId: member.id });
                    return interaction.editReply({ content: '❌ You do not have the required role to use this command.' });
                }

                if (voiceManager.has(guild.id)) {
                    return interaction.editReply({ content: '🎵 The bot is already playing!' });
                }

                await interaction.editReply({ content: '✅ Request received! Starting wTed Radio...' });
                
                // Don't await this; let it run in the background
                connectAndPlay(guild);

            } else if (subcommand === 'end') {
                // Permission Check
                if (!member.roles.cache.has(config.ADMIN_ROLE_ID)) {
                    log('Permission denied for /wted end', { userId: member.id });
                    return interaction.editReply({ content: '❌ You do not have the required role to use this command (Admin only).' });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.editReply({ content: '❌ The bot is not currently playing.' });
                }
                
                await interaction.editReply({ content: '✅ Request received! Stopping the bot...' });
                await safeSendMessage(client, '🛑 wTed Radio is being shut down by an admin.');
                disconnect(guild);

            } else if (subcommand === 'restart') {
                // Permission Check
                if (!member.roles.cache.has(config.ADMIN_ROLE_ID)) {
                    log('Permission denied for /wted restart', { userId: member.id });
                    return interaction.editReply({ content: '❌ You do not have the required role to use this command (Admin only).' });
                }
                
                await interaction.editReply({ content: '✅ Request received! Restarting the bot...' });

                if (voiceManager.has(guild.id)) {
                    await safeSendMessage(client, '🔄 Restarting the wTed Radio stream as requested by an admin.');
                    log('Restarting: Disconnecting first...');
                    disconnect(guild);
                } else {
                     await safeSendMessage(client, '🔄 Starting the wTed Radio stream as requested by an admin.');
                }
                
                // Wait a moment before reconnecting to ensure full disconnect
                setTimeout(() => {
                    log('Restarting: Reconnecting...');
                    connectAndPlay(guild);
                }, 2000);
            }
        } catch (error) {
            log('An error occurred during command execution.', { error: error.message, stack: error.stack });
            await interaction.editReply({ content: '🔥 An unexpected error occurred. Please check the logs.' });
        }
    },
}; 