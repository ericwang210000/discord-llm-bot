import { config } from 'dotenv';
import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js';
import OpenAI from 'openai';
import DataCollector from './utils/dataCollector.js';
import { RAGManager } from './utils/ragManager.js';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

config();

// get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// combined helper function for processing LaTeX blocks
function processLatexBlocks(text) {
  //arrays to hold parsed text and regex segments
  const textSegments = [];
  const embeds = [];
  let lastIndex = 0;

  // wrap math segments in markdown code blocks
  const formattedText = text
  // handle LaTeX delimited format first (more specific)
  .replace(/\\\(([^)]+)\\\)/g, (match, latex) => {
    return "```latex\n" + latex + "\n```";
  })
  .replace(/\\\[([^\]]+)\\\]/g, (match, latex) => {
    return "```latex\n" + latex + "\n```";
  })
  // Handle generic square brackets last (broadest match)
  .replace(/\[([^\]]+)\]/g, (match, latex) => {
    return "```latex\n" + latex + "\n```";
  });

  //text preceding laTex blocks and idnetified laTex blocks are proceessed in parallel arrays
  // find all LaTeX segments
  const regex = /```latex\s*\n([\s\S]+?)\n```/g;
  let match;
  //search string using regex pattern
  while ((match = regex.exec(formattedText)) !== null) {
    // add text to the text segment
    if (match.index > lastIndex) {
      textSegments.push(formattedText.substring(lastIndex, match.index));
    }
    
    // process the LaTeX and convert to image
    const latex = match[1];
    const encodedLatex = encodeURIComponent(latex);
    const imageUrl = `https://latex.codecogs.com/png.latex?%5Cdpi%7B150%7D%20%5Ccolor%7Bwhite%7D%20${encodedLatex}`;
    embeds.push(new EmbedBuilder()
      .setTitle('Rendered LaTeX')
      .setImage(imageUrl)
      .setColor(0xFFFFFF));
    
    lastIndex = match.index + match[0].length;
  }
  
  // add any remaining text
  if (lastIndex < formattedText.length) {
    textSegments.push(formattedText.substring(lastIndex));
  }
  //return both arrays
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

//init RAG manager
const ragManager = new RAGManager(process.env.OPENROUTER_API_KEY);

