import os
import re
import random
from typing import List
from sqlmodel import Session, select
from models.wildcard import WildcardFile, WildcardEntry

WILDCARD_PATTERN = re.compile(r"__([A-Za-z0-9_./\\-]+)__")
BRACE_PATTERN = re.compile(r"\{([^{}]+)\}")

def resolve_wildcard(session: Session, wildcard_name: str) -> str:
    name_clean = wildcard_name.strip().lower().replace("\\", "/")
    
    # Query all WildcardFiles to find the best match
    files = session.exec(select(WildcardFile)).all()
    matching_file = None
    
    # 1. Exact relative path match without extension
    for f in files:
        path_no_ext, _ = os.path.splitext(f.path.lower())
        if path_no_ext == name_clean:
            matching_file = f
            break
            
    # 2. Filename match without extension
    if not matching_file:
        for f in files:
            filename_no_ext, _ = os.path.splitext(f.filename.lower())
            if filename_no_ext == name_clean:
                matching_file = f
                break
                
    # 3. Partial path match
    if not matching_file:
        for f in files:
            if name_clean in f.path.lower():
                matching_file = f
                break
                
    if not matching_file:
        # Keep original reference if not found
        return f"__{wildcard_name}__"
        
    # Query all entries for this file
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
        
        parts = inner.split("$$", 1)
        if len(parts) == 2:
            prefix, options_str = parts
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
            
        if not options:
            replacement = ""
        else:
            count_val = min(count_val, len(options))
            chosen = random.sample(options, count_val) if count_val > 1 else [random.choice(options)]
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
