
import nlp from 'compromise';

const sentences = [
    "Laurin uses Python.",
    "Python is used by Laurin.",
    "Project X uses Library Y.",
    "Laurin loves Coffee.",
    "The server runs on Linux." // Passive-ish or Prepositional
];

console.log("--- Testing Compromise NLP Extraction ---");

sentences.forEach(text => {
    console.log(`\nInput: "${text}"`);
    const doc = nlp(text);
    
    // Current Logic Reproduction (from archivist.ts)
    // 1. Entities
    const people = doc.people().out('array');
    const places = doc.places().out('array');
    const orgs = doc.organizations().out('array');
    const nouns = doc.nouns().out('array');
    
    console.log("Entities found:", { people, places, orgs, nouns });

    // 2. Relations (Simplified Reproduction)
    // In archivist.ts, it takes all entities in the sentence, sorts them by index.
    // Entities = people + places + orgs + concepts.
    // For this test, let's just use Nouns as a proxy for all entities to see structure.
    
    const entities = doc.nouns().json(); // { text: "Laurin", ... }
    if (entities.length >= 2) {
        const source = entities[0].text;
        const target = entities[1].text;
        
        let verb = doc.verbs().out('normal');
        console.log(`Potential Relation: ${source} --[${verb}]--> ${target}`);
    } else {
        console.log("Not enough entities for relation.");
    }
});
