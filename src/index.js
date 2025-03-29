require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const DataCollector = require('./utils/dataCollector');
const path = require('path');
const fs = require('fs/promises');

// Combined helper function for processing LaTeX blocks
function processLatexBlocks(text) {
  const textSegments = [];
  const embeds = [];
  let lastIndex = 0;

  // First, wrap math segments in markdown code blocks
  const formattedText = text.replace(/\[([^\]]+)\]/g, (match, latex) => {
    return "```latex\n" + latex + "\n```";
  });

  // Find all LaTeX segments
  const regex = /```latex\s*\n([\s\S]+?)\n```/g;
  let match;
  
  while ((match = regex.exec(formattedText)) !== null) {
    // Add text before the LaTeX
    if (match.index > lastIndex) {
      textSegments.push(formattedText.substring(lastIndex, match.index));
    }
    
    // Process the LaTeX
    const latex = match[1];
    const encodedLatex = encodeURIComponent(latex);
    const imageUrl = `https://latex.codecogs.com/png.latex?%5Cdpi%7B300%7D%20%5Ccolor%7Bwhite%7D%20${encodedLatex}`;
    embeds.push(new EmbedBuilder()
      .setTitle('Rendered LaTeX')
      .setImage(imageUrl)
      .setColor(0xFFFFFF));
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining text
  if (lastIndex < formattedText.length) {
    textSegments.push(formattedText.substring(lastIndex));
  }
  
  return { textSegments, embeds };
}


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

      // Determine model based on message content
      const hasImage = message.attachments.size > 0;
      const model = hasImage ? 'qwen/qwen2.5-vl-72b-instruct:free' : 'qwen/qwq-32b:free';

      // Prepare conversation with image if present
      let conversation;
      if (hasImage) {
        const imageUrl = message.attachments.first().url;
        console.log('Image URL:', imageUrl);
        conversation = [
          { 
            role: 'system', 
            content: 'You are a helpful AI assistant in a Discord server. For Math Problems: Please reason step by step and put your final answer within **{}**.' 
          },
          { 
            role: 'user', 
            content: [
              {
                type: 'text',
                text: userMessage
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ];
        console.log('Full conversation object:', JSON.stringify(conversation, null, 2));
      } else {
        conversation = [
          { 
            role: 'system', 
            content: 'You are a helpful AI assistant in a Discord server. For Math Problems: Please reason step by step and put your final answer within **{}**.' 
          },
          { 
            role: 'user', 
            content: userMessage 
          }
        ];
      }

      console.log('Sending request to OpenRouter with message:', userMessage);

      //get response from OpenRouter
      const completion = await openai.chat.completions.create({
        model: model,
        messages: conversation,
        temperature: 0.6,
        max_tokens: 10000
      });

      console.log('Received completion:', JSON.stringify(completion, null, 2));
      //await message.reply(JSON.stringify(completion, null, 2));
      
      //verify completion is valid
      if (!completion.choices || completion.choices.length === 0) {
        throw new Error('No choices returned from OpenRouter');
      }

      //get response from content or reasoning
      let response = completion.choices[0].message.content;
      if (!response || response.trim() === '') {
        response = "**Reasoned too long, content field null, outputting Reasoning:** \n" + completion.choices[0].message.reasoning;
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

      // Process LaTeX: extract text segments and embeds
      const { textSegments, embeds } = processLatexBlocks(response);

      // Send segments in order
      for (let i = 0; i < textSegments.length; i++) {
        // Send text segment
        const text = textSegments[i].trim();
        if (text) {  // Only send non-empty text segments
          if (text.length > 1900) {
            for (let j = 0; j < text.length; j += 1900) {
              await message.reply(text.substring(j, j + 1900));
            }
          } else {
            await message.reply(text);
          }
        }

        // Send corresponding embed if it exists
        if (i < embeds.length) {
          await message.reply({ embeds: [embeds[i]] });
        }
      }

      //collect interaction data
      await dataCollector.collectInteraction(message, response, model);

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