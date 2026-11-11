# A Light Beyond / 远方的微光

An original instrumental score created specifically for Void Explorer in this task by Codex (AI-assisted composition and synthesis). No reference audio was listened to, downloaded, extracted, transcribed, sampled, or supplied to a generation model. No artist-style prompt, external soundfont, sample library, recording, or impulse response was used.

The composition, synthesis program, score data and rendered recording contributed here are dedicated under **CC0 1.0**: https://creativecommons.org/publicdomain/zero/1.0/ . Attribution is optional; suggested credit: “A Light Beyond — original Void Explorer score, composed and synthesized with Codex.” This describes the contribution's reuse terms, not a guarantee of copyright eligibility or musical uniqueness in every jurisdiction. NumPy, SciPy and FFmpeg are offline tools; none is shipped as a runtime dependency.

## Musical design

80 BPM, 4/4, 48 bars, exactly 144 seconds. Six eight-bar sections: First light; An answer across distance; Orbits; Open horizon; The quiet surface; A light remembered. A D–A–E–F♯ motif returns with changed endings. D major/add9, B minor11, G major9, suspended A, E minor9 and F♯ minor7 share smooth inner voices. Four synthesized roles: warm sustained harmony, a soft glass-key theme, sparse high answering pulses, and a sustained bass. Every note is specified; no random note generator runs in the game or renderer.

The final suspended harmony leads back to D. All envelopes and synthetic reverberation tails wrap into the opening, so the score has a cyclic rather than silent endpoint. The first user gesture introduces it with a gain fade. It continues without restarting when entering the game. A single arrangement avoids unstable gameplay-driven switches; the quieter fifth section provides breathing space.

## Reproducible production

`render-score.py` is the authoritative score and synthesis source. `score.json` records all 242 rendered note events and sections. Python 3 + NumPy 2.3.5 + SciPy 1.17.0 render additive instruments, envelopes, stereo placement, deterministic multitap space and periodic filtering. FFmpeg 7.1.5 with libmp3lame encodes the result. No application dependency was added.

```sh
python assets/music/render-score.py /tmp/void-music
# Compare or copy /tmp/void-music/a-light-beyond.mp3 only after reviewing it.
ffprobe -v error -show_format -show_streams /tmp/void-music/a-light-beyond.mp3
ffmpeg -i /tmp/void-music/a-light-beyond.mp3 -af loudnorm=I=-24:TP=-2:LRA=11:print_format=json -f null -
```

The last command measures the input; its hypothetical output normalization is NOT applied. Mastering uses only constant gain, preserving the circular seam. Source WAV is 16-bit PCM, stereo, 32 kHz; production MP3 is 128 kbit/s stereo, 32 kHz, 2,305,196 bytes. Actual gapless decoded duration is 144 seconds (container duration includes encoder padding). Measured encoded-input integrated loudness: −24.07 LUFS; true peak: −12.82 dBTP; LRA: 3.80 LU. Runtime music gain is 0.45 (approximately −6.94 dB); a notification temporarily ducks only music to 0.18. Original engine and notification frequency/envelope/level formulas are retained.

## Listening and evidence boundary

The complete track, a tail-to-head excerpt and actual browser mix recording are supplied with the delivery evidence. Signal analysis, actual browser decoding/loop rendering and real-time playback are engineering checks, not subjective listening. This agent has no audio-perception tool in the current session and cannot truthfully certify musical quality, masking, pleasant loop transitions or long-session listening fatigue. Those remain human-listening acceptance items unless the user explicitly supplies feedback. The score is a complete original musical draft, not a claim that automated checks establish listening quality.
