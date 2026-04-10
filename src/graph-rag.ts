/**
 * graph-rag.ts — The Middle Ground
 *
 * Simulates GraphRAG: a graph is derived FROM the text corpus by LLM entity
 * extraction. Multi-hop traversal is possible — but the graph inherits every
 * gap and ambiguity in the source text.
 *
 * Key limitations surfaced here:
 *   • No REPORTS_TO edges — no document says "Frank reports to Alice"
 *     (doc5 says "Alice manages the engineering team", which is too vague
 *      for an extractor to create per-person manager links)
 *   • HAS_SKILL edges carry no temporal metadata (no `since` / `confidence`)
 *   • No write-back — agent decisions can't be persisted to the graph
 */

import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

// ── Derived graph (simulated LLM entity-extraction output) ────────────────────

export interface DerivedNode {
  id: string;
  type: "Person" | "Project" | "Skill";
  props: Record<string, string>;
}

export interface DerivedEdge {
  source: string;
  rel: string;
  target: string;
  fromDoc: string;
}

/** Nodes extracted from the 8 corpus documents */
export const DERIVED_NODES: DerivedNode[] = [
  { id: "Atlas",    type: "Project", props: { status: "at_risk"  } },
  { id: "Phoenix",  type: "Project", props: { status: "on_track" } },
  { id: "Orion",    type: "Project", props: { status: "on_track" } },
  { id: "Frank",    type: "Person",  props: { role: "Senior Engineer" } },
  { id: "Grace",    type: "Person",  props: { role: "Engineer"        } },
  { id: "Dave",     type: "Person",  props: { role: "Engineer"        } },
  { id: "Carol",    type: "Person",  props: { role: "Engineer"        } },
  { id: "Alice",    type: "Person",  props: { role: "VP Engineering"  } },
  { id: "ML",       type: "Skill",   props: {} },
  { id: "DevOps",   type: "Skill",   props: {} },
  { id: "Python",   type: "Skill",   props: {} },
  { id: "Backend",  type: "Skill",   props: {} },
  { id: "Frontend", type: "Skill",   props: {} },
];

/**
 * Edges extracted from the 8 corpus documents.
 *
 * Notice what is ABSENT:
 *   - No REPORTS_TO edges (doc5 is too vague to generate per-person links)
 *   - HAS_SKILL has no `since` or `confidence` (not in source text)
 */
export const DERIVED_EDGES: DerivedEdge[] = [
  // doc1 — Atlas requirements
  { source: "Atlas", rel: "REQUIRES_SKILL", target: "ML",       fromDoc: "doc1" },
  { source: "Atlas", rel: "REQUIRES_SKILL", target: "DevOps",   fromDoc: "doc1" },
  { source: "Atlas", rel: "REQUIRES_SKILL", target: "Python",   fromDoc: "doc1" },
  // doc2 — Frank's skills (no `since` / `confidence` in text)
  { source: "Frank", rel: "HAS_SKILL",      target: "ML",       fromDoc: "doc2" },
  { source: "Frank", rel: "HAS_SKILL",      target: "DevOps",   fromDoc: "doc2" },
  { source: "Frank", rel: "HAS_SKILL",      target: "Python",   fromDoc: "doc2" },
  // doc3 — Grace
  { source: "Grace", rel: "HAS_SKILL",      target: "ML",       fromDoc: "doc3" },
  { source: "Grace", rel: "HAS_SKILL",      target: "DevOps",   fromDoc: "doc3" },
  { source: "Grace", rel: "ASSIGNED_TO",    target: "Atlas",    fromDoc: "doc3" },
  // doc4 — Dave
  { source: "Dave",  rel: "HAS_SKILL",      target: "Python",   fromDoc: "doc4" },
  { source: "Dave",  rel: "HAS_SKILL",      target: "Backend",  fromDoc: "doc4" },
  { source: "Dave",  rel: "ASSIGNED_TO",    target: "Atlas",    fromDoc: "doc4" },
  // doc5 — Alice "manages the engineering team" → too vague for REPORTS_TO extraction
  // doc6 — Frank assigned to Phoenix
  { source: "Frank", rel: "ASSIGNED_TO",    target: "Phoenix",  fromDoc: "doc6" },
  // doc7 — Carol
  { source: "Carol", rel: "HAS_SKILL",      target: "Frontend", fromDoc: "doc7" },
  { source: "Carol", rel: "HAS_SKILL",      target: "Python",   fromDoc: "doc7" },
  { source: "Carol", rel: "ASSIGNED_TO",    target: "Orion",    fromDoc: "doc7" },
  // doc8 — status confirmation, no new relationships
];

