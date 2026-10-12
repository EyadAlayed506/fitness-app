"""Voice messages: the endpoint with a fake transcriber, and real decoding of the formats phones record."""

import io
import math

import av
import numpy as np
import pytest
from faster_whisper.audio import decode_audio

from app.main import app
from app.services import speech


class FakeTranscriber:
    def __init__(self, text="add a banana to breakfast", error=None):
        self.text, self.error, self.calls = text, error, []

    def transcribe(self, audio: bytes, prompt: str | None = None) -> str:
        self.calls.append(audio)
        self.prompts = [*getattr(self, "prompts", []), prompt]
        if self.error:
            raise speech.SpeechError(self.error)
        return self.text


@pytest.fixture
def fake(client):
    f = FakeTranscriber()
    app.dependency_overrides[speech.get_transcriber] = lambda: f
    return f


def upload(client, auth, data=b"fake-audio", name="voice.m4a"):
    return client.post("/api/assistant/transcribe", files={"audio": (name, data, "audio/m4a")}, headers=auth)


def test_voice_message_becomes_text(client, auth, fake):
    r = upload(client, auth)
    assert r.status_code == 200 and r.json() == {"text": "add a banana to breakfast"}
    assert fake.calls == [b"fake-audio"]
    # hands-free sends a hint (the wake word, exercise names) so Whisper spells them right
    r = client.post("/api/assistant/transcribe", files={"audio": ("v.webm", b"x", "audio/webm")},
                    data={"prompt": "Chat, Leg Press, Lat Pulldown."}, headers=auth)
    assert r.status_code == 200 and fake.prompts == [None, "Chat, Leg Press, Lat Pulldown."]


def test_empty_silent_or_failed_recordings(client, auth, fake):
    assert upload(client, auth, data=b"").status_code == 422
    fake.text = ""
    r = upload(client, auth)
    assert r.status_code == 422 and "didn't catch" in r.json()["detail"]
    fake.error = "Couldn't load the speech model"
    r = upload(client, auth)
    assert r.status_code == 503 and "speech model" in r.json()["detail"]


def test_needs_login(client, fake):
    assert client.post("/api/assistant/transcribe", files={"audio": ("v.m4a", b"x")}).status_code == 401


def _recording(fmt: str, codec: str, rate: int) -> bytes:
    buf = io.BytesIO()
    with av.open(buf, "w", format=fmt) as out:
        stream = out.add_stream(codec, rate=rate)
        stream.layout = "mono"
        t = np.arange(rate) / rate
        frame = av.AudioFrame.from_ndarray(
            (0.3 * np.sin(2 * math.pi * 440 * t)).astype(np.float32).reshape(1, -1), format="fltp", layout="mono"
        )
        frame.sample_rate = rate
        for packet in [*stream.encode(frame), *stream.encode(None)]:
            out.mux(packet)
    return buf.getvalue()


@pytest.mark.parametrize("fmt,codec,rate", [("mp4", "aac", 44100), ("webm", "libopus", 48000)])
def test_phone_and_browser_recordings_can_be_decoded(fmt, codec, rate):
    """Phones record AAC (.m4a), browsers Opus (.webm). Fails if PyAV and faster-whisper stop working together."""
    audio = decode_audio(io.BytesIO(_recording(fmt, codec, rate)), sampling_rate=16000)
    assert 15000 < len(audio) < 17500  # about one second at 16 kHz
