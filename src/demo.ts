/**
 * demo.ts — Side-by-side comparison
 *
 * Runs both approaches sequentially so you can see the contrast directly:
 *   1. Flat RAG  → hedged, uncertain answer
 *   2. Context Graph → precise, verified answer
 */
import { runFlatRag } from "./flat-rag.js";
import { runContextGraph } from "./context-graph.js";
import { closeDriver } from "./db.js";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║      CONTEXT GRAPH DEMO — Acme Corp Knowledge Assistant      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Scenario: The Atlas project is at risk and needs immediate help.");
  console.log(
    "Question: Who has the right skills, isn't already on Atlas, and who do we notify?\n"
  );

  console.log("─".repeat(66));
  console.log("APPROACH 1: Flat RAG  (keyword retrieval → isolated chunks)");
  console.log("─".repeat(66));
  console.log();
  await runFlatRag();

  console.log("─".repeat(66));
  console.log("APPROACH 2: Context Graph  (Cypher traversal → verified subgraph)");
  console.log("─".repeat(66));
  console.log();
  await runContextGraph();

  console.log("═".repeat(66));
  console.log("SUMMARY");
  console.log("═".repeat(66));
  console.log(`
  Flat RAG:
    • Retrieves isolated text chunks via keyword overlap
    • Each document knows only what it says, not how entities relate
    • Multi-hop questions (Project → Skills → Unassigned Person → Manager)
      require the LLM to infer connections that may or may not exist
    • Result: hedged language, potential hallucination

  Context Graph (Neo4j):
    • Single Cypher query traverses 4 hops in milliseconds
    • Every edge is a verified database fact — no inference required
    • The LLM receives a compact, structured subgraph as context
    • Result: confident, explainable answer with a clear action path

  The key insight: it's not about the LLM being smarter.
  It's about giving the LLM verified, connected facts instead of
  hoping it can reconstruct relationships from disconnected text.
`);
}

main()
  .catch((err) => {
    console.error("Demo failed:", err.message);
    process.exit(1);
  })
  .finally(closeDriver);
