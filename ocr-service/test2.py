import sys
import traceback

class Logger(object):
    def __init__(self):
        self.terminal = sys.stdout
        self.log = open("trace.log", "w")
        sys.stdout = self
        sys.stderr = self

    def write(self, message):
        self.terminal.write(message)
        self.log.write(message)

    def flush(self):
        self.terminal.flush()
        self.log.flush()

sys.stdout = Logger()
sys.stderr = sys.stdout

print("Starting import...")
try:
    from paddleocr import PaddleOCR
    print("Import successful!")
except Exception as e:
    print("Exception during import:")
    traceback.print_exc()

print("Done.")
