"""F02 · Comparateur de prompts"""
from fastapi import APIRouter
from pydantic import BaseModel
from services.diff_engine import compute_diff

router = APIRouter()


class DiffRequest(BaseModel):
    left: str
    right: str
    mode: str = "auto"


@router.post("/diff")
def diff_prompts(req: DiffRequest):
    return compute_diff(req.left, req.right, req.mode)


@router.post("/similarity")
def similarity(req: DiffRequest):
    result = compute_diff(req.left, req.right, req.mode)
    return {
        "similarity_jaccard": result["similarity_jaccard"],
        "similarity_levenshtein": result["similarity_levenshtein"],
        "common_count": len(result["common"]),
        "left_only_count": len(result["left_only"]),
        "right_only_count": len(result["right_only"]),
    }
