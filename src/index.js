require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const OpenAI = require('openai');
const DataCollector = require('./utils/dataCollector');
const path = require('path');
const fs = require('fs/promises');

//init discord client with message perms
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

//init openai client w/ openrouter api
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/ericwang210000/discord-llm-bot',
    'X-Title': 'Discord LLM Bot'
  }
});

//init data collector
const dataCollector = new DataCollector(process.env.DATA_STORAGE_PATH);

//bot ready event
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Bot ID: ${client.user.id}`);
  await dataCollector.initialize();
});

//handle messages on creation
client.on(Events.MessageCreate, async message => {
  console.log(message.content);
  // check for documentation command
  if (message.content.toLowerCase() === '-qwqdocumentation') {
    try {
      const docPath = path.join(__dirname, 'qwq-documentation.txt');
      const documentation = await fs.readFile(docPath, 'utf8');
      // Send the documentation text first
      await message.reply('```\n' + documentation + '\n```');
      return;
    } catch (error) {
      console.error('Error reading documentation or sending image:', error);
      return;
    }
  }
  //check if message mentions the bot
  if(message.mentions.users.has(client.user.id)){
    try {
      //typing indicator
      await message.channel.sendTyping();

      // parse message string remove bot mention
      const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();
      
      // ignore empty messages
      if (!userMessage) {
        await message.reply('Please provide a message for me to respond to!');
        return;
      }

      //conversation context
      const conversation = [
        { role: 'system', content: 'You are a helpful AI assistant in a Discord server.' },
        { role: 'user', content: userMessage }
      ];

      console.log('Sending request to OpenRouter with message:', userMessage);

      //get response from OpenRouter
      const completion = await openai.chat.completions.create({
        model: 'qwen/qwq-32b:free',
        messages: conversation,
        temperature: 0.7,
        max_tokens: 1000
      });

      //console.log('Received completion:', JSON.stringify(completion, null, 2));

      //verify completion is valid
      if (!completion.choices || completion.choices.length === 0) {
        throw new Error('No choices returned from OpenRouter');
      }

      //get response from content or reasoning
      let response = completion.choices[0].message.content;
      if (!response || response.trim() === '') {
        response = "Content field null, outputting Reasoning: " + completion.choices[0].message.reasoning;
      }

      //validate response
      if (!response || response.trim() === '') {
        throw new Error('Received empty response from OpenRouter');
      }

      //check for refusal field and prepend if it exists
      const refusal = completion.choices[0].message.refusal;
      if (refusal && refusal.trim() !== '') {
        response = "Refusal: " + refusal + "\n\nResponse: " + response;
      }

      //split response into chunks if char > 1900
      const maxLength = 1900;
      if (response.length > maxLength) {
        const chunks = [];
        for (let i = 0; i < response.length; i += maxLength) {
          chunks.push(response.substring(i, i + maxLength));
        }
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      } else {
        await message.reply(response);
      }

      //collect interaction data
      await dataCollector.collectInteraction(message, response, 'qwq-32b:free');

    } catch (error) {
      console.error('Error processing message:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      
      const errorMessage = error.message === 'Received empty response from OpenRouter'
        ? 'I received an empty response from the AI model. Please try again.'
        : 'I encountered an error processing your message. Please try again later.';
      await message.reply(errorMessage);
    }
  }
});

//error handling
client.on(Events.Error, error => {
  console.error('Discord client error:', error);
});

//start the bot
client.login(process.env.DISCORD_TOKEN); 