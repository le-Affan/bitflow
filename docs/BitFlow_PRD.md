# BitFlow : Bitcoin Transaction Visualizer
## MVP Product Requirements Document

## MVP scope update

*Recorded 2026-10-11. Everything in this section is decided unless listed under "Still open". Where it conflicts with the rest of this document, this section wins. Original lines it replaces are marked "(superseded, see MVP scope update)"; lines it only postpones are marked "(deferred, see MVP scope update)".*

### Scope and build order

1. The visualizer works end to end for one UTC day: **2026-10-09**.
2. A daily job at a fixed time ingests the previous complete UTC day. It is observed running on 10 Oct, 11 Oct and later.
3. Only after that: date presets and custom ranges (deferred; not decided, not designed).
4. Only after that, and only if the daily flow works well: historical data before 2026-10-09 (out of scope now).

There is **no historical backfill and no historical dataset** in the MVP. The first day loaded is 2026-10-09 UTC, through the normal ingestion process.

### Storage

- Only each day's **top 100 transactions** are kept, with their inputs and outputs that have addresses (address and value), plus tx id, block height and block timestamp. Everything else from that day is discarded after ranking.
- A day is stored **all-or-nothing**: it counts as ingested only when every block of the day was fetched and the top 100 are stored. Re-running ingestion for a date replaces that date's data (safe to repeat).
- If a day's ingestion fails, previously ingested days stay available.
- Ingestion takes a **target date** as input, so earlier days can be loaded or re-ingested later.

### Day, source, schedule

- A day is a **UTC calendar day**. A block belongs to the day of its own block timestamp, never of any listing endpoint.
- **Initial data source: blockchain.info**, because it is the only tested source that returns a full day in one request per block (139 requests for 2026-10-08, measured in `docs/data-source-spike.md`). Its rate limits are unpublished (unverified risk), so ingestion must fetch sequentially with a pause and retry with backoff. It stays behind the adapter/normalizer and must be replaceable.
- **Known quirk (measured):** blockchain.info's blocks-by-day listing (`/blocks/{ms}`) returned the previous day's blocks when queried with midnight of the next day (querying 2026-10-09T00:00Z returned the blocks of 2026-10-08, see `docs/data-source-spike.md`).
- The daily job runs once per day at **01:00 UTC**, configurable through an environment variable, and ingests the previous complete UTC day. What triggers the job is open (see below).

### Ranking and eligibility

- Ranking value of a transaction = its **largest output that has a standard address**. *(superseded, see "Ranking update" below)*
- A transaction is **eligible** only if it has at least one input with an address, at least one output with an address, and at least one edge remains after dropping self-loops (see Graph model). Coinbase transactions are therefore excluded. *(superseded, see "Ranking update" below)*
- The top 100 are chosen among eligible transactions only. **Ties at rank 100** are broken by tx id in ascending alphabetical order.
- Outputs without an address (OP_RETURN, non-standard scripts) do not count for ranking and are not shown.

### Ranking update (decided 2026-10-11)

On 2026-10-09, 96 of the 100 stored transactions were ranked by an output going back to one of their own input addresses (usually change). The ranking now reflects money that actually moves to another address:

- **Ranking value** of a transaction = its largest output that (a) has a standard address and (b) goes to an address that is **not** among that same transaction's input addresses.
- A transaction is **eligible** only if it has at least one addressed input and at least one such output. Coinbase stays excluded.
- Top 100 by ranking value, ties broken by tx id ascending. Everything else is unchanged: UTC day, all-or-nothing storage, integer satoshis, edge rules (every input address to every output address, self-loop pairs dropped, repeated pairs aggregated), and the stored data (the 100 transactions with all their addressed inputs and outputs, including change outputs).
- **Known limitation:** change sent to a brand-new address cannot be told apart from a real payment without address clustering, which the MVP excludes. Such change can still set a transaction's ranking value.

### Graph model

- One node per address.
- Directed edges: every input address links to every output address of the same transaction (A + B → C + D gives A→C, A→D, B→C, B→D). Edges carry no BTC value (edges stay visually uniform).
- **Self-loops are dropped:** if an output address is also an input address of the same transaction, no edge is created for that pair.
- Repeated address pairs are aggregated into one visual edge. Clicking an edge lists its transactions, and each shows the amount that went to the output address.
- **Node details:** the address, the number of top-100 transactions it appears in, and the total BTC it sent and received within the displayed top 100 only. The panel must state that these numbers cover only the displayed view, not the address's full history.
- Graph size: a batch transaction can create many edges. Whether a cap is needed is open and must be measured on the 2026-10-09 data first.

