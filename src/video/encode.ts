// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { sizeOf, type Timeline, type VideoProject } from './project';
import { drawFrame, type Assets } from './render';

/** Creates an MP4 on this device, faster than real time, using the browser's built-in encoders. */

const FPS = 30;
const RATE = 48000;

/** Mixes background music and recorded voices. Generated locally, with no audio files. */
export async function renderAudio(project: VideoProject, tl: Timeline, voices: Map<string, AudioBuffer>): Promise<AudioBuffer | null> {
  if (project.music === 'none' && !voices.size) return null;
  const length = Math.max(1, Math.ceil(tl.total * RATE));
  const ctx = new OfflineAudioContext(2, length, RATE);
  if (project.music !== 'none') {
    const master = ctx.createGain();
    master.gain.value = voices.size ? 0.05 : 0.11;
    master.connect(ctx.destination);
    const chords = project.music === 'calm'
      ? [[220, 261.6, 329.6], [174.6, 220, 261.6], [130.8, 196, 261.6], [196, 246.9, 293.7]]
      : [[261.6, 329.6, 392], [392, 493.9, 587.3], [220, 261.6, 329.6], [349.2, 440, 523.3]];
    const bar = project.music === 'calm' ? 4 : 2.4;
    for (let n = 0, t = 0; t < tl.total; n++, t += bar) {
      for (const f of chords[n % chords.length]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = project.music === 'calm' ? 'sine' : 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.32, t + bar * 0.25);
        g.gain.linearRampToValueAtTime(0, t + bar * 1.05);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(Math.min(tl.total, t + bar * 1.08));
      }
    }
  }
  project.scenes.forEach((s, i) => {
    const v = voices.get(s.id);
    if (!v) return;
    const src = ctx.createBufferSource();
    src.buffer = v;
    src.connect(ctx.destination);
    src.start(tl.starts[i] + 0.2);
  });
  return ctx.startRendering();
}

async function pickVideoCodec(width: number, height: number, bitrate: number) {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a']) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: FPS, avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  return null;
}

export const canExportVideo = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

export async function encodeVideo(project: VideoProject, tl: Timeline, assets: Assets, voices: Map<string, AudioBuffer>, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Blob> {
  if (!canExportVideo()) throw new Error('Video export needs a current version of Chrome or Edge.');
  const { width, height } = sizeOf(project);
  const video = await pickVideoCodec(width, height, project.quality === 1080 ? 8_000_000 : 4_500_000);
  if (!video) throw new Error('This browser cannot create MP4 video at this size.');
  const mix = await renderAudio(project, tl, voices);
  const audioConfig: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: RATE, numberOfChannels: 2, bitrate: 128000 };
  const hasAudio = Boolean(mix) && (await AudioEncoder.isConfigSupported(audioConfig)).supported === true;
  if (mix && !hasAudio) throw new Error('This browser cannot add sound to MP4 video. Turn off music and recorded voice, then try again.');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: FPS },
    audio: hasAudio ? { codec: 'aac', numberOfChannels: 2, sampleRate: RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure: Error | null = null;
  const fail = (e: Error) => { failure = e; };
  const ve = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  ve.configure(video);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const frames = Math.ceil(tl.total * FPS);
  for (let f = 0; f < frames; f++) {
    if (signal.aborted) { ve.close(); throw new DOMException('Cancelled', 'AbortError'); }
    if (failure) throw failure;
    drawFrame(ctx, project, tl, f / FPS, assets);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    ve.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
    frame.close();
    while (ve.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (f % 10 === 0) { onProgress((f / frames) * 0.94); await new Promise((r) => setTimeout(r, 0)); }
  }
  await ve.flush();
  ve.close();

  if (mix && hasAudio) {
    const ae = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
    ae.configure(audioConfig);
    const [left, right] = [mix.getChannelData(0), mix.getChannelData(1)];
    const size = 4800;
    for (let at = 0; at < mix.length; at += size) {
      const n = Math.min(size, mix.length - at);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(at, at + n), 0);
      data.set(right.subarray(at, at + n), n);
      const clip = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / RATE) * 1e6), data });
      ae.encode(clip);
      clip.close();
    }
    await ae.flush();
    ae.close();
  }
  if (failure) throw failure;
  onProgress(1);
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
