import os
import re
import random
import math
from typing import List
from sqlmodel import Session, select
from sqlalchemy import func
from models.wildcard import WildcardFile, WildcardEntry

WILDCARD_PATTERN = re.compile(r"__([A-Za-z0-9_./\\*%-]+)__")
BRACE_PATTERN = re.compile(r"\{([^{}]+)\}")

def resolve_wildcard(session: Session, wildcard_name: str) -> str:
    name_clean = wildcard_name.strip().lower().replace("\\", "/")
    
    # 1. Search by exact wildcard_path in WildcardEntry (case-insensitive via NOCASE collation index or LIKE glob)
    if "*" in name_clean:
        like_pattern = name_clean.replace("*", "%")
        entries = session.exec(
            select(WildcardEntry).where(
                (WildcardEntry.wildcard_path.like(like_pattern)) |
                (WildcardEntry.wildcard_path.like(f"%/{like_pattern}"))
            )
        ).all()
    else:
        entries = session.exec(
            select(WildcardEntry).where(WildcardEntry.wildcard_path.collate("NOCASE") == name_clean)
        ).all()
    
    # 2. Suffix match where wildcard_path ends with "/" + name_clean and starts with file's base name
    if not entries:
        file_paths = session.exec(select(WildcardFile.path)).all()
        candidate_paths = []
        for fp in file_paths:
            file_base = os.path.splitext(fp)[0].lower()
            candidate_paths.append(f"{file_base}/{name_clean}")
            
        entries = session.exec(
            select(WildcardEntry).where(WildcardEntry.wildcard_path.collate("NOCASE").in_(candidate_paths))
        ).all()

    # 3. Fallback to existing file-based resolution (for flat files / whole-file matching)
    if not entries:
        candidates = [
            name_clean,
            name_clean + ".yaml",
            name_clean + ".yml",
            name_clean + ".txt",
        ]
        
        matching_file = session.exec(
            select(WildcardFile).where(WildcardFile.path.in_(candidates))
        ).first()
        
        if not matching_file:
            matching_file = session.exec(
                select(WildcardFile).where(func.lower(WildcardFile.path).in_(candidates))
            ).first()
        
        if not matching_file:
            matching_file = session.exec(
                select(WildcardFile).where(func.lower(WildcardFile.filename).in_(candidates))
            ).first()
            
        if not matching_file:
            matching_file = session.exec(
                select(WildcardFile).where(func.lower(WildcardFile.path).contains(name_clean))
            ).first()
                    
        if not matching_file:
            return f"__{wildcard_name}__"
            
        entries = session.exec(
            select(WildcardEntry).where(WildcardEntry.file_id == matching_file.id)
        ).all()
        
    if not entries:
        return ""
        
    weights = [e.weight for e in entries]
    total_weight = sum(weights)
    if total_weight <= 0:
        weights = [1.0] * len(entries)
        
    chosen = random.choices(entries, weights=weights, k=1)[0]
    return chosen.content

def resolve_braces(text: str) -> str:
    iterations = 0
    while iterations < 100:
        match = BRACE_PATTERN.search(text)
        if not match:
            break
        inner = match.group(1)
        separator = ", "
        count_val = 1
        
        parts = inner.split("$$")
        if len(parts) >= 3:
            prefix = parts[0]
            separator = parts[1]
            options_str = "$$".join(parts[2:])
            options = options_str.split("|")
            has_count = True
        elif len(parts) == 2:
            prefix = parts[0]
            separator = ", "
            options_str = parts[1]
            options = options_str.split("|")
            has_count = True
        else:
            options = inner.split("|")
            has_count = False
            
        if has_count:
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
        
        if not options or count_val <= 0:
            replacement = ""
        else:
            # Parse weights for each option
            parsed_options = []
            for opt in options:
                opt_parts = opt.split("::", 1)
                if len(opt_parts) == 2:
                    weight_str, opt_val = opt_parts
                    try:
                        weight = float(weight_str)
                        if not math.isfinite(weight):
                            weight = 0.0
                        elif weight < 0:
                            weight = 0.0
                    except ValueError:
                        weight = 1.0
                        opt_val = opt
                else:
                    weight = 1.0
                    opt_val = opt
                parsed_options.append((opt_val, weight))
                
            count_val = min(count_val, len(parsed_options))
            
            # Perform weighted sampling without replacement
            pool = list(parsed_options)
            chosen = []
            for _ in range(count_val):
                if not pool:
                    break
                total_weight = sum(item[1] for item in pool)
                if total_weight <= 0:
                    weights = [1.0] * len(pool)
                else:
                    weights = [item[1] for item in pool]
                chosen_idx = random.choices(range(len(pool)), weights=weights, k=1)[0]
                chosen_item = pool.pop(chosen_idx)
                chosen.append(chosen_item[0])
                
            replacement = separator.join(chosen)
            
        text = text[:match.start()] + replacement + text[match.end():]
        iterations += 1
        
    return text

def process_prompt(session: Session, prompt: str, max_depth: int = 5) -> str:
    current_prompt = prompt
    for _ in range(max_depth):
        has_changes = False
        
        # 1. Resolve wildcards
        matches = list(WILDCARD_PATTERN.finditer(current_prompt))
        if matches:
            for match in reversed(matches):
                wildcard_name = match.group(1)
                replacement = resolve_wildcard(session, wildcard_name)
                current_prompt = current_prompt[:match.start()] + replacement + current_prompt[match.end():]
            has_changes = True
            
        # 2. Resolve braces
        if "{" in current_prompt and "}" in current_prompt:
            before = current_prompt
            current_prompt = resolve_braces(current_prompt)
            if current_prompt != before:
                has_changes = True
                
        if not has_changes:
            break
            
    return current_prompt