### App behaviour until ranges exist

- The app shows **one UTC day at a time**, defaulting to the latest ingested day, with a simple selector listing ingested days.
- If no day has been ingested yet, the app shows an **empty state** saying so.
- Presets (24h, 7 days, 30 days) and custom ranges are deferred to build step 3.

### Step-1 success criteria

A user can:

1. Open BitFlow.
2. See the graph for the latest ingested day (default) or a selected ingested day.
3. See that it contains the top 100 eligible transactions.
4. See addresses as nodes and address-to-address relationships as edges.
5. Inspect nodes, aggregated edges and individual transactions.
6. Zoom and pan.
7. Run the whole system through Docker.
8. See a new day appear after the daily job succeeds.

### Still open

- What triggers the daily job (cron, in-app scheduler, separate container).
- Graph size cap.
- Date presets and custom ranges (build step 3).
- Database choice.
- Graph library choice.

---

### 1. Product Overview

**BitFlow** is a cloud-deployable Bitcoin transaction visualization application that allows users to explore the movement of Bitcoin.

The application will maintain an incrementally growing dataset of Bitcoin blockchain activity and provide an interactive graph where:

- Each **Bitcoin address is represented as a node**.
- Each **Bitcoin transfer relationship is represented as a directed edge**.
- Users can select a time period and visualize the most significant transactions within that period.
- Users can interact with nodes and edges to inspect underlying blockchain information.

The MVP is intended to demonstrate a **reproducible, Dockerized, continuously updating Bitcoin data pipeline combined with an interactive transaction graph**.

---

# 2. MVP Goals

### Primary goal

Build a **cloud-deployable Bitcoin transaction visualizer** capable of:

1. Maintaining at least one year of historical Bitcoin transaction data. *(superseded, see MVP scope update)*
2. Automatically adding new blockchain data once per day.
3. Allowing users to select predefined or custom date ranges. *(deferred, see MVP scope update)*
4. Selecting the top 100 transactions for the requested period. *(deferred, see MVP scope update)*
5. Representing Bitcoin addresses and their relationships as an interactive graph.
6. Allowing users to inspect transaction/address details interactively.
7. Running reproducibly through Docker.

### Non-goals

The MVP will **not** attempt to:

- Visualize every transaction in a selected period.
- Run its own Bitcoin node.
- Identify real-world owners or entities behind addresses.
- Cluster multiple addresses belonging to the same wallet.
- Provide address search.
- Provide authentication.
- Provide real-time blockchain updates.
- Build a full blockchain explorer.
- Store unnecessary raw blockchain data.

---

# 3. Target Users

BitFlow is intended for a combination of:

- General users interested in Bitcoin activity.
- Developers and technically knowledgeable users.
- Students and researchers exploring blockchain transaction behavior.

The default visualization should therefore remain visually simple, while detailed technical information should be available through interaction.

---

# 4. Core User Experience

## 4.1 Initial View

When the application opens, BitFlow automatically displays the **latest successfully ingested day's data**. *(superseded, see MVP scope update)*

If the latest scheduled ingestion failed, BitFlow continues displaying the most recent successfully loaded dataset.

---

## 4.2 Date Selection *(deferred, see MVP scope update)*

Users can select:

- **Last 24 hours**
- **Last 7 days**
- **Last 30 days**
- **Custom date range**

After selecting a range, the user clicks **Visualize**.

The graph is then generated using the applicable transactions stored in BitFlow's database.

---

# 5. Transaction Selection

The MVP will not attempt to render every transaction in the selected period.

Instead, it will identify the **top 100 transactions based on the largest individual transaction output value**.

For example:

```text
Transaction X

Input(s)
   |
   +----> 6 BTC → Address A
   |
   +----> 3 BTC → Address B
   |
   +----> 1 BTC → Address C
```

This transaction's ranking is determined by its largest output: **6 BTC**. *(superseded, see MVP scope update)*

Only outputs associated with standard identifiable Bitcoin addresses will be visualized.

---

# 6. Graph Model

