# Second Brain AI Companion - System Design Document

## Executive Summary

This document outlines the complete architecture for a "Second Brain" AI companion system that ingests, processes, and reasons about multi-modal user data through natural language conversations.

---

## 1. Multi-Modal Data Ingestion Pipeline

### 1.1 Architecture Overview

```
┌─────────────────┐
│   User Input    │
└────────┬────────┘
         │
    ┌────▼────┐
    │  Router │
    └────┬────┘
         │
    ┌────▼────────────────────────────────┐
    │     Type-Specific Processors        │
    ├─────────┬──────────┬───────┬────────┤
    │  Audio  │ Document │  Web  │ Image  │
    │Processor│Processor │Scraper│Extract │
    └────┬────┴────┬─────┴───┬───┴────┬───┘
         │         │         │        │
    ┌────▼─────────▼─────────▼────────▼───┐
    │      Chunking & Embedding Engine     │
    └────────────────┬─────────────────────┘
                     │
    ┌────────────────▼─────────────────────┐
    │      Metadata Enrichment Layer       │
    └────────────────┬─────────────────────┘
                     │
    ┌────────────────▼─────────────────────┐
    │       Storage & Indexing Layer       │
    │  ┌─────────┐  ┌──────┐  ┌─────────┐ │
    │  │Vector DB│  │Pg SQL│  │Object   │ │
    │  │(Pinecone│  │(Meta)│  │Storage  │ │
    │  │or Qdrant│  │      │  │(S3/Local│ │
    │  └─────────┘  └──────┘  └─────────┘ │
    └──────────────────────────────────────┘
```

### 1.2 Processor Specifications

#### Audio Processor
**Technology:** OpenAI Whisper API / Deepgram
**Pipeline:**
1. Accept `.mp3`, `.m4a`, `.wav`, `.ogg` formats
2. Validate audio quality (sample rate ≥16kHz recommended)
3. Send to Whisper API with language detection
4. Receive timestamped transcription
5. Extract speaker diarization if available
6. Store raw audio in object storage with reference ID

**Output Schema:**
```json
{
  "id": "audio_uuid",
  "type": "audio",
  "transcript": "Full text...",
  "duration": 180.5,
  "language": "en",
  "segments": [
    {"start": 0.0, "end": 5.2, "text": "Hello..."}
  ],
  "audio_url": "s3://bucket/audio_uuid.mp3"
}
```

#### Document Processor
**Technology:** PyPDF2, pdfplumber for PDFs; markdown parser for .md
**Pipeline:**
1. Accept `.pdf`, `.md`, `.txt`, `.docx` formats
2. Extract text with layout preservation
3. Parse structure (headings, lists, tables)
4. Extract metadata (author, creation date, title)
5. OCR fallback for scanned PDFs (Tesseract)

**Output Schema:**
```json
{
  "id": "doc_uuid",
  "type": "document",
  "content": "Extracted text...",
  "structure": {
    "headings": ["Introduction", "Methods"],
    "has_tables": true,
    "page_count": 12
  },
  "metadata": {
    "author": "John Doe",
    "created": "2024-01-15"
  }
}
```

#### Web Content Scraper
**Technology:** BeautifulSoup4, Trafilatura, Playwright for JS-heavy sites
**Pipeline:**
1. Accept URL input
2. Fetch HTML content (respect robots.txt)
3. Extract main content (removing ads, nav, footer)
4. Parse metadata (title, description, publish date)
5. Extract and store images with alt text
6. Archive snapshot of page

**Output Schema:**
```json
{
  "id": "web_uuid",
  "type": "web",
  "url": "https://example.com/article",
  "title": "Article Title",
  "content": "Main article text...",
  "author": "Jane Smith",
  "published": "2024-12-01",
  "images": [
    {"url": "img.jpg", "alt": "Description"}
  ]
}
```

#### Image Processor
**Technology:** Claude Vision API / GPT-4 Vision
**Pipeline:**
1. Accept `.jpg`, `.png`, `.webp` formats
2. Generate visual description via Vision API
3. Extract text via OCR (Tesseract)
4. Generate semantic tags
5. Create thumbnail
6. Store original in object storage

