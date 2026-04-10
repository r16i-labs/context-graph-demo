/**
 * Seeds Neo4j with Acme Corp data — including temporal edge metadata,
 * assignment provenance, and two historical AgentDecision nodes.
 */
import { driver, closeDriver } from "./db.js";

// Each statement is run individually (Neo4j doesn't support multi-statement batches)
const STATEMENTS = [
  // ── Wipe ────────────────────────────────────────────────────────────────────
  `MATCH (n) DETACH DELETE n`,

  // ── Skills ──────────────────────────────────────────────────────────────────
  `MERGE (:Skill {name:'ML'})`,
  `MERGE (:Skill {name:'DevOps'})`,
  `MERGE (:Skill {name:'Python'})`,
  `MERGE (:Skill {name:'Frontend'})`,
  `MERGE (:Skill {name:'Backend'})`,

  // ── People ───────────────────────────────────────────────────────────────────
  `MERGE (:Person {name:'Alice', role:'VP Engineering'})`,
  `MERGE (:Person {name:'Frank', role:'Senior Engineer'})`,
  `MERGE (:Person {name:'Carol', role:'Engineer'})`,
  `MERGE (:Person {name:'Dave',  role:'Engineer'})`,
  `MERGE (:Person {name:'Grace', role:'Engineer'})`,

  // ── Projects ─────────────────────────────────────────────────────────────────
  `MERGE (:Project {name:'Atlas',   status:'at_risk',  description:'AI-powered supply chain optimiser'})`,
  `MERGE (:Project {name:'Phoenix', status:'on_track', description:'Legacy payment system rewrite'})`,
  `MERGE (:Project {name:'Orion',   status:'on_track', description:'Customer analytics dashboard'})`,

  // ── Reporting lines ──────────────────────────────────────────────────────────
  `MATCH (a:Person {name:'Frank'}),(b:Person {name:'Alice'}) CREATE (a)-[:REPORTS_TO]->(b)`,
  `MATCH (a:Person {name:'Carol'}),(b:Person {name:'Alice'}) CREATE (a)-[:REPORTS_TO]->(b)`,
  `MATCH (a:Person {name:'Dave'}), (b:Person {name:'Alice'}) CREATE (a)-[:REPORTS_TO]->(b)`,
  `MATCH (a:Person {name:'Grace'}),(b:Person {name:'Alice'}) CREATE (a)-[:REPORTS_TO]->(b)`,

  // ── HAS_SKILL — with temporal + confidence metadata ──────────────────────────
  `MATCH (p:Person {name:'Frank'}),(s:Skill {name:'ML'})
   CREATE (p)-[:HAS_SKILL {since:'2020-03', confidence:0.95, endorsedBy:'Alice', source:'performance_review'}]->(s)`,

  `MATCH (p:Person {name:'Frank'}),(s:Skill {name:'DevOps'})
   CREATE (p)-[:HAS_SKILL {since:'2019-06', confidence:0.98, endorsedBy:'Alice', source:'hire_assessment'}]->(s)`,

  `MATCH (p:Person {name:'Frank'}),(s:Skill {name:'Python'})
   CREATE (p)-[:HAS_SKILL {since:'2018-01', confidence:0.99, source:'hire_assessment'}]->(s)`,

  `MATCH (p:Person {name:'Grace'}),(s:Skill {name:'ML'})
   CREATE (p)-[:HAS_SKILL {since:'2022-07', confidence:0.87, endorsedBy:'Alice', source:'project_outcome'}]->(s)`,

  `MATCH (p:Person {name:'Grace'}),(s:Skill {name:'DevOps'})
   CREATE (p)-[:HAS_SKILL {since:'2023-01', confidence:0.82, source:'self_assessed'}]->(s)`,

  `MATCH (p:Person {name:'Carol'}),(s:Skill {name:'Frontend'})
   CREATE (p)-[:HAS_SKILL {since:'2021-03', confidence:0.93, source:'hire_assessment'}]->(s)`,

  `MATCH (p:Person {name:'Carol'}),(s:Skill {name:'Python'})
   CREATE (p)-[:HAS_SKILL {since:'2021-03', confidence:0.88, source:'hire_assessment'}]->(s)`,

  `MATCH (p:Person {name:'Dave'}),(s:Skill {name:'Backend'})
   CREATE (p)-[:HAS_SKILL {since:'2020-09', confidence:0.91, source:'performance_review'}]->(s)`,

  `MATCH (p:Person {name:'Dave'}),(s:Skill {name:'Python'})
   CREATE (p)-[:HAS_SKILL {since:'2020-09', confidence:0.94, source:'performance_review'}]->(s)`,

  // ── ASSIGNED_TO — with provenance ────────────────────────────────────────────
  `MATCH (p:Person {name:'Frank'}),(proj:Project {name:'Phoenix'})
   CREATE (p)-[:ASSIGNED_TO {from:'2024-01-15', assignedBy:'Alice', reason:'backend_rewrite_lead', status:'active'}]->(proj)`,

  `MATCH (p:Person {name:'Grace'}),(proj:Project {name:'Atlas'})
   CREATE (p)-[:ASSIGNED_TO {from:'2025-02-01', assignedBy:'Alice', reason:'ml_model_deployment', status:'active'}]->(proj)`,

  `MATCH (p:Person {name:'Dave'}),(proj:Project {name:'Atlas'})
   CREATE (p)-[:ASSIGNED_TO {from:'2025-02-01', assignedBy:'Alice', reason:'api_integration', status:'active'}]->(proj)`,

  `MATCH (p:Person {name:'Carol'}),(proj:Project {name:'Orion'})
   CREATE (p)-[:ASSIGNED_TO {from:'2024-11-01', assignedBy:'Alice', reason:'dashboard_frontend', status:'active'}]->(proj)`,

  // ── REQUIRES_SKILL ───────────────────────────────────────────────────────────
  `MATCH (proj:Project {name:'Atlas'}),(s:Skill {name:'ML'})     CREATE (proj)-[:REQUIRES_SKILL]->(s)`,
  `MATCH (proj:Project {name:'Atlas'}),(s:Skill {name:'DevOps'}) CREATE (proj)-[:REQUIRES_SKILL]->(s)`,
  `MATCH (proj:Project {name:'Atlas'}),(s:Skill {name:'Python'}) CREATE (proj)-[:REQUIRES_SKILL]->(s)`,
  `MATCH (proj:Project {name:'Phoenix'}),(s:Skill {name:'Backend'}) CREATE (proj)-[:REQUIRES_SKILL]->(s)`,
  `MATCH (proj:Project {name:'Phoenix'}),(s:Skill {name:'Python'})  CREATE (proj)-[:REQUIRES_SKILL]->(s)`,
  `MATCH (proj:Project {name:'Orion'}),(s:Skill {name:'Frontend'}) CREATE (proj)-[:REQUIRES_SKILL]->(s)`,
  `MATCH (proj:Project {name:'Orion'}),(s:Skill {name:'Python'})   CREATE (proj)-[:REQUIRES_SKILL]->(s)`,

  // ── Historical AgentDecision nodes ───────────────────────────────────────────
  `CREATE (:AgentDecision {
    id:        'decision-history-001',
    query:     'Phoenix is under-staffed for the backend rewrite. Who has Python and Backend skills?',
    answer:    'Frank is the strongest candidate: Python (confidence 99%, since 2018) and can ramp DevOps support. Recommend assigning as lead. Notify Alice.',
    model:     'claude-opus-4',
    timestamp: '2024-01-10T09:15:00Z',
    status:    'implemented',
    outcome:   'Phoenix is currently on track'
  })`,

  `CREATE (:AgentDecision {
    id:        'decision-history-002',
    query:     'Atlas needs ML expertise for model deployment. Who can join?',
    answer:    'Grace has ML (confidence 87%) and DevOps (82%) skills and is unassigned. Recommend adding to Atlas. Notify Alice.',
    model:     'claude-opus-4',
    timestamp: '2025-01-28T14:30:00Z',
    status:    'implemented',
    outcome:   'ML pipeline deployed; Atlas still at risk due to DevOps gap'
  })`,

  // Link historical decisions to entities
  `MATCH (d:AgentDecision {id:'decision-history-001'}),(p:Person {name:'Frank'}),(proj:Project {name:'Phoenix'})
   CREATE (d)-[:RECOMMENDS]->(p)
   CREATE (d)-[:ABOUT]->(proj)`,

  `MATCH (d:AgentDecision {id:'decision-history-002'}),(p:Person {name:'Grace'}),(proj:Project {name:'Atlas'})
   CREATE (d)-[:RECOMMENDS]->(p)
   CREATE (d)-[:ABOUT]->(proj)`,
];

async function seed() {
  const session = driver.session();
  try {
    for (const stmt of STATEMENTS) {
      await session.run(stmt.replace(/\n\s+/g, " "));
    }
    console.log("✅ Graph seeded with temporal + provenance data.\n");

    const counts = await session.run(
      "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY label"
    );
    console.log("Nodes:");
    counts.records.forEach((r) => console.log(`  ${r.get("label")}: ${r.get("count")}`));

    const rels = await session.run(
      "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY type"
    );
    console.log("\nRelationships:");
    rels.records.forEach((r) => console.log(`  ${r.get("type")}: ${r.get("count")}`));
  } finally {
    await session.close();
    await closeDriver();
  }
}

seed().catch((err) => { console.error(err.message); process.exit(1); });
