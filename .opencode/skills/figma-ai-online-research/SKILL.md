---
name: online-research
description: >
  Research any topic using live web sources before creating content or documentation.
  Use when asked to research, compare, analyze, or create content that requires
  up-to-date information beyond training data. Fetches authoritative sources,
  extracts structured data, and produces accurate, sourced content.
---

# Online Research

Fetch live web data to ground content in current facts. **Research first, create second.** Use this skill whenever content accuracy depends on information that may have changed since training.

## When to Use

- User asks to "research," "look up," "compare," or "find the latest" on any topic
- Content involves pricing, specs, rankings, dates, or statistics that change over time
- User explicitly wants current/accurate data (not training knowledge)
- Creating a doc or brief on a topic where outdated info would hurt credibility

## Prerequisites

- `fetch_webpage` tool available (built into the agent)
- For Figma doc output: combine with the `figma-doc` skill

## Workflow

### 1. Identify What Needs to Be Current

Before researching, determine:
- **What claims need live sourcing?** (pricing, specs, rankings, dates, availability)
- **What can use training knowledge?** (concepts, history, frameworks, opinions)
- **What's the user's actual question?** (don't over-research tangents)

### 2. Select Sources

Choose 2–5 authoritative sources per topic. Prioritize:

| Source type | When to use | Examples |
|---|---|---|
| Official product pages | Pricing, specs, features | Vendor pricing pages, product docs |
| Aggregator / comparison sites | Cross-vendor comparisons | Review sites, benchmark aggregators |
| Documentation / API docs | Technical specs, API details | Official developer docs |
| News / blog posts | Recent announcements, launches | Tech news sites, official blogs |
| Data sources | Statistics, market data | Industry reports, public datasets |

**Source selection principles:**
- **Primary over secondary** — official docs over blog summaries
- **Multiple sources for contested claims** — cross-reference pricing, benchmarks
- **Recency matters** — prefer sources updated within the last 3 months
- **Fallback sources** — if a primary source 403s or redirects, use aggregators

### 3. Fetch and Extract

Use `fetch_webpage` with:
- **urls**: array of 1–3 URLs per fetch call
- **query**: specific question to focus extraction

```
fetch_webpage(
  urls: ["https://example.com/pricing", "https://example.com/specs"],
  query: "current pricing and key specifications"
)
```

**Extraction tips:**
- Tables in fetched content often contain the most useful structured data
- Look for dates/timestamps to confirm freshness
- If a page redirects, follow the redirect URL in a second fetch
- If a page returns 403/404, try an alternative source

### 4. Synthesize

After fetching, organize findings:

1. **Separate facts from interpretation** — facts are sourced, interpretation is yours
2. **Flag stale or conflicting data** — if sources disagree, note it
3. **Structure for the output format** — if building a doc, organize into sections
4. **Cite sources** — include source URLs or names in the content

### 5. Output

Produce the content in whatever format the user needs:
- **Figma doc** → use `figma-doc` skill with researched content
- **Text response** → structured markdown with sourced claims
- **Comparison** → tables with sourced data points

## Research Patterns

### Price Comparison
1. Fetch each vendor's official pricing page
2. Fetch one aggregator for cross-reference
3. Build a comparison table with consistent dimensions
4. Note pricing date and any caveats (volume discounts, preview pricing)

### Product / Feature Comparison
1. Fetch each product's official specs/docs page
2. Fetch one independent review or comparison
3. Identify common dimensions (features, specs, availability)
4. Build a table or columns comparing across products

### Market / Industry Analysis
1. Fetch 2–3 recent news articles or reports
2. Fetch official announcements from key players
3. Synthesize trends, numbers, and quotes
4. Structure as narrative sections with data tables

### Technical Deep-Dive
1. Fetch official documentation and API references
2. Fetch community discussions or tutorials for practical context
3. Structure as overview → details → examples → gotchas

### Event / Announcement Summary
1. Fetch the official announcement or press release
2. Fetch 1–2 analysis pieces for context
3. Summarize what happened, why it matters, what's next

## Handling Common Issues

| Issue | Solution |
|---|---|
| 403 / blocked page | Try an aggregator or cached version of the data |
| Redirect | Follow the new URL with another `fetch_webpage` call |
| Stale data on page | Check for a "last updated" date; note it in output |
| Conflicting sources | Present both data points with source attribution |
| Too much data | Focus extraction with a specific `query` parameter |
| Missing data | Note what couldn't be verified; use training knowledge as fallback with disclaimer |

## Quality Checklist

Before delivering researched content:
- [ ] Every data point that could be outdated is sourced from a live fetch
- [ ] Sources are authoritative (official > aggregator > blog)
- [ ] Conflicting data is flagged, not silently resolved
- [ ] Pricing/dates include an "as of" timestamp
- [ ] Content structure matches the output format
- [ ] Fetched data is synthesized, not just dumped

## Notes

- **Don't fetch for everything** — conceptual explanations, frameworks, and opinions don't need live data
- **Batch fetches** — fetch 2–3 URLs in one call when they're independent
- **Be specific with queries** — a focused query extracts better data than a vague one
- **Respect rate limits** — don't make more than 5–6 fetch calls per research task
- **Training knowledge is still valuable** — use it for context, history, and framing
- **Always disclose** — if data couldn't be verified live, say so
