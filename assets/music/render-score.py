"""Render 'A Light Beyond / 远方的微光', an original, explicitly scored suite.

Offline only: Python + NumPy + SciPy, then FFmpeg/libmp3lame. No samples,
downloaded soundfonts, reference recordings, generative model, or random notes.
Usage: python assets/music/render-score.py /tmp/void-music
The score, timbres and synthetic space below are released under CC0-1.0.
"""
import json
import pathlib
import subprocess
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 32000
BPM = 80
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 48
N = round(BARS * BAR * SR)
out = pathlib.Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
mix = np.zeros((N, 2), dtype=np.float64)
events = []

# Two-bar voicings: smooth inner voices, ninths/suspensions, no dominant hammering.
chords = {
    'Dmaj9': [38, 57, 61, 64, 66],
    'Bm11': [35, 57, 61, 64, 66],
    'Gmaj9': [31, 54, 57, 59, 62],
    'Asus9': [33, 55, 59, 62, 64],
    'Em9': [40, 55, 59, 62, 66],
    'F#m7': [30, 57, 61, 64, 69],
    'D6/9': [38, 54, 59, 64, 69],
}
sections = [
    ('First light', ['Dmaj9', 'Bm11', 'Gmaj9', 'Asus9']),
    ('An answer across distance', ['D6/9', 'F#m7', 'Em9', 'Asus9']),
    ('Orbits', ['Bm11', 'Gmaj9', 'Dmaj9', 'Asus9']),
    ('Open horizon', ['Gmaj9', 'D6/9', 'Em9', 'Asus9']),
    ('The quiet surface', ['Bm11', 'F#m7', 'Gmaj9', 'Em9']),
    ('A light remembered', ['Dmaj9', 'Bm11', 'Gmaj9', 'Asus9']),
]
# Original four-bar phrases: (beat offset, MIDI pitch, held beats).
# Motif D-A-E-F# / E-B-A returns with different endings and orchestration.
phrases = [
    [(0, 74, 2), (3, 69, 1), (5, 76, 2.5), (8, 78, 3), (12, 76, 1.5), (14, 71, 1.5)],
    [(1, 69, 3), (5, 66, 2), (8, 67, 2), (11, 71, 1.5), (14, 69, 1.5)],
    [(0, 74, 2.5), (4, 76, 2), (7, 73, 2.5), (11, 69, 3)],
    [(1, 71, 2), (4, 74, 2), (8, 78, 3), (13, 76, 2)],
    [(0, 66, 3), (5, 69, 2), (8, 73, 3), (13, 71, 2)],
    [(1, 74, 3), (6, 71, 2), (10, 69, 4)],
    [(0, 79, 3), (4, 78, 2), (7, 74, 3), (12, 76, 3)],
    [(0, 78, 2), (3, 76, 2), (6, 74, 3), (11, 71, 2), (14, 69, 1)],
    [(2, 66, 4), (9, 69, 5)],
    [(1, 67, 3), (7, 71, 3), (12, 74, 3)],
    [(0, 74, 2), (3, 69, 1), (5, 76, 2.5), (8, 78, 3), (12, 76, 1.5), (14, 71, 1.5)],
    [(0, 69, 3), (5, 67, 2.5), (9, 64, 3), (13, 69, 2)],
]

