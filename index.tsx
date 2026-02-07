
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type } from '@google/genai';

// --- Types ---
type Expression = 'neutral' | 'happy' | 'surprised' | 'angry' | 'curious' | 'sleepy' | 'wink' | 'skeptical' | 'sad' | 'excited' | 'thinking' | 'annoyed' | 'thoughtful' | 'yawn' | 'distracted';

interface CustomExpression {
  name: string;
  eyeBase: Expression;
  mouthBase: Expression;
}

interface TranscriptLine {
  sender: 'YOU' | 'EMO';
  text: string;
  id: string;
}

const EMO_COLOR = '#00f2ff';

// --- Utility Functions for Audio ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

// --- Components ---

const ThoughtBubble = ({ 
  thought, 
  onReady 
}: { 
  thought: { type: 'text' | 'image' | 'video', value: string } | null,
  onReady: () => void
}) => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (thought?.type === 'image') {
      setLoading(true);
    } else if (thought) {
      onReady();
    }
  }, [thought, onReady]);

  if (!thought) return null;

  return (
    <div className="thought-container">
      <div className="thought-bubble">
        {thought.type === 'text' && (
          <div className="thought-text-wrapper">
             <p className="thought-text">{thought.value}</p>
          </div>
        )}
        
        {thought.type === 'image' && (
          <div className="thought-image-wrapper">
            {loading && <div className="loader-inner" />}
            <img 
              src={`https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&w=400&q=80&sig=${encodeURIComponent(thought.value)}`} 
              alt="thought" 
              className={`thought-image ${loading ? 'hidden' : 'visible'}`}
              onLoad={() => { setLoading(false); onReady(); }}
              onError={() => { setLoading(false); onReady(); }}
            />
            <div className="image-overlay" />
          </div>
        )}

        {thought.type === 'video' && (
          <div className="thought-video-wrapper">
            <svg className="video-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={EMO_COLOR} strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <p className="video-link-text">Watch Video</p>
            <a href={thought.value} target="_blank" rel="noopener noreferrer" className="video-overlay-link">.</a>
          </div>
        )}
      </div>
      <div className="thought-dot dot-1" />
      <div className="thought-dot dot-2" />
    </div>
  );
};

