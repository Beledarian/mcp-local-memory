import nlp from 'compromise';

const text = "User created LLM-powered chatbot and PDF-parser tool.";
const doc = nlp(text);

console.log("Raw text:", text);
console.log("\nTerms:");
doc.terms().forEach((t: any) => {
    const txt = typeof t.text === 'function' ? t.text() : t.text;
    console.log(`  "${txt}"`);
});

console.log("\nNouns:");
console.log(doc.nouns().out('array'));