### Nodes

Each Bitcoin **address** is represented by exactly one node.

The MVP does not attempt to determine whether multiple addresses belong to the same physical or logical wallet.

### Edges

Edges represent Bitcoin movement from one address to another. *(superseded, see MVP scope update)*

For a transaction such as:

```text
A + B → C
```

the graph represents the relationships as:

```text
A → C
B → C
```

Transactions themselves are **not represented as nodes**.

### Multiple transactions

If multiple transactions occur between the same two addresses:

```text
A → B
A → B
A → B
```

the graph displays them as a **single visually aggregated edge**.

The edge can then be selected to inspect the individual transactions that make up that relationship.

---

# 7. Graph Interaction

### Node interaction

Clicking a node displays available information about the corresponding Bitcoin address.

The exact information displayed will depend on the fields retained by the data model. *(superseded, see MVP scope update)*

### Edge interaction

Clicking an edge displays the individual transactions represented by that aggregated relationship.

### Transaction interaction

Users can select an individual transaction to view its available blockchain details.

### Hover

Hovering over nodes or edges provides a concise tooltip.

### Navigation

The graph supports:

- Zoom
- Pan

### Visual styling

Nodes and edges remain **visually uniform**.

The MVP will not use:

- Node size to represent volume.
- Edge thickness to represent BTC value.
- Color intensity to represent transaction significance.

Transaction details are revealed through interaction rather than visual encoding.

---

# 8. Data Architecture

BitFlow will maintain its own dataset rather than querying the external Bitcoin API whenever a user requests a visualization.

The high-level flow is:

```text
Public Bitcoin API
        ↓
API Adapter / Normalizer
        ↓
BitFlow Internal Data Model
        ↓
Database
        ↓
Backend API
        ↓
Frontend Graph
```

This ensures that the visualization layer is independent of the external API's response format.

---

# 9. Data Source

The MVP will use a **public Bitcoin API** rather than operating a Bitcoin Core node.

Requirements:

- Must be free for at least the initial development period.
- API usage must remain within the provider's free/rate limits.
- Data ingestion occurs once per day.
- The ingestion layer should be replaceable if the API changes or another provider is required.

Different API response structures will be handled through the **API Adapter / Normalizer** layer.

---

# 10. Data Ingestion

The ingestion system will run once per day.

It will:

1. Determine the latest blockchain data already stored. *(superseded, see MVP scope update)*
2. Request newly available blockchain data from the external API.
3. Normalize the API response into BitFlow's internal data model.
4. Store the required fields in the database.
5. Mark the new dataset as successfully available.
6. Make the latest successful dataset available to the application.

If ingestion fails, the existing latest successful dataset remains available.

---

# 11. Historical Data *(deferred, see MVP scope update)*

The MVP will initially contain approximately **one year of historical Bitcoin data**. *(superseded, see MVP scope update)*

Historical data will **not be deleted after one year**.

The system should therefore support:

```text
Initial dataset
    ↓
1 year
    ↓
2 years
    ↓
3+ years
    ↓
Expandable further
```

The architecture should allow storage and querying capacity to be expanded later without requiring a fundamental rewrite of BitFlow.

---

# 12. Stored Data

The MVP will store **only the blockchain fields required by BitFlow**. *(superseded, see MVP scope update)*

The system does not need to retain complete raw transaction payloads.

The data model must provide enough information to:

- Identify transactions.
- Identify blocks/time periods.
- Identify input addresses.
- Identify output addresses.
- Identify output values.
- Rank transactions.
- Build address-to-address graph relationships.
- Display transaction details.
- Display address information where applicable.

---

# 13. Backend

The MVP backend will use **FastAPI**.

Responsibilities include:

- Serving transaction data.
- Processing date-range queries.
- Selecting the top 100 applicable transactions.
- Constructing graph relationships.
- Providing node/edge details.
- Providing individual transaction details.
- Exposing the latest successfully ingested dataset.
- Supporting the frontend visualization.

---

# 14. Frontend

The MVP frontend will use **React**.

The frontend will provide:

- Date-range controls.
- Visualize button.
- Interactive transaction graph.
- Node tooltips/details.
- Edge tooltips/details.
- Transaction details.
- Zoom and pan controls.
- Loading/error states.

The frontend should remain independent of the external Bitcoin API.

