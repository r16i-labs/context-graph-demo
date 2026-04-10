import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true });

import { driver } from "./db.js";
import { getFlatRagResult, DOCUMENTS } from "./flat-rag.js";
import { getContextGraphResult, getDecisionHistory } from "./context-graph.js";
import { getGraphRagResult, DERIVED_NODES, DERIVED_EDGES } from "./graph-rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── GET /api/graph ────────────────────────────────────────────────────────────

app.get("/api/graph", async (_req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (n)
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN
        coalesce(n.name, n.id) AS sourceName,
        labels(n)[0]           AS sourceType,
        properties(n)          AS sourceProps,
        type(r)                AS relType,
        properties(r)          AS relProps,
        coalesce(m.name, m.id) AS targetName,
        labels(m)[0]           AS targetType
    `);

    const nodesMap = new Map<string, object>();
    const edges: object[] = [];

    result.records.forEach((record) => {
      const sourceName  = record.get("sourceName")  as string;
      const sourceType  = record.get("sourceType")  as string;
      const sourceProps = record.get("sourceProps")  as Record<string, unknown>;
      const relType     = record.get("relType")      as string | null;
      const relProps    = record.get("relProps")     as Record<string, unknown> | null;
      const targetName  = record.get("targetName")   as string | null;
      const targetType  = record.get("targetType")   as string | null;

      if (sourceName && !nodesMap.has(sourceName)) {
        // Use short ID for AgentDecision nodes to keep graph readable
        const label = sourceType === "AgentDecision"
          ? `Decision\n${(sourceProps.id as string)?.split("-").slice(-1)[0] ?? "?"}`
          : sourceName;
        nodesMap.set(sourceName, {
          data: { id: sourceName, label, type: sourceType, ...sourceProps },
        });
      }

      if (targetName && targetType && !nodesMap.has(targetName)) {
        const label = targetType === "AgentDecision"
          ? `Decision\n${targetName.split("-").slice(-1)[0] ?? "?"}`
          : targetName;
        nodesMap.set(targetName, {
          data: { id: targetName, label, type: targetType },
        });
      }

      if (relType && sourceName && targetName) {
        // Cytoscape reserves "source", "target", "id", "label" on edge data.
        // Prefix any rel-property that collides with those reserved keys.
        const RESERVED = new Set(["source", "target", "id", "label"]);
        const safeProps = Object.fromEntries(
          Object.entries(relProps ?? {}).map(([k, v]) =>
            RESERVED.has(k) ? [`rel_${k}`, v] : [k, v]
          )
        );
        edges.push({
          data: {
            id:     `${sourceName}-${relType}-${targetName}`,
            source: sourceName,
            target: targetName,
            label:  relType,
            ...safeProps,
          },
        });
      }
    });

    res.json({ nodes: Array.from(nodesMap.values()), edges });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    await session.close();
  }
});

// ── POST /api/flat-rag ────────────────────────────────────────────────────────

app.post("/api/flat-rag", async (req, res) => {
  const { question } = req.body as { question: string };
  if (!question) { res.status(400).json({ error: "question is required" }); return; }
  try {
    res.json(await getFlatRagResult(question));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /api/context-graph ───────────────────────────────────────────────────

app.post("/api/context-graph", async (req, res) => {
  const { question, projectName = "Atlas" } = req.body as { question: string; projectName?: string };
  if (!question) { res.status(400).json({ error: "question is required" }); return; }
  try {
    res.json(await getContextGraphResult(projectName, question));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/decisions ────────────────────────────────────────────────────────

// ── GET /api/docs ─────────────────────────────────────────────────────────────

app.get("/api/docs", (_req, res) => {
  res.json(DOCUMENTS);
});

// ── POST /api/graph-rag ───────────────────────────────────────────────────────

app.post("/api/graph-rag", async (req, res) => {
  const { question, projectName = "Atlas" } = req.body as { question: string; projectName?: string };
  if (!question) { res.status(400).json({ error: "question is required" }); return; }
  try {
    res.json(await getGraphRagResult(question, projectName));
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/graph-rag/schema ─────────────────────────────────────────────────
// Exposes the derived graph structure for the UI to render

app.get("/api/graph-rag/schema", (_req, res) => {
  res.json({ nodes: DERIVED_NODES, edges: DERIVED_EDGES });
});

// ── GET /api/decisions ────────────────────────────────────────────────────────

app.get("/api/decisions", async (_req, res) => {
  try {
    res.json(await getDecisionHistory());
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`\n🕸️  Context Graph Demo`);
  console.log(`   http://localhost:${PORT}\n`);
});
