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

- Node.js (v20.6.0 or higher for native env support)
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

The Pinecone index must use the same vector dimension returned by
`gemini-embedding-001` (3072 dimensions with the current embedding request).
Set `ENABLE_NEO4J=true` and valid Neo4j credentials to store graph nodes and
relationships. With Neo4j disabled, vector ingestion and retrieval still work,
but graph context is unavailable.

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

### Governance result indexing

`POST /governance/index` accepts finalized findings and decisions, embeds them into the same repo-scoped vector index as source chunks, and preserves finding IDs and evidence references as metadata. Q&A retrieval can therefore cite prior governance results. The backend calls this endpoint after consensus and records indexing status on the analysis job.
