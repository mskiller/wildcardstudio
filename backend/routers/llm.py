from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.llm_service import stream_kobold_generation

router = APIRouter()

class LLMRequest(BaseModel):
    prompt: str
    max_length: int = 512
    temperature: float = 0.7

@router.post("/stream")
async def stream_llm(request: LLMRequest):
    return StreamingResponse(
        stream_kobold_generation(request.prompt, request.max_length, request.temperature),
        media_type="text/event-stream"
    )
