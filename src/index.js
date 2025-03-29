require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const OpenAI = require('openai');
const DataCollector = require('./utils/dataCollector');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// Initialize OpenRouter client
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/ericwang210000/discord-llm-bot',
    'X-Title': 'Discord LLM Bot'
  }
});

// Initialize data collector
const dataCollector = new DataCollector(process.env.DATA_STORAGE_PATH);

// Bot ready event
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await dataCollector.initialize();
});

// Message event handler
client.on(Events.MessageCreate, async message => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if the message mentions the bot or is a DM
  if (!message.mentions.users.has(client.user.id) && !message.channel.isDMBased()) return;

  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Prepare the conversation
    const conversation = [
      { role: 'system', content: 'You are a helpful AI assistant in a Discord server.' },
      { role: 'user', content: message.content.replace(`<@${client.user.id}>`, '').trim() }
    ];

    // Get response from OpenRouter
    const completion = await openai.chat.completions.create({
      model: 'qwen/qwq-32b:free',
      messages: conversation,
      temperature: 0.7,
      max_tokens: 1000
    });

    const response = completion.choices[0].message.content;

    // Send response
    await message.reply(response);

    // Collect interaction data
    await dataCollector.collectInteraction(message, response, 'qwq-32b:free');

  } catch (error) {
    console.error('Error processing message:', error);
    await message.reply('I apologize, but I encountered an error processing your message. Please try again later.');
  }
});

// Error handling
client.on(Events.Error, error => {
  console.error('Discord client error:', error);
});

// Start the bot
client.login(process.env.DISCORD_TOKEN); 