from typing import Optional, List

class LoopDetector:
    def __init__(
        self,
        max_tokens: int = 3000,          # hard token ceiling (approx 12000 chars)
        repetition_window: int = 1000,   # chars to check for repeat (increased to capture longer loops)
        repetition_threshold: int = 4,   # how many times a phrase repeats = loop
        min_phrase_len: int = 20,        # ignore short phrases
    ):
        self.max_tokens = max_tokens
        self.repetition_window = repetition_window
        self.repetition_threshold = repetition_threshold
        self.min_phrase_len = min_phrase_len
        
        self.thought_buffer = ""
        self.content_buffer = ""

    def feed_thought(self, text: str) -> Optional[str]:
        """Returns an abort reason string if a loop is detected, else None."""
        self.thought_buffer += text
        
        # 1. Token Ceiling Check
        # Approximate tokens as chars / 4
        if len(self.thought_buffer) / 4 > self.max_tokens:
            return f"Max thinking tokens exceeded ({len(self.thought_buffer) // 4} > {self.max_tokens})"
            
        # 2. Line Repetition Check (Specific to thinking traces)
        # We check the last 50 lines for repetition of the current line
        if "\n" in self.thought_buffer:
            lines = self.thought_buffer.splitlines()
            if lines:
                # Only check if we have enough lines and the last one is substantial
                recent_lines = lines[-50:]
                last_line = recent_lines[-1].strip()
                
                if len(last_line) > 10: # Ignore short lines
                    count = recent_lines.count(last_line)
                    # Use a stricter threshold for exact line matches
                    if count >= 4:
                        return f"Line repeated {count} times in thinking trace: '{last_line[:30]}...'"

        # 3. Phrase Repetition Check (Sliding Window)
        return self._check_repetition(self.thought_buffer)

    def feed_content(self, text: str) -> Optional[str]:
        """Returns an abort reason string if a loop is detected, else None."""
        self.content_buffer += text
        
        # Phrase Repetition Check
        return self._check_repetition(self.content_buffer)

    def _check_repetition(self, buffer_text: str) -> Optional[str]:
        # Only check the window at the end
        window = buffer_text[-self.repetition_window:]
        if len(window) < self.min_phrase_len * 2:
            return None
            
        # Check if the END of the window repeats a pattern found earlier in the window
        # We iterate through possible phrase lengths ending at the current position
        
        # Limit candidate length to avoid performance hit on large windows
        # But we need to catch long phrases too.
        # Max candidate length is window/2 (since it needs to appear at least twice)
        max_len = len(window) // 2
        
        # We start checking from the longest possible phrase (most significant loop) down to min_phrase_len
        # Actually, usually we want to catch the smallest repeating unit?
        # "abc abc abc" -> "abc" repeats 3 times. "abc abc" repeats 1 time (overlapping).
        # We count non-overlapping.
        
        # Let's check a few candidate lengths from the end
        for length in range(self.min_phrase_len, max_len + 1):
            candidate = window[-length:]
            # Count occurrences in the window
            count = window.count(candidate)
            if count >= self.repetition_threshold:
                return f"Phrase repeated {count} times: '{candidate[:20]}...'"
                
        return None

    def total_thought_tokens(self) -> int:
        """Rough token count (chars / 4)."""
        return len(self.thought_buffer) // 4
