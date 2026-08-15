# Dietary Maps AI

A **multi-agent AI system** for restaurant search under dietary preferences,
allergies, and food restrictions. A Python (FastAPI) **multi-agent pipeline**
behind a Next.js frontend, filtered on live OpenStreetMap `diet:*` tags — and
it only shows restaurants whose dietary tags it can actually verify.

> "Halal food with gluten-free options near USC" → real restaurants,
> confidence-scored, with the evidence behind every match.

**Live:** https://diet-aware-dining-xi.vercel.app

*Winner — Miro × Kiro Hackathon, LA Chapter 2026.*

---

## The rule that shapes everything

Most restaurant search optimises for showing you results. This one optimises
for not being wrong, because the cost of a wrong answer is someone eating
something they can't.

A missing `diet:*` tag is treated as **unknown**, never as *probably fine*. If
nothing within 25 km can be verified, the app says so and shows you nothing —
and explains what it searched and how many places it checked. Three verified
results beat twenty guesses.

Everything below follows from that.

---

## Features

- **Multi-agent pipeline** — eight stages: three LLM agents (dietary intent,
  clarification, recommendation copy) plus deterministic discovery, evidence
  verification, and confidence scoring, coordinated by a tool-calling agent
  runtime with a deterministic fallback when `OPENAI_API_KEY` is unset.
- **Natural-language search** — describe dietary preferences, allergies, and
  food restrictions in plain English ("vegan sushi near downtown").
- **Live OpenStreetMap data** — fetched per search via the Overpass API;
  Nominatim geocoding turns a place name into coordinates.
- **Hard dietary filtering** — the requirement is in the Overpass query itself
  and re-asserted after parsing, so an unverified place cannot reach the results.
- **Evidence for every match** — each result quotes the OSM tag it relied on and
  links to the exact mapped object so you can check it yourself.
- **Deterministic confidence scoring** — no random component; the same input
  always scores the same.
- **Google Maps directions** — one-click deep link from any result (client-side,
  no API key).
- **Honest failure modes** — an outage, an ambiguous location and a genuinely
  empty result set are three different states with three different screens.
- **Degrades gracefully** — Nominatim, Overpass and OSM are free and keyless.
  `OPENAI_API_KEY` unlocks the LLM agents; each falls back to a deterministic
  path without it.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  Next.js 14 · React 18 · Zustand · Tailwind             │
│  SearchForm → ResultsMapView + RecommendationCard        │
│             → RestaurantDetails (evidence & scoring)     │
└────────────────────────────┬────────────────────────────┘
                             │ POST /api/recommend