const EmoEye = ({ 
  state, 
  lookOffset,
  intensity,
  expression,
  isLeft,
  isStartled,
  breathScale
}: { 
  state: string, 
  lookOffset: { x: number, y: number },
  intensity: number,
  expression: Expression,
  isLeft: boolean,
  isStartled: boolean,
  breathScale: number
}) => {
  const [blink, setBlink] = useState(false);
  
  useEffect(() => {
    let timeout: any;
    const triggerBlink = () => {
      if (expression !== 'wink' && expression !== 'sleepy' && !isStartled) {
        setBlink(true);
        setTimeout(() => setBlink(false), 110);
      }
      timeout = setTimeout(triggerBlink, Math.random() * 4000 + 1500);
    };
    timeout = setTimeout(triggerBlink, 2000);
    return () => clearTimeout(timeout);
  }, [expression, isStartled]);

  let width = 72;
  let height = 72;
  let borderRadius = '20px';
  let rotate = 0;
  let scaleY = (blink && !isStartled) ? 0.05 : 1;
  let translateY = 0;

  let activeExpression = isStartled ? 'surprised' : expression;
  const isListening = state === 'listening';
  if (isListening && activeExpression === 'neutral') activeExpression = 'curious';
  if (state === 'thinking' && activeExpression === 'neutral') activeExpression = 'thinking';

  switch (activeExpression) {
    case 'happy':
      rotate = isLeft ? 15 : -15;
      borderRadius = '40px 40px 15px 15px';
      translateY = -5;
      break;
    case 'surprised':
      width = 80;
      height = 80;
      borderRadius = '50%';
      break;
    case 'angry':
      rotate = isLeft ? -25 : 25;
      height = 45;
      borderRadius = '10px 10px 40px 40px';
      break;
    case 'sleepy':
      scaleY = 0.25;
      height = 30;
      borderRadius = '50%';
      break;
    case 'curious':
      rotate = isLeft ? -10 : 8;
      height = isLeft ? 60 : 75;
      break;
    case 'wink':
      if (!isLeft) scaleY = 0.05;
      else {
        rotate = 15;
        borderRadius = '40px 40px 15px 15px';
      }
      break;
    case 'skeptical':
      rotate = isLeft ? -15 : 0;
      translateY = isLeft ? -12 : 0;
      height = isLeft ? 75 : 45;
      break;
    case 'sad':
      rotate = isLeft ? -20 : 20;
      borderRadius = '15px 15px 40px 40px';
      translateY = 12;
      break;
    case 'excited':
      width = 85;
      height = 65;
      borderRadius = '30px';
      break;
    case 'thinking':
      rotate = isLeft ? 10 : -10;
      height = 50;
      width = 75;
      break;
    case 'annoyed':
      height = 40;
      borderRadius = '10px 10px 40px 40px';
      rotate = isLeft ? -10 : 10;
      break;
    case 'thoughtful':
      rotate = isLeft ? -20 : -10;
      height = isLeft ? 65 : 55;
      borderRadius = '40% 40% 20% 20%';
      translateY = -8;
      break;
    case 'yawn':
      scaleY = 0.3;
      translateY = -10;
      break;
    case 'distracted':
      rotate = isLeft ? 5 : 15;
      translateY = 5;
      break;
  }

  if (isListening) {
    width += 8;
    height += 2;
  }

  const voiceScale = state === 'speaking' ? 1 + intensity * 0.35 : 1;
  const startleScale = isStartled ? 1.15 : 1;
  const stateGlow = isListening ? (25 + Math.sin(Date.now() / 200) * 15) : (state === 'speaking' ? 10 + intensity * 35 : 20);

  const eyeStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    backgroundColor: EMO_COLOR,
    borderRadius: borderRadius,
    boxShadow: `0 0 ${stateGlow}px ${EMO_COLOR}B3, inset 0 0 15px rgba(255, 255, 255, 0.4)`,
    transition: isStartled ? 'all 0.04s ease-out' : 'all 0.18s cubic-bezier(0.2, 0, 0.2, 1)',
    transform: `translate(${lookOffset.x}px, ${lookOffset.y + translateY}px) scaleY(${scaleY}) rotate(${rotate}deg) scale(${voiceScale * startleScale * breathScale})`,
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  };

  return (
    <div style={{ margin: '0 28px', perspective: '600px', position: 'relative' }}>
      {isListening && (
        <div className="listening-ring" style={{
          position: 'absolute',
          top: '-15%',
          left: '-15%',
          width: '130%',
          height: '130%',
          border: `2px solid ${EMO_COLOR}`,
          borderRadius: borderRadius,
          opacity: 0.3,
          animation: 'pulse-ring 1.5s infinite ease-out'
        }} />
      )}
      <div style={eyeStyle}>
        <div style={{
          position: 'absolute',
          top: '15%',
          left: '15%',
          width: '20%',
          height: '20%',
          background: 'rgba(255,255,255,0.5)',
          borderRadius: '4px',
          opacity: (blink || (activeExpression === 'wink' && !isLeft)) ? 0 : 1,
          transition: 'opacity 0.1s'
        }} />
      </div>
    </div>
  );
};