// ── In-memory traversal ───────────────────────────────────────────────────────

export interface Candidate {
  name: string;
  skills: string[];
  matchedSkills: string[];
  currentProject: string | null;
  manager: string | null;   // always null — not extractable from corpus
  fromDocs: string[];
}

export interface TraversalResult {
  project: string;
  requiredSkills: string[];
  candidates: Candidate[];
}

function traverse(projectName: string): TraversalResult {
  const requiredSkills = DERIVED_EDGES
    .filter(e => e.source === projectName && e.rel === "REQUIRES_SKILL")
    .map(e => e.target);

  const candidates = DERIVED_NODES
    .filter(n => n.type === "Person")
    .flatMap(person => {
      const skillEdges   = DERIVED_EDGES.filter(e => e.source === person.id && e.rel === "HAS_SKILL");
      const skills       = skillEdges.map(e => e.target);
      const assignments  = DERIVED_EDGES.filter(e => e.source === person.id && e.rel === "ASSIGNED_TO").map(e => e.target);
      const matchedSkills = requiredSkills.filter(s => skills.includes(s));

      if (matchedSkills.length !== requiredSkills.length) return [];
      if (assignments.includes(projectName)) return [];

      return [{
        name: person.id,
        skills,
        matchedSkills,
        currentProject: assignments[0] ?? null,
        manager: DERIVED_EDGES.find(e => e.source === person.id && e.rel === "REPORTS_TO")?.target ?? null,
        fromDocs: [...new Set(skillEdges.map(e => e.fromDoc))],
      }];
    });

  return { project: projectName, requiredSkills, candidates };
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface GraphRagResult {
  traversal: TraversalResult;
  extractedNodeCount: number;
  extractedEdgeCount: number;
  missingEdgeTypes: string[];
  context: string;
  answer: string;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function getGraphRagResult(
  question: string,
  projectName = "Atlas"
): Promise<GraphRagResult> {
  const client = new Anthropic();
  const traversal = traverse(projectName);

  const missingEdgeTypes = ["REPORTS_TO"];

  const context = traversal.candidates.length
    ? traversal.candidates.map(c =>
        `Candidate: ${c.name} | role: Senior Engineer | ` +
        `skills: ${c.skills.join(", ")} | currently on: ${c.currentProject ?? "unassigned"}\n` +
        `Manager: ${c.manager ?? "UNKNOWN — no REPORTS_TO relationship was extractable from the corpus"}`
      ).join("\n\n")
    : "No qualifying candidates found in extracted graph.";

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 400,
    system:
      "You are a helpful assistant analysing a graph derived from text documents by LLM entity extraction. " +
      "The graph may be incomplete — relationships not explicitly stated in the source text were not extracted. " +
      "Answer based only on what is in the graph, and clearly flag any gaps or missing information.",
    messages: [{ role: "user", content: `Extracted graph context:\n${context}\n\nQuestion: ${question}` }],
  });

  return {
    traversal,
    extractedNodeCount: DERIVED_NODES.length,
    extractedEdgeCount: DERIVED_EDGES.length,
    missingEdgeTypes,
    context,
    answer: response.content[0].type === "text" ? response.content[0].text : "",
  };
}