def note(start, pitch, duration, voice, level, pan):
    tail = {'pad': 3.0, 'glass': 3.8, 'pulse': 1.7, 'bass': 2.0}[voice]
    count = round((duration + tail) * SR)
    t = np.arange(count) / SR
    f = 440 * 2 ** ((pitch - 69) / 12)
    if voice == 'pad':
        wave = sum(np.sin(2 * np.pi * f * h * t + 0.06 * np.sin(2*np.pi*0.13*t)) / h**2.3 for h in range(1, 6))
        wave += 0.25 * np.sin(2*np.pi*f*1.0018*t)
        env = np.minimum(t / 1.6, 1) * np.exp(-np.maximum(t-duration, 0) / 1.0)
    elif voice == 'glass':
        wave = np.sin(2*np.pi*f*t) + 0.23*np.exp(-t/1.1)*np.sin(2*np.pi*2*f*t)
        wave += 0.09*np.exp(-t/0.7)*np.sin(2*np.pi*3*f*t)
        env = (1-np.exp(-t/0.035)) * np.exp(-t/2.3) * np.exp(-np.maximum(t-duration, 0)/1.1)
    elif voice == 'pulse':
        wave = np.sin(2*np.pi*f*t) + 0.15*np.sin(2*np.pi*2*f*t)
        env = (1-np.exp(-t/0.025))*np.exp(-t/0.65)
    else:
        wave = np.sin(2*np.pi*f*t) + 0.18*np.sin(2*np.pi*2*f*t)
        env = np.minimum(t/0.65, 1)*np.exp(-np.maximum(t-duration, 0)/0.65)
    # All tails reach exact zero; wrap them onto the beginning for a cyclic mix.
    env *= np.minimum((count-1-np.arange(count))/(SR*0.12), 1)
    mono = wave * env * level
    stereo = mono[:, None] * np.array([np.cos((pan+1)*np.pi/4), np.sin((pan+1)*np.pi/4)])
    start_sample = round(start*SR) % N
    first = min(count, N-start_sample)
    mix[start_sample:start_sample+first] += stereo[:first]
    if first < count:
        mix[:count-first] += stereo[first:]
    events.append(dict(start=round(start, 4), midi=pitch, duration=round(duration, 4), voice=voice, level=level, pan=pan))

for s, (_, progression) in enumerate(sections):
    for c, symbol in enumerate(progression):
        at = (s*8+c*2)*BAR
        pitches = chords[symbol]
        note(at, pitches[0], 2*BAR-0.25, 'bass', 0.043, 0)
        for i, p in enumerate(pitches[1:]):
            note(at+i*0.025, p, 2*BAR-0.2, 'pad', 0.026 if s != 4 else 0.021, (i-1.5)*0.42)
        if s in (2, 3, 5):
            # A deliberately sparse, scored ostinato; rests prevent a metronomic bed.
            for beat, index in [(0.5, 1), (2, 3), (3.5, 2), (5, 4), (6.5, 2)]:
                note(at+beat*BEAT, pitches[index]+12, 0.5*BEAT, 'pulse', 0.016, -0.5 if index%2 else 0.5)
    for half in range(2):
        for beat, p, length in phrases[s*2+half]:
            note((s*8+half*4)*BAR+beat*BEAT, p, length*BEAT, 'glass', 0.084 if s != 4 else 0.061, -0.12)
    if s in (1, 3, 5):
        # Sustained answering voice in the second half, distinct from the main motif.
        for beat, p in [(17, 62), (22, 64), (26, 66), (29, 64)]:
            note(s*8*BAR+beat*BEAT, p, 2*BEAT, 'glass', 0.028, 0.42)

# Synthetic reverberation: deterministic circular multitaps, no impulse recordings.
dry = mix.copy()
for delay, level in [(0.173, .19), (.293, .16), (.431, .13), (.683, .10), (1.117, .075), (1.793, .05), (2.713, .025)]:
    mix += np.roll(dry[:, ::-1], round(delay*SR), axis=0)*level
# Filter periodic signal after warming one complete cycle; DC is suppressed.
sos = butter(2, [32, 8500], btype='bandpass', fs=SR, output='sos')
_, state = sosfilt(sos, mix, axis=0, zi=np.zeros((len(sos), 2, 2)))
mix, _ = sosfilt(sos, mix, axis=0, zi=state)
mix *= 0.34 / np.max(np.abs(mix))
wavfile.write(out/'a-light-beyond-master.wav', SR, (mix*32767).astype(np.int16))
(out/'score.json').write_text(json.dumps(dict(title='A Light Beyond / 远方的微光', bpm=BPM, meter='4/4', bars=BARS, duration=N/SR, sections=sections, events=events), indent=2)+'\n')
# Constant-gain mastering preserves the exact circular seam and phrase dynamics.
subprocess.run(['ffmpeg','-y','-i',str(out/'a-light-beyond-master.wav'),'-af','volume=-3dB','-codec:a','libmp3lame','-b:a','128k','-ar',str(SR),'-map_metadata','-1',str(out/'a-light-beyond.mp3')], check=True)
print(json.dumps(dict(samples=N, sample_rate=SR, duration=N/SR, events=len(events), peak=float(np.max(np.abs(mix))), seam_delta=(mix[0]-mix[-1]).tolist())))
