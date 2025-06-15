const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { log } = require('./utils/logger');
const config = require('./utils/config');
const { deployCommands } = require('./deploy-commands');

log('Bot is starting...');

// Deploy commands first
deployCommands()
    .then(() => {
        log('Commands deployed successfully.');
    })
    .catch((error) => {
        log('Failed to deploy commands.', { error });
        process.exit(1);
    });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        log(`Loaded command: ${command.data.name}`);
    } else {
        log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.once(Events.ClientReady, c => {
    log(`Ready! Logged in as ${c.user.tag}`);
    log(`Bot is ready and running in ${client.guilds.cache.size} server(s).`);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        log(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        log('Error executing command', { command: interaction.commandName, error: error.message, stack: error.stack });
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.login(config.DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
    log('SIGINT received. Shutting down gracefully.');
    client.destroy();
    process.exit(0);
}); 