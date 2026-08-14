# 🍽️ Dietary Maps AI

🏆 **Winning project — Miro x Kiro Hackathon LA Chapter 2026**

A multi-agent AI system that discovers restaurants matching complex dietary needs using **real-time OpenStreetMap data**. **Python** backend (FastAPI) running the agent pipeline, **Next.js/React** frontend — it only shows restaurants whose dietary tags it can actually verify.

> "Halal food with gluten-free options near USC" → Real restaurants, confidence-scored, with Google Maps directions.

## 🌐 Live Demo

**https://diet-aware-dining.vercel.app**

---

## ✨ Features

- **Natural Language Search** — Describe dietary needs in plain English (e.g., "vegan sushi near downtown")
- **Real-Time Data** — Fetches live restaurant data from OpenStreetMap via Overpass API
- **Multi-Agent Pipeline** — Four LLM agents (intent, clarification, evidence, recommendation) over a deterministic core that owns discovery, filtering and scoring
- **Verified Matches Only** — Results are hard-filtered on OpenStreetMap `diet:*` tags; a missing tag counts as "unknown", never "probably fine"
- **Source Verification** — Every result links back to its OpenStreetMap source for independent verification
- **Google Maps Navigation** — One-click directions to any restaurant
- **Responsive UI** — Full desktop layout with side-by-side map + results, mobile-first design
- **Degrades Gracefully** — Nominatim, Overpass and OSM are free and keyless; `OPENAI_API_KEY` unlocks the LLM agents, and every one falls back to a deterministic path without it

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Client)                                       │
│  Next.js Frontend • React • Zustand • Tailwind CSS      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ SearchForm  │→ │ ResultsMapView│→ │ Sources Tab   │  │
│  │ (NL input)  │  │ + RecCard    │  │ (OSM verify)  │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└────────────────────────────┬────────────────────────────┘
                             │ POST /api/recommend
