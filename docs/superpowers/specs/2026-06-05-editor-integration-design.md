# Editor Integration: LLM Assistant & Generation Side-Panel

## Goal
Integrate KoboldCPP for streaming prompt assistance and ComfyUI for direct image generation into the `EditorPage` workflow via a resizable side-panel.

## Architecture & Components

### 1. Frontend Layout & Components
*   **Location:** `j:\wildcardstudio\frontend\src\pages\EditorPage.tsx`
*   **Changes:**
    *   Wrap the `WildcardEditor` component inside a resizable split pane (e.g., using `react-split` or standard CSS flex/grid resizing).
    *   Introduce a new component `AssistantPanel.tsx` in `j:\wildcardstudio\frontend\src\components\editor\`.
*   **AssistantPanel UI:**
    *   **Tabs:** Two main tabs: "Assistant" (LLM) and "Generation" (ComfyUI).
    *   **Assistant Tab:** Contains a chat history view, an input field for instructions (e.g., "rewrite to be more cyberpunk"), and buttons to "Apply to Editor" or "Insert at Cursor".
    *   **Generation Tab:** Displays a progress bar indicating ComfyUI rendering status and a gallery for the generated image result.

### 2. LLM Streaming Integration (KoboldCPP)
*   **Backend:** Create a new route `j:\wildcardstudio\backend\routers\llm.py` (and corresponding service `llm_service.py`).
    *   Endpoint: `POST /api/llm/stream`
    *   Logic: Connects to the KoboldCPP endpoint (`http://localhost:5001/api/v1/generate`) and proxies the response back to the frontend using Server-Sent Events (SSE).
*   **Frontend Data Flow:** `AssistantPanel` uses native `EventSource` or `fetch` stream reader to consume the SSE and update the chat UI in real-time.

### 3. Image Generation Integration (ComfyUI)
*   **Backend:** Extend `j:\wildcardstudio\backend\routers\generation.py` and `j:\wildcardstudio\backend\services\generation_connector.py`.
    *   Add an endpoint `POST /api/generation/trigger-from-editor` that accepts a raw prompt string from the editor.
    *   Inject the prompt into the default ComfyUI workflow format and send it to ComfyUI (`http://localhost:8188`).
    *   Return the `job_id` or `prompt_id`.
*   **Frontend Data Flow:** `EditorPage` toolbar adds a "Generate via ComfyUI" button. Clicking it sends the editor content to the API, switches the `AssistantPanel` to the "Generation" tab, and begins polling the job status.

## Data Flow & Error Handling
*   **LLM Errors:** If KoboldCPP is unreachable, the backend returns a 503 Service Unavailable, and the frontend displays a localized error message in the chat panel ("KoboldCPP is not running or unreachable").
*   **ComfyUI Errors:** If ComfyUI fails to generate or is offline, the generation tab displays a visual error indicator and stops polling.
*   **Concurrency:** The user should be able to continue typing in the `WildcardEditor` while the LLM streams or the image generates in the background.

## Out of Scope
*   Node-based workflow editing.
*   Inline code-completion (GitHub Copilot style) streaming directly into the CodeMirror instance (opted for Side-Panel approach instead to minimize complexity and ensure stability).
