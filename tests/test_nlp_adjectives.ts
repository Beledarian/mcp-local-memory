
import nlp from 'compromise';

const text = "User loves optimized WGSL.";
const text2 = "User loves perfectly written WGSL.";

const doc = nlp(text);
const doc2 = nlp(text2);

console.log("--- Text 1: " + text + " ---");
console.log("Nouns:", doc.nouns().out('array'));
console.log("Verbs:", doc.verbs().out('array'));
console.log("SVO:", doc.clauses().out('array'));

console.log("\n--- Text 2: " + text2 + " ---");
console.log("Nouns:", doc2.nouns().out('array'));
// console.log("Noun Phrases:", doc2.nounPhrases().out('array')); // Not standard in core compromise?
console.log("Adjectives:", doc2.adjectives().out('array'));
console.log("Terms:", doc2.terms().out('array'));
console.log("\n--- Pattern Matching ---");
console.log("Text 1 (#Adjective #Noun):", doc.match('#Adjective #Noun').out('array'));
console.log("Text 1 (#Verb #Noun):", doc.match('#Verb #Noun').out('array')); // optimized might be Verb
console.log("Text 2 (#Adjective #Noun):", doc2.match('#Adjective #Noun').out('array'));
console.log("Text 2 (#Adverb #Verb #Noun):", doc2.match('#Adverb #Verb #Noun').out('array'));
console.log("Text 2 (#Adverb #Adjective #Noun):", doc2.match('#Adverb #Adjective #Noun').out('array'));