---

# 15. Graph Technology

No graph library is mandated at the product level.

The implementation should select the simplest appropriate graph visualization technology that supports:

- Directed edges.
- Interactive nodes.
- Edge interaction.
- Zoom.
- Pan.
- Dynamic graph rendering.
- Aggregated edges.

This remains an implementation decision.

---

# 16. Database

The database technology will be selected based on the expected MVP workload and the characteristics of Bitcoin transaction data.

The database should support:

- Efficient date-range queries.
- Transaction ranking.
- Address lookups.
- Relationship queries.
- Growth over multiple years. *(deferred, see MVP scope update)*
- Dockerized deployment.
- Future migration/scaling.

The architecture should avoid coupling the rest of the application directly to database-specific implementation details.

---

# 17. Deployment

BitFlow will be **Dockerized**.

The objective is reproducibility rather than dependence on a particular cloud provider.

A deployment should allow another user to obtain the project and reproduce the environment through the provided Docker configuration.

Conceptually:

```text
Repository / Dataset
        ↓
Docker configuration
        ↓
BitFlow services
        ↓
Deploy locally or on cloud infrastructure
```

*(superseded, see MVP scope update)*: applies to "Dataset" in "Repository / Dataset"; no dataset is shipped.

The MVP does not require:

- Kubernetes
- AWS-specific infrastructure
- Managed cloud databases
- Complex cloud orchestration

The system should nevertheless be structured so these can be introduced later if scale requires them.

---

# 18. Authentication

No authentication is required for the MVP.

BitFlow is intended to function as a publicly accessible visualizer.

---

# 19. Failure Handling

The system must prioritize the **latest successfully loaded dataset**. *(superseded, see MVP scope update)*

If a scheduled ingestion fails:

```text
Previous successful dataset
          ↓
      remains active
          ↓
Next successful ingestion
          ↓
     becomes latest
```

The application should not become unusable merely because the newest ingestion attempt failed.

---

# 20. MVP Success Criteria

The MVP is considered successful if a user can:

1. Open BitFlow.
2. See the latest successfully ingested day's transaction graph.
3. Select a preset or custom date range. *(deferred, see MVP scope update)*
4. Click **Visualize**. *(deferred, see MVP scope update)*
5. Receive a graph containing the top 100 qualifying transactions.
6. See Bitcoin addresses as nodes.
7. See address-to-address relationships as edges.
8. Interact with nodes.
9. Interact with aggregated edges.
10. Inspect the underlying individual transactions.
11. Inspect transaction details.
12. Zoom and pan through the graph.
13. Run the complete system through Docker.
14. See newly ingested Bitcoin data after the daily update process succeeds.

---

# 21. MVP Decisions vs Future Expansion

| Area | MVP Decision | Future Direction |
|---|---|---|
| Historical data | Start with 1 year *(superseded, see MVP scope update)* | Grow indefinitely |
| Retention | Keep all ingested data *(superseded, see MVP scope update)* | Multi-year / full historical chain |
| Updates | Once per day | More frequent updates |
| Data source | Public API | Swappable APIs / own Bitcoin node |
| API cost | Free initially | Paid/provider-independent options |
| Transactions shown | Top 100 | Configurable larger datasets |
| Ranking | Largest individual output *(superseded, see MVP scope update)* | More sophisticated significance metrics |
| Nodes | Individual addresses | Wallet/entity clustering |
| Transaction node | Not used | Optional transaction-level graph |
| Edge representation | Aggregated *(superseded, see MVP scope update)* | Drill-down / higher granularity |
| Graph styling | Uniform | Value/activity-based visual encoding |
| Address search | Not included | Possible future feature |
| Authentication | None | Optional |
| Storage | Required fields only | Raw + optimized representations |
| Deployment | Dockerized | Cloud-native infrastructure |
| Scaling | MVP-scale | Horizontal/database/storage scaling |
| Blockchain source | External API | Bitcoin Core/full node |
| Visualization | Interactive graph | More analytical visualizations |

---

# 22. Product Principle

The central principle of BitFlow is:

> **Make Bitcoin transaction activity understandable as movement through a network of addresses, while retaining enough underlying data for users to drill into the actual transactions.**

The MVP deliberately prioritizes **clarity, reproducibility, and deployability** over complete blockchain coverage or real-time processing.
