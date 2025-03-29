const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const crypto = require('crypto');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

class DataCollector {
  constructor(storagePath) {
    this.storagePath = storagePath;
    this.userMap = new Map(); // Maps Discord user IDs to anonymous IDs
    this.channelMap = new Map(); // Maps Discord channel IDs to anonymous IDs
  }

  async initialize() {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create storage directory:', error);
    }
  }

  getAnonymousId(userId) {
    if (!this.userMap.has(userId)) {
      this.userMap.set(userId, uuidv4());
    }
    return this.userMap.get(userId);
  }

  getAnonymousChannelId(channelId) {
    if (!this.channelMap.has(channelId)) {
      // Create a hash of the channel ID using SHA-256
      const hash = crypto.createHash('sha256').update(channelId).digest('hex');
      this.channelMap.set(channelId, hash);
    }
    return this.channelMap.get(channelId);
  }

  async collectInteraction(message, response, model) {
    if (!process.env.DATA_COLLECTION_ENABLED === 'true') return;

    const timestamp = new Date().toISOString();
    const anonymousUserId = this.getAnonymousId(message.author.id);
    const anonymousChannelId = this.getAnonymousChannelId(message.channel.id);
    const anonymousGuildId = message.guild ? this.getAnonymousChannelId(message.guild.id) : 'DM';
    
    const interactionData = {
      timestamp,
      anonymousUserId,
      anonymousChannelId,
      anonymousGuildId,
      messageLength: message.content.length,
      responseLength: response.length,
      model,
      messageType: message.type,
      hasAttachments: message.attachments.size > 0,
      hasEmbeds: message.embeds.length > 0
    };

    try {
      const filename = `${timestamp.split('T')[0]}.json`;
      const filepath = path.join(this.storagePath, filename);
      
      let existingData = [];
      try {
        const fileContent = await fs.readFile(filepath, 'utf8');
        existingData = JSON.parse(fileContent);
      } catch (error) {
        // File doesn't exist or is empty, start with empty array
      }

      existingData.push(interactionData);
      await fs.writeFile(filepath, JSON.stringify(existingData, null, 2));
    } catch (error) {
      logger.error('Failed to save interaction data:', error);
    }
  }
}

module.exports = DataCollector; 