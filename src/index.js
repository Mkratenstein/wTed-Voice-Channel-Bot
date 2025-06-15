require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { deployCommands } = require('./deploy-commands');

// Verify environment variables
if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is not set in environment variables');
    process.exit(1);
}

if (!process.env.CLIENT_ID) {
    console.error('CLIENT_ID is not set in environment variables');
    process.exit(1);
}

if (!process.env.GUILD_ID) {
    console.error('GUILD_ID is not set in environment variables');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
});

client.commands = new Collection();
client.voiceManager = new Map(); // To store voice connection and timer

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', flags: [4096] });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', flags: [4096] });
        }
    }
});

client.once('ready', async () => {
    console.log(`Ready! Logged in as ${client.user.tag}`);
    try {
        console.log('Deploying commands...');
        await deployCommands();
        console.log('Commands deployed successfully!');
    } catch (error) {
        console.error('Error deploying commands:', error);
        // Don't exit the process, let the bot continue running
        console.log('Continuing without command deployment...');
    }
});

// Handle process errors
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
}); 