---
name: content-review
description: >
  Review and fix UI text in Figma designs using standard writing style guidelines.
  Use when asked to review content, fix text, check grammar, capitalization, word choice,
  or improve UI strings in a Figma design. Extracts text from Figma, reviews against style
  rules, and applies approved changes back to Figma.
---

# Figma Content Review

Review UI text in Figma designs against writing style guidelines and apply fixes directly. **Be fast** — extract, review, present changes, apply.

## Prerequisites

- **figma-ai-bridge plugin** running in Figma and connected
- Helper scripts:
  - `.github/skills/content-review/scripts/figma_text.py extract <ch> <nodeId>` — extract all text nodes
  - `.github/skills/content-review/scripts/figma_text.py apply <ch> <changes.json>` — apply text changes
  - `scripts/figma_cmd.mjs` for WebSocket commands

## Workflow — Do This Quickly

**Run all commands directly without asking for permission.** Only pause for user approval when presenting the proposed text changes (step 3).

### 1. Extract text from Figma

Get the selection, then extract all text nodes:

```sh
python3 .github/skills/content-review/scripts/figma_text.py extract <ch> <nodeId> --out /tmp/figma_texts.json
```

Outputs a JSON array of `{nodeId, nodeName, text, fontSize, visible}` for every text node.

### 2. Review text against style rules

Load the style references and review each text node:

- `.github/skills/content-review/references/style/grammar.md` — voice, tense, articles, pronouns
- `.github/skills/content-review/references/style/capitalization.md` — sentence case, proper nouns
- `.github/skills/content-review/references/style/word-choice.md` — simple words, contractions, action verbs
- `.github/skills/content-review/references/style/punctuation.md` — periods, commas, colons, apostrophes

For each issue found, generate a change entry:

```json
{"nodeId": "...", "original": "...", "newText": "...", "reason": "..."}
```

### 3. Present changes for approval

Show a diff table:

| Node | Original | Suggested | Rule |
|------|----------|-----------|------|

Wait for user approval (all, selective, or skip).

### 4. Apply approved changes

```sh
python3 .github/skills/content-review/scripts/figma_text.py apply <ch> /tmp/text_changes.json
```

The changes JSON is an array of `{nodeId, newText}`.

## Style Rules Quick Reference

### Voice & Grammar
- Present tense, active voice
- Address users as "you"
- Use contractions (don't, it's, you'll)
- Every singular countable noun needs an article (a, an, the)
- "Select" not "click" or "tap"
- No "please" in instructions
- No "in order to" — use "to"

### Capitalization
- **Sentence case everywhere** — headings, buttons, menus, tooltips
- Capitalize only first word + proper nouns
- Common nouns lowercase: workspace, dashboard, pipeline, settings

### Word Choice
- Simple words: "use" not "utilize", "start" not "initiate", "to" not "in order to"
- Positive framing: "Save your work before closing" not "Don't close without saving"
- Action verbs: Select, Enter, Turn on/off, Open, Close, Go to

### Punctuation
- Serial comma (Oxford): "files, folders, and settings"
- No periods in button labels or tooltips (unless multi-sentence)
- No periods in headings
- Apostrophes for contractions, not plurals: "APIs" not "API's"

## Common UI Text Fixes

| Original | Fixed | Rule |
|----------|-------|------|
| "Click Save" | "Select **Save**" | Use "select" not "click" |
| "Setup Your Workspace" | "Set up your workspace" | Sentence case + "set up" is two words as verb |
| "Please Enter a Name" | "Enter a name" | No "please", sentence case |
| "In Order To Continue" | "To continue" | Simplify, sentence case |
| "Settings Will Be Saved" | "Your settings are saved" | Present tense, active voice |
| "Dont forget to save" | "Don't forget to save" | Proper contraction |

## References

- `.github/skills/content-review/references/style/grammar.md`
- `.github/skills/content-review/references/style/capitalization.md`
- `.github/skills/content-review/references/style/word-choice.md`
- `.github/skills/content-review/references/style/punctuation.md`
