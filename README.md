# GraphRAG Codebase Analysis System

## Overview

This project implements a GraphRAG (Graph-Augmented Retrieval) system designed for deep codebase analysis. By combining semantic vector search with a Knowledge Graph, the system can retrieve not only relevant code snippets but also the architectural context, such as where a function is defined, what classes it belongs to, and how modules interact.

## Architecture

The system utilizes a hybrid storage approach to bridge the gap between raw text and structural relationships:

- **Vector Database (Pinecone):** Stores code embeddings for semantic similarity search.
- **Graph Database (Neo4j):** Stores the structural lineage and relationships between code entities.
- **LLM (Gemini 2.5 Flash):** Processes the augmented context to provide precise, technically grounded answers.

## Project Structure

- **05_chunkBuilder.js**: Handles the parsing and chunking of source code files into searchable units.
- **06_vectorStore.js**: Manages the embedding process and upserting of data into the vector index.
- **07_graphStore.js**: Manages the Neo4j schema, including the creation of Module, Class, and Function nodes and their respective relationships.
- **08_queryEngine.js**: The orchestration layer that performs semantic search and then expands the found nodes within the graph to collect architectural context.
- **09_llmResponder.js**: Formats the final consolidated context and interfaces with the Gemini API for response generation.

## Graph Schema

The system builds a relationship map using the following logic:

- **DEFINED_IN**: Links Functions to Classes or Modules, and Classes to Modules.
- **CALLS**: Represents function-to-function execution paths.
- **IMPORTS**: Tracks dependencies between different Modules.

## Getting Started

### Prerequisites

- Node.js 22 or newer (required by the Pinecone TypeScript SDK v9)
- Git (required when ingesting a repository by URL)
- Neo4j Instance (Aura or Local)
- Pinecone API Key
- Google Gemini API Key

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure your environment variables in a `.env` file:
    ```env
    PINECONE_API_KEY=your_key
    GEMINI_API_KEY=your_key
    PINECONE_INDEX=your_index_name
    ENABLE_NEO4J=true
    NEO4J_URI=neo4j+s://your-instance.databases.neo4j.io
    NEO4J_USERNAME=neo4j
    NEO4J_PASSWORD=your_password
    ```

The RAG service detects the configured Pinecone index schema at runtime. For a
document-schema index, configure a string `chunk_text` field with integrated
embedding and an optional string `title` field. Pinecone then embeds chunks and
queries through its Documents API. For a classic vector index, the service keeps
using `gemini-embedding-001`; that index must match the embedding dimension
returned by Gemini. Set `ENABLE_NEO4J=true` and valid Neo4j credentials to store
graph nodes and relationships. With Neo4j disabled, vector ingestion and
retrieval still work, but graph context is unavailable.

### Usage

Start the HTTP service:

```bash
npm start
```

The server listens on port `8000`. Ingest a local checkout or a Git URL:

```bash
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoId":"my-repo","repoUrl":"https://github.com/user/repo"}'
```

Ask a question with the same `repoId`:

```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"repoId":"my-repo","question":"Where is authentication handled?"}'
```

Ingestion reports the vector count and whether Neo4j was enabled, along with
the graph node and relationship counts. Ask responses include retrieved source
metadata and snippet/relationship counts so empty retrievals are visible instead
of being confused with a successful contextual lookup.

Docker builds install Git and start the same HTTP service:

```bash
docker build -t codelens-rag .
docker run --rm -p 8000:8000 --env-file .env codelens-rag
```

### Production service access

Set `NODE_ENV=production` and configure `RAG_SERVICE_TOKEN` with a random value of at least 32 characters. Configure the exact same token on the RepoLens backend. `/ingest`, `/ask`, and `/governance/index` require that bearer token; `/health` remains public for deployment health checks. Keep this service on a private network where possible and store the token in the hosting provider's secret manager, not in source control.

### Governance result indexing

`POST /governance/index` accepts finalized findings and decisions, writes them to the same repo-scoped Pinecone index as source chunks, and preserves finding IDs and evidence references as filterable document fields. Q&A retrieval can therefore cite prior governance results. The backend calls this endpoint after consensus and records indexing status on the analysis job. Document-schema indexes use Pinecone's Documents API; classic indexes continue using vector operations.
