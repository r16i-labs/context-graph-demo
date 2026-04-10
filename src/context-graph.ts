/**
 * context-graph.ts — The Fix + Governance Layer
 *
 * Three capabilities:
 *  1. queryGraph()        — 4-hop Cypher with temporal edge metadata
 *  2. writeDecisionTrace()— writes the agent's recommendation back into Neo4j
 *  3. getDecisionHistory()— reads past AgentDecision nodes
 */
import Anthropic from "@anthropic-ai/sdk";
import { driver, closeDriver } from "./db.js";
import "dotenv/config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SkillMeta {
  name: string;
  since: string;
  confidence: number;
  endorsedBy?: string;
}

export interface GraphRow {
  project: string;
  projectDescription: string;
  candidate: string;
  candidateRole: string;
  skills: SkillMeta[];
  currentProject: string | null;
  assignedSince: string | null;
  assignedBy: string | null;
  manager: string;
  managerRole: string;
}

export interface DecisionRecord {
  id: string;
  query: string;
  answer: string;
  model: string;
  timestamp: string;
  status: string;
  outcome: string | null;
  candidates: string[];
  projects: string[];
}

export interface ContextGraphResult {
  rows: GraphRow[];
  context: string;
  cypher: string;
  answer: string;
  highlight: {
    nodes: string[];
    edges: Array<{ source: string; target: string; type: string }>;
  };
  decisionTrace: {
    id: string;
    timestamp: string;
    written: boolean;
    recommended: string[];
    considered: string[];
  };
}

// ── Cypher query — now includes temporal edge properties ──────────────────────

export const QUERY_CYPHER = `MATCH (proj:Project {name: $projectName, status: 'at_risk'})
      -[:REQUIRES_SKILL]->(skill:Skill)
      <-[hs:HAS_SKILL]-(candidate:Person)
WHERE NOT (candidate)-[:ASSIGNED_TO]->(proj)
MATCH (candidate)-[:REPORTS_TO]->(manager:Person)
OPTIONAL MATCH (candidate)-[at:ASSIGNED_TO]->(currentProj:Project)
RETURN
  proj.name           AS project,
  proj.description    AS projectDescription,
  candidate.name      AS candidate,
  candidate.role      AS candidateRole,
  collect(DISTINCT {
    name:       skill.name,
    since:      hs.since,
    confidence: hs.confidence,
    endorsedBy: hs.endorsedBy
  })                  AS skills,
  at.from             AS assignedSince,
  at.assignedBy       AS assignedBy,
  currentProj.name    AS currentProject,
  manager.name        AS manager,
  manager.role        AS managerRole
ORDER BY size(skills) DESC`;

// ── Query the graph ───────────────────────────────────────────────────────────

async function queryGraph(projectName: string): Promise<GraphRow[]> {
  const session = driver.session();
  try {
    const result = await session.run(QUERY_CYPHER, { projectName });
    return result.records.map((r) => ({
      project:            r.get("project"),
      projectDescription: r.get("projectDescription"),
      candidate:          r.get("candidate"),
      candidateRole:      r.get("candidateRole"),
      skills:             r.get("skills") as SkillMeta[],
      currentProject:     r.get("currentProject"),
      assignedSince:      r.get("assignedSince"),
      assignedBy:         r.get("assignedBy"),
      manager:            r.get("manager"),
      managerRole:        r.get("managerRole"),
    }));
  } finally {
    await session.close();
  }
}

// ── Write decision trace back into the graph ──────────────────────────────────

export async function writeDecisionTrace(params: {
  id: string;
  query: string;
  answer: string;
  timestamp: string;
  projectName: string;
  recommended: string[];   // LLM-endorsed candidates → RECOMMENDS edge
  considered: string[];    // traversal candidates not endorsed → CONSIDERS edge
}): Promise<void> {
  const session = driver.session();
  try {
    // Create the AgentDecision node
    await session.run(
      `CREATE (:AgentDecision {
         id:        $id,
         query:     $query,
         answer:    $answer,
         model:     'claude-opus-4-6',
         timestamp: $timestamp,
         status:    'pending'
       })`,
      { id: params.id, query: params.query, answer: params.answer, timestamp: params.timestamp }
    );

    // Link to project
    await session.run(
      `MATCH (d:AgentDecision {id:$id}), (proj:Project {name:$projectName})
       CREATE (d)-[:ABOUT]->(proj)`,
      { id: params.id, projectName: params.projectName }
    );

    // RECOMMENDS — candidates the LLM explicitly endorsed
    for (const candidate of params.recommended) {
      await session.run(
        `MATCH (d:AgentDecision {id:$id}), (p:Person {name:$candidate})
         CREATE (d)-[:RECOMMENDS]->(p)`,
        { id: params.id, candidate }
      );
    }

    // CONSIDERS — candidates evaluated but not endorsed
    for (const candidate of params.considered) {
      await session.run(
        `MATCH (d:AgentDecision {id:$id}), (p:Person {name:$candidate})
         CREATE (d)-[:CONSIDERS]->(p)`,
        { id: params.id, candidate }
      );
    }
  } finally {
    await session.close();
  }
}

// ── Read decision history ─────────────────────────────────────────────────────

