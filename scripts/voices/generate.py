#!/usr/bin/env python3
"""
Radio voice generator: text lines -> Kokoro TTS -> radio-ready MP3 clips + manifest.

Offline tool. It is NOT run in CI and its outputs are committed:
  public/audio/voice/<key>.<variant>.mp3   mono, 24 kHz, 32 kbps CBR
  public/audio/voice/manifest.json         {version, format, speakers, lines:{key:{speaker, cat, variants:[{file, dur, bytes, hash, en, th}]}}}

Inputs (same format; src/audio/voice/lines.json wins on duplicate keys):
  src/audio/voice/speakers.json   speaker id -> {callsign, voice, lang, speed}
  src/audio/voice/lines.json      generic pools + legacy scripted keys (RADIO)
  src/stages/radioLines.json      stage lines r.<stageId>.<name> (STAGES; optional)
  line: {"speaker": id, "cat"?: str, "speed"?: mul, "variants": [{"en", "th", "speaker"?, "say"?, "speed"?}]}
  ("say" overrides the spoken text, e.g. "X B seventy" for "XB-70").

Usage:
  python3 scripts/voices/generate.py --setup            # once: pip deps + model files into .voice-cache/
  python3 scripts/voices/generate.py                    # voice every new/changed line (incremental)
  python3 scripts/voices/generate.py --only gen.kill 'r.ocean.*'   # restrict synthesis to these keys (globs ok)
  python3 scripts/voices/generate.py --force            # re-voice everything
  python3 scripts/voices/generate.py --dry-run          # list what would be (re)generated
  options: --threads N (onnxruntime threads, default 1), --kbps N (MP3 bitrate, default 32)
  env: VOICE_CACHE=<dir> overrides the cache location (default <repo>/.voice-cache, gitignored)

Incremental: a clip is reused when sha1(spoken text + voice + lang + speed + pipeline settings
+ bitrate) matches the manifest entry and the file exists; processed speech is also cached in
.voice-cache/pcm/, so changing only the bitrate re-encodes without running TTS.
Pipeline per clip: synthesize -> DC removal -> loudness normalise (gated RMS of the speech,
about -16 LUFS) -> soft peak limit (-0.5 dBFS) -> 50 ms padding -> 60 ms raised-cosine fades ->
MP3 (lameenc). Model: Kokoro v1.0 int8 ONNX (Apache-2.0 weights) via the kokoro-onnx package.
CPU friendly: runs at nice 10 with one onnxruntime thread by default.
"""
import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get('VOICE_CACHE') or ROOT / '.voice-cache')
PYDEPS = CACHE / 'py'
PCM_DIR = CACHE / 'pcm'  # processed speech per synthesis hash (re-encoding needs no TTS)
SPEAKERS_FILE = ROOT / 'src/audio/voice/speakers.json'
LINES_FILE = ROOT / 'src/audio/voice/lines.json'
STAGE_LINES_FILE = ROOT / 'src/stages/radioLines.json'
OUT = ROOT / 'public/audio/voice'
MANIFEST = OUT / 'manifest.json'

MODEL_BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
MODEL = 'kokoro-v1.0.int8.onnx'
VOICES = 'voices-v1.0.bin'
PIP_DEPS = ['kokoro-onnx', 'soundfile', 'lameenc', 'numpy']

SR = 24000
TARGET_DB = -18.0  # gated speech RMS (dBFS); ~ -16 LUFS for speech
GATE_DB = -32.0  # frames this far below the loudest frame are not speech
LIMIT_T = 0.78  # soft limiter knee
CEIL = 0.944  # -0.5 dBFS
PAD = 0.05
FADE = 0.06
KEY_RE = re.compile(r'^[A-Za-z0-9._-]+$')


def log(*a):
    print(*a, flush=True)


def load_json(path, required=True):
    if not path.exists():
        if required:
            sys.exit(f'missing {path}')
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ----------------------------------------------------------------- setup

def setup():
    CACHE.mkdir(parents=True, exist_ok=True)
    log(f'installing {PIP_DEPS} into {PYDEPS}')
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', '--target', str(PYDEPS), *PIP_DEPS])
    for name in (MODEL, VOICES):
        dst = CACHE / name
        if dst.exists() and dst.stat().st_size > 1_000_000:
            log(f'{name}: present')
            continue
        log(f'downloading {name}')
        tmp = dst.with_suffix('.part')
        urllib.request.urlretrieve(MODEL_BASE + name, tmp)
        tmp.replace(dst)
    log('setup done')


def import_deps():
    if PYDEPS.exists():
        sys.path.insert(0, str(PYDEPS))
    try:
        import numpy as np  # noqa: F401
        import lameenc  # noqa: F401
        import onnxruntime  # noqa: F401
        import kokoro_onnx  # noqa: F401
    except ImportError as e:
        sys.exit(f'missing dependency ({e}). Run: python3 scripts/voices/generate.py --setup')


# ------------------------------------------------------------------ data