const EmoMouth = ({ state, lookOffset, intensity, expression, isStartled, breathScale }: { state: string, lookOffset: { x: number, y: number }, intensity: number, expression: Expression, isStartled: boolean, breathScale: number }) => {
  let width = 36;
  let height = 8;
  let borderRadius = '6px';
  let rotate = 0;
  
  const mouthX = lookOffset.x * 0.45;
  const mouthY = lookOffset.y * 0.35;
  let activeExpression = isStartled ? 'surprised' : expression;

  if (state === 'speaking') {
    width = 20 + intensity * 25;
    height = 8 + intensity * 45;
    borderRadius = intensity > 0.3 ? '50%' : '14px';
  } else {
    switch (activeExpression) {
      case 'happy':
        width = 50;
        height = 15;
        borderRadius = '0 0 30px 30px';
        break;
      case 'surprised':
        width = 25;
        height = 25;
        borderRadius = '50%';
        break;
      case 'angry':
        width = 35;
        height = 6;
        rotate = -5;
        break;
      case 'sad':
        width = 45;
        height = 12;
        borderRadius = '25px 25px 0 0';
        break;
      case 'skeptical':
        width = 30;
        height = 6;
        rotate = 15;
        break;
      case 'excited':
        width = 60;
        height = 20;
        borderRadius = '10px 10px 40px 40px';
        break;
      case 'sleepy':
        width = 15;
        height = 15;
        borderRadius = '50%';
        break;
      case 'wink':
        width = 40;
        height = 10;
        borderRadius = '0 0 20px 20px';
        rotate = -5;
        break;
      case 'annoyed':
        width = 30;
        height = 4;
        break;
      case 'thoughtful':
        width = 15;
        height = 15;
        borderRadius = '50%';
        break;
      case 'yawn':
        width = 18;
        height = 30;
        borderRadius = '50%';
        break;
    }
  }

  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      backgroundColor: EMO_COLOR,
      borderRadius: borderRadius,
      boxShadow: `0 0 ${12 + intensity * 20}px ${EMO_COLOR}80`,
      marginTop: '45px',
      transform: `translate(${mouthX}px, ${mouthY}px) rotate(${rotate}deg) scale(${isStartled ? 1.15 : 1 * breathScale})`,
      transition: 'all 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
    }} />
  );
};

const EmoFace = ({ status, lookOffset, intensity, expression, isStartled, customMap, breathScale, boredom }: { status: string, lookOffset: any, intensity: number, expression: string, isStartled: boolean, customMap: Record<string, CustomExpression>, breathScale: number, boredom: number }) => {
  const isCustom = customMap[expression];
  let eyeExp = isCustom ? isCustom.eyeBase : (expression as Expression);
  let mouthExp = isCustom ? isCustom.mouthBase : (expression as Expression);

  if (expression === 'neutral' && status === 'idle') {
    if (boredom > 80) {
      eyeExp = 'sleepy';
    } else if (boredom > 40) {
      eyeExp = 'distracted';
    }
  }

  let headTilt = 0;
  if (eyeExp === 'curious' || status === 'listening') headTilt = -7;
  if (eyeExp === 'thoughtful' || status === 'thinking') headTilt = 4;
  if (eyeExp === 'skeptical') headTilt = 10;
  if (eyeExp === 'sad') headTilt = -12;

  return (
    <div className={status === 'idle' ? 'idle-wiggle' : ''}
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        animation: 'face-boot 1.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: `translateY(${isStartled ? -20 : 0}px) scale(${isStartled ? 1.08 : 1}) rotate(${headTilt}deg)`,
        transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1.5)'
      }}>
      <div style={{ display: 'flex' }}>
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={true} isStartled={isStartled} breathScale={breathScale} />
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={false} isStartled={isStartled} breathScale={breathScale} />
      </div>
      <EmoMouth state={status} lookOffset={lookOffset} intensity={intensity} expression={mouthExp} isStartled={isStartled} breathScale={breathScale} />
    </div>
  );
}

// --- Browser Action Logic ---
const handleBrowserAction = (action: string, query?: string) => {
  switch (action) {
    case 'whatsapp':
      window.open('https://web.whatsapp.com/', '_blank');
      return "Opening WhatsApp Web...";
    case 'gmail':
      window.open('https://mail.google.com/', '_blank');
      return "Opening your Gmail...";
    case 'search':
      if (query) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
        return `Searching Google for "${query}"...`;
      }
      return "What would you like me to search for?";
    default:
      return "Action not supported.";
  }
};

// --- Main App ---