**Output Schema:**
```json
{
  "id": "img_uuid",
  "type": "image",
  "description": "A sunset over mountains...",
  "ocr_text": "Text found in image",
  "tags": ["nature", "sunset", "landscape"],
  "image_url": "s3://bucket/img_uuid.jpg"
}
```

---

## 2. Information Retrieval & Querying Strategy

### 2.1 Hybrid Search Architecture

**Chosen Approach:** Hybrid (Semantic + Keyword + Temporal)

```
User Query: "What did the article about quantum computing say?"
           │
    ┌──────▼──────┐
    │Query Analyzer│
    └──────┬──────┘
           │
    ┌──────▼────────────────────────┐
    │  Multi-Strategy Retrieval     │
    ├───────┬──────────┬────────────┤
    │Semantic│Keyword  │ Temporal   │
    │Search  │Search   │ Filter     │
    │(Vector)│(FTS)    │(Timestamp) │
    └───┬────┴────┬────┴─────┬──────┘
        │         │          │
    ┌───▼─────────▼──────────▼─────┐
    │    Reciprocal Rank Fusion    │
    │    (RRF Score Combination)   │
    └───────────────┬────────────────┘
                    │
    ┌───────────────▼────────────────┐
    │   Context Window Assembly      │
    │   (Top K results with chunks)  │
    └────────────────────────────────┘
```

### 2.2 Strategy Justification

**Why Hybrid?**

1. **Semantic Search (Primary):**
   - Uses vector embeddings (OpenAI `text-embedding-3-small`)
   - Captures conceptual similarity
   - Handles synonyms and paraphrasing
   - Best for "meaning-based" queries

2. **Keyword Search (Fallback):**
   - PostgreSQL full-text search with tsvector
   - Exact term matching
   - Better for specific names, dates, technical terms
   - Fast and deterministic

3. **Temporal Filter (Enhancement):**
   - Timestamp-based filtering
   - Handles queries like "last week", "in March"
   - Pre-filters before semantic/keyword search

**Reciprocal Rank Fusion (RRF):**
```
Score = Σ (1 / (k + rank_i))
where k = 60, rank_i = position in result list i
```

This combines rankings from multiple strategies without needing to normalize scores.

### 2.3 Query Flow Example

```
Query: "Summarize quantum computing article from last month"
│
├─ Parse temporal: "last month" → [2024-11-01, 2024-11-30]
├─ Generate embedding: [0.123, -0.456, ...]
├─ Keyword extract: ["quantum", "computing", "article"]
│
├─ Vector Search:    [doc_45 (0.92), doc_12 (0.87), doc_78 (0.81)]
├─ FTS Search:       [doc_45 (rank 1), doc_78 (rank 2), doc_33 (rank 3)]
├─ Temporal Filter:  Keeps only docs in date range
│
└─ RRF Fusion:       [doc_45 (0.034), doc_78 (0.027), doc_12 (0.023)]
   └─ Return Top 3
```

---

## 3. Data Indexing & Storage Model

### 3.1 Complete Lifecycle

```
Raw Data → Processing → Chunking → Embedding → Storage → Indexing
```

#### Step 1: Chunking Strategy

**Approach:** Recursive Character-based Chunking with Overlap

```python
# Pseudo-implementation
chunk_size = 1000 characters
chunk_overlap = 200 characters
separator_priority = ["\n\n", "\n", ". ", " "]

chunks = split_text_recursively(
    text=document.content,
    chunk_size=chunk_size,
    overlap=overlap,
    separators=separator_priority
)
```

**Why this approach?**
- Preserves semantic boundaries (paragraphs, sentences)
- Overlap ensures context continuity
- Fixed size enables consistent embedding
- Adaptable to document structure

#### Step 2: Embedding Generation

```
For each chunk:
  embedding = openai.embeddings.create(
    model="text-embedding-3-small",
    input=chunk_text,
    dimensions=1536
  )
```

**Model Choice Rationale:**
- `text-embedding-3-small`: Cost-effective, 1536 dims
- Alternative: `text-embedding-3-large` for higher accuracy
- Dimension reduction available (512 dims) for speed