def collect_jobs(speakers, lines, kbps):
    """Flatten lines into per-variant jobs with their content hash."""
    pipeline = f'p1|{SR}|{TARGET_DB}|{GATE_DB}|{LIMIT_T}|{CEIL}|{PAD}|{FADE}'
    jobs = []
    for key, line in lines.items():
        if not KEY_RE.match(key):
            sys.exit(f'bad key {key!r}: use [A-Za-z0-9._-]')
        variants = line.get('variants') or []
        if not variants:
            sys.exit(f'{key}: no variants')
        for i, v in enumerate(variants):
            spk_id = v.get('speaker') or line.get('speaker')
            spk = speakers.get(spk_id)
            if not spk:
                sys.exit(f'{key}[{i}]: unknown speaker {spk_id!r}')
            if not v.get('en') or not v.get('th'):
                sys.exit(f'{key}[{i}]: needs both "en" and "th"')
            text = (v.get('say') or v['en']).strip()
            speed = round(float(spk.get('speed', 1)) * float(line.get('speed', 1)) * float(v.get('speed', 1)), 3)
            lang = spk.get('lang', 'en-us')
            pcm = hashlib.sha1(json.dumps([text, spk['voice'], lang, speed, pipeline]).encode()).hexdigest()[:16]
            h = hashlib.sha1(f'{pcm}|mp3|{SR}|{kbps}'.encode()).hexdigest()[:12]
            jobs.append({'key': key, 'i': i, 'speaker': spk_id, 'voice': spk['voice'], 'lang': lang,
                         'speed': speed, 'text': text, 'en': v['en'], 'th': v['th'], 'hash': h, 'pcm': pcm,
                         'file': f'{key}.{i}.mp3'})
    return jobs


def old_variants(manifest):
    out = {}
    for key, line in (manifest.get('lines') or {}).items():
        for i, v in enumerate(line.get('variants') or []):
            out[(key, i)] = v
    return out


# ------------------------------------------------------------------ audio

def process(a, np):
    """DC removal, gated loudness normalisation, soft limit, padding and fades."""
    a = np.asarray(a, dtype=np.float64).ravel()
    a = a - a.mean()
    frame = int(0.02 * SR)
    n = max(1, len(a) // frame)
    fr = a[: n * frame].reshape(n, frame) if len(a) >= frame else a.reshape(1, -1)
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    gate = rms.max() * 10 ** (GATE_DB / 20)
    act = rms[rms > gate]
    speech = float(np.sqrt((act ** 2).mean())) if len(act) else float(rms.max())
    a = a * (10 ** (TARGET_DB / 20) / max(speech, 1e-6))
    mag = np.abs(a)
    over = mag > LIMIT_T
    if over.any():
        span = CEIL - LIMIT_T
        a[over] = np.sign(a[over]) * (LIMIT_T + span * np.tanh((mag[over] - LIMIT_T) / span))
    pad = np.zeros(int(PAD * SR))
    a = np.concatenate([pad, a, pad])
    f = int(FADE * SR)
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, f))
    a[:f] *= ramp
    a[-f:] *= ramp[::-1]
    return a


def stats(a, np):
    frame = int(0.02 * SR)
    n = max(1, len(a) // frame)
    fr = a[: n * frame].reshape(n, frame)
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    act = rms[rms > rms.max() * 10 ** (GATE_DB / 20)]
    db = lambda x: 20 * np.log10(max(float(x), 1e-9))  # noqa: E731
    voiced = int((rms > 10 ** (-45 / 20)).sum())
    return {'dur': len(a) / SR, 'peak': db(np.abs(a).max()), 'rms': db(np.sqrt((act ** 2).mean())),
            'clip': int((np.abs(a) >= 0.999).sum()), 'voiced': voiced * frame / SR}


def encode_mp3(a, kbps, lameenc, np):
    pcm = np.clip(np.round(a * 32767), -32768, 32767).astype('<i2').tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(SR)
    enc.set_out_sample_rate(SR)  # LAME would resample to 22.05 kHz at low bitrates
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(pcm) + enc.flush())


def make_tts(threads):
    import onnxruntime as rt
    from kokoro_onnx import Kokoro
    for name in (MODEL, VOICES):
        if not (CACHE / name).exists():
            sys.exit(f'missing {CACHE / name}. Run: python3 scripts/voices/generate.py --setup')
    so = rt.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    sess = rt.InferenceSession(str(CACHE / MODEL), so, providers=['CPUExecutionProvider'])
    return Kokoro.from_session(sess, str(CACHE / VOICES))


