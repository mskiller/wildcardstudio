"""
Bidirectional conversion between Impact (ComfyUI) and Dynamic-Prompts (SD-Forge) syntax.
"""
import re
import yaml
from typing import List


def impact_to_dynamic(content: str, wildcard_name: str = "wildcard") -> str:
    """
    Convert Impact format (flat list) to Dynamic-Prompts YAML.
    Input: plain text or YAML list.
    Output: YAML with __name__: entries.
    """
    lines = []
    for line in content.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            lines.append(line)

    if not lines:
        return f"__{wildcard_name}__:\n  []\n"

    result = {f"__{wildcard_name}__": lines}
    return yaml.dump(result, allow_unicode=True, default_flow_style=False)


def dynamic_to_impact(content: str) -> str:
    """
    Convert Dynamic-Prompts YAML to Impact flat list.
    Extracts all entries from all keys.
    """
    try:
        data = yaml.safe_load(content)
    except yaml.YAMLError:
        return content

    entries = []
    if isinstance(data, dict):
        for key, values in data.items():
            if isinstance(values, list):
                for v in values:
                    if v is not None:
                        entries.append(str(v).strip())
    elif isinstance(data, list):
        entries = [str(v).strip() for v in data if v is not None]

    return "\n".join(entries)


def convert_inline_syntax(prompt: str, direction: str = "impact_to_dynamic") -> str:
    """
    Convert wildcard references within a prompt string.
    impact_to_dynamic: __wildcard__ → {__wildcard__}
    dynamic_to_impact: @include wildcard → __wildcard__
    """
    if direction == "impact_to_dynamic":
        # __name__ → {__name__}
        return re.sub(r"(__\w+__)", r"{\1}", prompt)
    else:
        # {__name__} → __name__
        result = re.sub(r"\{(__\w+__)\}", r"\1", prompt)
        # @include name → __name__
        result = re.sub(r"@include\s+(\w+)", r"__\1__", result)
        return result
