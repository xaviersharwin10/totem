// Talk to the Totem. Replies come from /api/voice (web/server/voice.ts): a model
// on NEAR AI Cloud, in character, grounded in the Totem's on-chain state.
// The newest line also floats over the panda's head as a speech bubble.

import { useEffect, useRef, useState } from "react";
import type { Game } from "./game";
import { Rich } from "./rich";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface Speech {
  id: number;
  text: string;
  typing?: boolean;
}

const SUGGESTIONS = ["How are you feeling?", "Who feeds you the most?", "Tell me about your ancestors", "How do I save you?"];
const SPEECH_MS = 9000;

export function useTotemChat(game: Game) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [speech, setSpeech] = useState<Speech | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastHello = useRef(0);
  const gen = useRef<number | null>(null);

  // a new generation is a new panda: start a fresh conversation
  useEffect(() => {
    const g = game.view?.generation ?? null;
    if (g !== null && gen.current !== null && g !== gen.current) setMessages([]);
    gen.current = g;
  }, [game.view?.generation]);

  const say = (text: string) => {
    clearTimeout(speechTimer.current);
    setSpeech({ id: Date.now(), text });
    speechTimer.current = setTimeout(() => setSpeech(null), SPEECH_MS);
  };

  const ask = async (history: ChatMsg[], trigger?: "fed" | "hello" | "rescue"): Promise<string> => {
    setTyping(true);
    clearTimeout(speechTimer.current);
    setSpeech({ id: Date.now(), text: "", typing: true });
    try {
      const v = game.view;
      const body = {
        messages: history,
        trigger,
        accountId: game.mode === "live" ? game.accountId || undefined : undefined,
        events: game.events.slice(0, 6).map((e) => e.text),
        practice:
          game.mode === "practice" && v
            ? { ...v, graves: game.graves }
            : undefined,
      };
      const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { reply?: string };
      return j.reply || "*munch munch* …";
    } catch {
      return "*rustles in the bamboo* I can't hear you right now…";
    } finally {
      setTyping(false);
    }
  };

  const send = async (text: string) => {
    const t = text.trim().slice(0, 300);
    if (!t || typing) return;
    const history = [...messages, { role: "user" as const, content: t }];
    setMessages(history);
    const reply = await ask(history);
    setMessages((m) => [...m, { role: "assistant", content: reply }]);
    say(reply);
  };

  /** Tapped the panda: a greeting, at most every 12 s. */
  const hello = async () => {
    if (typing || Date.now() - lastHello.current < 12_000) return;
    lastHello.current = Date.now();
    const reply = await ask(messages, "hello");
    setMessages((m) => [...m, { role: "assistant", content: reply }]);
    say(reply);
  };

  /** The player just fed it (at most every 20 s, to spare the AI credits). */
  const lastFed = useRef(0);
  const fed = async (why: "fed" | "rescue" = "fed") => {
    if (typing || (why === "fed" && Date.now() - lastFed.current < 20_000)) return;
    lastFed.current = Date.now();
    const reply = await ask(messages, why);
    setMessages((m) => [...m, { role: "assistant", content: reply }]);
    say(reply);
  };

  return { messages, typing, speech, send, hello, fed };
}

export function TotemChat({
  name,
  live,
  chat,
  onClose,
}: {
  name: string;
  live: boolean;
  chat: ReturnType<typeof useTotemChat>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.typing]);

  const submit = (t: string) => {
    chat.send(t);
    setText("");
  };

  return (
    <div className="chat glass" onKeyDown={(e) => e.stopPropagation()}>
      <div className="chat-head">
        <span>💬 Talk to {name}</span>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="chat-list" ref={list}>
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            {live
              ? "It remembers who fed it, its ancestors and how hungry it is, all read live from the chain. Its personality comes from its on-chain traits."
              : "Practice farm: it knows its belly, level and graveyard from this browser's game."}
          </div>
        )}
        {chat.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.role === "assistant" ? <Rich text={m.content} /> : m.content}</div>
        ))}
        {chat.typing && (
          <div className="msg assistant"><span className="dots"><i /><i /><i /></span></div>
        )}
      </div>
      <div className="chat-sugg">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => submit(s)} disabled={chat.typing}>{s}</button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Say something to ${name}…`} maxLength={300} />
        <button className="press-btn" disabled={chat.typing || !text.trim()}>Send</button>
      </form>
      <div className="chat-foot">AI on NEAR AI Cloud · {live ? "facts read from the NEAR contract" : "practice mode"}</div>
    </div>
  );
}
