import express from "express";
import cors from "cors";
import { Client } from "@elastic/elasticsearch";
import multer from "multer";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// ── Elasticsearch client ───────────────────────────────────────────────────
const es = new Client({ node: "http://localhost:9200" });

const INDEX = "log-files";

// ── Cria índice se não existir ─────────────────────────────────────────────
async function ensureIndex() {
  const exists = await es.indices.exists({ index: INDEX });
  if (!exists) {
    await es.indices.create({
      index: INDEX,
      mappings: {
        properties: {
          filename:   { type: "keyword" },
          content:    {
            type: "text",
            analyzer: "log_analyzer",    // analyzer customizado abaixo
            term_vector: "with_positions_offsets", // habilita highlight
          },
          line_count: { type: "integer" },
          file_size:  { type: "long" },
          uploaded_at:{ type: "date" },
        },
      },
      settings: {
        analysis: {
          analyzer: {
            log_analyzer: {
              type: "custom",
              tokenizer: "standard",
              filter: ["lowercase", "log_stop_words"],
              char_filter: ["log_normalizer"], // normaliza IPs, timestamps etc.
            },
          },
          char_filter: {
            log_normalizer: {
              type: "pattern_replace",
              // Remove IPs, timestamps, PIDs, ports — igual ao tokenize() do BM25
              pattern: "(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|\\[\\d+\\]|\\d{2}:\\d{2}:\\d{2}|port \\d+)",
              replacement: " ",
            },
          },
          filter: {
            log_stop_words: {
              type: "stop",
              stopwords: ["the", "a", "an", "is", "by", "for", "from", "to", "at", "in", "of"],
            },
          },
        },
      },
    });
    console.log(`✅ Índice '${INDEX}' criado com log_analyzer`);
  }
}

// ── POST /api/upload — indexa um ou mais arquivos ─────────────────────────
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const results = [];

    for (const file of req.files) {
      const content = file.buffer.toString("utf-8");
      const lineCount = content.split("\n").filter(Boolean).length;

      // Verifica se já existe documento com esse nome
      const existing = await es.search({
        index: INDEX,
        query: { term: { filename: file.originalname } },
        size: 1,
      });

      if (existing.hits.total.value > 0) {
        // Atualiza
        const docId = existing.hits.hits[0]._id;
        await es.update({
          index: INDEX,
          id: docId,
          doc: { content, line_count: lineCount, file_size: file.size, uploaded_at: new Date() },
        });
        results.push({ filename: file.originalname, action: "updated", lineCount });
      } else {
        // Indexa novo
        await es.index({
          index: INDEX,
          document: {
            filename:    file.originalname,
            content,
            line_count:  lineCount,
            file_size:   file.size,
            uploaded_at: new Date(),
          },
        });
        results.push({ filename: file.originalname, action: "indexed", lineCount });
      }
    }

    // Força refresh para resultados aparecerem imediatamente
    await es.indices.refresh({ index: INDEX });

    res.json({ success: true, files: results });
  } catch (err) {
    console.error("Erro no upload:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/files — lista todos os arquivos indexados ────────────────────
app.get("/api/files", async (req, res) => {
  try {
    const result = await es.search({
      index: INDEX,
      size: 100,
      query: { match_all: {} },
      _source: ["filename", "line_count", "file_size", "uploaded_at"],
      sort: [{ uploaded_at: { order: "desc" } }],
    });

    const files = result.hits.hits.map(hit => ({
      id: hit._id,
      ...hit._source,
    }));

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/files/:id — remove um arquivo ─────────────────────────────
app.delete("/api/files/:id", async (req, res) => {
  try {
    await es.delete({ index: INDEX, id: req.params.id });
    await es.indices.refresh({ index: INDEX });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/search — busca BM25 via Elasticsearch ──────────────────────
app.post("/api/search", async (req, res) => {
  try {
    const { query, size = 10 } = req.body;

    if (!query?.trim()) {
      return res.status(400).json({ error: "Query vazia" });
    }

    const result = await es.search({
      index: INDEX,
      size,
      query: {
        match: {
          content: {
            query,
            operator: "or",   // BM25 padrão do ES — mesmo comportamento do BM25Files
            fuzziness: "AUTO", // tolerância a typos leves
          },
        },
      },
      highlight: {
        fields: {
          content: {
            fragment_size: 200,         // tamanho do trecho destacado
            number_of_fragments: 5,     // máx de fragmentos por doc
            pre_tags:  ["<<<"],         // marcadores de highlight
            post_tags: [">>>"],
          },
        },
      },
      _source: ["filename", "line_count", "file_size"],
    });

    const hits = result.hits.hits.map(hit => ({
      id:         hit._id,
      filename:   hit._source.filename,
      line_count: hit._source.line_count,
      file_size:  hit._source.file_size,
      score:      hit._score,
      // Fragmentos com as linhas mais similares (substitui findMatchingLines)
      highlights: (hit.highlight?.content || []).map(fragment => ({
        text: fragment.replace(/<<<|>>>/g, "").trim(),
        marked: fragment,
      })),
    }));

    res.json({
      total:    result.hits.total.value,
      max_score: result.hits.max_score,
      hits,
    });
  } catch (err) {
    console.error("Erro na busca:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/health — status do ES ────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    const health = await es.cluster.health();
    const stats  = await es.count({ index: INDEX }).catch(() => ({ count: 0 }));
    res.json({ status: health.status, documents: stats.count });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = 3001;
app.listen(PORT, async () => {
  await ensureIndex();
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});