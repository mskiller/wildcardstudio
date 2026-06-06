# Weighted Wildcards and Persistent ComfyUI Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly resolve weighted options (e.g., `{10::red|1::blue}`) in wildcard prompts, stripping the weight prefix from the final prompt, and persist ComfyUI capabilities on the frontend so switching tabs doesn't disconnect.

**Architecture:** Update backend wildcard brace resolution to parse option weights and delimiters, applying a weighted selection algorithm. Update frontend image generation page to store and load capability metadata from `window.localStorage` and silently verify connection on mount.

**Tech Stack:** Python (SQLModel, pytest), React (TypeScript, LocalStorage)

---

### Task 1: Backend Weighted Braces and Custom Delimiters

**Files:**
- Modify: [wildcard_processor.py](file:///j:/wildcardstudio/backend/services/wildcard_processor.py)
- Test: [test_wildcard_processor.py](file:///j:/wildcardstudio/backend/tests/test_wildcard_processor.py)

- [ ] **Step 1: Write the failing tests**
  Add the following test functions to `backend/tests/test_wildcard_processor.py`:
  ```python
  def test_resolve_braces_weights():
      # Test weighted selection: 10::red is selected and 0::blue is never selected
      for _ in range(50):
          res = resolve_braces("{10::red|0::blue}")
          assert res == "red"
          
      # Test fallback/default weights
      res = resolve_braces("{green}")
      assert res == "green"

  def test_resolve_braces_complex_delimiter():
      # Test {count$$delimiter$$options} syntax
      res = resolve_braces("{2$$ and $$red|red}")
      assert res == "red and red"
  ```

- [ ] **Step 2: Run tests to verify they fail**
  Run: `docker compose exec backend python -m pytest tests/test_wildcard_processor.py -v`
  Expected: FAIL / Errors on `test_resolve_braces_weights` and `test_resolve_braces_complex_delimiter`

- [ ] **Step 3: Modify resolve_braces to support weights and custom delimiters**
  Update the `resolve_braces` function in `backend/services/wildcard_processor.py` to:
  ```python
  def resolve_braces(text: str) -> str:
      iterations = 0
      while iterations < 100:
          match = BRACE_PATTERN.search(text)
          if not match:
              break
          inner = match.group(1)
          separator = ", "
          count_val = 1
          
          if "$$" in inner:
              parts = inner.split("$$")
              if len(parts) >= 3:
                  prefix = parts[0]
                  separator = parts[1]
                  options_str = "$$".join(parts[2:])
              else:
                  prefix = parts[0]
                  options_str = parts[1]
              
              options = options_str.split("|")
              if "-" in prefix:
                  try:
                      low, high = map(int, prefix.split("-"))
                      count_val = random.randint(low, high)
                  except ValueError:
                      count_val = 1
              else:
                  try:
                      count_val = int(prefix)
                  except ValueError:
                      count_val = 1
          else:
              options = inner.split("|")
              
          if not options or count_val <= 0:
              replacement = ""
          else:
              # Parse weights (e.g. "2::option" or "option")
              parsed_options = []
              weights = []
              for opt in options:
                  if "::" in opt:
                      parts_opt = opt.split("::", 1)
                      try:
                          w = float(parts_opt[0].strip())
                          v = parts_opt[1]
                          parsed_options.append(v)
                          weights.append(w)
                      except ValueError:
                          parsed_options.append(opt)
                          weights.append(1.0)
                  else:
                      parsed_options.append(opt)
                      weights.append(1.0)
                      
              # Normalize weights
              total_w = sum(weights)
              if total_w <= 0:
                  weights = [1.0] * len(weights)
                  
              count_val = min(count_val, len(parsed_options))
              
              if count_val >= len(parsed_options):
                  chosen = list(parsed_options)
                  random.shuffle(chosen)
              else:
                  # Weighted sample without replacement
                  temp_options = list(parsed_options)
                  temp_weights = list(weights)
                  chosen = []
                  for _ in range(count_val):
                      total_temp_w = sum(temp_weights)
                      if total_temp_w <= 0:
                          temp_weights = [1.0] * len(temp_weights)
                      idx = random.choices(range(len(temp_options)), weights=temp_weights, k=1)[0]
                      chosen.append(temp_options[idx])
                      temp_options.pop(idx)
                      temp_weights.pop(idx)
                      
              replacement = separator.join(chosen)
              
          text = text[:match.start()] + replacement + text[match.end():]
          iterations += 1
          
      return text
  ```

- [ ] **Step 4: Run tests to verify they pass**
  Run: `docker compose exec backend python -m pytest tests/test_wildcard_processor.py -v`
  Expected: PASS (including the new tests)

- [ ] **Step 5: Commit backend changes**
  ```bash
  git add backend/services/wildcard_processor.py backend/tests/test_wildcard_processor.py
  git commit -m "feat: implement weighted option braces and custom delimiters"
  ```

---

### Task 2: Frontend Persistent Capabilities Connection

**Files:**
- Modify: [ImageGenerationPage.tsx](file:///j:/wildcardstudio/frontend/src/pages/ImageGenerationPage.tsx)

- [ ] **Step 1: Update localStorage persistence state definitions**
  Modify the `PersistedGenerationState` interface and related state synchronization logic to include `capabilities`.
  At `PersistedGenerationState` declaration:
  ```typescript
  type PersistedGenerationState = {
    provider?: GenerationProvider
    baseUrl?: string
    prompt?: string
    negativePrompt?: string
    resolutionPreset?: ResolutionPresetId
    settings?: Partial<GenerationSettings>
    capabilities?: GenerationCapabilities
  }
  ```

- [ ] **Step 2: Load and persist capabilities in state hooks**
  Update capabilities state declaration in `ImageGenerationPage`:
  ```typescript
  const [capabilities, setCapabilities] = useState<GenerationCapabilities | null>(
    () => persisted.capabilities ?? null
  )
  ```
  Update the persistence `useEffect` hook to include capabilities in the localStorage payload and dependencies list:
  ```typescript
  useEffect(() => {
    const payload: PersistedGenerationState = {
      provider,
      baseUrl,
      prompt,
      negativePrompt,
      resolutionPreset,
      settings,
      capabilities: capabilities ?? undefined,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [provider, baseUrl, prompt, negativePrompt, resolutionPreset, settings, capabilities])
  ```

- [ ] **Step 3: Implement background connection refresh on mount**
  Add a mount `useEffect` to trigger a silent connection check in the background when the page mounts:
  ```typescript
  useEffect(() => {
    if (baseUrl.trim()) {
      generationApi.capabilities({ provider, base_url: baseUrl.trim() })
        .then((data) => {
          applyCapabilities(data)
        })
        .catch((err) => {
          console.error('Error auto-connecting to generation backend on mount:', err)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  ```

- [ ] **Step 4: Verify frontend code builds successfully**
  Run: `docker compose exec -w /app/frontend backend npm run build` (or verify from package scripts, let's verify compile errors)

- [ ] **Step 5: Commit frontend changes**
  ```bash
  git add frontend/src/pages/ImageGenerationPage.tsx
  git commit -m "feat: persist ComfyUI connection and capabilities state across tabs"
  ```
