import nlp from 'compromise';

const text = "The NlpArchivist uses the Process method. The WorkerArchivist requires a DbPath. The CompositeArchivist contains multiple Strategies.";
console.log("Testing text:", text);

const doc = nlp(text);

// 1. People, Places, Orgs
const people = doc.people().out('array');
const places = doc.places().out('array');
const orgs = doc.organizations().out('array');

console.log("People:", people);
console.log("Places:", places);
console.log("Orgs:", orgs);

// 2. Acronyms
const acronyms = doc.terms().filter((t) => {
    const text = typeof t.text === 'function' ? t.text() : (t.text || '');
    return typeof text === 'string' && text.length > 1 && text === text.toUpperCase() && /^[A-Z0-9]+$/.test(text);
}).out('array');
console.log("Acronyms:", acronyms);

// 3. Projects
let projects = [];
const textStr = typeof doc.text === 'function' ? doc.text() : doc.text || '';
if (typeof textStr === 'string') {
    const matches = textStr.matchAll(/(?:Project|Operation|Initiative)\s+([A-Z][a-z0-9]+)/g);
    for (const m of matches) {
        if (m[1]) projects.push("Project " + m[1]);
    }
}
if (projects.length === 0) {
    const fallback = doc.match('(project|operation|initiative) .').out('array');
    fallback.forEach((p) => {
        if (/[A-Z]/.test(p)) projects.push(p); 
    });
}
console.log("Projects:", projects);

// 4. Normalized Nouns
const nouns = doc.nouns().out('array')
    .map((n) => n.replace(/^.*\s+([A-Z][a-z]+)$/, "$1")) 
    .filter((n) => /^[A-Z]/.test(n)) 
    .filter((n) => n.length > 2);

console.log("Nouns (filtered):", nouns);
console.log("All Nouns:", doc.nouns().out('array'));
