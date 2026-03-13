import unittest
from orwell.loop_detector import LoopDetector

class TestLoopDetector(unittest.TestCase):
    def test_token_ceiling(self):
        detector = LoopDetector(max_tokens=10) # 40 chars
        
        # 39 chars
        reason = detector.feed_thought("a" * 39)
        self.assertIsNone(reason)
        
        # 41 chars
        reason = detector.feed_thought("aa")
        self.assertIsNotNone(reason)
        self.assertIn("Max thinking tokens exceeded", reason)

    def test_line_repetition(self):
        detector = LoopDetector()
        
        line = "This is a repeated line of sufficient length."
        
        # Feed 3 times
        for _ in range(3):
            reason = detector.feed_thought(line + "\n")
            self.assertIsNone(reason)
            
        # 4th time should trigger (default threshold is 4)
        reason = detector.feed_thought(line + "\n")
        self.assertIsNotNone(reason)
        self.assertIn("Line repeated 4 times", reason)

    def test_phrase_repetition(self):
        # We need a longer phrase now (min 60 chars by default, but we can override for test)
        # And threshold is 6 by default
        detector = LoopDetector(
            phrase_repetition_threshold=4, 
            min_phrase_len=20
        )
        
        phrase = "This is a repeating phrase that is long enough to trigger detection. "
        # Feed it 3 times
        detector.feed_thought(phrase * 3)
        
        # 4th time
        reason = detector.feed_thought(phrase)
        self.assertIsNotNone(reason)
        self.assertIn("Phrase repeated 4 times", reason)

    def test_content_repetition_ignored(self):
        # Content repetition should now be IGNORED
        detector = LoopDetector(
            phrase_repetition_threshold=4, 
            min_phrase_len=20
        )
        
        phrase = "This is a repeating content phrase that is long enough. "
        detector.feed_content(phrase * 10) # Even 10 times
        reason = detector.feed_content(phrase)
        self.assertIsNone(reason) # Should return None now

    def test_markdown_list_ignored(self):
        # Should ignore simple markdown lists due to whitespace stripping
        # This simulates a list where the PREFIX is repeated but content differs
        detector = LoopDetector(
            phrase_repetition_threshold=4, 
            min_phrase_len=15
        )
        
        # Construct a list with repeating prefix but different values
        # This checks if the PHRASE repetition logic catches the prefix
        lines = [
            "* Towing: 6000 lbs",
            "* Towing: 5000 lbs",
            "* Towing: 4000 lbs",
            "* Towing: 3000 lbs",
            "* Towing: 2000 lbs",
            "* Towing: 1000 lbs"
        ]
        content = "\n".join(lines)
        
        # Line repetition check won't trigger (lines differ)
        # Phrase repetition check shouldn't trigger on "* Towing: " because it's too short/stripped
        reason = detector.feed_thought(content)
        self.assertIsNone(reason)
        
    def test_long_loop_detected(self):
        # Genuine long loop
        detector = LoopDetector(
            phrase_repetition_threshold=4,
            min_phrase_len=20
        )
        
        loop_text = "*Wait, I need to ensure I don't use Output as a guarantee.* "
        content = loop_text * 4
        
        reason = detector.feed_thought(content)
        self.assertIsNotNone(reason)

    def test_no_false_positive(self):
        detector = LoopDetector()
        text = "This is a normal thinking process. I am analyzing the data. The data suggests X. However, Y is also possible."
        reason = detector.feed_thought(text)
        self.assertIsNone(reason)

if __name__ == '__main__':
    unittest.main()