### 3.2 Database Schema

#### PostgreSQL (Metadata & Relations)

```sql
-- Core documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'audio', 'document', 'web', 'image', 'text'
  name TEXT NOT NULL,
  source_url TEXT, -- For web content
  file_path TEXT, -- For stored files
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB, -- Flexible metadata storage
  size_bytes BIGINT,
  status VARCHAR(20) DEFAULT 'processing'
);

-- Chunks table (for RAG retrieval)
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536), -- Using pgvector extension
  token_count INT,
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Full-text search
  content_tsvector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', content)
  ) STORED
);

-- Indexes
CREATE INDEX idx_chunks_document_id ON chunks(document_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_fts ON chunks USING gin(content_tsvector);
CREATE INDEX idx_documents_user_created ON documents(user_id, created_at DESC);
CREATE INDEX idx_documents_type ON documents(type);

-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  metadata JSONB, -- Store sources, tokens used, etc.
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Vector Database (Alternative/Hybrid Approach)

If using dedicated vector DB (Pinecone/Qdrant):

```yaml
# Pinecone Index Configuration
index_name: "second-brain-embeddings"
dimension: 1536
metric: "cosine"
pod_type: "p1.x1" # Starter tier

# Metadata stored with each vector
metadata:
  document_id: "uuid"
  chunk_index: 123
  user_id: "uuid"
  type: "document"
  created_at: "2024-12-14T10:00:00Z"
  content_preview: "First 200 chars..."
```

### 3.3 Storage Trade-offs Analysis

| Approach | Pros | Cons | Best For |
|----------|------|------|----------|
| **PostgreSQL + pgvector** | Single DB, ACID, easier ops, good for <1M vectors | Slower than specialized DBs at scale | MVP, small-medium deployments |
| **Pinecone** | Managed, fast, scales to billions | Cost, vendor lock-in | Production, large scale |
| **Qdrant** | Open-source, self-hostable, fast | Ops overhead | Privacy-first, self-hosted |
| **Hybrid (PG + Pinecone)** | Best of both, separate concerns | Complexity, sync overhead | Large production systems |

**Recommended:** PostgreSQL + pgvector for MVP, migrate to hybrid as needed.

---

## 4. Temporal Querying Support

### 4.1 Timestamp Strategy

**Every document receives:**
```json
{
  "created_at": "2024-12-14T10:30:00Z", // Ingestion time
  "content_date": "2024-12-10",         // Content creation date
  "last_modified": "2024-12-14T10:30:00Z"
}
```

### 4.2 Natural Language Temporal Parsing

```python
# Temporal extraction examples
query_patterns = {
  "last week": (-7, days),
  "last month": (-30, days),
  "in March": (month_range, "2024-03"),
  "yesterday": (-1, days),
  "this year": (year_range, "2024"),
  "before June": (before, "2024-06-01"),
  "between Jan and March": (range, "2024-01-01", "2024-03-31")
}

def parse_temporal(query):
  for pattern, transform in query_patterns.items():
    if pattern in query.lower():
      return build_sql_filter(transform)
  return None
```

### 4.3 Temporal Query Examples

**Query:** "What did I work on last month?"

```sql
SELECT d.*, c.content
FROM documents d
JOIN chunks c ON d.id = c.document_id
WHERE d.user_id = $1
  AND d.created_at >= NOW() - INTERVAL '1 month'
  AND d.created_at < NOW()
ORDER BY d.created_at DESC;
```

**Query:** "Find the quantum computing article I saved in October"

```sql
SELECT d.*, c.content
FROM documents d
JOIN chunks c ON d.id = c.document_id
WHERE d.user_id = $1
  AND d.created_at >= '2024-10-01'
  AND d.created_at < '2024-11-01'
  AND c.content_tsvector @@ to_tsquery('quantum & computing & article')
