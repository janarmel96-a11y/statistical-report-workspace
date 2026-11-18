// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lightbulb, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { askAssistant, emptyMemory, suggestedQuestions, suggestImprovements, type AssistantAction, type AssistantContext, type AssistantMemory, type AssistantReply } from '../core/assistant';
import { newId } from '../core/insights';
import type { Constraint } from '../core/types';
import { useStore } from '../state/store';

interface Message { id: number; from: 'you' | 'assistant'; text: string; reply?: AssistantReply }

export function AssistantPanel({ cs }: { cs: Constraint[] }) {
  const s = useStore();
  const memory: AssistantMemory = s.report?.assistant ?? emptyMemory();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [used, setUsed] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const ctx: AssistantContext = { en: s.engine!, report: s.report!, findings: s.findings.filter((f) => !s.disabled.includes(f.id) || !f.steps.length), cs, memory };
  const suggestions = useMemo(() => suggestImprovements(ctx).slice(0, 3), [s.revision, memory.dismissed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  const remember = (next: AssistantMemory) => s.mutateReport((r) => ({ ...r, assistant: next }), false);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    const reply = askAssistant(q, ctx);
    const learned = reply.actions.find((a) => a.type === 'remember');
    const key = q.toLowerCase();
    remember({
      ...memory,
      synonyms: learned?.type === 'remember' ? { ...memory.synonyms, [learned.word]: learned.column } : memory.synonyms,
      asked: { ...memory.asked, [key.length <= 60 ? q : q.slice(0, 60)]: (memory.asked[key] ?? 0) + 1 },
    });
    setMessages((m) => [...m, { id: m.length, from: 'you', text: q }, { id: m.length + 1, from: 'assistant', text: reply.text, reply }]);
    setInput('');
  };

  const run = (a: AssistantAction) => {
    const name = `${a.label}:${JSON.stringify(a).length}`;
    setUsed((u) => [...u, name]);
    switch (a.type) {
      case 'addChart': {
        const v = { ...a.visual, id: newId() };
        s.mutatePage((p) => ({ ...p, visuals: [...p.visuals, v], layout: [...p.layout, { i: v.id, x: 0, y: 9999, w: 6, h: 8 }] }));
        s.selectVisual(v.id);
        s.toast('success', `${v.title} was added to this page.`);
        break;
      }
      case 'addMeasure':
        s.mutateReport((r) => ({ ...r, measures: [...r.measures.filter((m) => m.name !== a.measure.name), a.measure] }));
        s.toast('success', `${a.measure.name} was added to your measures.`);
        break;
      case 'filter': s.setSlicer({ col: a.field.col, part: a.field.part, values: a.values }); break;
      case 'forecast':
        s.mutateReport((r) => ({ ...r, pages: r.pages.map((p) => ({ ...p, visuals: p.visuals.map((v) => (v.id === a.visualId ? { ...v, forecast: true } : v)) })) }));
        s.toast('success', 'The forecast was added to the trend chart.');
        break;
      case 'openData': s.setRoute('prepare'); break;
      default: break;
    }
  };
  const isUsed = (a: AssistantAction) => used.includes(`${a.label}:${JSON.stringify(a).length}`);

  return (
    <div className="assistant">
      <p className="assistant-note"><ShieldCheck size={14} /> Runs only on this device and learns only from this report.</p>
      {!messages.length && suggestions.length > 0 && (
        <section className="tips" aria-label="Suggested improvements">
          <h3 className="side-h"><Lightbulb size={13} /> Suggested for this report</h3>
          {suggestions.map((x) => (
            <article key={x.id} className="tip">
              <button className="icon-btn sm tip-x" aria-label={`Dismiss ${x.title}`} onClick={() => remember({ ...memory, dismissed: [...memory.dismissed, x.id] })}><X size={13} /></button>
              <b>{x.title}</b><p>{x.why}</p>
              {x.action && <button className="btn sm" disabled={isUsed(x.action)} onClick={() => run(x.action!)}>{isUsed(x.action) ? <><Check size={13} /> Done</> : x.action.label}</button>}
            </article>
          ))}
        </section>
      )}
      <div className="chat" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from}`}>
            <p>{m.text}</p>
            {m.reply?.table && <div className="vt small"><table><thead><tr>{m.reply.table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{m.reply.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="wrap">{c}</td>)}</tr>)}</tbody></table></div>}
            {m.reply && m.reply.actions.filter((a) => a.type !== 'remember').length > 0 && (
              <div className="row-wrap">{m.reply.actions.filter((a) => a.type !== 'remember').map((a, i) => <button key={i} className="btn sm" disabled={isUsed(a)} onClick={() => run(a)}>{isUsed(a) ? <><Check size={13} /> Done</> : a.label}</button>)}</div>
            )}
            {m.reply && m.reply.followUps.length > 0 && <div className="chips">{m.reply.followUps.map((f) => <button key={f} className="chip-btn" onClick={() => ask(f)}>{f}</button>)}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      {!messages.length && <div className="chips">{suggestedQuestions(memory).map((q) => <button key={q} className="chip-btn" onClick={() => ask(q)}>{q}</button>)}</div>}
      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <Sparkles size={15} aria-hidden="true" />
        <input aria-label="Ask about this report" placeholder="Ask about this report" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="icon-btn sm" aria-label="Send" disabled={!input.trim()}><Send size={14} /></button>
      </form>
    </div>
  );
}
