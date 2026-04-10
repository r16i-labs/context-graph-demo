# Context Graph Demo

Demonstrates why **Context Graphs** matter by showing the same multi-hop question answered two ways:

| Approach | Retrieval | LLM Context | Answer quality |
|----------|-----------|-------------|----------------|
| **Flat RAG** | Keyword match → isolated text chunks | Disconnected fragments | Hedged, may hallucinate |
| **Context Graph** | Cypher 4-hop traversal | Verified subgraph | Precise, explainable |

## The Scenario

> *"Atlas project is at risk. Who can cover both ML and DevOps needs that aren't already assigned — and who's their manager?"*

This is a **multi-hop** question. Answering it correctly requires chaining:

```
Atlas (at_risk) → REQUIRES_SKILL → [ML, DevOps]
                                 ← HAS_SKILL ← Frank  (NOT assigned to Atlas)
                                                Frank → REPORTS_TO → Alice (VP Eng)
```

Flat RAG has no edges. It can only hope the LLM guesses correctly from chunks.

## Graph Model

```
(:Person)-[:HAS_SKILL]->(:Skill)
(:Person)-[:ASSIGNED_TO]->(:Project)
(:Person)-[:REPORTS_TO]->(:Person)
(:Project)-[:REQUIRES_SKILL]->(:Skill)
```

Seeded with Acme Corp data: Alice (VP Eng), Frank, Carol, Dave, Grace + projects Atlas, Phoenix, Orion.

## Quick Start

### Set env vars
```bash
cp .env.example .env
# edit .env — add your ANTHROPIC_API_KEY
```

### Install dependencies
```bash
npm i
```

### Terminal 1 - Start neo4j
```bash
docker run --name neo4j-demo \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:5
```

### Terminal 2 - Start server
```bash
npm run server
```

### Terminal 3 - Seed (or reseed) the db
```bash
npm run seed
```


## Key Insight

It's not about the LLM being smarter. It's about giving the LLM **verified, connected facts** instead of hoping it can reconstruct relationships from disconnected text.

The context layer — the graph sitting between your raw data and the LLM — is the durable infrastructure play in AI.
