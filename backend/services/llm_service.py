import json
import httpx
from typing import AsyncGenerator
import logging

logger = logging.getLogger("wildcardstudio.llm")

KOBOLD_STREAM_URL = "http://host.docker.internal:5001/api/extra/generate/stream"

async def stream_kobold_generation(prompt: str, max_length: int = 512, temperature: float = 0.7) -> AsyncGenerator[str, None]:
    payload = {
        "prompt": prompt,
        "max_context_length": 4096,
        "max_length": max_length,
        "temperature": temperature,
        "top_p": 0.9,
    }
    
    async with httpx.AsyncClient() as client:
        try:
            async with client.stream("POST", KOBOLD_STREAM_URL, json=payload, timeout=60.0) as response:
                if response.status_code != 200:
                    error_detail = await response.aread()
                    yield f"data: {json.dumps({'error': f'KoboldCPP Error: {response.status_code}', 'detail': error_detail.decode()})}\n\n"
                    return
                
                async for line in response.aiter_lines():
                    if line.startswith("data:"):
                        yield f"{line}\n\n"
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to KoboldCPP: {e}")
            yield f"data: {json.dumps({'error': f'Failed to connect to KoboldCPP: {str(e)}'})}\n\n"
