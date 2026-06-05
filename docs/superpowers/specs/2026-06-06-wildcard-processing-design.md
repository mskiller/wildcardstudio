# Design Spec: Wildcard Processing & Tester

## Goal
Implement a server-side wildcard and brace variant parser, integrate it into the Image Generation page for live preview and generation, build an interactive wildcard tester in the Generator page, and implement three UX improvements (Autocomplete, Syntax Highlighting, and Batch Processing).

## Proposed Changes

### 1. Backend: Recursive Wildcard Processor (`backend/services/wildcard_processor.py`)
- **Wildcard Resolution (`__name__`)**:
  - Regex search for `__([A-Za-z0-9_./\\-]+)__`.
  - Match name against `WildcardFile` (by path without extension, or by filename without extension).
  - Pick a random entry from the file's `WildcardEntry` records using weighted random selection (`random.choices`).
  - Keep original `__wildcard__` reference if not found in database.
- **Brace Variant Resolution (`{option1|option2}`)**:
  - Regex search for `{([^{}]+)}`.
  - Parse choice counts (`{2$$a|b|c}` -> choose 2, or `{1-2$$a|b|c}` -> choose random between 1 and 2).
  - Randomly select elements and join with `, `.
- **Recursive Parsing**:
  - Run the parser in a loop (up to max depth 5) to resolve wildcards nested inside other wildcards.

### 2. Backend API: Endpoints Integration
- **New Endpoint**: `POST /generator/process-prompt`
  - Request: `{ prompt: str, count: int = 1 }`
  - Response: `{ original: str, processed: List[str] }`
- **Generation Endpoint Update**: `POST /generation/txt2img`
  - Automatically process the prompt using `process_prompt` before calling ComfyUI or SD-Forge.
  - Store the original wildcard-rich prompt in the `GenerationHistory.prompt` field and the resolved prompt inside the `GenerationHistory.metadata_json` under request metadata.

### 3. Frontend: Generator Page Tabs & Tester UI (`GeneratorPage.tsx`)
- Add a tabs header at the top of the Generator page:
  - **Créateur de Wildcard**: Displays the existing form to create and write wildcard files.
  - **Testeur de Wildcards**: Displays a new test bench:
    - Textarea for writing prompt template.
    - Variation count selector (number input, 1-10).
    - "Tester" button.
    - **Results Panel**: Lists the generated variations, each with a copy button.
    - **Analysis Panel**: Lists detected wildcards, highlighting whether they exist in the DB (🟢) or are unknown (🔴).

### 4. Frontend: Live Preview in Image Generation (`ImageGenerationPage.tsx`)
- Add a collapsible **"Prompt Traité (Aperçu)"** section below the prompt inputs.
- Automatically (debounced by 300ms) call `/generator/process-prompt` when the prompt changes.
- Display the processed prompt in a read-only monospace container.
- Include actions:
  - 🔄 **Régénérer**: Call the API to fetch a new random draw.
  - 📋 **Appliquer**: Replace the prompt input with the preview text.

### 5. Frontend: Interactive Autocomplete for Prompts (Update #1)
- Fetch available wildcards list on mount.
- Display a floating autocomplete menu when typing `__` in prompt fields.
- Filter as user types, select with `Enter`/`Tab`/click.

### 6. Frontend: Syntax Highlighting for Prompts (Update #2)
- Highlight wildcard references (e.g. `__color__` in cyan) and curly braces (e.g. `{variant}` in orange) using a synchronized overlay behind a transparent textarea.

## Verification Plan

### Automated Tests
- Run backend tests using `pytest` (e.g., `pytest backend/tests/test_wildcard_processor.py`).

### Manual Verification
- Test tabs toggle on the Generator page.
- Type prompt with wildcards in the Tester tab, select 5 variations, click "Tester", and verify different variations list out.
- Type prompt with wildcards in the Image Generation page, verify live processed preview appears.
- Click "Régénérer" to see a new draw, and "Appliquer" to verify it replaces the input text.
- Verify the autocomplete suggestions show up when typing `__`.
- Verify wildcards and braces are highlighted with different colors.
