// import { pipeline } from '@xenova/transformers';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class NoOpEmbedder implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    console.warn("Using NoOpEmbedder. Semantic search will not work effectively.");
    return new Array(384).fill(0);
  }
}

export class LocalEmbedder implements EmbeddingProvider {
  private pipe: any;

  async init() {
    if (!this.pipe) {
      // quantized: true is the default, loads ~23MB model
      // Dynamic import to avoid sharp dependency if not used or broken
      const { pipeline } = await import('@xenova/transformers');
      this.pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.pipe) await this.init();
    
    const result = await this.pipe(text, { pooling: 'mean', normalize: true });
    // result is a Tensor { data: Float32Array(...) }
    return Array.from(result.data);
  }
}

let globalEmbedder: EmbeddingProvider | null = null;

export const getEmbedder = (): EmbeddingProvider => {
    if (!globalEmbedder) {
        if (process.env.TEST_MODE === 'true') {
            globalEmbedder = new NoOpEmbedder();
        } else {
            // Switch to LocalEmbedder
            console.error("Initializing Local Embeddings (all-MiniLM-L6-v2)...");
            globalEmbedder = new LocalEmbedder();
        }
    }
    return globalEmbedder;
};