┌────────────────────────────▼────────────────────────────┐
│  Python Serverless Functions (FastAPI, api/*.py)        │
│  ┌────────────────────────────────────────────────────┐ │
│  │  AgentPipeline Orchestrator (pipeline.ts)          │ │
│  │                                                    │ │
│  │  1. DietaryIntentAgent    → Parse NL to intent     │ │
│  │  2. ClarificationAgent   → Ask if ambiguous       │ │
│  │  3. RestaurantDiscovery   → Query Overpass API     │ │
│  │  4. EvidenceVerification  → Verify dietary tags    │ │
│  │  5. ConfidenceScorer      → Deterministic scoring  │ │
│  │  6. MapService            → Compute map bounds     │ │
│  │  7. Recommendation        → Rank & compile         │ │
│  │  8. ExportService         → Format JSON/CSV        │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  External Services (Free, No API Key)                   │
│  • Nominatim — Geocodes location text → lat/lng         │
│  • Overpass API — Queries OSM for restaurants           │
│  • OpenStreetMap — 10M+ contributor database            │
│  • Google Maps — Directions link (client-side only)     │
│  • OpenAI — Intent, clarification, recommendation copy  │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ (frontend)
- Python 3.12+ (backend)

### Installation

```bash
git clone https://github.com/Aryan-2602/diet-aware-dining.git
cd diet-aware-dining

npm install                                   # frontend
python3 -m venv .venv                         # backend
.venv/bin/pip install -r requirements-dev.txt
```

Copy `.env.example` to `.env` and set `OPENAI_API_KEY`. Without it the app still
works — every agent falls back to a deterministic path.

#### Caching (recommended for production)

Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` to point at a Vercel KV / Upstash
Redis store; on Vercel, connecting the store to the project injects both
automatically. Unset, the cache is a no-op and behaviour is unchanged.

This matters more than it looks. Overpass and Nominatim are free services with
no capacity guarantee — a saturated Overpass mirror answers with a 504, a 429
or a hang, and one search issues up to four queries. Caching does not make the
mirrors faster; it stops the app asking them the same question, which is what
turns an intermittently failing search into a reliable one. Overpass results are
cached for 6 hours and geocodes for 30 days.

### Run Development Servers

Two processes. The Next.js dev server proxies `/api/*` to the Python API
(see `next.config.mjs`); in production Vercel does this via `vercel.json`.

```bash
npm run dev:api   # FastAPI on :8000
npm run dev       # Next.js on :3000
```

Open [http://localhost:3000](http://localhost:3000)

### Tests

```bash
npm run test:py   # 43 assertions over the safety functions, offline
npm run eval      # end-to-end against the real Nominatim/Overpass APIs
```

---

## 📁 Project Structure

```
api/                                 # Python backend (Vercel serverless)
├── recommend.py                     # Vercel entrypoint -> /api/recommend
├── clarify.py                       # Vercel entrypoint -> /api/clarify
├── health.py                        # Vercel entrypoint -> /api/health
└── _lib/
    ├── http.py                      # The FastAPI app all three re-export
    ├── types.py                     # Domain types (camelCase = the wire contract)
    ├── errors.py                    # Typed discovery failures
    ├── llm_client.py                # Dependency-free OpenAI client
    ├── agent.py                     # Tool-calling agent runtime
    ├── confidence_scorer.py         # Deterministic scoring
    ├── agents/
    │   ├── pipeline.py              # Orchestrator
    │   ├── dietary_intent.py        # NL query → structured intent
    │   ├── clarification.py         # Asks follow-ups when genuinely blocked
    │   ├── discovery.py             # Overpass search, deterministic
    │   ├── evidence_verification.py # Restates OSM tags as evidence
    │   └── recommendation.py        # Ranks results, writes match reasons
    ├── services/
    │   ├── map_service.py           # Map bounds & markers
    │   └── export_service.py        # JSON/CSV/text export
    └── tools/                       # Deterministic tools the agents call
        ├── diet_tags.py             # Vocabulary → OSM tag mapping (safety core)
        ├── geocode.py               # Nominatim, cached
        └── overpass.py              # Query builder + mirror failover

src/                                 # Next.js frontend
├── app/
│   ├── page.tsx                     # Main page with routing & state
│   ├── layout.tsx                   # Root layout
│   └── globals.css                  # Tailwind + Noto Sans font
├── components/
│   ├── LandingPage.tsx              # Hero, how-it-works, trust section
│   ├── SearchForm.tsx               # NL input, quick filters, prompts
│   ├── InterpretationView.tsx       # Agent processing animation
│   ├── ResultsMapView.tsx           # Map + sorted result cards
│   ├── RecommendationCard.tsx       # Restaurant card with sources dropdown
│   ├── RestaurantDetails.tsx        # Full restaurant detail view
│   ├── EvidenceView.tsx             # Evidence breakdown per restaurant
│   ├── ClarificationDialog.tsx      # Follow-up question UI
│   ├── SavedRecentView.tsx          # Saved restaurants + search history
│   └── Navigation.tsx               # Bottom nav (mobile) + top nav (desktop)
├── store/
│   └── index.ts                     # Zustand store (persisted saves/recents)
└── types/
    └── index.ts                     # TypeScript interfaces for all entities

tests/
└── test_tools.py                    # Offline tests for the safety functions
scripts/
└── eval.py                          # End-to-end eval against the real APIs
fixtures/                            # Overpass response for offline testing
```

---

## 🔄 Agent Pipeline Flow

Four stages reason with an LLM; the rest are deterministic services. The split
is deliberate — **the model decides strategy, code enforces dietary safety.**
Anything that changes *which* restaurants a person sees is reproducible.

1. **DietaryIntentAgent** *(LLM)* — Extracts dietary needs, allergies, cuisine
   and location from natural language, constrained to a controlled vocabulary
   and validated field by field. Falls back to a keyword/regex parser when
   `OPENAI_API_KEY` is absent, so the app works without one.

2. **ClarificationAgent** *(LLM)* — Asks about genuinely blocking gaps — a
   missing or ambiguous location, no stated dietary requirement — in wording
   that reflects the actual query. Options are re-derived from the vocabulary,
   never taken from the model.

3. **RestaurantDiscovery** — Geocodes once via Nominatim, then queries Overpass
   with the dietary requirement **in the query**: `nwr` across
   restaurant/cafe/fast_food, filtered on `diet:*` ~ `^(yes|only)$`. Widens
   2 → 5 → 10 → 25 km until there are enough matches. Cuisine is a soft
   preference applied to ranking, because 22% of places carry no `cuisine` tag.

4. **EvidenceVerification** — Emits one item per requested need, quoting the
   OSM tag verbatim. Whether a tag exists is a fact; whether it is still true is
   a belief derived from its `check_date`. Needs OSM cannot express, and every
   allergy, produce explicit "cannot be verified" evidence.

5. **Confidence scoring** *(deterministic)* — Diet tag strength (`only` > `yes`),
   `check_date` recency, how much of the request OSM can express, and listing
   completeness. No random component; the same input always scores the same.

6. **MapService** — Map centre, bounds, zoom and marker data.

7. **RecommendationAgent** *(LLM)* — Writes match reasons and warnings over the
   already-filtered, already-scored set. Ranking stays a deterministic sort, and
   safety warnings are generated in code and merged, never left to the model.

8. **ExportService** — JSON, plain text or CSV.

### What this app will not tell you

- **It never shows a restaurant it cannot verify.** A missing `diet:*` tag is
  treated as "unknown", not "probably fine". Three verified results beat twenty
  guesses.
- **It cannot verify allergies at all.** OpenStreetMap has no allergen or
  cross-contamination data, so allergies are never used to filter — they surface
  a standing warning and prioritise places with a phone number you can call.
- **`keto`, `paleo` and `nut-free` have no OSM tag.** They are reported as
  unenforceable rather than silently dropped.
- **There are no ratings, reviews or prices.** OSM has none, so none are shown.

### Verification

```bash
npm run test:py   # 43 assertions over the pure safety functions, offline
npm run eval      # end-to-end against the real Nominatim/Overpass APIs
```

The eval reports upstream outages as `SKIP` — Overpass allows 2 slots per IP and
is regularly saturated, so a network failure is never mistaken for a regression.

---

## 🗺️ Data Sources

| Source | What it provides | Cost |
|--------|-----------------|------|
| [OpenStreetMap](https://www.openstreetmap.org) | Restaurant locations, names, addresses, cuisine types, dietary tags | Free |
| [Nominatim](https://nominatim.openstreetmap.org) | Geocoding (city name → lat/lng coordinates) | Free |
| [Overpass API](https://overpass-api.de) | Query engine for OSM data (find restaurants within radius) | Free |
| Google Maps | Directions link (client-side, no API key needed) | Free |

### How OSM Dietary Tags Work

OpenStreetMap uses community-verified tags like:
- `diet:vegan=yes` / `diet:vegan=only`
- `diet:vegetarian=yes`
- `diet:gluten_free=yes`
- `diet:halal=yes`
- `diet:kosher=yes`
- `diet:lactose_free=yes`

These are added by local mappers who verify the information in person. [Learn more →](https://wiki.openstreetmap.org/wiki/Key:diet)

---

## 🎨 Design

The UI follows the "Dietary Maps AI" prototype from the Miro board (Trojans team):

- **Primary color:** Green (#22c55e) — trust, health, nature
- **Font:** Noto Sans (Google Fonts)
- **Layout:** Responsive — mobile-first with full desktop expansion
- **Components:** Rounded cards, confidence badges, expandable source panels
- **Navigation:** Bottom bar on mobile, horizontal nav on desktop

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| UI | React 18 + Tailwind CSS |
| State | Zustand (persisted) |
| Language | TypeScript |
| Data | OpenStreetMap (Overpass API + Nominatim) |
| Architecture | Multi-agent pipeline (7 agents) |
| Deployment | Static + Serverless API routes |

---

## 📝 Example Queries

- `"Vegan sushi spot with high-protein options near Downtown LA"`
- `"Late-night halal burgers in Santa Monica, gluten-free buns available"`
- `"Nut-free dessert places within 5 miles of Seattle"`
- `"Jain-friendly Indian restaurant open on Sundays in Los Angeles"`
- `"Keto-friendly Korean BBQ near Venice Beach"`

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'feat: add my feature'`)
4. Push to branch (`git push -u origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

## 🙏 Acknowledgments

- [OpenStreetMap](https://www.openstreetmap.org) contributors for the restaurant data
- [Overpass API](https://overpass-api.de) for the free query engine
- Miro + Kiro for design-to-code workflow
- Built at Hackathon 2026 by Team Trojans