export async function getDecisionHistory(): Promise<DecisionRecord[]> {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (d:AgentDecision)
      OPTIONAL MATCH (d)-[:RECOMMENDS]->(p:Person)
      OPTIONAL MATCH (d)-[:ABOUT]->(proj:Project)
      RETURN
        d.id        AS id,
        d.query     AS query,
        d.answer    AS answer,
        d.model     AS model,
        d.timestamp AS timestamp,
        d.status    AS status,
        d.outcome   AS outcome,
        collect(DISTINCT p.name)    AS candidates,
        collect(DISTINCT proj.name) AS projects
      ORDER BY d.timestamp DESC
      LIMIT 10
    `);
    return result.records.map((r) => ({
      id:         r.get("id"),
      query:      r.get("query"),
      answer:     r.get("answer"),
      model:      r.get("model"),
      timestamp:  r.get("timestamp"),
      status:     r.get("status"),
      outcome:    r.get("outcome"),
      candidates: r.get("candidates"),
      projects:   r.get("projects"),
    }));
  } finally {
    await session.close();
  }
}

// ── Build context string ──────────────────────────────────────────────────────

export function buildContext(rows: GraphRow[]): string {
  if (!rows.length) return "No candidates found.";
  const { project, projectDescription } = rows[0];
  const allSkills = [...new Set(rows.flatMap((r) => r.skills.map((s) => s.name)))];

  const lines = [
    `Project: ${project} (status: at_risk)`,
    `Description: ${projectDescription}`,
    `Required skills: ${allSkills.join(", ")}`,
    "",
    "Verified candidates (not currently assigned to this project):",
  ];

  rows.forEach((row, i) => {
    const skillSummary = row.skills
      .map((s) => `${s.name} (since ${s.since}, confidence ${Math.round(s.confidence * 100)}%)`)
      .join(", ");
    lines.push(
      `  ${i + 1}. ${row.candidate} (${row.candidateRole})` +
        ` — skills: ${skillSummary}` +
        ` — currently on: ${row.currentProject ?? "nothing"}` +
        ` — reports to: ${row.manager} (${row.managerRole})`
    );
  });
  return lines.join("\n");
}

// ── API-oriented function ─────────────────────────────────────────────────────

export async function getContextGraphResult(
  projectName: string,
  question: string
): Promise<ContextGraphResult> {
  const client = new Anthropic();
  const rows = await queryGraph(projectName);
  const context = buildContext(rows);

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 512,
    system:
      "You are a helpful assistant. The context you receive comes from a verified " +
      "knowledge graph — every relationship is a confirmed database fact, including " +
      "when each skill was acquired and its confidence score. Answer directly and " +
      "confidently based solely on this context.",
    messages: [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }],
    tools: [
      {
        name: "record_recommendation",
        description:
          "After answering, call this tool to record which candidates you are actively recommending " +
          "(i.e. explicitly suggesting for the role) versus merely evaluated but not endorsed.",
        input_schema: {
          type: "object" as const,
          properties: {
            recommended: {
              type: "array",
              items: { type: "string" },
              description: "Names of candidates you are actively recommending.",
            },
            considered: {
              type: "array",
              items: { type: "string" },
              description: "Names of candidates evaluated but NOT recommended.",
            },
          },
          required: ["recommended", "considered"],
        },
      },
    ],
    tool_choice: { type: "auto" },
  });

  const answer = response.content.find((b) => b.type === "text")?.text ?? "";

  // Extract structured recommendation from tool call (if present)
  const toolUse = response.content.find((b) => b.type === "tool_use");
  const toolInput = (toolUse?.type === "tool_use" ? toolUse.input : {}) as {
    recommended?: string[];
    considered?: string[];
  };
  const allCandidates = [...new Set(rows.map((r) => r.candidate))];
  const recommendedByLLM: string[] = toolInput.recommended ?? [];
  const consideredByLLM: string[] = toolInput.considered ??
    allCandidates.filter((c) => !recommendedByLLM.includes(c));

  // Build highlight data
  const highlightNodes = new Set<string>([projectName]);
  const highlightEdges: Array<{ source: string; target: string; type: string }> = [];

  rows.forEach((row) => {
    highlightNodes.add(row.candidate);
    highlightNodes.add(row.manager);
    row.skills.forEach((skill) => {
      highlightNodes.add(skill.name);
      highlightEdges.push({ source: projectName,    target: skill.name,  type: "REQUIRES_SKILL" });
      highlightEdges.push({ source: row.candidate,  target: skill.name,  type: "HAS_SKILL"      });
    });
    highlightEdges.push({ source: row.candidate, target: row.manager, type: "REPORTS_TO" });
  });

  const seen = new Set<string>();
  const uniqueEdges = highlightEdges.filter((e) => {
    const key = `${e.source}-${e.type}-${e.target}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });

  // Write decision trace
  const decisionId = `decision-${Date.now()}`;
  const timestamp = new Date().toISOString();

  await writeDecisionTrace({
    id: decisionId,
    query: question,
    answer,
    timestamp,
    projectName,
    recommended: recommendedByLLM,
    considered: consideredByLLM,
  });

  return {
    rows,
    context,
    cypher: QUERY_CYPHER,
    answer,
    highlight: { nodes: Array.from(highlightNodes), edges: uniqueEdges },
    decisionTrace: {
      id: decisionId,
      timestamp,
      written: true,
      recommended: recommendedByLLM,
      considered: consideredByLLM,
    },
  };
}

// ── CLI runner ────────────────────────────────────────────────────────────────

export async function runContextGraph() {
  const Q = "The Atlas project is at risk. Who can cover both ML and DevOps needs that aren't already assigned to Atlas — and who is their manager?";
  console.log("━━━  CONTEXT GRAPH  ━━━");
  const result = await getContextGraphResult("Atlas", Q);
  result.rows.forEach((r) =>
    console.log(`  • ${r.candidate} — ${r.skills.map((s) => `${s.name}(${s.since})`).join(", ")} — manager: ${r.manager}`)
  );
  console.log("\nAnswer:", result.answer);
  console.log(`\n✅ Decision written: ${result.decisionTrace.id}`);
}

const isMain = process.argv[1]?.endsWith("context-graph.ts");
if (isMain) {
  runContextGraph().catch((e) => { console.error(e.message); process.exit(1); }).finally(closeDriver);
}