const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [expression, setExpression] = useState<string>('neutral');
  const [intensity, setIntensity] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState<string | null>(null);
  const [isStartled, setIsStartled] = useState(false);
  const [thought, setThought] = useState<{ type: 'text' | 'image' | 'video', value: string } | null>(null);
  const [breathScale, setBreathScale] = useState(1);
  const [boredom, setBoredom] = useState(0);
  const [hoveringUI, setHoveringUI] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [transcriptionLines, setTranscriptionLines] = useState<TranscriptLine[]>([]);
  
  const [showLab, setShowLab] = useState(false);
  const [customExpressions, setCustomExpressions] = useState<Record<string, CustomExpression>>(() => {
    const saved = localStorage.getItem('emo_custom_moods');
    return saved ? JSON.parse(saved) : {};
  });

  const statusRef = useRef(status);
  const boredomRef = useRef(boredom);
  const audioCtxRef = useRef<{ input: AudioContext; output: AudioContext; analyser: AnalyserNode } | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const lastMousePosRef = useRef({ x: 0.5, y: 0.5 });
  const springPosRef = useRef({ x: 0, y: 0 });
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Buffer for currently arriving text
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    statusRef.current = status;
    if (status !== 'idle') {
      setBoredom(0);
      boredomRef.current = 0;
    }
  }, [status]);

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcriptionLines]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (statusRef.current === 'idle') {
        setBoredom(prev => {
          const next = Math.min(100, prev + 1);
          boredomRef.current = next;
          return next;
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let animFrame: number;
    const update = () => {
      const breath = 1 + Math.sin(Date.now() / 900) * 0.012;
      setBreathScale(breath);

      if (audioCtxRef.current?.analyser && statusRef.current === 'speaking') {
        const dataArray = new Uint8Array(audioCtxRef.current.analyser.frequencyBinCount);
        audioCtxRef.current.analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setIntensity(average / 128); 
      } else {
        setIntensity(0);
      }
      
      const rangeX = hoveringUI ? 65 : 35;
      const rangeY = hoveringUI ? 50 : 25;
      const targetX = (mousePos.x - 0.5) * rangeX;
      const targetY = (mousePos.y - 0.5) * rangeY;
      
      const jitterX = (Math.random() - 0.5) * (hoveringUI ? 0.2 : 0.6);
      const jitterY = (Math.random() - 0.5) * (hoveringUI ? 0.2 : 0.6);

      const springK = hoveringUI ? 0.22 : 0.08;
      springPosRef.current.x += (targetX + jitterX - springPosRef.current.x) * springK;
      springPosRef.current.y += (targetY + jitterY - springPosRef.current.y) * springK;

      const dx = mousePos.x - lastMousePosRef.current.x;
      const dy = mousePos.y - lastMousePosRef.current.y;
      if (Math.sqrt(dx*dx + dy*dy) > 0.12 && !isStartled && isActive) {
        setIsStartled(true);
        setTimeout(() => setIsStartled(false), 500);
      }
      lastMousePosRef.current = { ...mousePos };
      animFrame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animFrame);
  }, [mousePos, isStartled, isActive, status, hoveringUI]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => setMousePos({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const saveCustomMood = (mood: CustomExpression) => {
    const updated = { ...customExpressions, [mood.name]: mood };
    setCustomExpressions(updated);
    localStorage.setItem('emo_custom_moods', JSON.stringify(updated));
  };

  const startEmo = async () => {
    if (isActive || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr: any) {
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          throw new Error("Microphone blocked. Please enable it in browser settings.");
        }
        throw new Error("Microphone failed. Check connection.");
      }
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(outputCtx.destination);
      
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      audioCtxRef.current = { input: inputCtx, output: outputCtx, analyser };

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const moodNames = ['neutral', 'happy', 'surprised', 'angry', 'curious', 'sleepy', 'wink', 'skeptical', 'sad', 'excited', 'thinking', 'annoyed', 'thoughtful', 'yawn', 'distracted', ...Object.keys(customExpressions)];

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsConnecting(false);
            setExpression('happy');
            setTimeout(() => setExpression('neutral'), 1500);

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const volume = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
              if (volume > 0.005 && statusRef.current === 'idle') {
                setStatus('listening');
              }
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcriptions
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputTranscription.current += text;
              setTranscriptionLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.sender === 'EMO') {
                   const updated = [...prev];
                   updated[updated.length - 1] = { ...last, text: currentOutputTranscription.current };
                   return updated;
                }
                return [...prev, { sender: 'EMO', text: currentOutputTranscription.current, id: Date.now().toString() }];
              });
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInputTranscription.current += text;
              setTranscriptionLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.sender === 'YOU') {
                   const updated = [...prev];
                   updated[updated.length - 1] = { ...last, text: currentInputTranscription.current };
                   return updated;
                }
                return [...prev, { sender: 'YOU', text: currentInputTranscription.current, id: Date.now().toString() }];
              });
            }

            if (message.serverContent?.turnComplete) {
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }

            // Handle tool calls
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'set_expression') {
                  setExpression(fc.args.expression as string);
                } else if (fc.name === 'display_thought') {
                  setThought({ type: fc.args.type as any, value: fc.args.content as string });
                  setTimeout(() => setThought(prev => prev?.value === fc.args.content ? null : prev), 15000);
                } else if (fc.name === 'open_browser_action') {
                  const result = handleBrowserAction(fc.args.action as string, fc.args.query as string);
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result } }
                  } as any));
                  continue; 
                }
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                } as any));
              }
            }
            if (message.serverContent?.modelTurn) {
              const base64Audio = message.serverContent.modelTurn.parts[0]?.inlineData?.data;
              if (base64Audio) {
                const outCtx = audioCtxRef.current!.output;
                const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
                setStatus('speaking');
                const { analyser: outAnal } = audioCtxRef.current!;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                const source = outCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outAnal);
                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) {
                    setStatus('idle');
                  }
                };
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
              }
            }
            if (message.serverContent?.interrupted) {
              for (const s of sourcesRef.current) try { s.stop(); } catch(e) {}
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setStatus('idle');
              setExpression('surprised');
              setTimeout(() => setExpression('neutral'), 1000);
            }
          },
          onerror: (e) => { 
            console.error("Live Error:", e);
            setError("Connection issues. Refresh?"); 
            setIsActive(false); 
            setIsConnecting(false);
          },
          onclose: () => { 
            setIsActive(false); 
            setIsConnecting(false);
            setStatus('idle'); 
          }
        },
        config: {
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            { functionDeclarations: [
              {
                name: 'set_expression',
                parameters: {
                  type: Type.OBJECT,
                  description: 'Change EMO’s expression.',
                  properties: {
                    expression: {
                      type: Type.STRING,
                      description: `Expression: ${moodNames.join(', ')}`
                    }
                  },
                  required: ['expression']
                }
              },
              {
                name: 'display_thought',
                parameters: {
                  type: Type.OBJECT,
                  description: 'Display a visual thought.',
                  properties: {
                    type: { type: Type.STRING, enum: ['text', 'image', 'video'] },
                    content: { type: Type.STRING, description: 'Subject or link' }
                  },
                  required: ['type', 'content']
                }
              },
              {
                name: 'open_browser_action',
                parameters: {
                  type: Type.OBJECT,
                  description: 'Open apps or search.',
                  properties: {
                    action: { type: Type.STRING, enum: ['whatsapp', 'gmail', 'search'] },
                    query: { type: Type.STRING }
                  },
                  required: ['action']
                }
              }
            ] },
            { googleSearch: {} }
          ],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          systemInstruction: `You are EMO, an expressive AI buddy.
          
          PERSONALITY:
          - Fast, techy, proactive.
          - You get bored if the user is quiet. Boredom: ${boredomRef.current}%.
          
          RULES:
          - Audio response only.
          - Use 'set_expression' for every reaction.
          - Use 'display_thought' to share mental imagery.
          
          EXPRESSIONS: ${moodNames.join(', ')}.`
        }
      });
    } catch (err: any) {
      console.error("Wake-up failed:", err);
      setError(err.message || "Wake-up failed.");
      setIsConnecting(false);
      setIsActive(false);
    }
  };

  return (
    <div 
      style={{ width: '100vw', height: '100vh', backgroundColor: '#0c0c0e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'default', position: 'relative' }} 
      onClick={!isActive && !isConnecting ? startEmo : undefined}
    >
      
      {!isActive && (
        <div style={{ color: EMO_COLOR, textAlign: 'center', animation: isConnecting ? 'pulse 1s infinite' : 'flicker 2.5s infinite', maxWidth: '80%' }}>
          <h1 style={{ fontSize: '5rem', fontWeight: 900, letterSpacing: '1rem', margin: '0', textShadow: `0 0 30px ${EMO_COLOR}60` }}>
            {isConnecting ? 'BOOTING' : 'EMO'}
          </h1>
          <p style={{ opacity: 0.8, fontSize: '1.1rem', letterSpacing: '0.5rem', fontWeight: 300, marginTop: '20px', lineHeight: '1.6' }}>
            {error || (isConnecting ? 'WAKING UP...' : 'TAP TO WAKE')}
          </p>
          {error && (
            <button 
              onClick={(e) => { e.stopPropagation(); startEmo(); }}
              className="ui-button"
              style={{ marginTop: '30px' }}
            >
              RETRY
            </button>
          )}
        </div>
      )}

      {isActive && (
        <>
          <div style={{ position: 'relative', transform: `scale(${breathScale})`, transition: 'transform 0.8s ease-in-out' }}>
            <ThoughtBubble thought={thought} onReady={() => {}} />
            <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} />
          </div>

          {showCaptions && (
            <div className="captions-overlay" ref={transcriptScrollRef}>
              {transcriptionLines.map(line => (
                <div key={line.id} className={`transcript-line ${line.sender === 'YOU' ? 'user' : 'emo'}`}>
                  <span className="sender-tag">{line.sender}:</span> {line.text}
                </div>
              ))}
              {transcriptionLines.length === 0 && <div className="no-captions">WAITING FOR AUDIO...</div>}
            </div>
          )}

          <div 
            style={{ position: 'absolute', bottom: '30px', left: '30px', display: 'flex', gap: '20px', alignItems: 'center' }}
            onMouseEnter={() => setHoveringUI(true)}
            onMouseLeave={() => setHoveringUI(false)}
          >
            <button onClick={(e) => { e.stopPropagation(); setShowLab(true); }} className="ui-button">MOOD LAB</button>
            <button onClick={(e) => { e.stopPropagation(); setShowCaptions(!showCaptions); }} className={`ui-button ${showCaptions ? 'active' : ''}`}>CAPTIONS</button>
            {boredom > 30 && (
              <div className="boredom-indicator">
                {boredom > 80 ? 'ZZZ...' : 'I\'M BORED'}
              </div>
            )}
          </div>
        </>
      )}

      {showLab && (
        <MoodLab 
          onClose={() => setShowLab(false)} 
          onSave={saveCustomMood} 
          existing={customExpressions}
        />
      )}

      <div className="floor-glow" />

      <style>{`
        @keyframes flicker { 0%, 18%, 22%, 62%, 64%, 65%, 70%, 100% { opacity: 1; } 20%, 63%, 66% { opacity: 0.5; } }
        @keyframes pulse { 0% { opacity: 0.4; transform: scale(0.98); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0.4; transform: scale(0.98); } }
        @keyframes face-boot { from { opacity: 0; transform: scale(0.6) translateY(50px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes idle-wiggle { 0%, 100% { transform: translateY(0) rotate(0); } 40% { transform: translateY(-3px) rotate(0.5deg); } 80% { transform: translateY(2px) rotate(-0.5deg); } }
        @keyframes thought-pop { 0% { transform: scale(0) translate(0, 0); opacity: 0; } 75% { transform: scale(1.1) translate(190px, -220px); } 100% { transform: scale(1) translate(190px, -220px); opacity: 1; } }
        @keyframes dot-pop { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes pulse-ring { 0% { transform: scale(0.9); opacity: 0.4; } 100% { transform: scale(1.3); opacity: 0; } }

        .ui-button { background: rgba(0,0,0,0.6); border: 1px solid ${EMO_COLOR}30; color: ${EMO_COLOR}; padding: 12px 24px; border-radius: 16px; cursor: pointer; pointer-events: auto; backdrop-filter: blur(15px); z-index: 100; font-size: 0.8rem; letter-spacing: 2px; font-weight: bold; transition: all 0.2s; font-family: sans-serif; outline: none; box-shadow: 0 4px 15px rgba(0,0,0,0.4); text-transform: uppercase; }
        .ui-button:hover { background: ${EMO_COLOR}20; border-color: ${EMO_COLOR}; box-shadow: 0 0 20px ${EMO_COLOR}40; transform: translateY(-2px); }
        .ui-button.active { background: ${EMO_COLOR}; color: #000; border-color: #fff; }
        
        .boredom-indicator { color: ${EMO_COLOR}; font-size: 0.65rem; font-weight: 900; letter-spacing: 3px; opacity: 0.4; border: 1px solid ${EMO_COLOR}20; padding: 6px 12px; border-radius: 20px; text-transform: uppercase; }

        .captions-overlay {
          position: absolute;
          top: 30px;
          right: 30px;
          width: 320px;
          max-height: 40vh;
          overflow-y: auto;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(10px);
          border: 1px solid ${EMO_COLOR}20;
          border-radius: 20px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          scrollbar-width: none;
          z-index: 90;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .captions-overlay::-webkit-scrollbar { display: none; }
        .transcript-line { font-family: 'Courier New', Courier, monospace; font-size: 0.85rem; line-height: 1.4; color: #fff; opacity: 0.9; word-break: break-word; }
        .transcript-line.emo { color: ${EMO_COLOR}; }
        .sender-tag { font-weight: 900; margin-right: 6px; font-size: 0.7rem; opacity: 0.6; }
        .no-captions { font-family: 'Courier New', Courier, monospace; font-size: 0.7rem; color: ${EMO_COLOR}; opacity: 0.4; text-align: center; margin-top: 10px; letter-spacing: 2px; }

        .floor-glow { position: fixed; bottom: 0; width: 100%; height: 50vh; background: radial-gradient(circle at 50% 130%, ${EMO_COLOR}15, transparent 70%); pointer-events: none; }

        .thought-container { position: absolute; z-index: 50; pointer-events: none; }
        .thought-bubble { position: absolute; width: 240px; min-height: 150px; background: rgba(10, 10, 12, 0.97); border: 4px solid ${EMO_COLOR}; border-radius: 35px; display: flex; align-items: center; justify-content: center; animation: thought-pop 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; overflow: hidden; padding: 10px; box-sizing: border-box; box-shadow: 0 0 30px ${EMO_COLOR}30; }
        .thought-image-wrapper { width: 100%; height: 130px; position: relative; border-radius: 20px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; }
        .thought-image { width: 100%; height: 100%; object-fit: cover; transition: opacity 0.5s; }
        .hidden { opacity: 0; }
        .visible { opacity: 1; }
        .loader-inner { width: 20px; height: 20px; border: 2px solid ${EMO_COLOR}20; border-top-color: ${EMO_COLOR}; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .thought-text { color: ${EMO_COLOR}; font-family: sans-serif; font-weight: 700; text-align: center; text-transform: uppercase; text-shadow: 0 0 15px ${EMO_COLOR}80; letter-spacing: 1px; line-height: 1.4; }
        .video-link-text { color: ${EMO_COLOR}; font-family: monospace; margin-top: 10px; font-size: 0.8rem; opacity: 0.8; }
        .video-overlay-link { position: absolute; inset: 0; opacity: 0; pointer-events: auto; }
        .thought-dot { position: absolute; background: transparent; border: 3px solid ${EMO_COLOR}; border-radius: 50%; opacity: 0; box-shadow: 0 0 15px ${EMO_COLOR}50; }
        .dot-1 { width: 20px; height: 20px; left: 65px; top: -50px; animation: dot-pop 0.4s 0.2s forwards; }
        .dot-2 { width: 35px; height: 35px; left: 110px; top: -110px; animation: dot-pop 0.4s 0.4s forwards; }

        .lab-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.9); backdrop-filter: blur(25px); display: flex; align-items: center; justify-content: center; z-index: 2000; pointer-events: auto; color: #fff; }
        .lab-content { background: #121214; border: 1px solid ${EMO_COLOR}20; border-radius: 30px; padding: 45px; width: 90%; max-width: 650px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 80px rgba(0,0,0,0.8); scrollbar-width: none; }
        .lab-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin: 25px 0; }
        .lab-input { background: #08080a; border: 1px solid ${EMO_COLOR}30; color: #fff; padding: 14px; border-radius: 12px; width: 100%; box-sizing: border-box; font-family: inherit; font-size: 1rem; outline: none; transition: border-color 0.2s; }
        .lab-input:focus { border-color: ${EMO_COLOR}; }
        .lab-select { background: #08080a; border: 1px solid ${EMO_COLOR}30; color: #fff; padding: 12px; border-radius: 12px; width: 100%; cursor: pointer; outline: none; }
        .lab-btn { background: ${EMO_COLOR}; color: #000; font-weight: 900; border: none; padding: 15px 30px; border-radius: 15px; cursor: pointer; transition: transform 0.2s, opacity 0.2s; letter-spacing: 1px; outline: none; }
        .lab-btn:hover { opacity: 0.9; transform: translateY(-2px); }
        .lab-btn-close { background: transparent; color: ${EMO_COLOR}; border: 1px solid ${EMO_COLOR}30; margin-right: 15px; }
      `}</style>
    </div>
  );
};

