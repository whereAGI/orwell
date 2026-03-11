import re
from typing import List, Tuple, Optional, Dict, Any

class ThinkingStreamParser:
    """
    A robust stream parser that separates thinking/reasoning content from standard content.
    Updated for March 2026 standards:
    - Handles structured reasoning objects (Anthropic/Gemini 3)
    - Handles specialized API fields (OpenAI o3/GPT-5, OpenRouter)
    - Handles multiple legacy tag formats (DeepSeek R1, Ollama)
    """
    
    def __init__(self, start_tags: List[str] = None, end_tags: List[str] = None):
        self.start_tags = start_tags or [
            "<think>", "[THOUGHT]", "<thought>", "<reasoning>", 
            "<|tool_call_start|>", # Liquid LFM-2 tool calls often contain reasoning
            "<thinking>",
            "[REASONING]", "[THINK]", "[thinking]"
        ]
        self.end_tags = end_tags or [
            "</think>", "[/THOUGHT]", "</thought>", "</reasoning>",
            "<|tool_call_end|>", 
            "</thinking>",
            "[/REASONING]", "[/THINK]", "[/thinking]"
        ]
        self.buffer = ""
        self.in_think_block = False
        
    def process(self, content_token: str = "", reasoning_token: str = "", extra_fields: Dict[str, Any] = None):
        """
        Process a chunk of tokens.
        
        Args:
            content_token: The standard content token from delta.content
            reasoning_token: The explicit reasoning token from delta.reasoning, delta.reasoning_content, or other fields
            extra_fields: Optional dictionary containing complex reasoning objects (e.g. from Anthropic/Gemini)
            
        Yields:
            (type, text) tuples where type is "content" or "thought"
        """
        # 1. Handle specialized reasoning fields (Priority 1)
        # 2026 Standard: Explicit separation via API fields
        if reasoning_token:
            yield ("thought", reasoning_token)
            
        # 2. Handle structured reasoning objects (Anthropic Extended Thinking / Gemini 3)
        if extra_fields:
            # Anthropic 'thinking_delta'
            if "thinking_delta" in extra_fields and extra_fields["thinking_delta"]:
                 yield ("thought", extra_fields["thinking_delta"])
            
            # Generic 'reasoning_details' (OpenRouter unified)
            if "reasoning_details" in extra_fields and extra_fields["reasoning_details"]:
                 # Some providers might send this as a string or object
                 details = extra_fields["reasoning_details"]
                 if isinstance(details, str):
                     yield ("thought", details)

        if not content_token:
            return

        # 3. Handle mixed content/thinking stream via tags (Legacy / Open Models)
        self.buffer += content_token
        
        while self.buffer:
            if not self.in_think_block:
                # Look for any start tag
                found_tag, match_index = self._find_first_tag(self.buffer, self.start_tags)
                
                if found_tag:
                    # Found a complete tag
                    # Yield everything before the tag as content
                    if match_index > 0:
                        yield ("content", self.buffer[:match_index])
                    
                    # Switch state
                    self.in_think_block = True
                    self.buffer = self.buffer[match_index + len(found_tag):]
                else:
                    # No complete tag found. 
                    # Check if the end of the buffer matches the start of ANY start tag
                    if self._ends_with_partial_tag(self.buffer, self.start_tags):
                        # We are waiting for more tokens to complete the tag
                        break
                    else:
                        # No tag, yield all buffer
                        yield ("content", self.buffer)
                        self.buffer = ""
            
            else:
                # Inside thinking block. Look for any end tag
                found_tag, match_index = self._find_first_tag(self.buffer, self.end_tags)
                
                if found_tag:
                    # Found closing tag
                    # Yield everything before tag as thought
                    if match_index > 0:
                        yield ("thought", self.buffer[:match_index])
                    
                    # Switch state
                    self.in_think_block = False
                    self.buffer = self.buffer[match_index + len(found_tag):]
                else:
                    # Check for partial closing tag
                    if self._ends_with_partial_tag(self.buffer, self.end_tags):
                        break
                    else:
                        yield ("thought", self.buffer)
                        self.buffer = ""

    def flush(self):
        """
        Flush any remaining buffer.
        """
        if self.buffer:
            if self.in_think_block:
                yield ("thought", self.buffer)
            else:
                yield ("content", self.buffer)
            self.buffer = ""

    def _find_first_tag(self, text: str, tags: List[str]) -> Tuple[Optional[str], int]:
        """Find the earliest occurrence of any tag in the text."""
        best_tag = None
        best_index = -1
        
        for tag in tags:
            idx = text.find(tag)
            if idx != -1:
                if best_index == -1 or idx < best_index:
                    best_index = idx
                    best_tag = tag
        
        return best_tag, best_index

    def _ends_with_partial_tag(self, text: str, tags: List[str]) -> bool:
        """Check if text ends with a partial prefix of any tag."""
        for tag in tags:
            # We check if the end of text matches the start of tag
            # We only care about partial matches (length 1 to len(tag)-1)
            # Full matches are handled by _find_first_tag
            for i in range(1, len(tag)):
                suffix = text[-i:]
                if tag.startswith(suffix):
                    return True
        return False
