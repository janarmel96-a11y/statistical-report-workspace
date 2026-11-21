// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { bestVoice, splitSentences, spokenText } from '../video/speech';

/** Reads Present mode slides aloud with a voice installed on this device. Nothing is sent anywhere. */

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

/** Ends a phrase with a full stop, so the voice pauses between items. */
export const sentence = (s: string) => { const t = s.trim(); return !t || /[.!?]$/.test(t) ? t : `${t}.`; };

/**
 * Speaks the text one sentence at a time and calls onDone once, shortly after the last sentence.
 * Returns a function that stops the voice. If the browser never reports the end, a time limit moves on.
 */
export function speak(text: string, onDone: () => void): () => void {
  let stopped = false;
  let finished = false;
  const finish = () => { if (!finished && !stopped) { finished = true; onDone(); } };
  const sentences = splitSentences(spokenText(text));
  if (!canSpeak() || !sentences.length) {
    const t = setTimeout(finish, 9000);
    return () => { stopped = true; clearTimeout(t); };
  }
  const voices = speechSynthesis.getVoices();
  const name = bestVoice(voices);
  const voice = voices.find((v) => v.name === name);
  const words = text.split(/\s+/).length;
  const guard = setTimeout(finish, Math.max(7000, (words / 1.8) * 1000 + 6000));
  speechSynthesis.cancel();
  sentences.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s);
    if (voice) u.voice = voice;
    if (i === sentences.length - 1) {
      u.onend = () => setTimeout(finish, 800);
      u.onerror = () => setTimeout(finish, 800);
    }
    speechSynthesis.speak(u);
  });
  return () => { stopped = true; clearTimeout(guard); speechSynthesis.cancel(); };
}
