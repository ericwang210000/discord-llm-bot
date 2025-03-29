const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

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

  async collectInteraction(message, response, model) {
    if (!process.env.DATA_COLLECTION_ENABLED === 'true') return;

    const timestamp = new Date().toISOString();
    const anonymousUserId = this.getAnonymousId(message.author.id);
    
    const interactionData = {
      timestamp,
      anonymousUserId,
      channelId: message.channel.id,
      guildId: message.guild?.id || 'DM',
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