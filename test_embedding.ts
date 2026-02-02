
import { LocalEmbedder } from './src/lib/embeddings.js';

async function runEmbeddingTest() {
  console.log("Initializing Embedder (this may trigger model download)...");
  const embedder = new LocalEmbedder();
  
  const text = "This is a test sentence.";
  const start = Date.now();
  const vector = await embedder.embed(text);
  const duration = Date.now() - start;

  console.log(`Embedding generated in ${duration}ms`);
  console.log(`Vector dimension: ${vector.length}`);
  console.log(`First 5 values:`, vector.slice(0, 5));

  if (vector.length === 384) {
      console.log("SUCCESS: Correct dimension (384).");
  } else {
      console.error(`FAILURE: Incorrect dimension. Expected 384, got ${vector.length}`);
  }

  // Sanity check: ensure not all zeros
  const isZero = vector.every(v => v === 0);
  if (!isZero) {
      console.log("SUCCESS: Vector is non-zero.");
  } else {
       console.error("FAILURE: Vector is all zeros.");
  }
}

runEmbeddingTest().catch(console.error);
