# 🔍 Recuperação de Logs por Similaridade

> Encontre arquivos de log semelhantes a uma entrada de referência para acelerar a depuração de problemas em sistemas distribuídos.

---

## 📋 Sobre o Projeto

Este projeto implementa um sistema de **recuperação de informação baseado em similaridade** aplicado a arquivos de log. Dado um log de referência (uma linha ou trecho), o sistema busca nos arquivos indexados aqueles cujo conteúdo é mais similar, ranqueando os resultados por relevância.

O objetivo é auxiliar engenheiros e desenvolvedores a identificar rapidamente **onde um determinado tipo de evento já ocorreu** em sistemas que geram grandes volumes de logs, acelerando o processo de depuração.

---

## 🏗️ Arquitetura

```
┌─────────────────┐     HTTP      ┌─────────────────┐     REST API    ┌──────────────────────┐
│                 │  ──────────►  │                 │  ────────────►  │                      │
│   React (Vite)  │               │  Express (API)  │                 │   Elasticsearch 8.x  │
│   Frontend      │  ◄──────────  │   porta 3001    │  ◄────────────  │   porta 9200         │
│                 │   JSON        │                 │    BM25 nativo  │                      │
└─────────────────┘               └─────────────────┘                 └──────────────────────┘
```

### Por que essa arquitetura?

A versão inicial do projeto implementava o algoritmo BM25 diretamente no browser (JavaScript puro). Essa abordagem tem limitações claras: o índice é perdido ao fechar a aba, fica limitado à RAM do navegador e não escala para grandes volumes. A migração para Elasticsearch resolve todos esses problemas:

| Critério | BM25 no browser | Elasticsearch |
|---|---|---|
| Persistência do índice | ❌ Perdido ao fechar | ✅ Permanente em disco |
| Volume suportado | ~MBs (RAM do browser) | Bilhões de documentos |
| Velocidade | Linear (JS) | Índice invertido otimizado |
| Highlight de trechos | Manual (regex) | Nativo |
| Normalização de logs | Regex manual | `char_filter` configurável |

---

## 🧠 Como o BM25 Funciona Aqui

O **BM25 (Best Match 25)** é o algoritmo de ranking padrão do Elasticsearch. Ele calcula a relevância de cada documento para uma query combinando:

- **TF (Term Frequency)** — quantas vezes o termo aparece no arquivo, com saturação (mais ocorrências ajudam, mas com retorno decrescente)
- **IDF (Inverse Document Frequency)** — penaliza termos muito comuns entre todos os arquivos
- **Normalização por tamanho** — arquivos maiores não ganham vantagem injusta

Antes da indexação, um **`log_analyzer` customizado** normaliza o conteúdo via `char_filter`, removendo variáveis que não carregam significado semântico:

```
192.168.1.10  →  (removido)
07:32:51      →  (removido)  
sshd[5506]    →  sshd
port 22       →  (removido)
```

Isso garante que dois logs como:
```
Failed password for root from 192.168.1.1 port 22 ssh2
Failed password for root from 10.0.0.5 port 2222 ssh2
```
sejam tratados como semanticamente idênticos.

---

## 🚀 Como Rodar

### Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop) instalado e rodando
- [Node.js](https://nodejs.org) v18 ou superior
- npm

### Estrutura esperada de pastas

```
recuperacao-log-similaridade/
├── docker-compose.yml
├── src/                        ← frontend React
│   ├── App.jsx
│   ├── main.jsx
│   └── ...
└── src/Api/                    ← backend Express
    ├── server.js
    └── package.json
```

### Passo 1 — Subir o Elasticsearch

Na pasta raiz do projeto (onde está o `docker-compose.yml`):

```bash
cd server
docker compose up -d
```

Verifique se subiu:
```bash
curl http://localhost:9200
# Deve retornar JSON com "tagline": "You Know, for Search"
```

### Passo 2 — Rodar a API

```bash
cd src/Api
npm install
npm run dev
```

Saída esperada:
```
✅ Índice 'log-files' criado com log_analyzer
🚀 API rodando em http://localhost:3001
```

Verifique o status:
```
GET http://localhost:3001/api/health
```

### Passo 3 — Rodar o Frontend

```bash
cd src
npm install
npm run dev
```

Acesse **http://localhost:5173** no navegador.

---

## 📡 Endpoints da API

### `GET /api/health`
Retorna o status do cluster Elasticsearch e o total de documentos indexados.

```json
{ "status": "green", "documents": 42 }
```

---

### `POST /api/upload`
Indexa um ou mais arquivos de log. Aceita `multipart/form-data`.

**Campo:** `files` (múltiplos arquivos `.log`, `.txt`, `.csv`)

```json
{
  "success": true,
  "files": [
    { "filename": "auth.log", "action": "indexed", "lineCount": 2048 },
    { "filename": "syslog.log", "action": "updated", "lineCount": 15420 }
  ]
}
```

`action` pode ser `"indexed"` (novo) ou `"updated"` (já existia, foi substituído).

---

### `GET /api/files`
Lista todos os arquivos atualmente indexados no Elasticsearch.

```json
{
  "files": [
    {
      "id": "abc123",
      "filename": "auth.log",
      "line_count": 2048,
      "file_size": 204800,
      "uploaded_at": "2024-04-24T12:00:00.000Z"
    }
  ]
}
```

---

### `POST /api/search`
Busca arquivos similares ao log de referência usando BM25.

**Body:**
```json
{
  "query": "Failed password for root from 192.168.1.1 port 22 ssh2",
  "size": 10
}
```

**Resposta:**
```json
{
  "total": 3,
  "max_score": 14.72,
  "hits": [
    {
      "id": "abc123",
      "filename": "auth.log",
      "line_count": 2048,
      "file_size": 204800,
      "score": 14.72,
      "highlights": [
        {
          "text": "Dec 10 07:33:02 LabSZ sshd: Failed password for root from port ssh2",
          "marked": "Dec 10 07:33:02 LabSZ sshd: <<<Failed password>>> for <<<root>>>"
        }
      ]
    }
  ]
}
```

O campo `highlights` contém os trechos do arquivo com maior sobreposição com a query, já extraídos pelo Elasticsearch.

---

### `DELETE /api/files/:id`
Remove um arquivo do índice pelo seu ID.

```json
{ "success": true }
```

---

## 🛠️ Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Motor de busca | Elasticsearch 8.12 |
| Containerização | Docker + Docker Compose |
| Algoritmo de ranking | BM25 (nativo do Elasticsearch) |
---

## 📄 Licença

Este projeto é desenvolvido para fins acadêmicos na **Universidade Federal do Amazonas (UFAM)** — disciplina de Recuperação de Informações.