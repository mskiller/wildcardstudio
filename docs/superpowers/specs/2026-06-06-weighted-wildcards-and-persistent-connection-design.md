# Dynamic Prompt Weighted Braces and Persistent ComfyUI Connection

This specification details the design for resolving weighted brace options (the `N::` prefix) and persistent ComfyUI/SD-Forge capabilities connection status across tab changes in the Wildcard Studio frontend.

## Proposed Changes

### Backend: Dynamic Prompts Brace Resolution

We will modify [wildcard_processor.py](file:///j:/wildcardstudio/backend/services/wildcard_processor.py) in the `resolve_braces` function.

1. **Delimiter Parsing (`$$`):**
   Improve the parsing of `$$` to support:
   - `{count$$delimiter$$options}` (e.g. `{2$$ and $$red|blue}`)
   - `{count$$options}` (e.g. `{2$$red|blue}`)
   - `{options}` (e.g. `{red|blue}`)

2. **Weight Parsing (`::`):**
   - For each candidate option inside the braces, check if it contains `::`.
   - If it does, split at the first occurrence of `::`.
   - Parse the left part as a float `weight`. If parsing fails, fall back to a weight of `1.0` and treat the entire option string as the value.
   - Parse the right part as the option `value`.
   - If it does not contain `::`, assign it a default weight of `1.0`.

3. **Weighted Selection:**
   - If `count` is 1 (default), perform a weighted choice using `random.choices` with the parsed weights.
   - If `count` is greater than 1, perform weighted sampling without replacement by iteratively selecting one option using `random.choices`, saving it, removing it from the choices pool, and repeating.
   - Join selected options using the parsed separator (defaults to `", "`).
   - Weights will be stripped in the final output since we only output the chosen option values.

---

### Frontend: Persistent Connection

We will update [ImageGenerationPage.tsx](file:///j:/wildcardstudio/frontend/src/pages/ImageGenerationPage.tsx) to cache the capability structure.

1. **LocalStorage State Integration:**
   - Extend `PersistedGenerationState` interface to include `capabilities?: GenerationCapabilities`.
   - Update `readPersistedState` to read `capabilities` if present.
   - Update `ImageGenerationPage` to initialize the `capabilities` state using `persisted.capabilities ?? null`.
   - Update the state synchronization `useEffect` to save the `capabilities` state to `window.localStorage` when it changes.

2. **Silent Mount Reconnection:**
   - Add a `useEffect` on page mount (empty dependency array) that calls `generationApi.capabilities` silently.
   - On success, invoke `applyCapabilities(data)` to refresh the list of models, samplers, etc.
   - Do not display toast notifications for this background verification to keep the UI clean.

---

## Verification Plan

### Automated Tests
We will add new tests to [test_wildcard_processor.py](file:///j:/wildcardstudio/backend/tests/test_wildcard_processor.py):
- `test_resolve_braces_weights`: Verify options with weights (e.g. `{10::red|1::blue}`) choose `red` significantly more often than `blue`, and verify the weight prefix `10::` is stripped.
- `test_resolve_braces_complex_delimiter`: Verify `{2$$ and $$red|blue|yellow}` resolves to combinations like `red and blue` or `blue and yellow` with custom delimiters.
- Run `docker compose exec backend python -m pytest` to run the test suite.

### Manual Verification
- Launch the application, connect to ComfyUI, verify models populate.
- Switch to another tab (e.g., tags or library), return to the image generation tab, and verify the connection badge immediately shows "Connecté" and the dropdown values remain populated.
- Use a prompt containing weighted options, e.g. `{10::polka_dot|0::stripes}`, and click "Régénérer" on the processed prompt preview to verify the output resolves correctly without any `10::` weight prefixes.
