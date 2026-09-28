'use client';
import { useState } from 'react';
import { Bot, Sparkles, X, Send, Minimize2 } from 'lucide-react';

type Msg = { role: 'bot' | 'user'; text: string };

const suggestions = [
  'Why is production at risk?',
  'Show high prospectivity zones.',
  'What is causing the shortfall?',
  'Explain Zone A.',
];

function answer(q: string): string {
  const s = q.toLowerCase();
  if (s.includes('risk')) return 'Operational risk is elevated at 84%, driven mainly by equipment downtime in Zone B and a medium-probability heavy-rainfall event. Recommended: redeploy available equipment and adjust the blasting schedule.';
  if (s.includes('prospectivity') || s.includes('high') || s.includes('zone')) return 'Zone A currently shows the highest manganese prospectivity score at 87%, followed by Zone B at 72%. These are prototype prospectivity scores, not confirmed reserves.';
  if (s.includes('shortfall') || s.includes('production')) return 'The expected shortfall is 1,580 T against a 10,000 T target. Main contributors: equipment downtime (46%), rainfall (27%) and blasting delay (18%).';
  if (s.includes('zone a')) return 'Zone A: 87% prospectivity, 91% model confidence, 28% operational risk. Key indicators are geological proximity, spectral features and terrain characteristics. Status: high potential.';
  return "I can help with prospectivity zones, production forecasts, risk factors and recommended actions. This is a frontend demo — responses use prototype data and are structured so a real model can be connected later.";
}

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'bot', text: 'How can I help you explore the mine?' },
  ]);
  const [input, setInput] = useState('');

  function send(text: string) {
    if (!text.trim()) return;
    setMessages(m => [...m, { role: 'user', text }, { role: 'bot', text: answer(text) }]);
    setInput('');
  }

  if (!open) {
    return (
      <button className="chat-launcher" onClick={() => { setOpen(true); setMinimized(false); }} aria-label="Open Mn 25 AI assistant">
        <span className="chat-launcher-icon"><Sparkles size={15} /></span>
        <span>Mn 25 AI</span><span className="chat-online-dot" />
      </button>
    );
  }

  if (minimized) {
    return (
      <div className="chat-minimized">
        <button onClick={() => setMinimized(false)}><Bot size={15} /> Mn 25 AI</button>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={14} /></button>
      </div>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="Mn 25 AI assistant">
      <div className="chat-head">
        <div className="chat-agent">
          <div className="chat-agent-icon"><Bot size={17} /></div>
          <div><b>Mn 25 AI</b><div className="sub2"><span className="chat-online-dot" /> Intelligence assistant · demo</div></div>
        </div>
        <div className="chat-head-actions">
          <button className="icon-btn" onClick={() => setMinimized(true)} aria-label="Minimize assistant"><Minimize2 size={14} /></button>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={14} /></button>
        </div>
      </div>
      <div className="chat-body">
        <div className="chat-context">MN25 · Manganese Intelligence</div>
        {messages.map((m, i) => <div className={`chat-msg ${m.role}`} key={i}><span>{m.text}</span></div>)}
      </div>
      {messages.length < 3 && (
        <div className="chat-suggest">
          {suggestions.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <form className="chat-input" onSubmit={e => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about the mine..." aria-label="Message" />
        <button type="submit" aria-label="Send"><Send size={15} /></button>
      </form>
    </div>
  );
}
