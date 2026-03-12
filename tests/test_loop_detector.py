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
            
        # 4th time should trigger
        reason = detector.feed_thought(line + "\n")
        self.assertIsNotNone(reason)
        self.assertIn("Line repeated 4 times", reason)

    def test_phrase_repetition(self):
        detector = LoopDetector(repetition_threshold=4, min_phrase_len=5)
        
        phrase = "repeating phrase "
        # Feed it 3 times
        detector.feed_thought(phrase * 3)
        
        # 4th time
        reason = detector.feed_thought(phrase)
        self.assertIsNotNone(reason)
        self.assertIn("Phrase repeated 4 times", reason)

    def test_content_repetition(self):
        detector = LoopDetector(repetition_threshold=4, min_phrase_len=5)
        
        phrase = "content loop "
        detector.feed_content(phrase * 3)
        reason = detector.feed_content(phrase)
        self.assertIsNotNone(reason)
        self.assertIn("Phrase repeated 4 times", reason)

    def test_no_false_positive(self):
        detector = LoopDetector()
        text = "This is a normal thinking process. I am analyzing the data. The data suggests X. However, Y is also possible."
        reason = detector.feed_thought(text)
        self.assertIsNone(reason)

if __name__ == '__main__':
    unittest.main()
