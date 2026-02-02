
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class NoOpEmbedder implements EmbeddingProvider {
  // Returns a zero vector of dimension 768
  async embed(text: string): Promise<number[]> {
    console.warn("Using NoOpEmbedder. Semantic search will not work effectively.");
    return new Array(768).fill(0);
  }
}

// TODO: Implement OpenAI or other providers here
// export class OpenAIEmbedder implements EmbeddingProvider { ... }

export const getEmbedder = (): EmbeddingProvider => {
    // In the future, check env vars to decide which provider to use
    return new NoOpEmbedder();
};
