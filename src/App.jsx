import { useState, useRef, useCallback, useEffect } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
const API = "http://localhost:3001/api";

// ── Helpers ────────────────────────────────────────────────────────────────
function categorize(text) {
  if (/[Ff]ailed password/i.test(text))    return { label: "FAILED AUTH",  color: "#ef4444" };
  if (/[Ii]nvalid user/i.test(text))       return { label: "INVALID USER", color: "#f97316" };
  if (/[Aa]ccepted/i.test(text))           return { label: "ACCEPTED",     color: "#22c55e" };
  if (/[Dd]isconnect/i.test(text))         return { label: "DISCONNECT",   color: "#a78bfa" };
  if (/[Cc]onnection closed/i.test(text))  return { label: "CLOSED",       color: "#94a3b8" };
  if (/maximum authentication/i.test(text))return { label: "MAX ATTEMPTS", color: "#fb923c" };
  if (/pam_unix/i.test(text))              return { label: "PAM FAILURE",  color: "#f43f5e" };
  if (/[Ee]rror/i.test(text))              return { label: "ERROR",        color: "#fbbf24" };
  if (/[Ww]arn/i.test(text))              return { label: "WARNING",      color: "#facc15" };
  return { label: "OTHER", color: "#6b7280" };
}

function fmt(n)       { return Number(n).toLocaleString("pt-BR"); }
function fileSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Pill({ label, color }) {
  return (
    <span style={{
      background: `${color}20`, color, border: `1px solid ${color}40`,
      borderRadius: 4, padding: "2px 8px", fontSize: 10,
      fontWeight: 700, letterSpacing: "0.5px", whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function StatusDot({ status }) {
  const color = status === "green" ? "#22c55e" : status === "yellow" ? "#f59e0b" : "#ef4444";
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8,
      borderRadius: "50%", background: color,
      boxShadow: `0 0 6px ${color}`,
    }} />
  );
}

// ── Constantes visuais ─────────────────────────────────────────────────────
const C = {
  bg: "#07090f", panel: "#0c1422", border: "#162033",
  accent: "#3b82f6", text: "#b8cce0", muted: "#364a63", faint: "#1a2a3e",
};

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  // Estado de arquivos indexados no ES
  const [indexedFiles, setIndexedFiles]   = useState([]);
  const [esStatus, setEsStatus]           = useState(null); // {status, documents}
  const [uploading, setUploading]         = useState(false);
  const [uploadMsg, setUploadMsg]         = useState(null);

  // Estado de busca
  const [query, setQuery]                 = useState("");
  const [results, setResults]             = useState(null); // {total, max_score, hits}
  const [searching, setSearching]         = useState(false);
  const [searchError, setSearchError]     = useState(null);
  const [expanded, setExpanded]           = useState(null);
  const [animKey, setAnimKey]             = useState(0);

  const [dragging, setDragging]           = useState(false);
  const dropRef                           = useRef(null);

  // ── Verifica saúde do ES e lista arquivos ao montar ──────────────────────
  useEffect(() => {
    fetchHealth();
    fetchFiles();
  }, []);

  async function fetchHealth() {
    try {
      const r = await fetch(`${API}/health`);
      const d = await r.json();
      setEsStatus(d);
    } catch {
      setEsStatus({ status: "unavailable", documents: 0 });
    }
  }

  async function fetchFiles() {
    try {
      const r = await fetch(`${API}/files`);
      const d = await r.json();
      setIndexedFiles(d.files || []);
    } catch { /* ES offline */ }
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  const uploadFiles = useCallback(async (fileList) => {
    if (!fileList.length) return;
    setUploading(true);
    setUploadMsg(null);

    const form = new FormData();
    [...fileList].forEach(f => form.append("files", f));

    try {
      const r = await fetch(`${API}/upload`, { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      const actions = d.files.map(f =>
        `${f.filename} (${f.action === "indexed" ? "indexado" : "atualizado"}, ${fmt(f.lineCount)} linhas)`
      ).join(", ");
      setUploadMsg({ type: "ok", text: `✅ ${actions}` });
      await fetchFiles();
      await fetchHealth();
    } catch (e) {
      setUploadMsg({ type: "err", text: `❌ ${e.message}` });
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  // ── Remover arquivo ───────────────────────────────────────────────────────
  async function removeFile(id) {
    try {
      await fetch(`${API}/files/${id}`, { method: "DELETE" });
      setIndexedFiles(prev => prev.filter(f => f.id !== id));
      setResults(null);
      await fetchHealth();
    } catch (e) {
      alert("Erro ao remover: " + e.message);
    }
  }

  // ── Busca via Elasticsearch ───────────────────────────────────────────────
  async function doSearch(q = query) {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    setExpanded(null);

    try {
      const r = await fetch(`${API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Envia a query diretamente — o ES cuida do BM25 e do highlight
        body: JSON.stringify({ query: q, size: 10 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setResults(d);
      setAnimKey(k => k + 1);
    } catch (e) {
      setSearchError(e.message);
    } finally {
      setSearching(false);
    }
  }

  const maxScore = results?.max_score || 1;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Mono','Consolas',monospace", background: C.bg, minHeight: "100vh", color: C.text }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "24px 32px 20px" }}>

        {/* Título + status ES */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9, flexShrink: 0,
            background: "linear-gradient(135deg,#2563eb,#4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 0 24px rgba(79,70,229,.4)",
          }}>⌕</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#dde8f8" }}>
              Log File Similarity Search
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Elasticsearch BM25 · arquivos persistidos no índice
            </div>
          </div>
          {/* Badge de status do Elasticsearch */}
          {esStatus && (
            <div style={{
              background: C.faint, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "6px 12px",
              display: "flex", alignItems: "center", gap: 8, fontSize: 11,
            }}>
              <StatusDot status={esStatus.status} />
              <span style={{ color: C.muted }}>Elasticsearch</span>
              <span style={{ color: C.accent }}>{fmt(esStatus.documents)} docs</span>
            </div>
          )}
        </div>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById("file-inp").click()}
          style={{
            border: `2px dashed ${dragging ? C.accent : C.border}`,
            borderRadius: 12, padding: "18px 24px",
            textAlign: "center", cursor: "pointer",
            background: dragging ? "rgba(59,130,246,.06)" : C.faint,
            transition: "all .2s", marginBottom: 14,
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>
            {uploading ? "⏳" : "📂"}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {uploading
              ? "Indexando no Elasticsearch…"
              : <>Arraste arquivos <span style={{ color: C.accent }}>.log</span> aqui ou clique para selecionar</>
            }
          </div>
          <div style={{ fontSize: 10, color: "#243348", marginTop: 4 }}>
            Múltiplos arquivos · txt, log, csv · indexados permanentemente no ES
          </div>
          <input id="file-inp" type="file" accept=".log,.txt,.csv" multiple
            style={{ display: "none" }}
            onChange={e => uploadFiles(e.target.files)} />
        </div>

        {/* Mensagem de upload */}
        {uploadMsg && (
          <div style={{
            background: uploadMsg.type === "ok" ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)",
            border: `1px solid ${uploadMsg.type === "ok" ? "#22c55e40" : "#ef444440"}`,
            borderRadius: 8, padding: "8px 14px",
            fontSize: 11, color: uploadMsg.type === "ok" ? "#22c55e" : "#ef4444",
            marginBottom: 14,
          }}>
            {uploadMsg.text}
          </div>
        )}

        {/* Chips dos arquivos indexados no ES */}
        {indexedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {indexedFiles.map(f => (
              <div key={f.id} style={{
                background: "#0f1d30", border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "6px 12px",
                display: "flex", alignItems: "center", gap: 8, fontSize: 11,
              }}>
                <span style={{ fontSize: 13 }}>📄</span>
                <span style={{ color: "#7ab0d8", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.filename}
                </span>
                <span style={{ color: C.muted }}>{fmt(f.line_count)} linhas</span>
                <span style={{ color: C.muted }}>·</span>
                <span style={{ color: C.muted }}>{fileSize(f.file_size)}</span>
                {/* Ícone ES para indicar que está no índice */}
                <span title="Indexado no Elasticsearch" style={{ color: "#f59e0b", fontSize: 10 }}>ES</span>
                <button
                  onClick={() => removeFile(f.id)}
                  style={{ background: "none", border: "none", color: "#3a5570", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Input de busca */}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.accent, fontSize: 16, pointerEvents: "none" }}>⌕</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              placeholder="Cole o log de referência aqui..."
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#0a1220", border: `1px solid ${C.border}`,
                borderRadius: 10, padding: "13px 14px 13px 44px",
                color: C.text, fontSize: 12, outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          </div>
          <button
            onClick={() => doSearch()}
            disabled={!indexedFiles.length || !query.trim() || searching}
            style={{
              background: indexedFiles.length && query.trim() && !searching
                ? "linear-gradient(135deg,#2563eb,#4f46e5)" : "#111827",
              border: "none", borderRadius: 10, padding: "0 24px",
              color: indexedFiles.length && query.trim() ? "#fff" : "#2a3a50",
              fontSize: 13, fontWeight: 600,
              cursor: indexedFiles.length && !searching ? "pointer" : "not-allowed",
              boxShadow: indexedFiles.length ? "0 0 18px rgba(79,70,229,.3)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            {searching ? "Buscando…" : "Buscar"}
          </button>
        </div>

        {!indexedFiles.length && !uploading && (
          <div style={{ fontSize: 11, color: "#1e3050", marginTop: 8, textAlign: "center" }}>
            ↑ Faça upload de pelo menos um arquivo .log para indexar no Elasticsearch
          </div>
        )}
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "24px 32px" }}>

        {/* Aguardando busca */}
        {results === null && !searching && !searchError && indexedFiles.length > 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#1e3a5f" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 13 }}>
              {fmt(indexedFiles.length)} arquivo{indexedFiles.length > 1 ? "s" : ""} no índice. Cole um log acima e busque.
            </div>
          </div>
        )}

        {/* Spinner */}
        {searching && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{
              display: "inline-block", width: 36, height: 36,
              border: "3px solid #0f2040", borderTopColor: C.accent,
              borderRadius: "50%", animation: "spin .8s linear infinite",
            }} />
            <div style={{ marginTop: 14, color: "#1e3a5f", fontSize: 12 }}>
              Consultando Elasticsearch…
            </div>
          </div>
        )}

        {/* Erro */}
        {searchError && (
          <div style={{
            background: "#1a0a0a", border: "1px solid #4a1010",
            borderRadius: 10, padding: "14px 18px", color: "#ef4444", fontSize: 12,
          }}>
            ❌ {searchError}
          </div>
        )}

        {/* Lista de resultados */}
        {results && !searching && (
          <div key={animKey}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>
              {results.total} arquivo{results.total !== 1 ? "s" : ""} encontrado{results.total !== 1 ? "s" : ""} ·
              score máximo: <span style={{ color: C.accent }}>{maxScore.toFixed(2)}</span> ·
              via Elasticsearch BM25
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {results.hits.map((hit, rank) => {
                const pct = maxScore > 0 ? (hit.score / maxScore) * 100 : 0;
                const isExpanded = expanded === hit.id;
                const noMatch = hit.score === 0;

                return (
                  <div key={hit.id} style={{
                    background: C.panel,
                    border: `1px solid ${noMatch ? C.faint : C.border}`,
                    borderLeft: `3px solid ${noMatch ? "#1a2a3e" : rank === 0 ? "#f59e0b" : C.accent}`,
                    borderRadius: 12, overflow: "hidden", opacity: noMatch ? 0.45 : 1,
                    animation: `fadeUp .3s ease ${rank * 0.06}s both`,
                  }}>
                    {/* Card header */}
                    <div
                      onClick={() => !noMatch && setExpanded(isExpanded ? null : hit.id)}
                      style={{ padding: "14px 18px", cursor: noMatch ? "default" : "pointer", position: "relative", overflow: "hidden" }}
                    >
                      {/* Barra de score de fundo */}
                      <div style={{
                        position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`,
                        background: rank === 0 ? "rgba(245,158,11,.05)" : "rgba(59,130,246,.04)",
                        pointerEvents: "none", transition: "width .6s ease",
                      }} />

                      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
                        {/* Badge de rank */}
                        <div style={{
                          minWidth: 30, height: 30, borderRadius: 7, flexShrink: 0,
                          background: rank === 0 && !noMatch ? "linear-gradient(135deg,#f59e0b,#d97706)" : "#0a1220",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 800,
                          color: rank === 0 && !noMatch ? "#000" : "#2a4060",
                          border: rank === 0 ? "none" : `1px solid ${C.faint}`,
                        }}>
                          {rank + 1}
                        </div>

                        {/* Info do arquivo */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, color: "#7ab8e0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                              📄 {hit.filename}
                            </span>
                            {rank === 0 && !noMatch && <Pill label="MELHOR MATCH" color="#f59e0b" />}
                            {noMatch && <Pill label="SEM MATCH" color="#3a5570" />}
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 5, fontSize: 10, color: C.muted, flexWrap: "wrap" }}>
                            <span>{fmt(hit.line_count)} linhas</span>
                            <span>{fileSize(hit.file_size)}</span>
                            {!noMatch && hit.highlights.length > 0 && (
                              <span style={{ color: "#2a5a7a" }}>
                                {!isExpanded ? `▼ ${hit.highlights.length} trecho(s) similar(es)` : "▲ ocultar"}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Score numérico + barra */}
                        <div style={{ textAlign: "right", minWidth: 100 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: noMatch ? "#1e3050" : rank === 0 ? "#f59e0b" : C.accent }}>
                            {hit.score.toFixed(2)}
                          </div>
                          <div style={{ marginTop: 5, width: 100, height: 4, background: "#0a1220", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", width: `${pct}%`,
                              background: rank === 0
                                ? "linear-gradient(90deg,#f59e0b88,#f59e0b)"
                                : "linear-gradient(90deg,#3b82f688,#3b82f6)",
                              borderRadius: 4, transition: "width .6s ease",
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Trechos similares (highlights do ES) */}
                    {isExpanded && hit.highlights.length > 0 && (
                      <div style={{ borderTop: `1px solid ${C.faint}`, padding: "14px 18px", background: "#080d18" }}>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                          Trechos mais relevantes — destacados pelo Elasticsearch:
                        </div>
                        {hit.highlights.map(({ text }, li) => {
                          const cat = categorize(text);
                          return (
                            <div key={li} style={{
                              display: "flex", gap: 10, alignItems: "flex-start",
                              padding: "7px 10px", borderRadius: 7, marginBottom: 6,
                              background: "#0a1220", border: `1px solid ${C.faint}`,
                              borderLeft: `2px solid ${cat.color}`,
                            }}>
                              <Pill label={cat.label} color={cat.color} />
                              <span style={{ fontSize: 11, color: "#7098b8", flex: 1, wordBreak: "break-all", lineHeight: 1.6 }}>
                                {text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin   { to { transform: rotate(360deg); } }
        input::placeholder { color: #1e3050; }
        * { scrollbar-width: thin; scrollbar-color: #162033 transparent; }
      `}</style>
    </div>
  );
}