//bot ready event
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Bot ID: ${client.user.id}`);
  await dataCollector.initialize();
  await ragManager.initialize();
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

  //check if message mentions the bot (or Suvel)
  if(message.mentions.users.has(client.user.id) || message.mentions.users.has('966778471206514688')){
    try {
      //typing indicator
      await message.channel.sendTyping();

      // parse message string and remove mentions
      let userMessage = message.content;
      userMessage = userMessage.replace(/<@\d+>/g, '').trim();
      
      // substitute for empty messages
      if (!userMessage) {
        userMessage = 'Hello!';
      }

      // determine model based on if msg contains attatchments
      //qwen2.5VL: image and video processing
      //qwq: text-based reasoning
      const hasImage = message.attachments.size > 0;
      const model = hasImage ? 'qwen/qwen2.5-vl-72b-instruct:free' : 'qwen/qwq-32b:free';

      // define personality and format instructions
      //i fucking hate regex
      const personality = 'Assume the role of a condescending co-worker who is mean and sarcastic and insults others with profanity';
      const formatLaTex = 'For math problems, please reason step by step. When outputting mathematical content, use plain text for simple variables or symbols, and reserve LaTeX formatting (using delimiters like \'...\' or \'\\( \\)\' for complex expressions - such as fractions, integrals, sums, or equations - where clarity is improved. For example, instead of writing \'the matrix \\( A \\)\', simply write \'the matrix A\' unless A is part of a larger, nontrivial expression. Minimize the number of separate LaTeX fragments: if multiple expressions are connected by joiners (such as \'and\', \',\', or \':\'), group them into a single LaTeX fragment rather than multiple ones. For instance, instead of writing \'the matrix \\( A \\) and the vector \\( B \\)\' separately, write \'the matrix \\( A and the vector B \\)\' to combine them into one LaTeX block if they form part of a larger, complex expression.';

      // query RAG system for relevant context in vector database
      // will be appended subsequent context fields in openrouter api calls
      let relevantContext = '';
      /*try {
        const ragResults = await ragManager.query(message.author.id, userMessage);
        if (ragResults && ragResults.length > 0) {
          relevantContext = 'Here is some relevant information from your personal knowledge base:\n\n' +
            ragResults.map(result => result.content).join('\n\n') +
            '\n\nPlease use this information to help answer the question.';
        }
      } catch (error) {
        console.error('Error querying RAG system:', error);
      }*/

      // prepare conversation with image if present
      //use qwen2.5VL
      let conversation;
      if (hasImage) {
        const attachment = message.attachments.first();
        const imageUrl = attachment.url;
        console.log('Attachment details:', {
          url: imageUrl,
          contentType: attachment.contentType,
          size: attachment.size,
          name: attachment.name
        });
        
        // try catch block to validate image url
        try {
          const response = await fetch(imageUrl);
          console.log('Image URL accessibility check:', {
            status: response.status,
            ok: response.ok
          });
        } catch (error) {
          console.error('Error checking image URL:', error);
        }

        //img + text inputs
        conversation = [
          {
            role: 'system',
            content: personality + 'You are a helpful AI assistant that can analyze and describe images. When an image is provided, please describe what you see in detail. If the image contains text, equations, or mathematical content, please transcribe and explain it. If the image is a diagram or graph, please describe its components and meaning.' + formatLaTex + (relevantContext ? '\n\n' + relevantContext : '')
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
                  url: imageUrl,
                  detail: "high"
                }
              }
            ]
          }
        ];
      } else {

        //create conversation with text if no attatchments
        //QwQ
        //ONLY text inputs
        conversation = [
          { 
            role: 'system', 
            content: personality + formatLaTex + (relevantContext ? '\n\n' + relevantContext : '')
          },
          { 
            role: 'user', 
            content: userMessage 
          }
        ];
      }

      console.log('Sending request to OpenRouter with message:', userMessage);
      console.log('Full conversation object:', JSON.stringify(conversation, null, 2));

      //get response from OpenRouter
      //temperature...
      const completion = await openai.chat.completions.create({
        model: model,
        messages: conversation,
        temperature: 0.7,
        max_tokens: 10000
      });

      console.log('Received completion:', JSON.stringify(completion, null, 2));
      
      //verify completion is valid
      if (!completion.choices || completion.choices.length === 0) {
        throw new Error('No choices returned from OpenRouter');
      }

      //max tokens exceeded or improper prompt formatting/pre-preprocessing can prevent models from producing a 'content'
      let response = completion.choices[0].message.content;
      if (!response || response.trim() === '') {
        response = "**Reasoned too long, content field null.** \n";
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

      // process LaTeX: extract text segments and embeds
      const { textSegments, embeds } = processLatexBlocks(response);

      // send segments in the order they were returned from LLM api
      for (let i = 0; i < textSegments.length; i++) {
        // Prepare text and embed for each segment by removing white spaces and identifying nulls
        const text = textSegments[i].trim();
        const embed = i < embeds.length ? embeds[i] : null;
        //if the current segment contains text
        if (text) {
          //further segmenting may be required if char count exceeds discord message len limits  
          if (text.length > 1900) {
            //for long text, split into chunks but only add embed to the last chunk
            const chunks = [];
            for (let j = 0; j < text.length; j += 1900) {
              chunks.push(text.substring(j, j + 1900));
            }
            
            // send all chunks except the last one, whose mesage should also include the embed for easier readability
            for (let j = 0; j < chunks.length - 1; j++) {
              await message.reply(chunks[j]);
            }
            
            // send the last chunk with the embed if it exists
            await message.reply({
              content: chunks[chunks.length - 1],
              embeds: embed ? [embed] : []
            });
          } else {
            // for messages that dont exceed the limit, send text field then img chunk, looping through parallel arrays. parallel, send with embed in the same message
            await message.reply({
              content: text,
              embeds: embed ? [embed] : []
            });
          }
        } else if (embed) {
          // If there's no text but there is an embed, send just the embed
          await message.reply({ embeds: [embed] });
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