ORDER BY ts_rank(c.content_tsvector, to_tsquery('quantum & computing')) DESC;
```

---

## 5. Scalability and Privacy

### 5.1 Scalability Strategy

**Single User → 10K Documents:**

```
┌─────────────────────────────────────┐
│         Application Layer           │
│  (FastAPI/Node.js + Load Balancer)  │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│      Processing Queue               │
│  (Redis + Celery/Bull.js)           │
│  - Async document processing        │
│  - Rate limiting per user           │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│      Database Layer                 │
│  - PostgreSQL (read replicas)       │
│  - Connection pooling (PgBouncer)   │
│  - Partitioning by user_id          │
└──────────┬──────────────────────────┘
           │
┌──────────▼──────────────────────────┐
│      Caching Layer                  │
│  - Redis for frequently accessed    │
│  - User query history cache         │
└─────────────────────────────────────┘
```

**Scaling Tactics:**

1. **Horizontal Scaling:**
   - Stateless API servers behind load balancer
   - Database read replicas for queries
   - Separate processing workers

2. **Partitioning:**
   - Table partitioning by user_id
   - Shard vector DB by user cohorts

3. **Optimization:**
   - Lazy loading of embeddings
   - Query result caching (Redis)
   - Batch embedding generation
   - Compression for stored documents

4. **Resource Limits:**
   - Per-user storage quotas (e.g., 10GB)
   - Rate limiting on uploads (10/min)
   - Async processing with queue priority

### 5.2 Privacy & Security

**Privacy by Design Principles:**

#### Cloud-Hosted Approach
```
User Data → TLS 1.3 → API Gateway → Encrypted Storage
                                      ↓
                           All data encrypted at rest (AES-256)
                           Per-user encryption keys (KMS)
```

**Security Measures:**
- End-to-end encryption in transit (TLS 1.3)
- Encryption at rest (AES-256-GCM)
- User-specific encryption keys via KMS
- Zero-knowledge architecture option
- RBAC for multi-user scenarios
- Audit logging (immutable, append-only)
- GDPR compliance (right to deletion)

#### Local-First Approach (Alternative)

```
┌──────────────────────────────────┐
│      Local Machine (User)        │
│  ┌────────────────────────────┐  │
│  │  Electron/Tauri App        │  │
│  │  - Local SQLite DB         │  │
│  │  - Local file storage      │  │
│  │  - Local vector index      │  │
│  └────────────┬───────────────┘  │
│               │                   │
│  Only embeddings & queries sent  │
│  to external API (no raw data)   │
└───────────────┼───────────────────┘
                │
         ┌──────▼──────┐
         │  LLM API    │
         │ (OpenAI/etc)│
         └─────────────┘
```

**Trade-offs:**

| Aspect | Cloud | Local-First |
|--------|-------|-------------|
| Privacy | User trusts provider | Maximum privacy |
| Performance | Optimized infrastructure | Limited by user hardware |
| Multi-device | Seamless sync | Complex sync needed |
| Maintenance | Provider handles | User responsibility |
| Cost | Subscription model | One-time + API costs |

**Recommendation:** Start with privacy-focused cloud (encrypted, audited), offer local-first as premium option.

---

## 6. Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  - Chat Interface  - File Upload  - Document Browser            │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS/WSS
┌──────────────────────────────▼──────────────────────────────────┐
│                      API Gateway (Nginx)                        │
│  - Rate Limiting  - Authentication (JWT)  - Load Balancing      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│  Ingestion API  │  │   Query API     │  │   User API      │
│  (FastAPI)      │  │   (FastAPI)     │  │   (FastAPI)     │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                     │                     │
         │          ┌──────────▼──────────┐          │
         │          │   PostgreSQL DB     │          │
         │          │  - Documents        │          │
         │          │  - Chunks           │◄─────────┘
         │          │  - Users            │
         │          │  - Conversations    │
         │          └──────────┬──────────┘
         │                     │
┌────────▼────────┐  ┌────────▼────────┐
│ Processing Queue│  │  Vector Search  │
│   (Redis/Bull)  │  │  (pgvector)     │
└────────┬────────┘  └─────────────────┘
         │
┌────────▼────────────────────────────────┐
│        Worker Processes                 │
│  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │ Whisper  │  │ Document │  │  Web   ││
│  │ Worker   │  │ Worker   │  │ Worker ││
│  └────┬─────┘  └────┬─────┘  └────┬───┘│
└───────┼─────────────┼─────────────┼────┘
        │             │             │
┌───────▼─────────────▼─────────────▼────┐
│         External Services               │
│  - OpenAI API (Whisper, Embeddings)    │
│  - Anthropic API (Claude)              │
│  - Object Storage (S3/MinIO)           │
└────────────────────────────────────────┘
```

