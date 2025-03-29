# Discord LLM Bot with OpenRouter Integration

A Discord bot that uses OpenRouter's API to provide LLM-powered responses while collecting anonymized interaction data for future training.

## Features

- Discord.js integration
- OpenRouter LLM API integration
- Anonymized data collection
- Daily JSON file storage of interactions
- Error logging with Winston

## Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- OpenRouter API Key

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` and add your:
   - Discord Bot Token
   - OpenRouter API Key
   - Data collection settings (optional)

## Running the Bot

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Data Collection

The bot collects anonymized interaction data including:
- Timestamp
- Anonymous user ID
- Hashed channel and server IDs
- Message and response lengths
- Model used
- Message metadata (attachments, embeds)

Data is stored in daily JSON files in the configured `DATA_STORAGE_PATH`.

## Security Notes

- Never commit your `.env` file
- Keep your API keys secure
- The bot only responds to mentions
- User and channel idenntifiers are anonymized