# ------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description='Generate radio voice clips (Kokoro TTS).')
    ap.add_argument('--setup', action='store_true', help='install deps and download the model into the cache')
    ap.add_argument('--only', nargs='+', metavar='KEY', help='only (re)synthesize these keys (fnmatch globs)')
    ap.add_argument('--force', action='store_true', help='re-voice every selected line')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--threads', type=int, default=1)
    ap.add_argument('--kbps', type=int, default=32)
    args = ap.parse_args()

    if args.setup:
        setup()
        return
    os.environ.setdefault('OMP_NUM_THREADS', str(args.threads))
    try:
        os.nice(10)
    except OSError:
        pass

    speakers = load_json(SPEAKERS_FILE)
    stage_lines = load_json(STAGE_LINES_FILE, required=False)
    lines = {**stage_lines, **load_json(LINES_FILE)}
    jobs = collect_jobs(speakers, lines, args.kbps)
    old_manifest = load_json(MANIFEST, required=False)
    old = old_variants(old_manifest)

    def selected(key):
        return not args.only or any(fnmatch.fnmatchcase(key, p) for p in args.only)

    todo = []
    for j in jobs:
        prev = old.get((j['key'], j['i']))
        exists = prev and (OUT / prev.get('file', '')).exists()
        if exists and prev.get('hash') == j['hash'] and not (args.force and selected(j['key'])):
            j['result'] = {'file': prev['file'], 'dur': prev['dur'], 'bytes': prev['bytes']}
        elif not selected(j['key']):
            if exists:  # stale but outside --only: keep the old clip (runtime checks the text)
                j['result'] = {'file': prev['file'], 'dur': prev['dur'], 'bytes': prev['bytes'], 'hash': prev.get('hash')}
            else:
                j['result'] = None
        else:
            todo.append(j)
    log(f'{len(jobs)} variants in {len(lines)} lines ({len(stage_lines)} from radioLines.json); {len(todo)} to (re)generate')
    if args.dry_run:
        for j in todo:
            log(f'  {j["file"]}  [{j["speaker"]}/{j["voice"]} x{j["speed"]}] {j["text"]}')
        return

    if todo:
        import_deps()
        import numpy as np
        import lameenc
        OUT.mkdir(parents=True, exist_ok=True)
        tts = None
        n_tts = 0
        t0 = time.time()
        report = []
        for n, j in enumerate(todo):
            cached = PCM_DIR / f'{j["pcm"]}.npy'
            if cached.exists() and not args.force:
                a = np.load(cached).astype(np.float64)  # same speech, other encoder settings
            else:
                tts = tts or make_tts(args.threads)
                audio, sr = tts.create(j['text'], voice=j['voice'], speed=j['speed'], lang=j['lang'])
                n_tts += 1
                if sr != SR:
                    sys.exit(f'unexpected sample rate {sr}')
                a = process(audio, np)
                PCM_DIR.mkdir(parents=True, exist_ok=True)
                np.save(cached, a.astype(np.float32))
            st = stats(a, np)
            mp3 = encode_mp3(a, args.kbps, lameenc, np)
            (OUT / j['file']).write_bytes(mp3)
            j['result'] = {'file': j['file'], 'dur': round(st['dur'], 3), 'bytes': len(mp3)}
            flags = []
            if st['clip']:
                flags.append(f'CLIP {st["clip"]}')
            if st['voiced'] < 0.25:
                flags.append('SILENT?')
            if st['dur'] > 4.5:
                flags.append('LONG')
            report.append({'file': j['file'], **st})
            log(f'[{n + 1}/{len(todo)}] {j["file"]}  {st["dur"]:.2f}s  peak {st["peak"]:.1f} dBFS  rms {st["rms"]:.1f} dBFS  '
                f'{len(mp3) / 1024:.1f} KB {" ".join(flags)}')
        log(f'encoded {len(report)} clips ({n_tts} synthesized, {len(report) - n_tts} from the PCM cache) in {time.time() - t0:.0f}s')
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / 'last-stats.json').write_text(json.dumps(report, indent=1))

    # manifest
    out_lines = {}
    for j in jobs:
        r = j.get('result')
        if not r:
            continue
        line = lines[j['key']]
        entry = out_lines.setdefault(j['key'], {'speaker': line.get('speaker'), 'cat': line.get('cat'), 'variants': []})
        if entry['cat'] is None:
            del entry['cat']
        var = {'file': r['file'], 'dur': r['dur'], 'bytes': r['bytes'], 'hash': r.get('hash', j['hash']), 'en': j['en'], 'th': j['th']}
        if j['speaker'] != line.get('speaker'):
            var['speaker'] = j['speaker']
        # keep variant indices aligned with the source even if one is missing
        while len(entry['variants']) < j['i']:
            entry['variants'].append(None)
        entry['variants'].append(var)
    used = {v['file'] for e in out_lines.values() for v in e['variants'] if v}
    total = sum((OUT / f).stat().st_size for f in used)
    manifest = {
        'version': 1,
        'format': {'codec': 'mp3', 'sampleRate': SR, 'channels': 1, 'kbps': args.kbps},
        'speakers': {k: {'voice': s['voice'], 'speed': s.get('speed', 1), 'callsign': s['callsign']} for k, s in speakers.items()},
        'totalBytes': total,
        'lines': out_lines,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    removed = 0
    for f in OUT.glob('*.mp3'):
        if f.name not in used:
            f.unlink()
            removed += 1
    log(f'manifest: {len(out_lines)} lines, {len(used)} clips, {total / 1024:.0f} KB total'
        + (f', removed {removed} orphan clips' if removed else ''))


if __name__ == '__main__':
    main()
