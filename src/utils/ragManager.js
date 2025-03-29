import { ChromaClient } from 'chromadb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from 'langchain/document';

export class RAGManager {
  constructor(openaiApiKey) {
    this.client = new ChromaClient();
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: openaiApiKey,
      modelName: 'text-embedding-ada-002'
    });
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      lengthFunction: (text) => text.length
    });
    this.collections = new Map(); // Store collections for each user
  }

  async initialize() {
    try {
      console.log('RAG system initialized successfully');
    } catch (error) {
      console.error('Error initializing RAG system:', error);
      throw error;
    }
  }

  async getUserCollection(userId) {
    const collectionName = `knowledge_base_${userId}`;
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, await this.client.getOrCreateCollection({
        name: collectionName,
        metadata: { "hnsw:space": "cosine" }
      }));
    }
    return this.collections.get(collectionName);
  }

  async query(userId, query, k = 3) {
    try {
      const collection = await this.getUserCollection(userId);
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: k
      });

      return results.documents[0].map((doc, i) => ({
        content: doc,
        metadata: results.metadatas[0][i],
        distance: results.distances[0][i]
      }));
    } catch (error) {
      console.error(`Error querying RAG system for user ${userId}:`, error);
      throw error;
    }
  }
} 