---

## 7. Technology Stack Recommendation

### Backend
- **Framework:** FastAPI (Python) - async, type hints, auto docs
- **Database:** PostgreSQL 15+ with pgvector extension
- **Queue:** Redis + Celery (Python) or Bull (Node.js)
- **Object Storage:** AWS S3 or MinIO (self-hosted)
- **Cache:** Redis

### Frontend
- **Framework:** React 18+ with Vite
- **State:** Zustand or Context API
- **UI:** Tailwind CSS + shadcn/ui
- **Real-time:** WebSockets (Socket.io)

### AI/ML
- **Embeddings:** OpenAI text-embedding-3-small
- **LLM:** Claude 3.5 Sonnet (primary), GPT-4o (fallback)
- **Speech-to-Text:** OpenAI Whisper API
- **Vision:** Claude Vision API

### Infrastructure
- **Containerization:** Docker + Docker Compose
- **Orchestration:** Kubernetes (production)
- **CI/CD:** GitHub Actions
- **Monitoring:** Prometheus + Grafana
- **Logging:** ELK Stack or Loki

---

## 8. API Specifications

### Ingestion Endpoint

```
POST /api/v1/ingest
Content-Type: multipart/form-data

Request:
{
  "file": <binary>,
  "type": "audio|document|image",
  "metadata": {
    "title": "Optional title",
    "tags": ["tag1", "tag2"]
  }
}

Response:
{
  "document_id": "uuid",
  "status": "processing",
  "estimated_time": 30
}
```

### Query Endpoint

```
POST /api/v1/query
Content-Type: application/json

Request:
{
  "query": "What did the quantum article say?",
  "stream": true,
  "max_chunks": 5,
  "temporal_filter": {
    "start": "2024-11-01",
    "end": "2024-12-01"
  }
}

Response (streaming):
{
  "type": "context",
  "chunks": [
    {
      "document_id": "uuid",
      "content": "...",
      "score": 0.92
    }
  ]
}

{
  "type": "token",
  "content": "Based on the article..."
}

{
  "type": "done",
  "metadata": {
    "tokens_used": 450,
    "sources": ["doc1", "doc2"]
  }
}
```

---

## 9. Implementation Timeline

**Phase 1 (Week 1): Core Infrastructure**
- PostgreSQL setup with pgvector
- Basic document ingestion (text, PDF)
- Embedding generation pipeline
- Simple vector search

**Phase 2 (Week 2): Advanced Ingestion**
- Audio transcription (Whisper)
- Web scraping
- Image processing
- Async processing queue

**Phase 3 (Week 3): Intelligent Retrieval**
- Hybrid search implementation
- Temporal query parsing
- RAG pipeline with Claude
- Streaming responses

**Phase 4 (Week 4): UI & Polish**
- React chat interface
- Document management UI
- Real-time updates
- Error handling & testing

---

## 10. Future Enhancements

1. **Multi-modal RAG:** Combine text, image, and audio in single retrieval
2. **Knowledge Graphs:** Build entity relationships across documents
3. **Proactive Insights:** AI suggests connections between documents
4. **Collaborative Spaces:** Shared knowledge bases with permissions
5. **Fine-tuned Embeddings:** Custom embedding model for domain-specific data
6. **Mobile Apps:** iOS/Android native applications
7. **Voice Interface:** Speak queries naturally
8. **Browser Extension:** Capture web content seamlessly

---

## Conclusion

This architecture provides a production-ready foundation for a "Second Brain" system that can scale from single-user MVP to enterprise deployment while maintaining strong privacy guarantees and excellent retrieval performance through hybrid search strategies.
