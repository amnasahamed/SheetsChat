# AI Chatbot Builder — Google Workspace Marketplace Readiness Design

**Date:** 2026-04-26
**Goal:** Launch as a public Google Workspace Marketplace add-on
**Approach:** Minimum Viable Launch — fix critical gaps, add marketplace requirements, polish core flow
**Target audience:** Non-technical creators (bloggers, small business owners, vibe-coders)
**Timeline:** No rush — focus on quality

---

## Section 1: Readiness Assessment

### What's working well
- Core architecture: monolithic Apps Script is the right call
- 10 providers + custom gives excellent coverage
- Knowledge base with keyword matching adds real value
- Widget is self-contained, no external dependencies
- UI is polished — dark mode, animations, responsive
- Lead capture is a nice differentiator

### Critical gaps

| Gap | Severity | Why it matters |
|-----|----------|---------------|
| No rate limiting | CRITICAL | API key exposed to abuse via public `doPost` endpoint (`access: ANYONE_ANONYMOUS`) |
| No input sanitization on doPost | CRITICAL | Widget sends raw user input to AI — injection risk |
| No privacy policy / terms | BLOCKER | Google requires these for marketplace listing |
| No store listing assets | BLOCKER | Screenshots, icon, description, category needed |
| No OAuth consent screen | BLOCKER | Required for marketplace publication |
| API key in DocumentProperties | HIGH | Anyone with sheet access can read it |
| No first-run experience | MEDIUM | User opens the add-on and sees empty form — no guidance |
| Widget has no error recovery | MEDIUM | If fetch fails silently, user sees nothing |
| No token usage tracking | LOW | Users can't monitor costs |

---

## Section 2: Security Hardening

### 2.1 Rate Limiting (WebApp.gs)

- Use CacheService for per-session rate limiting (auto-expires, no sheet bloat)
- Limit: 30 requests per session per minute
- Return HTTP 429 with clear message when exceeded
- Key format: `rate_{sessionId}` with 60s TTL, incrementing counter

### 2.2 Input Sanitization (WebApp.gs doPost)

- Truncate message to 4000 chars max
- Strip HTML/script tags from user input before sending to AI
- Validate `history` array: max 20 messages, max 2000 chars each
- Validate `type` field for lead capture requests

### 2.3 API Key Protection (Code.gs)

- Move from DocumentProperties to ScriptProperties
  - ScriptProperties: only accessible by the script, not by users opening the sheet
- `getConfig()` returns masked API key (`sk-...abc`) — never the full key
- Only accept full key during save via `saveConfig()`
- Migration: on first load after update, copy existing DocumentProperties key to ScriptProperties

### 2.4 Widget Origin Validation

- Add optional `allowedDomains` config field (comma-separated)
- Validate `Origin` header in `doPost` when configured
- Default: allow all origins (backwards compatible)
- When set, reject requests from non-matching origins with 403

---

## Section 3: Marketplace Requirements

### 3.1 Google Cloud Project Setup

- Create GCP project linked to the Apps Script
- Configure OAuth consent screen (External, with scopes from manifest)
- Scopes already declared in appsscript.json:
  - `script.external_request` — to call AI APIs
  - `spreadsheets` — to create config/logs/leads/knowledge sheets
  - `script.container.ui` — to show sidebar
  - `script.scriptapp` — to get web app URL
- Submit for Google OAuth verification
- Add privacy policy and terms of service URLs to consent screen

### 3.2 Store Listing Assets

**Icon:**
- 128x128 PNG
- Recognizable brand mark (chat bubble + AI motif)
- Must work at small sizes

**Screenshots (1280x800 or 640x400 PNG, 3-5 recommended):**
1. Setup tab showing provider selection
2. Test Chat in action with a conversation
3. Deploy tab with generated embed code
4. Widget rendered on a sample website

**Listing copy:**
- **Short description** (132 chars max): "Add a customizable AI chatbot to any website in minutes. No coding required."
- **Full description**: Feature highlights, use cases, setup steps, supported providers
- **Category**: Productivity
- **Language**: English

### 3.3 Privacy Policy

Required sections:
- What data we collect (chat messages, leads, config settings)
- How we store it (Google Sheets, PropertiesService within user's own spreadsheet)
- Third-party services (AI providers — messages sent to their APIs per their terms)
- User rights (delete data by deleting sheets or uninstalling add-on)
- No data shared with third parties beyond the selected AI provider
- Host publicly (GitHub Pages, Netlify, etc.)

### 3.4 Terms of Service

Required sections:
- Usage terms and acceptable use
- API key responsibility (user provides their own key, responsible for costs)
- Liability limitations
- Modifications notice
- Host alongside privacy policy

---

## Section 4: UX Polish

### 4.1 First-Run Experience

- Detect if config is at defaults (no API key saved)
- Show welcome banner: "Welcome! Let's set up your chatbot in 3 steps"
- Highlight API key field as step 1
- Add "(?)" help link next to API key explaining where to get one (links to provider-specific API key pages)

### 4.2 Empty States

- Knowledge tab: Already has "No entries yet" — sufficient
- Chat tab: Already shows welcome message — sufficient
- Deploy tab: Add hint when config isn't saved yet ("Save your configuration first to generate embed code")

### 4.3 Error Recovery

- Sidebar: Inline errors for common issues:
  - 401 → "Invalid API key. Check your key in the Setup tab."
  - 429 → "Rate limited. Wait a moment and try again."
  - 500 → "AI provider error. Try again or switch providers."
- Widget: Add retry button on failed messages
- Show "Check your API key" hint when AI returns auth error

### 4.4 Discoverability

- Add brief descriptions on Setup tab fields:
  - Temperature: "Higher = more creative, Lower = more focused"
  - Max Tokens: "Maximum length of AI responses"
  - Top P: "Controls response diversity"
- Small info text under system prompt: "Instructions that guide the AI's behavior"

---

## Implementation Order

1. **Security hardening** (rate limiting, input sanitization, API key protection) — highest priority
2. **Marketplace assets** (privacy policy, terms, store listing copy) — blocker
3. **UX polish** (first-run, error recovery, discoverability) — quality
4. **GCP setup & submission** (OAuth consent, verification) — final step
