"""Speech to text for voice messages, on this PC with Whisper (faster-whisper). Free, nothing leaves the PC.

The model downloads once (about 500 MB for "small") the first time someone sends a voice message, then
loads from disk. CPU with int8 is the default because it works everywhere; on an NVIDIA GPU with CUDA
libraries installed, WHISPER_DEVICE=cuda is faster.
"""

import io
import threading

from app.config import get_settings


class SpeechError(Exception):
    pass


class Transcriber:
    def __init__(self, model_size: str, device: str, compute_type: str, language: str | None):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.language = language or None  # None: Whisper detects the language
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                try:
                    self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)
                except Exception as e:  # download or GPU problems: say what to do
                    raise SpeechError(
                        f"Couldn't load the speech model '{self.model_size}' ({e}). The first time, it downloads "
                        "from huggingface.co, so the PC needs internet. For WHISPER_DEVICE=cuda the NVIDIA CUDA "
                        "libraries must be installed; WHISPER_DEVICE=cpu always works."
                    ) from e
        return self._model

    def transcribe(self, audio: bytes) -> str:
        model = self._load()
        try:
            segments, _ = model.transcribe(io.BytesIO(audio), language=self.language, beam_size=5, vad_filter=True)
            return " ".join(s.text.strip() for s in segments).strip()
        except Exception as e:
            raise SpeechError(f"Couldn't read that recording ({e}). Try recording again.") from e


_transcriber: Transcriber | None = None


def get_transcriber() -> Transcriber:
    """One shared model for the whole server (loading it takes a few seconds)."""
    global _transcriber
    if _transcriber is None:
        s = get_settings()
        _transcriber = Transcriber(s.whisper_model, s.whisper_device, s.whisper_compute_type, s.whisper_language)
    return _transcriber