┌────────────────────────────▼────────────────────────────┐
│  Python serverless functions (FastAPI, api/*.py)        │
│  ┌────────────────────────────────────────────────────┐ │
│  │  AgentPipeline orchestrator (pipeline.py)          │ │
│  │                                                    │ │
│  │  1. DietaryIntentAgent      LLM   NL → intent      │ │
│  │  2. ClarificationAgent      LLM   ask if blocked   │ │
│  │  3. RestaurantDiscovery     code  Overpass search  │ │
│  │  4. EvidenceVerification    code  restate OSM tags │ │
│  │  5. ConfidenceScorer        code  scoring          │ │
│  │  6. MapService              code  bounds & markers │ │
│  │  7. RecommendationAgent     LLM   reasons/warnings │ │
│  │  8. ExportService           code  JSON/CSV/text    │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  External services                                      │
│  Nominatim      location text → coordinates      free   │
│  Overpass API   OSM query engine                 free   │
│  OpenStreetMap  contributor-maintained tag data  free   │
│  Google Maps    directions deep link (client)    free   │
│  OpenAI         intent, clarification, copy      keyed  │
│  Vercel KV      result cache (optional)          keyed  │
└─────────────────────────────────────────────────────────┘
```

The **multi-agent pipeline orchestrator** (`AgentPipeline` in
`api/_lib/agents/pipeline.py`) runs those eight stages. **Three of them use an
LLM.** The split is deliberate: the model decides strategy, code enforces
dietary safety. Anything that changes *which* restaurants a person sees is
deterministic and reproducible.

---

## Getting started

### Prerequisites

- Node.js 18+
- Python 3.12+

### Installation

```bash
git clone https://github.com/Aryan-2602/diet-aware-dining.git
cd diet-aware-dining

npm install                                   # frontend
python3 -m venv .venv                         # backend
.venv/bin/pip install -r requirements-dev.txt
```

### Configuration

Copy `.env.example` to `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | No | Enables the LLM agents. Without it each falls back to a deterministic parser and the app still works. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini`. Must support JSON mode. |
| `KV_REST_API_URL` | No | Vercel KV / Upstash Redis endpoint for the result cache. |
| `KV_REST_API_TOKEN` | No | Token for the above. Unset, the cache is a no-op. |

**Caching is strongly recommended in production.** Overpass and Nominatim are
free services with no capacity guarantee — a saturated Overpass mirror answers
with a 504, a 429 or a hang, and one search can issue up to four queries.
Caching doesn't make the mirrors faster; it stops the app asking them the same
question, which is what turns an intermittently failing search into a reliable
one. On Vercel, connecting a KV store to the project injects both variables
automatically. Overpass results are cached for 6 hours, geocodes for 30 days.

### Running locally

Two processes. The Next.js dev server proxies `/api/*` to the Python API (see
`next.config.mjs`); in production Vercel routes them directly via `vercel.json`.

```bash
npm run dev:api   # FastAPI on :8000
npm run dev       # Next.js on :3000
```

Open http://localhost:3000

### Verification

```bash
npm run test:py    # 64 offline assertions over the safety-critical functions
npm run eval       # end-to-end against the real Nominatim/Overpass APIs
npx tsc --noEmit   # type check
npm run build      # production build
```

The eval reports upstream outages as `SKIP`. Overpass allows two slots per IP
and is regularly saturated, so a network failure is never mistaken for a
regression.

---

## Project structure

```
api/                                 # Python backend (Vercel serverless)
├── recommend.py                     # entrypoint → /api/recommend
├── clarify.py                       # entrypoint → /api/clarify
├── health.py                        # entrypoint → /api/health
└── _lib/                            # underscore: not routed by Vercel
    ├── http.py                      # the FastAPI app all three re-export
    ├── types.py                     # domain types (camelCase = wire contract)
    ├── errors.py                    # typed discovery failures
    ├── llm_client.py                # dependency-free OpenAI client
    ├── agent.py                     # tool-calling agent runtime
    ├── confidence_scorer.py         # deterministic scoring
    ├── agents/
    │   ├── pipeline.py              # orchestrator
    │   ├── dietary_intent.py        # NL query → structured intent  (LLM)
    │   ├── clarification.py         # follow-ups when blocked       (LLM)
    │   ├── discovery.py             # Overpass search, deterministic
    │   ├── evidence_verification.py # restates OSM tags as evidence
    │   └── recommendation.py        # match reasons and warnings    (LLM)
    ├── services/
    │   ├── map_service.py           # map bounds and markers
    │   └── export_service.py        # JSON/CSV/text export
    └── tools/
        ├── diet_tags.py             # vocabulary → OSM tags (safety core)
        ├── geocode.py               # Nominatim
        ├── overpass.py              # query builder, mirror failover, timeouts
        └── cache.py                 # shared result cache (KV, optional)

src/                                 # Next.js frontend
├── app/
│   ├── page.tsx                     # screen switching, request lifecycle
│   ├── layout.tsx                   # shell, fonts, skip link
│   └── globals.css                  # Tailwind layers, focus ring, motion
├── components/
│   ├── LandingPage.tsx              # what the app does, and what it will not
│   ├── SearchForm.tsx               # NL input, dietary filters, allergies
│   ├── InterpretationView.tsx       # in-flight state: elapsed time, cancel
│   ├── ResultsMapView.tsx           # map, safety banners, sorted results
│   ├── RecommendationCard.tsx       # one result, with its evidence
│   ├── RestaurantDetails.tsx        # full detail and confidence breakdown
│   ├── ClarificationDialog.tsx      # follow-up questions
│   ├── SavedRecentView.tsx          # saved restaurants and history
│   ├── Navigation.tsx               # mobile tab bar
│   └── ui/                          # design-system primitives
│       ├── Button.tsx               # icon-only buttons require aria-label
│       ├── Alert.tsx                # deliberately has no dismiss prop
│       ├── Card.tsx  Badge.tsx  Chip.tsx  Field.tsx  EmptyState.tsx
├── lib/
│   ├── confidence.ts                # tier thresholds, defined once
│   ├── format.ts                    # distances, percentages, Maps links
│   ├── icons.ts                     # semantic icon aliases
│   ├── cn.ts                        # class joiner
│   └── prompts.ts                   # example queries, placeholder copy
├── store/index.ts                   # Zustand (persisted saves and recents)
└── types/index.ts                   # shared TypeScript interfaces

tests/test_tools.py                  # offline tests for the safety functions
scripts/eval.py                      # end-to-end eval against the real APIs
fixtures/                            # recorded Overpass response
```

---

## Multi-agent pipeline

1. **DietaryIntentAgent** *(LLM)* — extracts dietary needs, allergies, cuisine
   and location, constrained to a controlled vocabulary and validated field by
   field. Falls back to a keyword/regex parser without an API key.

2. **ClarificationAgent** *(LLM)* — asks only about genuinely blocking gaps: a
   missing or ambiguous location, no stated dietary requirement. Answer options
   are re-derived from the vocabulary, never taken from the model.

3. **RestaurantDiscovery** — geocodes once via Nominatim, then queries Overpass
   with the dietary requirement **in the query**: `nwr` across
   restaurant/cafe/fast_food filtered on `diet:*` ~ `^(yes|only)$`. Widens
   2 → 5 → 10 → 25 km until there are enough matches, with per-radius timeouts
   and a total budget that fits the serverless limit. Cuisine is a soft
   ranking preference, because 22% of places carry no `cuisine` tag at all.

4. **EvidenceVerification** — emits one item per requested need, quoting the OSM
   tag verbatim. Whether a tag *exists* is a fact; whether it is *still true* is
   a belief derived from its `check_date`. Needs OSM cannot express, and every
   allergy, produce explicit "cannot be verified" evidence.

5. **Confidence scoring** — diet tag strength (`only` > `yes`), `check_date`
   recency, how much of the request OSM can express, and listing completeness.

6. **MapService** — map centre, bounds, zoom and marker data.

7. **RecommendationAgent** *(LLM)* — writes match reasons and warnings over the
   already-filtered, already-scored set. Ranking remains a deterministic sort,
   and safety warnings are generated in code and merged, never left to the model.

8. **ExportService** — JSON, plain text or CSV.

### What this app will not tell you

- **It never shows a restaurant it cannot verify.** A missing `diet:*` tag is
  "unknown", not "probably fine".
- **It cannot verify allergies at all.** OpenStreetMap holds no allergen or
  cross-contamination data, so allergies never filter results — they raise a
  standing, non-dismissible warning and prioritise places with a phone number
  you can call.
- **`keto`, `paleo` and `nut-free` have no OSM tag.** They are reported as
  unenforceable rather than silently dropped.
- **There are no ratings, reviews or prices.** OSM has none, so none are shown —
  and none are inferred.

---

## Data sources

| Source | Provides | Cost |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) | Locations, names, addresses, cuisine, dietary tags | Free |
| [Nominatim](https://nominatim.openstreetmap.org) | Geocoding (place name → coordinates) | Free |
| [Overpass API](https://overpass-api.de) | Query engine over OSM data | Free |
| Google Maps | Directions deep link (client-side, no key) | Free |

### How OSM dietary tags work

OpenStreetMap uses community-maintained tags:

| Tag | Meaning |
|---|---|
| `diet:vegan=yes` / `=only` | Vegan options / entirely vegan |
| `diet:vegetarian=yes` | Vegetarian options available |
| `diet:gluten_free=yes` | Gluten-free options available |
| `diet:halal=yes` | Halal options available |
| `diet:kosher=yes` | Kosher options available |
| `diet:lactose_free=yes` | Dairy-free options available |

These are added by local mappers, often verified in person, and carry an
optional `check_date` recording when someone last confirmed them — which is what
the recency component of the confidence score reads.
[Reference →](https://wiki.openstreetmap.org/wiki/Key:diet)

---

## Design

A restrained, light-only interface built on tokens in `tailwind.config.ts`.

The governing rule is that **colour means something**. Hue is reserved for what
the app can and cannot verify, and actions are neutral ink. When green is both
the brand colour and the "high confidence" signal, the signal stops reading as
one.

| Token | Meaning |
|---|---|
| `verified` (emerald) | A claim OpenStreetMap confirms; confidence tier *high* |
| `caution` (amber) | Tier *medium*, warnings, unenforceable needs |
| `danger` (red) | Allergy non-verifiability, errors, destructive actions |
| `source` (blue) | Links out to openstreetmap.org — provenance, never state |

- **Type** — Inter via `next/font`, weights 400/500/600, tabular figures for
  every number so digits don't shift as results re-sort.
- **Surfaces** — cards are defined by a border, not a shadow.
- **Icons** — lucide-react, with state icons behind semantic aliases in
  `src/lib/icons.ts` so one state cannot acquire two glyphs.
- **Accessibility** — a single zero-specificity `:focus-visible` ring covers
  every interactive element, motion respects `prefers-reduced-motion`, and
  `Button` makes an unlabelled icon-only button a *type error*.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS, lucide-react |
| State | Zustand (persisted) |
| Backend | Python 3.12, FastAPI |
| Architecture | Multi-agent pipeline (LLM agents + deterministic services) |
| Data | OpenStreetMap via Overpass API + Nominatim |
| Cache | Vercel KV / Upstash Redis (optional) |
| Deployment | Vercel — static frontend + Python serverless functions |

---

## Example queries

- `Vegan sushi spot with high-protein options near Downtown LA`
- `Late-night halal burgers in Santa Monica, gluten-free buns available`
- `Nut-free dessert places within 5 miles of Seattle`
- `Jain-friendly Indian restaurant open on Sundays in Los Angeles`
- `Keto-friendly Korean BBQ near Venice Beach`

The last three deliberately include needs OpenStreetMap cannot express. The app
reports them as unenforceable rather than pretending to have filtered on them.

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Keep `npm run test:py` and `npx tsc --noEmit` green.
4. Commit and push, then open a pull request.

Changes touching `api/_lib/tools/diet_tags.py`, the discovery filter, or the
safety banners need a test — those are the paths where a bug shows someone a
restaurant that does not meet their dietary requirement.

---

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [OpenStreetMap](https://www.openstreetmap.org) contributors, for the data this
  is built on.
- [Overpass API](https://overpass-api.de) and
  [Nominatim](https://nominatim.openstreetmap.org), for running free public
  infrastructure.
- Miro and Kiro, for the design-to-code workflow.
- Built by Team Trojans, Hackathon 2026.
