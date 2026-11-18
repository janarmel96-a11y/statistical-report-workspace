// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Captions, Copy, Download, ImagePlus, Mic, Pause, Play, Plus, Redo2, SkipBack, Square, Trash2, Undo2, Video, Volume2, X } from 'lucide-react';
import { emptyMemory, suggestImprovements } from '../core/assistant';
import { keyLabel } from '../core/report';
import { buildStory, type DetailLevel } from '../core/story';
import { chartImages, download, safeFileName, type ExportContext } from '../export/reportExports';
import { filterSummary, pageConstraints, useStore } from '../state/store';
import { canExportVideo, encodeVideo, renderAudio } from '../video/encode';
import { newScene, sceneSeconds, sizeOf, STYLES, subtitles, timelineOf, toVideoScenes, type Animation, type Music, type Quality, type Transition, type VideoFormat, type VideoProject, type VideoScene } from '../video/project';
import { drawFrame, type Assets } from '../video/render';
import { bestVoice, sentenceOffsets, sentencePauseMs, speechRate, splitSentences, spokenText } from '../video/speech';

const FORMATS: [VideoFormat, string][] = [['landscape', 'Landscape'], ['portrait', 'Portrait'], ['square', 'Square']];

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export default function VideoStudio({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const engine = s.engine!;
  const report = s.report!;
  const ctx = useMemo<ExportContext>(() => ({
    report, engine, table: engine.table, findings: s.findings.filter((f) => !s.disabled.includes(f.id)),
    constraints: pageConstraints(s.slicers, s.selection),
    filterText: filterSummary(s.slicers, s.selection, (x) => `${x.col}: ${x.values.map((v) => keyLabel(engine, { col: x.col, part: x.part }, v)).join(', ')}`),
    palette: s.palette,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const makeScenes = (detail: DetailLevel) => toVideoScenes(buildStory(engine, report, ctx.findings, ctx.constraints, {
    detail, filterText: ctx.filterText,
    actions: suggestImprovements({ en: engine, report, findings: ctx.findings, cs: ctx.constraints, memory: emptyMemory() }).slice(0, 4).map((x) => x.title),
  }));

  const [detail, setDetail] = useState<DetailLevel>('standard');
  const [project, setProject] = useState<VideoProject>(() => ({ format: 'landscape', quality: 720, styleId: 'boardroom', music: 'calm', captions: true, presenter: true, pace: 2.4, scenes: makeScenes('standard') }));
  const [undo, setUndo] = useState<VideoScene[][]>([]);
  const [redo, setRedo] = useState<VideoScene[][]>([]);
  const [selected, setSelected] = useState(project.scenes[0]?.id ?? '');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [, bump] = useState(0);

  const canvas = useRef<HTMLCanvasElement>(null);
  const assets = useRef<Assets>(new Map());
  const voices = useRef(new Map<string, AudioBuffer>());
  const abort = useRef<AbortController | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const speechRun = useRef(0);
  const speechCap = useRef(Infinity);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  const voiceSeconds = new Map([...voices.current].map(([k, v]) => [k, v.duration]));
  const tl = timelineOf(project, voiceSeconds);
  const size = sizeOf(project);
  const index = Math.max(0, project.scenes.findIndex((x) => x.id === selected));
  const scene = project.scenes[index];

  const setScenes = (scenes: VideoScene[]) => {
    setUndo((u) => [...u.slice(-40), project.scenes]);
    setRedo([]);
    setProject((p) => ({ ...p, scenes }));
  };
  const patch = (changes: Partial<VideoScene>) => setScenes(project.scenes.map((x) => (x.id === scene.id ? { ...x, ...changes } : x)));
  const goTo = (i: number) => { stop(); setSelected(project.scenes[i].id); setTime(tl.starts[i] + 0.9); };

  useEffect(() => {
    let live = true;
    const images = chartImages(ctx);
    void Promise.all(images.map((img) => new Promise<void>((res) => {
      const el = new Image();
      el.onload = () => { assets.current.set(img.visual.id, el as HTMLImageElement); res(); };
      el.onerror = () => res();
      el.src = img.dataUrl;
    }))).then(() => { if (live) setReady(true); });
    const load = () => {
      const list = speechSynthesis.getVoices().filter((v) => v.localService && /^en/i.test(v.lang));
      setDeviceVoices(list);
      setVoiceName((cur) => cur || (list.length ? bestVoice(list) : ''));
    };
    if ('speechSynthesis' in window) { load(); speechSynthesis.addEventListener('voiceschanged', load); }
    return () => { live = false; if ('speechSynthesis' in window) { speechSynthesis.removeEventListener('voiceschanged', load); speechSynthesis.cancel(); } void audio.current?.close(); };
  }, [ctx]);

  useEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (c) drawFrame(c, project, tl, time, assets.current);
  });

  const voiced = () => Boolean(voiceName && voiceName !== 'off' && 'speechSynthesis' in window);
  const stop = () => {
    speechRun.current += 1;
    speechCap.current = Infinity;
    setPlaying(false);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    void audio.current?.close();
    audio.current = null;
  };

  /** The voice leads: a scene changes only after its last sentence has been fully spoken. */
  const finishScene = (i: number, run: number) => {
    if (run !== speechRun.current) return;
    if (i >= project.scenes.length - 1) { stop(); setTime(tl.total); return; }
    speechCap.current = tl.starts[i + 1];
    setTime(tl.starts[i + 1]);
    setSelected(project.scenes[i + 1].id);
    window.setTimeout(() => speakScene(i + 1, 0, run), 500);
  };

  const speakScene = (i: number, first: number, run: number) => {
    if (run !== speechRun.current) return;
    const current = project.scenes[i];
    const [start, seconds] = [tl.starts[i], tl.durations[i]];
    const recorded = voices.current.get(current.id);
    if (recorded && audio.current) {
      speechCap.current = start + seconds - 0.02;
      const src = audio.current.createBufferSource();
      src.buffer = recorded;
      src.connect(audio.current.destination);
      src.onended = () => finishScene(i, run);
      src.start();
      return;
    }
    const parts = splitSentences(current.narration);
    const at = sentenceOffsets(parts, seconds);
    const voice = deviceVoices.find((v) => v.name === voiceName) ?? null;
    const say = (k: number) => {
      if (run !== speechRun.current) return;
      if (k >= parts.length) { speechCap.current = start + seconds - 0.02; window.setTimeout(() => finishScene(i, run), 350); return; }
      speechCap.current = start + at[k + 1] - 0.02;
      setTime(start + at[k]);
      const u = new SpeechSynthesisUtterance(spokenText(parts[k]));
      u.voice = voice;
      if (voice) u.lang = voice.lang;
      u.rate = speechRate(project.pace);
      u.onend = () => { if (run === speechRun.current) window.setTimeout(() => say(k + 1), sentencePauseMs(project.pace)); };
      u.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted') say(k + 1); };
      utterance.current = u; // Browsers can lose the end event if nothing holds on to the sentence.
      speechSynthesis.speak(u);
    };
    say(first);
  };

  const play = async () => {
    if (playing) { stop(); return; }
    const from = time >= tl.total - 0.05 ? 0 : time;
    const speaking = voiced();
    const run = ++speechRun.current;
    speechCap.current = speaking ? from : Infinity;
    if (speaking) speechSynthesis.cancel();
    setTime(from);
    setPlaying(true);
    const mix = await renderAudio(project, tl, speaking ? new Map() : voices.current).catch(() => null);
    if (run !== speechRun.current) return;
    audio.current = new AudioContext();
    if (mix) {
      const src = audio.current.createBufferSource();
      const level = audio.current.createGain();
      level.gain.value = speaking ? 0.45 : 1;
      src.buffer = mix;
      src.loop = speaking;
      src.connect(level).connect(audio.current.destination);
      src.start(0, from % mix.duration);
    }
    if (!speaking) return;
    const i = Math.max(0, tl.starts.findIndex((st, k) => from >= st && from < st + tl.durations[k]));
    const at = sentenceOffsets(splitSentences(project.scenes[i].narration), tl.durations[i]);
    const inside = from - tl.starts[i];
    speakScene(i, Math.max(0, at.findIndex((t, k) => k < at.length - 1 && inside >= t && inside < at[k + 1])), run);
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const next = Math.min(t + dt, speechCap.current);
        if (next >= tl.total) { stop(); return tl.total; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl.total]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const i = tl.starts.findIndex((st, k) => time >= st && time < st + tl.durations[k]);
    if (playing && i >= 0 && project.scenes[i].id !== selected) setSelected(project.scenes[i].id);
  }, [time, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= project.scenes.length) return;
    const next = [...project.scenes];
    [next[i], next[j]] = [next[j], next[i]];
    setScenes(next);
  };

  const record = async () => {
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      recorder.current = r;
      const id = scene.id;
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const ac = new AudioContext({ sampleRate: 48000 });
        const decoded = await ac.decodeAudioData(await new Blob(chunks).arrayBuffer());
        void ac.close();
        voices.current.set(id, decoded);
        bump((n) => n + 1);
      };
      r.start();
      setRecording(true);
    } catch { setError('The microphone is not available. Allow access in your browser, then try again.'); }
  };

  const addImage = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => { assets.current.set(scene.id, el); patch({ visualId: undefined }); bump((n) => n + 1); };
    el.src = url;
  };

  const exportVideo = async () => {
    stop();
    setError(null); setDone(false); setExporting(0);
    abort.current = new AbortController();
    try {
      const blob = await encodeVideo(project, tl, assets.current, voices.current, setExporting, abort.current.signal);
      download(blob, `${safeFileName(report.title)}.mp4`, 'video/mp4');
      setDone(true);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'The video could not be created.');
    }
    setExporting(null);
  };

  const regenerate = (d: DetailLevel) => { setDetail(d); const scenes = makeScenes(d); setScenes(scenes); setSelected(scenes[0]?.id ?? ''); setTime(0); };

  return (
    <div className="studio" role="dialog" aria-modal="true" aria-label="Video studio">
      <header className="studio-bar">
        <button className="icon-btn" aria-label="Close video studio" onClick={() => { stop(); abort.current?.abort(); onClose(); }}><X size={18} /></button>
        <b><Video size={16} /> Video studio</b>
        <button className="icon-btn" aria-label="Undo" disabled={!undo.length} onClick={() => { setRedo((r) => [...r, project.scenes]); setProject((p) => ({ ...p, scenes: undo[undo.length - 1] })); setUndo((u) => u.slice(0, -1)); }}><Undo2 size={16} /></button>
        <button className="icon-btn" aria-label="Redo" disabled={!redo.length} onClick={() => { setUndo((u) => [...u, project.scenes]); setProject((p) => ({ ...p, scenes: redo[redo.length - 1] })); setRedo((r) => r.slice(0, -1)); }}><Redo2 size={16} /></button>
        <div className="segmented text" role="radiogroup" aria-label="Video shape">
          {FORMATS.map(([f, label]) => <button key={f} role="radio" aria-checked={project.format === f} className={project.format === f ? 'on' : ''} onClick={() => setProject((p) => ({ ...p, format: f }))}>{label}</button>)}
        </div>
        <div className="spacer" />
        <span className="rows-count">{project.scenes.length} scenes · {clock(tl.total)}</span>
        <button className="btn primary" disabled={exporting !== null || !ready || !project.scenes.length} onClick={() => void exportVideo()}><Download size={15} /> Export MP4</button>
      </header>

      {(exporting !== null || done || error) && (
        <div className="studio-status" role="status">
          {exporting !== null && <><span>Creating your video: {Math.round(exporting * 100)}%</span><div className="meter"><i style={{ width: `${exporting * 100}%` }} /></div><button className="btn sm" onClick={() => abort.current?.abort()}>Cancel</button></>}
          {done && exporting === null && <><span>Your MP4 video was created and downloaded.</span><button className="btn sm" onClick={() => download(subtitles(project, tl), `${safeFileName(report.title)}.srt`, 'text/plain')}><Captions size={14} /> Subtitles</button><button className="btn sm" onClick={() => download(project.scenes.map((x, i) => `Scene ${i + 1}: ${x.title}\n${x.narration}`).join('\n\n'), `${safeFileName(report.title)} script.txt`, 'text/plain')}>Script</button></>}
          {error && <span className="bad-text">{error}</span>}
        </div>
      )}

      <div className="studio-body">
        <aside className="scene-list" aria-label="Scenes">
          <button className="btn sm" onClick={() => { const n = newScene(); const next = [...project.scenes]; next.splice(index + 1, 0, n); setScenes(next); setSelected(n.id); }}><Plus size={14} /> New scene</button>
          <ol>
            {project.scenes.map((x, i) => (
              <li key={x.id} className={x.id === selected ? 'on' : ''}>
                <button className="scene-open" onClick={() => goTo(i)}><small>{i + 1} · {clock(tl.durations[i])}</small><b>{x.title}</b></button>
                <span className="scene-tools">
                  <button className="icon-btn sm" aria-label={`Move scene ${i + 1} up`} disabled={!i} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
                  <button className="icon-btn sm" aria-label={`Move scene ${i + 1} down`} disabled={i === project.scenes.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
                  <button className="icon-btn sm" aria-label={`Duplicate scene ${i + 1}`} onClick={() => { const c = { ...x, id: newScene().id }; const next = [...project.scenes]; next.splice(i + 1, 0, c); setScenes(next); }}><Copy size={13} /></button>
                  <button className="icon-btn sm" aria-label={`Delete scene ${i + 1}`} disabled={project.scenes.length < 2} onClick={() => { const next = project.scenes.filter((y) => y.id !== x.id); setScenes(next); if (x.id === selected) setSelected(next[Math.max(0, i - 1)].id); }}><Trash2 size={13} /></button>
                </span>
              </li>
            ))}
          </ol>
        </aside>

        <main className="stage">
          <div className="stage-view"><canvas ref={canvas} width={size.width} height={size.height} className={project.format} aria-label="Video preview" /></div>
          <div className="transport">
            <button className="icon-btn" aria-label="Go to beginning" onClick={() => { stop(); setTime(0); }}><SkipBack size={16} /></button>
            <button className="btn primary sm" disabled={!ready} onClick={() => void play()}>{playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}</button>
            <span className="rows-count">{clock(time)} / {clock(tl.total)}</span>
          </div>
          <div className="timeline" role="slider" aria-label="Video position" aria-valuemin={0} aria-valuemax={Math.round(tl.total)} aria-valuenow={Math.round(time)} tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') setTime((t) => Math.min(tl.total, t + 1)); if (e.key === 'ArrowLeft') setTime((t) => Math.max(0, t - 1)); }}
            onClick={(e) => { stop(); const r = e.currentTarget.getBoundingClientRect(); const t = ((e.clientX - r.left) / r.width) * tl.total; setTime(t); const i = tl.starts.findIndex((st, k) => t >= st && t < st + tl.durations[k]); if (i >= 0) setSelected(project.scenes[i].id); }}>
            {project.scenes.map((x, i) => <div key={x.id} className={`clip ${x.id === selected ? 'on' : ''}`} style={{ width: `${(tl.durations[i] / tl.total) * 100}%` }}><span>{i + 1}</span>{voices.current.has(x.id) && <Mic size={11} />}</div>)}
            <i className="playhead" style={{ left: `${(time / Math.max(0.01, tl.total)) * 100}%` }} />
          </div>
        </main>

        <aside className="inspector" aria-label="Video settings">
          {scene && <>
            <h3 className="side-h">Scene {index + 1}</h3>
            <label className="field compact">Heading <input value={scene.title} onChange={(e) => patch({ title: e.target.value })} /></label>
            <label className="field compact">Script <textarea rows={6} className="plain" value={scene.narration} onChange={(e) => patch({ narration: e.target.value })} /></label>
            <label className="field compact">Key points, one per line <textarea rows={3} className="plain" value={scene.bullets.join('\n')} onChange={(e) => patch({ bullets: e.target.value.split('\n') })} /></label>
            <div className="two">
              <label className="field compact">Transition <select value={scene.transition} onChange={(e) => patch({ transition: e.target.value as Transition })}><option value="fade">Fade</option><option value="slide">Slide</option><option value="zoom">Zoom</option><option value="none">None</option></select></label>
              <label className="field compact">Animation <select value={scene.animation} onChange={(e) => patch({ animation: e.target.value as Animation })}><option value="wipe">Wipe</option><option value="zoom">Zoom</option><option value="rise">Rise</option></select></label>
              <label className="field compact">Seconds <input type="number" min={2} max={120} step={0.5} value={sceneSeconds(scene, project.pace, voiceSeconds.get(scene.id))} disabled={voices.current.has(scene.id)} onChange={(e) => patch({ seconds: Number(e.target.value) || undefined })} /></label>
              <label className="field compact">Background <input type="color" aria-label="Scene background" value={scene.background ?? (STYLES.find((x) => x.id === project.styleId)?.bg[0] ?? '#000000')} onChange={(e) => patch({ background: e.target.value })} /></label>
            </div>
            <div className="row-wrap">
              <button className={`btn sm ${recording ? 'danger' : ''}`} onClick={() => void record()}>{recording ? <><Square size={13} /> Stop recording</> : <><Mic size={13} /> Record voice</>}</button>
              {voices.current.has(scene.id) && <button className="btn sm" onClick={() => { voices.current.delete(scene.id); bump((n) => n + 1); }}><Trash2 size={13} /> Remove voice</button>}
              <label className="btn sm"><ImagePlus size={13} /> Add image<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => addImage(e.target.files?.[0])} /></label>
            </div>
          </>}

          <h3 className="side-h">Whole video</h3>
          <label className="field compact">Script detail <select value={detail} onChange={(e) => regenerate(e.target.value as DetailLevel)}><option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label>
          <div className="style-picks" role="radiogroup" aria-label="Video style">
            {STYLES.map((x) => <button key={x.id} role="radio" aria-checked={project.styleId === x.id} className={project.styleId === x.id ? 'on' : ''} style={{ background: `linear-gradient(135deg, ${x.bg[0]}, ${x.bg[1]})`, color: x.ink }} onClick={() => setProject((p) => ({ ...p, styleId: x.id }))}>{x.name}</button>)}
          </div>
          <div className="two">
            <label className="field compact">Music <select value={project.music} onChange={(e) => setProject((p) => ({ ...p, music: e.target.value as Music }))}><option value="calm">Calm</option><option value="bright">Bright</option><option value="none">None</option></select></label>
            <label className="field compact">Quality <select value={project.quality} onChange={(e) => setProject((p) => ({ ...p, quality: Number(e.target.value) as Quality }))}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
          </div>
          <label className="field compact"><span><Volume2 size={13} /> Read aloud in preview</span>
            <select aria-label="Read aloud voice" value={voiceName || 'off'} onChange={(e) => { stop(); setVoiceName(e.target.value); }}><option value="off">Off</option>{deviceVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select>
          </label>
          <label className="param"><span>Speaking pace <b>{project.pace.toFixed(1)}</b></span><input type="range" min={1.6} max={3.4} step={0.1} value={project.pace} onChange={(e) => setProject((p) => ({ ...p, pace: Number(e.target.value) }))} /></label>
          <label className="switch solo"><input type="checkbox" checked={project.captions} onChange={(e) => setProject((p) => ({ ...p, captions: e.target.checked }))} /><i /><span>Captions</span></label>
          <label className="switch solo"><input type="checkbox" checked={project.presenter} onChange={(e) => setProject((p) => ({ ...p, presenter: e.target.checked }))} /><i /><span>Animated presenter</span></label>
          <p className="hint">The exported MP4 includes captions, music, and voices you record. Read-aloud voices play only in this preview.</p>
          {!canExportVideo() && <p className="hint bad-text">MP4 export needs a current version of Chrome or Edge.</p>}
        </aside>
      </div>
    </div>
  );
}
