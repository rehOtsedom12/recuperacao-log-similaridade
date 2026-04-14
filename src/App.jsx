import { useState, useRef, useCallback } from "react";

// ── BM25 over documents (each file = one document) ─────────────────────────
function tokenize(text) {
  return text
    .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, "IP")
    .replace(/\[\d+\]/g, "")
    .replace(/\d{2}:\d{2}:\d{2}/g, "TIME")
    .replace(/port \d+/g, "PORT")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1);
}

class BM25Files {
  constructor(files) { // files: [{name, content}]
    this.files = files;
    this.k1 = 1.5; this.b = 0.75;
    this.tokenized = files.map(f => tokenize(f.content));
    this.N = files.length;
    this.avgdl = this.tokenized.reduce((s, t) => s + t.length, 0) / Math.max(this.N, 1);
    // TF per doc
    this.tf = this.tokenized.map(tokens => {
      const freq = {};
      tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
      return freq;
    });
    // IDF
    const df = {};
    this.tokenized.forEach(tokens => {
      [...new Set(tokens)].forEach(t => { df[t] = (df[t] || 0) + 1; });
    });
    this.idf = {};
    Object.entries(df).forEach(([t, n]) => {
      this.idf[t] = Math.log((this.N - n + 0.5) / (n + 0.5) + 1);
    });
  }

