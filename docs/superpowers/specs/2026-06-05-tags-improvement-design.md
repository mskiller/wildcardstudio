# Design Spec: Tags Tab Improvements

## Goal
Improve the Tags page with selectable tags, prompt-building capabilities, Danbooru-style colors/categorization, advanced sorting/filtering, and seamless integration with the Generator page.

## Proposed Changes

### 1. Interactive Tag Selection & "Prompt Builder" Sidebar (Right Panel)
- Introduce a third column on the right side of the Tags tab.
- This panel acts as a temporary "Prompt Builder".
- Displays the current selection of tags as drag-and-drop sortable pills (or with arrow buttons for re-ordering).
- Includes two major actions:
  - **Envoyer au générateur**: Combines selected tags as a single comma-separated prompt, saves it to a shared store, and redirects the user to the `/generator` page.
  - **Copier**: Copies the comma-separated prompt to the clipboard.
  - **Vider**: Clears the selection.

### 2. Danbooru-style Color Coding & Styling
- Apply custom modern color themes (HSL colors) to tags based on their categories:
  - **subject**: Blue (General/Subject)
  - **character**: Green (Character)
  - **artist**: Red/Pink (Artist)
  - **style**: Purple (Style)
  - **nsfw**: Orange/Dark-red (NSFW)
  - Others (lighting, camera, quality, background): Custom secondary/warm accent colors.
- Interactive Tag states:
  - **Unselected**: Colored thin border, subtle text, hover glow.
  - **Selected**: Semi-transparent colored background fill, vibrant text, checkmark icon (`✓`) prefixed, and box-shadow glow.

### 3. Advanced Sorting and Filtering Controls
- Add a toolbar above the tag grid:
  - **Sort**: Usage Count (highest first, lowest first) or Alphabetical (A-Z, Z-A).
  - **Source Filter**: All, Custom Database (manually created), or Wildcard Index (extracted).
  - **Status Filter**: All, Selected only, Unselected only.

### 4. Tag Detail Tooltips
- On hover, display a tooltip with tag metadata:
  - Tag name and category colored accordingly.
  - Source type (e.g., "Manuel (Base de données)" or "Index (Fichiers wildcards)").
  - Usage count (e.g., "Utilisé 24 fois").
  - Aliases (comma-separated if aliases exist on the tag).

### 5. Generator Tab Integration
- Implement a shared Zustand store `useTagStore` to hold:
  - `selectedTags` (list of selected tags).
  - `pendingPromptForGenerator` (string).
- The "Générateur" tab will check for `pendingPromptForGenerator` on mount. If present, it will append it as a new entry, display a success toast, and clear the value.

## Verification Plan
- **Manual Verification**:
  - Test selecting tags, verify they show up in the right-side Prompt Builder.
  - Reorder tags and verify the order updates in real-time.
  - Click "Envoyer au générateur" and verify redirect and auto-filling in the generator list.
  - Verify Danbooru-style colors render correctly based on categories.
  - Verify hover tooltips display correct details and aliases.
