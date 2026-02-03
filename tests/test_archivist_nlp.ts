
import { getDb } from './src/db/client.js';
import { initSchema } from './src/db/schema.js';
import { getArchivist } from './src/lib/archivist.js';

process.env.ARCHIVIST_STRATEGY = 'nlp';

async function runArchivistTest() {
  console.log("Setting up DB...");
  const db = getDb();
  initSchema(db);

  console.log("Initializing Archivist (Strategy: NLP)...");
  const archivist = getArchivist(db);

  const text = "Elon Musk founded SpaceX in California.";
  console.log(`Processing text: "${text}"`);

  await archivist.process(text);

  console.log("Checking entities...");
  const entities = db.prepare('SELECT * FROM entities').all();
  
  console.log("Entities found:", entities.map((e: any) => `${e.name} (${e.type})`));

  const foundElon = entities.find((e: any) => e.name === 'Elon Musk' && e.type === 'Person');
  const foundSpaceX = entities.find((e: any) => e.name === 'SpaceX' && e.type === 'Organization');
  const foundCalifornia = entities.find((e: any) => e.name === 'California' && e.type === 'Place');

  if (foundElon && foundSpaceX && foundCalifornia) {
      console.log("SUCCESS: NLP extracted expected entities.");
  } else {
      console.error("FAILURE: Missing expected entities.");
  }
}

runArchivistTest().catch(console.error);