  score(queryTokens, docIdx) {
    const tf = this.tf[docIdx];
    const dl = this.tokenized[docIdx].length;
    return queryTokens.reduce((s, t) => {
      const f = tf[t] || 0;
      if (!f) return s;
      const idf = this.idf[t] || 0;
      return s + idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * dl / this.avgdl));
    }, 0);
  }

  search(query) {
    const q = tokenize(query);
    return this.files
      .map((file, i) => ({ file, score: this.score(q, i), lineCount: this.tokenized[i].length }))
      .sort((a, b) => b.score - a.score);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function categorize(log) {
  if (/[Ff]ailed password/i.test(log))        return { label: "FAILED AUTH",   color: "#ef4444" };
  if (/[Ii]nvalid user/i.test(log))            return { label: "INVALID USER",  color: "#f97316" };
  if (/[Aa]ccepted/i.test(log))                return { label: "ACCEPTED",      color: "#22c55e" };
  if (/[Dd]isconnect/i.test(log))              return { label: "DISCONNECT",    color: "#a78bfa" };
  if (/[Cc]onnection closed/i.test(log))       return { label: "CLOSED",        color: "#94a3b8" };
  if (/maximum authentication/i.test(log))     return { label: "MAX ATTEMPTS",  color: "#fb923c" };
  if (/pam_unix/i.test(log))                   return { label: "PAM FAILURE",   color: "#f43f5e" };
  if (/[Ee]rror/i.test(log))                   return { label: "ERROR",         color: "#fbbf24" };
  if (/[Ww]arn/i.test(log))                    return { label: "WARNING",       color: "#facc15" };
  return { label: "OTHER", color: "#6b7280" };
}

// Find matching lines in file content
function findMatchingLines(content, query, maxLines = 5) {
  const qTokens = new Set(tokenize(query).filter(t => t.length > 3));
  const lines = content.split("\n").filter(Boolean);
  const scored = lines.map(line => {
    const lt = new Set(tokenize(line));
    const overlap = [...qTokens].filter(t => lt.has(t)).length;
    return { line, overlap };
  });
  return scored.sort((a, b) => b.overlap - a.overlap).slice(0, maxLines).filter(l => l.overlap > 0);
}

function fmt(n) { return n.toLocaleString("pt-BR"); }
function ext(name) { return name.split(".").pop().toLowerCase(); }
function fileSize(content) {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── UI Components ──────────────────────────────────────────────────────────
const COLORS = {
  bg: "#080c14", panel: "#0c1422", border: "#162033",
  accent: "#3b82f6", accent2: "#6366f1", text: "#b8c9e0",
  muted: "#364a63", faint: "#1a2a3e"
};

function Pill({ label, color }) {
  return (
    <span style={{
      background: `${color}18, color, border: 1px solid ${color}40`,
      borderRadius: `4, padding: "2px 8px", fontSize: 10, fontWeight: 700`,
      letterSpacing: "0.5px", whiteSpace: "nowrap"
    }}>{label}</span>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function LogFileSearch() {
  const [files, setFiles] = useState([]); // {name, content, lines}
  const [index, setIndex] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const dropRef = useRef(null);
  const inputRef = useRef(null);

  const readFiles = useCallback(async (fileList) => {
    const loaded = await Promise.all([...fileList].map(f =>
      new Promise(res => {
        const r = new FileReader();
        r.onload = e => res({ name: f.name, content: e.target.result });
        r.readAsText(f);
      })
    ));
    const newFiles = loaded.map(f => ({
      ...f,
      lines: f.content.split("\n").filter(Boolean).length
    }));
    setFiles(prev => {
      const all = [...prev, ...newFiles].filter(
        (f, i, arr) => arr.findIndex(x => x.name === f.name) === i
      );
      setIndex(new BM25Files(all));
      return all;
    });
    setResults(null);
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    readFiles(e.dataTransfer.files);
  }, [readFiles]);

  function doSearch() {
    if (!query.trim() || !index) return;
    const res = index.search(query);
    setResults(res);
    setExpanded(null);
    setAnimKey(k => k + 1);
  }

  function removeFile(name) {
    setFiles(prev => {
      const next = prev.filter(f => f.name !== name);
      setIndex(next.length ? new BM25Files(next) : null);
      return next;
    });
    setResults(null);
  }

  const maxScore = results?.[0]?.score || 1;

  return (
    <div style={{
      fontFamily: "'JetBrains Mono','Fira Mono','Consolas',monospace",
      background: COLORS.bg, minHeight: "100vh", color: COLORS.text,
    }}>
      {/* ── Header ── */}
      <div style={{
        background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`,
        padding: "24px 32px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9,
            background: "linear-gradient(135deg,#2563eb,#4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 0 24px rgba(79,70,229,.4)"
          }}>⌕</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#dde8f8", letterSpacing: "-0.3px" }}>
              Log File Similarity Search
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
              BM25 · Faça upload de arquivos .log e busque por similaridade
            </div>
          </div>
        </div>

        {/* Drop zone */}
        <div
          ref={dropRef}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById("file-inp").click()}
          style={{
            border: `2px dashed ${dragging ? COLORS.accent : COLORS.border}`,
            borderRadius: 12, padding: "20px 24px",
            textAlign: "center", cursor: "pointer",
            background: dragging ? "rgba(59,130,246,.06)" : COLORS.faint,
            transition: "all 0.2s", marginBottom: 16,
}}
        >
          <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
          <div style={{ fontSize: 12, color: COLORS.muted }}>
            Arraste arquivos <span style={{ color: COLORS.accent }}>.log</span> aqui ou clique para selecionar
          </div>
          <div style={{ fontSize: 10, color: "#243348", marginTop: 4 }}>
            Múltiplos arquivos suportados · txt, log, csv
          </div>
          <input id="file-inp" type="file" accept=".log,.txt,.csv" multiple
            style={{ display: "none" }}
            onChange={e => readFiles(e.target.files)} />
        </div>

        {/* Uploaded files chips */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {files.map(f => (
              <div key={f.name} style={{
                background: "#0f1d30", border: `1px solid ${COLORS.border}`,
                borderRadius: 8, padding: "6px 12px",
                display: "flex", alignItems: "center", gap: 8, fontSize: 11
              }}>
                <span style={{ fontSize: 14 }}>📄</span>
                <span style={{ color: "#7ab0d8", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ color: COLORS.muted }}>{fmt(f.lines)} linhas</span>
                <span style={{ color: COLORS.muted }}>·</span>
                <span style={{ color: COLORS.muted }}>{fileSize(f.content)}</span>
                <button onClick={e => { e.stopPropagation(); removeFile(f.name); }}
                  style={{ background: "none", border: "none", color: "#3a5570", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Query input */}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={{
              position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
              color: COLORS.accent, fontSize: 16, pointerEvents: "none"
            }}>⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              placeholder="Cole o log de referência aqui..."
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#0a1220", border: `1px solid ${COLORS.border}`,
                borderRadius: 10, padding: "13px 14px 13px 44px",
                color: COLORS.text, fontSize: 12, outline: "none",
                transition: "border-color .2s",
              }}
              onFocus={e => e.target.style.borderColor = COLORS.accent}
              onBlur={e => e.target.style.borderColor = COLORS.border}
            />
          </div>
          <button
            onClick={doSearch}
            disabled={!files.length || !query.trim()}
            style={{
              background: files.length && query.trim()
                ? "linear-gradient(135deg,#2563eb,#4f46e5)"
                : "#111827",
              border: "none", borderRadius: 10, padding: "0 24px",
              color: files.length && query.trim() ? "#fff" : "#2a3a50",
              fontSize: 13, fontWeight: 600, cursor: files.length ? "pointer" : "not-allowed",
              boxShadow: files.length ? "0 0 18px rgba(79,70,229,.3)" : "none",
              transition: "all .2s", whiteSpace: "nowrap"
            }}
          >
            Buscar
          </button>
        </div>

        {!files.length && (
          <div style={{ fontSize: 11, color: "#1e3050", marginTop: 8, textAlign: "center" }}>
            ↑ Faça upload de pelo menos um arquivo de log para começar
          </div>
        )}
      </div>
      {/* ── Results ── */}
      <div style={{ padding: "24px 32px" }}>
        {results === null && files.length > 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#1e3a5f" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 13 }}>{files.length} arquivo{files.length > 1 ? "s" : ""} indexado{files.length > 1 ? "s" : ""}. Cole um log acima e clique em Buscar.</div>
          </div>
        )}

        {results !== null && 
          (
          <div key={animKey}>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 16 }}>
              {results.filter(r => r.score > 0).length} arquivo{results.filter(r => r.score > 0).length !== 1 ? "s" : ""} com correspondência · ordenados por score BM25
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {results.map(({ file, score, lineCount }, rank) => {
                const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
                const isExpanded = expanded === file.name;
                const matches = isExpanded ? findMatchingLines(file.content, query, 8) : [];
                const noMatch = score === 0;

                return (
                  <div key={file.name} style={{
                    background: COLORS.panel,
                    border: `1px solid ${noMatch ? COLORS.faint : COLORS.border}`,
                    borderLeft: `3px solid ${noMatch ? "#1a2a3e" : rank === 0 ? "#f59e0b" : COLORS.accent}`,
                    borderRadius: 12,
                    opacity: noMatch ? 0.45 : 1,
                    animation: `fadeUp .3s ease ${rank * 0.06}s both`,
                    overflow: "hidden",
                  }}>
                    {/* Card header */}
                    <div
                      onClick={() => !noMatch && setExpanded(isExpanded ? null : file.name)}
                      style={{
                        padding: "14px 18px",
                        cursor: noMatch ? "default" : "pointer",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      {/* Score fill */}
                      <div style={{
                        position: "absolute", left: 0, top: 0, bottom: 0,
                        width: `${pct}%`,
                        background: rank === 0 ? "rgba(245,158,11,.05)" : "rgba(59,130,246,.04)",
                        pointerEvents: "none", transition: "width .6s ease"
                      }} />

                      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
                        {/* Rank badge */}
                        <div style={{
                          minWidth: 30, height: 30, borderRadius: 7,
                          background: rank === 0 && !noMatch
                            ? "linear-gradient(135deg,#f59e0b,#d97706)"
                            : "#0a1220",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 800,
                          color: rank === 0 && !noMatch ? "#000" : "#2a4060",
                          border: rank === 0 ? "none" : `1px solid ${COLORS.faint}`
                        }}>
                          {rank + 1}
                        </div>

                        {/* File info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, color: "#7ab8e0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
📄 {file.name}
                            </span>
                            {rank === 0 && !noMatch && <Pill label="MELHOR MATCH" color="#f59e0b" />}
                            {noMatch && <Pill label="SEM MATCH" color="#3a5570" />}
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 5, fontSize: 10, color: COLORS.muted, flexWrap: "wrap" }}>
                            <span>{fmt(lineCount)} linhas</span>
                            <span>{fileSize(file.content)}</span>
                            {!noMatch && <span style={{ color: "#2a5a7a" }}>{!isExpanded ? "▼ ver linhas similares" : "▲ ocultar"}</span>}
                          </div>
                        </div>

                        {/* Score */}
                        <div style={{ textAlign: "right", minWidth: 100 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: noMatch ? "#1e3050" : rank === 0 ? "#f59e0b" : "#3b82f6" }}>
                            {score.toFixed(2)}
                          </div>
                          <div style={{ marginTop: 5, width: 100, height: 4, background: "#0a1220", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", width: `${pct}%`,
                              background: rank === 0 ? "linear-gradient(90deg,#f59e0b88,#f59e0b)" : "linear-gradient(90deg,#3b82f688,#3b82f6)",
                              borderRadius: 4, transition: "width .6s ease"
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded: matching lines */}
                    {isExpanded && (
                      <div style={{
                        borderTop: `1px solid ${COLORS.faint}`,
                        padding: "14px 18px",
                        background: "#080d18",
                      }}>
                        <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>
                          Linhas com maior sobreposição de tokens:
                        </div>
                        {matches.length > 0 ? matches.map(({ line, overlap }, li) => {
                          const cat = categorize(line);
                          return (
                            <div key={li} style={{
                              display: "flex", gap: 10, alignItems: "flex-start",
                              padding: "7px 10px", borderRadius: 7, marginBottom: 6,
                              background: "#0a1220", border: `1px solid ${COLORS.faint}`,
                              borderLeft: `2px solid ${cat.color}`,
                            }}>
                              <Pill label={cat.label} color={cat.color} />
                              <span style={{
                                fontSize: 11, color: "#7098b8", flex: 1,
                                wordBreak: "break-all", lineHeight: 1.6
                              }}>{line}</span>
                              <span style={{ fontSize: 10, color: "#1e3050", whiteSpace: "nowrap" }}>
                                {overlap} tok
                              </span>
                            </div>
                          );
                        }) : (
                          <div style={{ fontSize: 11, color: "#1e3050" }}>Nenhuma linha similar encontrada.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )
        }
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        input::placeholder { color: #1e3050; }
        * { scrollbar-width: thin; scrollbar-color: #162033 transparent; }
      `}</style>
    </div>
  );
}