# BitFlow : Bitcoin Transaction Visualizer
## MVP Product Requirements Document

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

1. Maintaining at least one year of historical Bitcoin transaction data.
2. Automatically adding new blockchain data once per day.
3. Allowing users to select predefined or custom date ranges.
4. Selecting the top 100 transactions for the requested period.
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

When the application opens, BitFlow automatically displays the **latest successfully ingested day's data**.

If the latest scheduled ingestion failed, BitFlow continues displaying the most recent successfully loaded dataset.

---

## 4.2 Date Selection

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

This transaction's ranking is determined by its largest output: **6 BTC**.

Only outputs associated with standard identifiable Bitcoin addresses will be visualized.

---

# 6. Graph Model

### Nodes

Each Bitcoin **address** is represented by exactly one node.

The MVP does not attempt to determine whether multiple addresses belong to the same physical or logical wallet.

### Edges

Edges represent Bitcoin movement from one address to another.

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

The exact information displayed will depend on the fields retained by the data model.

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

1. Determine the latest blockchain data already stored.
2. Request newly available blockchain data from the external API.
3. Normalize the API response into BitFlow's internal data model.
4. Store the required fields in the database.
5. Mark the new dataset as successfully available.
6. Make the latest successful dataset available to the application.

If ingestion fails, the existing latest successful dataset remains available.

---

# 11. Historical Data

The MVP will initially contain approximately **one year of historical Bitcoin data**.

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

The MVP will store **only the blockchain fields required by BitFlow**.

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
- Growth over multiple years.
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

The system must prioritize the **latest successfully loaded dataset**.

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
3. Select a preset or custom date range.
4. Click **Visualize**.
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
| Historical data | Start with 1 year | Grow indefinitely |
| Retention | Keep all ingested data | Multi-year / full historical chain |
| Updates | Once per day | More frequent updates |
| Data source | Public API | Swappable APIs / own Bitcoin node |
| API cost | Free initially | Paid/provider-independent options |
| Transactions shown | Top 100 | Configurable larger datasets |
| Ranking | Largest individual output | More sophisticated significance metrics |
| Nodes | Individual addresses | Wallet/entity clustering |
| Transaction node | Not used | Optional transaction-level graph |
| Edge representation | Aggregated | Drill-down / higher granularity |
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