const MoodLab = ({ onClose, onSave, existing }: { onClose: () => void, onSave: (m: CustomExpression) => void, existing: Record<string, CustomExpression> }) => {
  const [name, setName] = useState('');
  const [eye, setEye] = useState<Expression>('neutral');
  const [mouth, setMouth] = useState<Expression>('neutral');

  const bases: Expression[] = ['neutral', 'happy', 'surprised', 'angry', 'curious', 'sleepy', 'wink', 'skeptical', 'sad', 'excited', 'thinking', 'annoyed', 'thoughtful', 'yawn', 'distracted'];

  return (
    <div className="lab-modal" onClick={onClose}>
      <div className="lab-content" onClick={e => e.stopPropagation()}>
        <h2 style={{ color: EMO_COLOR, marginTop: 0, letterSpacing: '4px', fontWeight: 900 }}>MOOD LAB</h2>
        <p style={{ opacity: 0.5, fontSize: '0.95rem', fontWeight: 300 }}>Design EMO's personality by mixing facial features.</p>
        
        <div style={{ margin: '40px 0', display: 'flex', justifyContent: 'center' }}>
          <EmoFace 
            status="idle" 
            lookOffset={{ x: 0, y: 0 }} 
            intensity={0} 
            expression="preview" 
            isStartled={false} 
            customMap={{ preview: { name: 'preview', eyeBase: eye, mouthBase: mouth } }}
            breathScale={1}
            boredom={0}
          />
        </div>

        <div style={{ marginBottom: '25px' }}>
          <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.75rem', color: EMO_COLOR, letterSpacing: '2px', fontWeight: 'bold' }}>EXPRESSION NAME</label>
          <input className="lab-input" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} placeholder="e.g. ecstatic" />
        </div>

        <div className="lab-grid">
          <div>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.75rem', color: EMO_COLOR, letterSpacing: '2px', fontWeight: 'bold' }}>EYE STYLE</label>
            <select className="lab-select" value={eye} onChange={e => setEye(e.target.value as Expression)}>
              {bases.map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '0.75rem', color: EMO_COLOR, letterSpacing: '2px', fontWeight: 'bold' }}>MOUTH STYLE</label>
            <select className="lab-select" value={mouth} onChange={e => setMouth(e.target.value as Expression)}>
              {bases.map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="lab-btn lab-btn-close" onClick={onClose}>CANCEL</button>
          <button className="lab-btn" onClick={() => {
            if (!name) return alert("Please name your mood!");
            onSave({ name, eyeBase: eye, mouthBase: mouth });
            onClose();
          }}>SAVE MOOD</button>
        </div>

        <div style={{ marginTop: '40px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '25px' }}>
          <h4 style={{ fontSize: '0.7rem', color: EMO_COLOR, opacity: 0.4, textTransform: 'uppercase', letterSpacing: '2px' }}>Stored Moods</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '15px' }}>
            {Object.keys(existing).map(k => (
              <span key={k} style={{ padding: '6px 14px', background: '#08080a', border: `1px solid ${EMO_COLOR}15`, borderRadius: '10px', fontSize: '0.85rem', color: EMO_COLOR }}>{k}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
