require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { deployCommands } = require('./deploy-commands');
const { DISCORD_TOKEN } = require('./config');

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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
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
        console.log(`Loaded command: ${command.data.name}`);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        console.log(`Executing command: ${interaction.commandName} by ${interaction.user.tag}`);
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: [4096] });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: [4096] });
            }
        } catch (replyError) {
            console.error('Error sending error message:', replyError);
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
    }
});

// Handle errors
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(DISCORD_TOKEN); 