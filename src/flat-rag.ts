/**
 * flat-rag.ts — The Void
 *
 * Simulates traditional flat/vector RAG: documents are stored as isolated text
 * chunks. The LLM has no way to traverse relationships, so it must guess when
 * answering multi-hop questions.
 */
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

// ── Simulated document corpus (what a typical RAG index would hold) ──────────

export const DOCUMENTS: { id: string; text: string }[] = [
  {
    id: "doc1",
    text: "Atlas is a high-priority AI-powered supply chain optimisation project. It is currently at risk due to under-resourcing. The project requires expertise in machine learning, DevOps automation, and Python scripting.",
  },
  {
    id: "doc2",
    text: "Frank is a Senior Engineer at Acme Corp. He has strong skills in machine learning, DevOps, and Python. He is known for delivering complex infrastructure work.",
  },
  {
    id: "doc3",
    text: "Grace is an Engineer at Acme Corp. She has skills in machine learning and DevOps. She is currently assigned to the Atlas project.",
  },
  {
    id: "doc4",
    text: "Dave is an Engineer at Acme Corp. He has backend and Python skills. He is assigned to the Atlas project.",
  },
  {
    id: "doc5",
    text: "Alice is the VP of Engineering. She manages the engineering team and is responsible for project staffing decisions.",
  },
  {
    id: "doc6",
    text: "Frank is currently assigned to the Phoenix project, which is a legacy payment system rewrite.",
  },
  {
    id: "doc7",
    text: "Carol is an Engineer with frontend and Python skills. She is assigned to the Orion analytics dashboard project.",
  },
  {
    id: "doc8",
    text: "The Phoenix project is on track. The Orion project is also on track.",
  },
];

// ── Naïve keyword retrieval ──────────────────────────────────────────────────

function keywordSearch(
  query: string,
  topK = 4
): Array<{ id: string; text: string; score: number }> {
  const queryTerms = query.toLowerCase().split(/\W+/).filter(Boolean);

  return DOCUMENTS.map((doc) => {
    const docTerms = doc.text.toLowerCase().split(/\W+/);
    const score = queryTerms.filter((t) => docTerms.includes(t)).length;
    return { ...doc, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── API-oriented function (used by the web server) ───────────────────────────

export interface FlatRagResult {
  chunks: Array<{ id: string; text: string; score: number }>;
  context: string;
  answer: string;
}

export async function getFlatRagResult(
  question: string
): Promise<FlatRagResult> {
  const client = new Anthropic();
  const chunks = keywordSearch(question);
  const context = chunks.map((c) => c.text).join("\n\n");

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 512,
    system:
      "You are a helpful assistant. Answer strictly based on the provided context. " +
      "If you cannot verify something from the context, say so explicitly.",
    messages: [
      {
        role: "user",
        content: `Context:\n${context}\n\nQuestion: ${question}`,
      },
    ],
  });

  const answer =
    response.content[0].type === "text" ? response.content[0].text : "";
  return { chunks, context, answer };
}

// ── CLI runner ───────────────────────────────────────────────────────────────

export async function runFlatRag() {
  const QUESTION =
    "The Atlas project is at risk. Who can cover both ML and DevOps needs that aren't already assigned to Atlas — and who is their manager?";

  console.log("━━━  FLAT RAG APPROACH  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\nQuestion: ${QUESTION}\n`);

  const result = await getFlatRagResult(QUESTION);

  console.log(`Retrieved ${result.chunks.length} chunks (keyword match):`);
  result.chunks.forEach((c, i) =>
    console.log(`  [${i + 1}] (score ${c.score}) ${c.text.slice(0, 80)}…`)
  );
  console.log();
  console.log("LLM Answer:");
  console.log(result.answer);
  console.log(
    "\n⚠️  Notice: The LLM hedges because it cannot verify the assignment chain.\n"
  );

  return result.answer;
}

const isMain = process.argv[1]?.endsWith("flat-rag.ts");
if (isMain) {
  runFlatRag().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
