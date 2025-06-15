const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./utils/config');
const { log } = require('./utils/logger');

async function deployCommands() {
    const commands = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(`./commands/${file}`);
        if (command.data) {
            commands.push(command.data.toJSON());
        }
    }

    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

    try {
        log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID),
            { body: commands },
        );

        log(`Successfully reloaded ${commands.length} application (/) commands.`);
    } catch (error) {
        log('Failed to reload application commands.', { error });
        throw error; // Re-throw to be caught by the caller in index.js
    }
}

// If this file is run directly, deploy commands
if (require.main === module) {
    deployCommands()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { deployCommands }; 