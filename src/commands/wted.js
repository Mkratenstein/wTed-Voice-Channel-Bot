const { SlashCommandBuilder } = require('discord.js');
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
                .setDescription('Stops the radio and disconnects the bot (Admin only).')),
    
    async execute(interaction) {
        const { guild, member, client } = interaction;
        const subcommand = interaction.options.getSubcommand();
        
        log(`Command received: /wted ${subcommand}`, { user: member.user.tag, guild: guild.name });

        // Defer the reply to avoid timeout, and make it public.
        await interaction.deferReply();

        try {
            if (subcommand === 'play') {
                if (!member.roles.cache.has(config.USER_ROLE_ID)) {
                    log('Permission denied for /wted play', { userId: member.id });
                    return interaction.editReply({ content: '❌ You do not have the required role to use this command.' });
                }

                if (voiceManager.has(guild.id)) {
                    return interaction.editReply({ content: '�� The bot is already playing!' });
                }

                await interaction.editReply({ content: `▶️ **${member.displayName}** started wTed Radio!` });
                connectAndPlay(guild); // Runs in the background

            } else if (subcommand === 'end') {
                if (!member.roles.cache.has(config.ADMIN_ROLE_ID)) {
                    log('Permission denied for /wted end', { userId: member.id });
                    return interaction.editReply({ content: '❌ You do not have the required role to use this command (Admin only).' });
                }

                if (!voiceManager.has(guild.id)) {
                    return interaction.editReply({ content: '🔇 The bot is not currently in a voice channel.' });
                }
                
                disconnect(interaction.guild, true); // Mark as an intentional disconnect
                await interaction.editReply({ content: `⏹️ **${member.displayName}** stopped the radio.` });

            }
        } catch (error) {
            log('An error occurred during command execution.', { error: error.message, stack: error.stack });
            if (!interaction.replied) {
                return; // Can't do anything if we haven't replied
            }
            try {
                await interaction.editReply({ content: '🔥 An unexpected error occurred. Please check the logs.' });
            } catch (editError) {
                log('Failed to send error feedback to user.', { error: editError.message });
            }
        }
    },
}; 