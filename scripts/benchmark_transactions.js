
/* eslint-disable @typescript-eslint/no-require-imports */
const { performance } = require('perf_hooks');

// Configuration
const NUM_TRANSACTIONS = 100000;
const NUM_PORTFOLIOS = 100;
const TRANSACTIONS_PER_PORTFOLIO = NUM_TRANSACTIONS / NUM_PORTFOLIOS;

console.log(`Setting up benchmark with ${NUM_TRANSACTIONS} transactions across ${NUM_PORTFOLIOS} portfolios...`);

// Mock Data Generation
const portfolios = [];
for (let i = 0; i < NUM_PORTFOLIOS; i++) {
    portfolios.push(`portfolio-${i}`);
}

const transactions = [];
for (let i = 0; i < NUM_TRANSACTIONS; i++) {
    const portfolioId = portfolios[Math.floor(Math.random() * NUM_PORTFOLIOS)];
    transactions.push({
        id: `tx-${i}`,
        portfolioId: portfolioId,
        amount: Math.random() * 1000,
        date: new Date().toISOString()
    });
}

console.log('Data generation complete.');

// Benchmark 1: Full Scan (O(N)) - Simulating NO INDEX
// We iterate through all transactions to find matches for a specific portfolio
const targetPortfolioId = portfolios[Math.floor(Math.random() * NUM_PORTFOLIOS)];

console.log(`\nBenchmarking lookup for ${targetPortfolioId}...`);

const startScan = performance.now();
let foundScan = [];
for (let i = 0; i < 1000; i++) { // Run 1000 times to get measurable duration
    foundScan = transactions.filter(t => t.portfolioId === targetPortfolioId);
}
const endScan = performance.now();
const timeScan = endScan - startScan;

console.log(`Full Scan (No Index): ${timeScan.toFixed(2)}ms for 1000 lookups`);
console.log(`Average per lookup: ${(timeScan / 1000).toFixed(4)}ms`);
console.log(`Found ${foundScan.length} transactions.`);


// Benchmark 2: Index Lookup (O(1) / O(log N)) - Simulating INDEX
// We pre-build an index (Map) mapping portfolioId -> transactions[]
console.log('\nBuilding index...');
const startIndexBuild = performance.now();
const indexMap = new Map();
for (const tx of transactions) {
    if (!indexMap.has(tx.portfolioId)) {
        indexMap.set(tx.portfolioId, []);
    }
    indexMap.get(tx.portfolioId).push(tx);
}
const endIndexBuild = performance.now();
console.log(`Index built in ${(endIndexBuild - startIndexBuild).toFixed(2)}ms`);

const startIndexLookup = performance.now();
let foundIndex = [];
for (let i = 0; i < 1000; i++) { // Run 1000 times
    foundIndex = indexMap.get(targetPortfolioId) || [];
}
const endIndexLookup = performance.now();
const timeIndex = endIndexLookup - startIndexLookup;

console.log(`Index Lookup (With Index): ${timeIndex.toFixed(2)}ms for 1000 lookups`);
console.log(`Average per lookup: ${(timeIndex / 1000).toFixed(4)}ms`);
console.log(`Found ${foundIndex.length} transactions.`);

// Summary
const improvement = timeScan / timeIndex;
console.log(`\nSpeedup Factor: ${improvement.toFixed(1)}x`);

const results = `
Benchmark Results:
------------------
Transactions: ${NUM_TRANSACTIONS}
Portfolios: ${NUM_PORTFOLIOS}

Full Scan (No Index): ${timeScan.toFixed(2)}ms (1000 ops)
Index Lookup (With Index): ${timeIndex.toFixed(2)}ms (1000 ops)
Speedup: ${improvement.toFixed(1)}x
`;

const fs = require('fs');
fs.writeFileSync('benchmark_results.txt', results);
console.log('\nResults saved to benchmark_results.txt');
