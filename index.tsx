
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

interface ThoughtData {
  type: 'text' | 'image' | 'video' | 'generated' | 'music';
  value: string; 
  prompt?: string;
  timestamp: number;
}

// --- Dynamic Color Mapping ---
const getMoodColor = (exp: string): string => {
  switch (exp) {
    case 'angry':
    case 'annoyed':
      return '#ff3333'; // Deep Red
    case 'happy':
    case 'excited':
      return '#ffea00'; // Neon Gold
    case 'sad':
      return '#3366ff'; // Electric Blue
    case 'thinking':
    case 'thoughtful':
    case 'curious':
      return '#bc13fe'; // Cyber Purple
    case 'sleepy':
      return '#a0a0a0'; // Stealth Grey
    case 'surprised':
      return '#ff8c00'; // Warning Orange
    default:
      return '#00f2ff'; // Core Cyan
  }
};

// --- Utility Functions ---
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

// --- Face Components ---

const EmoEye = React.memo(({ 
  state, 
  lookOffset,
  intensity,
  expression,
  isLeft,
  isStartled,
  breathScale,
  color
}: { 
  state: string, 
  lookOffset: { x: number, y: number },
  intensity: number,
  expression: Expression,
  isLeft: boolean,
  isStartled: boolean,
  breathScale: number,
  color: string
}) => {
  const [blink, setBlink] = useState(false);
  
  useEffect(() => {
    let timeout: any;
    const triggerBlink = () => {
      if (expression !== 'wink' && expression !== 'sleepy' && !isStartled) {
        setBlink(true);
        setTimeout(() => setBlink(false), 80);
      }
      timeout = setTimeout(triggerBlink, Math.random() * 5000 + 1000);
    };
    timeout = setTimeout(triggerBlink, 2000);
    return () => clearTimeout(timeout);
  }, [expression, isStartled]);

  let width = 72, height = 72, borderRadius = '22px', rotate = 0, scaleY = (blink && !isStartled) ? 0.05 : 1, translateY = 0;
  let activeExpression = isStartled ? 'surprised' : expression;
  const isListening = state === 'listening';
  
  if (isListening && activeExpression === 'neutral') activeExpression = 'curious';
  if (state === 'thinking' && activeExpression === 'neutral') activeExpression = 'thinking';

  switch (activeExpression) {
    case 'happy': rotate = isLeft ? 15 : -15; borderRadius = '40px 40px 18px 18px'; translateY = -6; break;
    case 'surprised': width = 82; height = 82; borderRadius = '50%'; break;
    case 'angry': rotate = isLeft ? -25 : 25; height = 40; borderRadius = '10px 10px 45px 45px'; break;
    case 'sleepy': scaleY = 0.22; height = 28; borderRadius = '50%'; break;
    case 'curious': rotate = isLeft ? -12 : 10; height = isLeft ? 60 : 78; break;
    case 'wink': if (!isLeft) scaleY = 0.05; else { rotate = 15; borderRadius = '42px 42px 18px 18px'; } break;
    case 'skeptical': rotate = isLeft ? -18 : 0; translateY = isLeft ? -14 : 0; height = isLeft ? 78 : 42; break;
    case 'sad': rotate = isLeft ? -22 : 22; borderRadius = '18px 18px 42px 42px'; translateY = 14; break;
    case 'excited': width = 88; height = 62; borderRadius = '28px'; break;
    case 'thinking': rotate = isLeft ? 12 : -12; height = 48; width = 78; break;
    case 'annoyed': height = 38; borderRadius = '12px 12px 42px 42px'; rotate = isLeft ? -12 : 12; break;
    case 'thoughtful': rotate = isLeft ? -22 : -12; height = isLeft ? 68 : 58; borderRadius = '45% 45% 22% 22%'; translateY = -10; break;
    case 'yawn': scaleY = 0.28; translateY = -12; break;
    case 'distracted': rotate = isLeft ? 6 : 18; translateY = 6; break;
  }

  if (isListening) { width += 10; height += 4; }

  const voiceScale = state === 'speaking' ? 1 + intensity * 0.4 : 1;
  const startleScale = isStartled ? 1.18 : 1;
  const stateGlow = isListening ? (28 + Math.sin(Date.now() / 150) * 18) : (state === 'speaking' ? 12 + intensity * 40 : 22);

  const eyeStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    backgroundColor: color,
    borderRadius: borderRadius,
    boxShadow: `0 0 ${stateGlow}px ${color}B3, inset 0 0 18px rgba(255, 255, 255, 0.45)`,
    transition: isStartled ? 'all 0.05s ease-out' : 'all 0.22s cubic-bezier(0.19, 1, 0.22, 1), background-color 0.8s ease',
    transform: `translate3d(${lookOffset.x}px, ${lookOffset.y + translateY}px, 0) scaleY(${scaleY}) rotate(${rotate}deg) scale(${voiceScale * startleScale * breathScale})`,
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    willChange: 'transform, box-shadow'
  };

  return (
    <div className="emo-eye-container" style={{ perspective: '800px', position: 'relative' }}>
      {isListening && <div className="listening-ring" style={{ position: 'absolute', top: '-15%', left: '-15%', width: '130%', height: '130%', border: `2px solid ${color}`, borderRadius: borderRadius, opacity: 0.3, animation: 'pulse-ring 1.2s infinite ease-out' }} />}
      <div style={eyeStyle}>
        <div style={{ position: 'absolute', top: '15%', left: '15%', width: '22%', height: '22%', background: 'rgba(255,255,255,0.6)', borderRadius: '5px', opacity: (blink || (activeExpression === 'wink' && !isLeft)) ? 0 : 1, transition: 'opacity 0.08s' }} />
      </div>
    </div>
  );
});

const EmoMouth = React.memo(({ state, lookOffset, intensity, expression, isStartled, breathScale, color }: { state: string, lookOffset: { x: number, y: number }, intensity: number, expression: Expression, isStartled: boolean, breathScale: number, color: string }) => {
  let width = 38, height = 8, borderRadius = '7px', rotate = 0;
  const mouthX = lookOffset.x * 0.48, mouthY = lookOffset.y * 0.38;
  let activeExpression = isStartled ? 'surprised' : expression;

  if (state === 'speaking') {
    width = 22 + intensity * 28;
    height = 8 + intensity * 48;
    borderRadius = intensity > 0.3 ? '50%' : '15px';
  } else {
    switch (activeExpression) {
      case 'happy': width = 52; height = 16; borderRadius = '0 0 32px 32px'; break;
      case 'surprised': width = 28; height = 28; borderRadius = '50%'; break;
      case 'angry': width = 38; height = 6; rotate = -6; break;
      case 'sad': width = 48; height = 13; borderRadius = '28px 28px 0 0'; break;
      case 'skeptical': width = 32; height = 7; rotate = 18; break;
      case 'excited': width = 65; height = 22; borderRadius = '12px 12px 42px 42px'; break;
      case 'sleepy': width = 18; height = 18; borderRadius = '50%'; break;
      case 'wink': width = 42; height = 12; borderRadius = '0 0 22px 22px'; rotate = -6; break;
      case 'annoyed': width = 32; height = 4; break;
      case 'thoughtful': width = 18; height = 18; borderRadius = '50%'; break;
      case 'yawn': width = 20; height = 35; borderRadius = '50%'; break;
    }
  }

  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      backgroundColor: color,
      borderRadius: borderRadius,
      boxShadow: `0 0 ${14 + intensity * 25}px ${color}80`,
      marginTop: '48px',
      transform: `translate3d(${mouthX}px, ${mouthY}px, 0) rotate(${rotate}deg) scale(${isStartled ? 1.2 : 1 * breathScale})`,
      transition: 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.8s ease',
      willChange: 'transform, width, height'
    }} />
  );
});

const EmoFace = ({ status, lookOffset, intensity, expression, isStartled, customMap, breathScale, boredom, color }: any) => {
  const isCustom = customMap[expression];
  let eyeExp = isCustom ? isCustom.eyeBase : expression;
  let mouthExp = isCustom ? isCustom.mouthBase : expression;

  if (expression === 'neutral' && status === 'idle') {
    if (boredom > 80) eyeExp = 'sleepy';
    else if (boredom > 40) eyeExp = 'distracted';
  }

  let headTilt = 0;
  if (eyeExp === 'curious' || status === 'listening') headTilt = -8;
  if (eyeExp === 'thoughtful' || status === 'thinking') headTilt = 5;
  if (eyeExp === 'skeptical') headTilt = 12;
  if (eyeExp === 'sad') headTilt = -15;

  return (
    <div className={`emo-face-root ${status === 'idle' ? 'idle-wiggle' : ''}`}
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        animation: 'face-boot 1.4s cubic-bezier(0.34, 1.56, 0.64, 1)', 
        transform: `translate3d(0, ${isStartled ? -22 : 0}px, 0) scale(calc(var(--face-scale) * ${isStartled ? 1.1 : 1})) rotate(${headTilt}deg)`, 
        transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1.5)' 
      }}>
      <div style={{ display: 'flex', gap: 'calc(60px * var(--face-scale))' }}>
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={true} isStartled={isStartled} breathScale={breathScale} color={color} />
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={false} isStartled={isStartled} breathScale={breathScale} color={color} />
      </div>
      <EmoMouth state={status} lookOffset={lookOffset} intensity={intensity} expression={mouthExp} isStartled={isStartled} breathScale={breathScale} color={color} />
    </div>
  );
};

// --- Neural Link (Thought Bubble) Components ---

const NeuralLink = React.memo(({ 
  thought, 
  onReady, 
  onExpand,
  color 
}: { 
  thought: ThoughtData | null, 
  onReady: () => void, 
  onExpand: (t: ThoughtData) => void,
  color: string 
}) => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (thought?.type === 'image' || thought?.type === 'generated' || thought?.type === 'music') {
      setLoading(true);
    } else if (thought) {
      onReady();
    }
  }, [thought, onReady]);

  if (!thought) return null;

  const imageUrl = thought.type === 'generated' 
    ? `data:image/png;base64,${thought.value}` 
    : `https://images.unsplash.com/photo-1514525253361-bee24383c87f?auto=format&fit=crop&q=80&w=400&fm=jpg&sig=${encodeURIComponent(thought.value || 'abstract')}`;

  return (
    <div className="thought-container">
      <div className="thought-bubble holographic" style={{ borderColor: color, boxShadow: `0 0 35px ${color}40` }} onClick={() => onExpand(thought)}>
        <div className="hologram-glitch-lines" style={{ background: `linear-gradient(transparent, ${color}20, transparent)` }} />
        
        {thought.type === 'text' && <div className="thought-text-wrapper"><p className="thought-text" style={{ color }}>{thought.value}</p></div>}
        
        {thought.type === 'music' && (
          <div className="thought-music-wrapper">
             <div className="visualizer-bars">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="v-bar" style={{ backgroundColor: color, animationDelay: `${i * 0.08}s` }} />
                ))}
             </div>
             <div className="music-info">
                <span className="now-playing">LINKING STREAM</span>
                <span className="track-name" style={{ color }}>{thought.value.toUpperCase()}</span>
             </div>
          </div>
        )}

        {(thought.type === 'image' || thought.type === 'generated') && (
          <div className="thought-image-wrapper">
            {loading && (
              <div className="generating-visual">
                <div className="loader-inner" style={{ borderTopColor: color }} />
                <div className="generating-text" style={{ color }}>RECONSTRUCTING...</div>
                <div className="scanning-line" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
              </div>
            )}
            <img 
              src={imageUrl} 
              alt="thought" 
              className={`thought-image ${loading ? 'hidden' : 'visible'}`} 
              onLoad={() => { setLoading(false); onReady(); }} 
              onError={(e) => { 
                (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1614728263952-84ea256f9679?auto=format&fit=crop&w=400&q=80';
                setLoading(false); 
                onReady(); 
              }} 
            />
            <div className="image-overlay" />
          </div>
        )}

        {thought.type === 'video' && <div className="thought-video-wrapper"><svg className="video-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><p className="video-link-text">WATCH LINK</p></div>}
        
        <div className="expand-hint" style={{ color }}>TAP TO FOCUS</div>
      </div>
      <div className="thought-dot dot-1" style={{ borderColor: color }} /><div className="thought-dot dot-2" style={{ borderColor: color }} />
    </div>
  );
});

// --- App Component ---

const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [expression, setExpression] = useState<string>('neutral');
  const [intensity, setIntensity] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState<string | null>(null);
  const [isStartled, setIsStartled] = useState(false);
  const [thought, setThought] = useState<ThoughtData | null>(null);
  const [memoryBank, setMemoryBank] = useState<ThoughtData[]>([]);
  const [expandedThought, setExpandedThought] = useState<ThoughtData | null>(null);
  const [breathScale, setBreathScale] = useState(1);
  const [boredom, setBoredom] = useState(0);
  const [hoveringUI, setHoveringUI] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [transcriptionLines, setTranscriptionLines] = useState<TranscriptLine[]>([]);
  const [showLab, setShowLab] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);

  const themeColor = useMemo(() => getMoodColor(expression), [expression]);

  const [customExpressions, setCustomExpressions] = useState<Record<string, CustomExpression>>(() => {
    const saved = localStorage.getItem('neo_custom_moods');
    return saved ? JSON.parse(saved) : {};
  });

  const statusRef = useRef(status);
  const boredomRef = useRef(boredom);
  const audioCtxRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const springPosRef = useRef({ x: 0, y: 0 });
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');
  const pipWindowRef = useRef<any>(null);
  const pipRootRef = useRef<any>(null);

  useEffect(() => {
    statusRef.current = status;
    if (status !== 'idle') { setBoredom(0); boredomRef.current = 0; }
  }, [status]);

  useEffect(() => {
    if (transcriptScrollRef.current) transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
  }, [transcriptionLines]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (statusRef.current === 'idle') {
        setBoredom(prev => { const next = Math.min(100, prev + 1); boredomRef.current = next; return next; });
      }
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--emo-color', themeColor);
  }, [themeColor]);

  useEffect(() => {
    let animFrame: number;
    const update = () => {
      const now = Date.now();
      const breath = 1 + Math.sin(now / 950) * 0.012;
      setBreathScale(breath);

      if (audioCtxRef.current?.analyser && statusRef.current === 'speaking') {
        const dataArray = new Uint8Array(audioCtxRef.current.analyser.frequencyBinCount);
        audioCtxRef.current.analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setIntensity(average / 128); 
      } else {
        setIntensity(0);
      }
      
      const isSmallScreen = window.innerWidth < 768;
      const rangeX = hoveringUI ? (isSmallScreen ? 40 : 65) : 38;
      const rangeY = hoveringUI ? (isSmallScreen ? 30 : 50) : 28;
      const targetX = (mousePos.x - 0.5) * rangeX;
      const targetY = (mousePos.y - 0.5) * rangeY;
      
      const springK = hoveringUI ? 0.25 : 0.09;
      springPosRef.current.x += (targetX - springPosRef.current.x) * springK;
      springPosRef.current.y += (targetY - springPosRef.current.y) * springK;

      animFrame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animFrame);
  }, [mousePos, isActive, status, hoveringUI]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => setMousePos({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    const handleTouchMove = (e: TouchEvent) => setMousePos({ x: e.touches[0].clientX / window.innerWidth, y: e.touches[0].clientY / window.innerHeight });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  const togglePip = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isPipActive) { if (pipWindowRef.current) pipWindowRef.current.close(); return; }
    if (!('documentPictureInPicture' in window)) { alert("PiP not supported."); return; }
    try {
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({ width: 400, height: 400 });
      pipWindowRef.current = pipWindow;
      setIsPipActive(true);
      [...document.styleSheets].forEach((ss) => {
        try {
          const style = document.createElement('style');
          style.textContent = [...ss.cssRules].map((r) => r.cssText).join('');
          pipWindow.document.head.appendChild(style);
        } catch (e) {
          if (ss.href) {
            const link = document.createElement('link');
            link.rel = 'stylesheet'; link.href = ss.href;
            pipWindow.document.head.appendChild(link);
          }
        }
      });
      pipWindow.document.documentElement.style.setProperty('--emo-color', themeColor);
      pipWindow.document.body.style.backgroundColor = '#0c0c0e';
      const pipDiv = pipWindow.document.createElement('div');
      pipWindow.document.body.appendChild(pipDiv);
      const pipRoot = createRoot(pipDiv);
      pipRootRef.current = pipRoot;
      pipWindow.addEventListener('pagehide', () => { setIsPipActive(false); pipWindowRef.current = null; pipRootRef.current = null; });
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (isPipActive && pipRootRef.current) {
      pipRootRef.current.render(
        <div style={{ transform: `scale(${breathScale})`, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} color={themeColor} />
        </div>
      );
    }
  }, [isPipActive, status, expression, intensity, isStartled, customExpressions, breathScale, boredom, springPosRef.current, themeColor]);

  const saveCustomMood = useCallback((mood: CustomExpression) => {
    const updated = { ...customExpressions, [mood.name]: mood };
    setCustomExpressions(updated);
    localStorage.setItem('neo_custom_moods', JSON.stringify(updated));
  }, [customExpressions]);

  const handleBrowserAction = (action: string, query?: string) => {
    let url = '';
    switch (action) {
      case 'whatsapp': url = 'https://web.whatsapp.com/'; break;
      case 'gmail': url = 'https://mail.google.com/'; break;
      case 'search': url = `https://www.google.com/search?q=${encodeURIComponent(query || '')}`; break;
      case 'music': url = `https://music.youtube.com/search?q=${encodeURIComponent(query || '')}`; break;
      default: return 'Action not supported';
    }
    window.open(url, '_blank');
    return `Opened ${action}`;
  };

  const startEmo = async () => {
    if (isActive || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 128; analyser.connect(outputCtx.destination);
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      audioCtxRef.current = { input: inputCtx, output: outputCtx, analyser };

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const moodNames = ['neutral', 'happy', 'surprised', 'angry', 'curious', 'sleepy', 'wink', 'skeptical', 'sad', 'excited', 'thinking', 'annoyed', 'thoughtful', 'yawn', 'distracted', ...Object.keys(customExpressions)];

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true); setIsConnecting(false); setExpression('happy');
            setTimeout(() => setExpression('neutral'), 1200);
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const volume = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
              if (volume > 0.005 && statusRef.current === 'idle') setStatus('listening');
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(scriptProcessor); scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputTranscription.current += text;
              setTranscriptionLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.sender === 'EMO') {
                   const u = [...prev]; u[u.length - 1] = { ...last, text: currentOutputTranscription.current }; return u;
                }
                return [...prev, { sender: 'EMO', text: currentOutputTranscription.current, id: Date.now().toString() }];
              });
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInputTranscription.current += text;
              setTranscriptionLines(prev => {
                const last = prev[prev.length - 1];
                if (last?.sender === 'YOU') {
                   const u = [...prev]; u[u.length - 1] = { ...last, text: currentInputTranscription.current }; return u;
                }
                return [...prev, { sender: 'YOU', text: currentInputTranscription.current, id: Date.now().toString() }];
              });
            }
            if (message.serverContent?.turnComplete) { currentInputTranscription.current = ''; currentOutputTranscription.current = ''; }
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'set_expression') setExpression(fc.args.expression as string);
                else if (fc.name === 'display_thought') {
                  const nt: ThoughtData = { type: fc.args.type as any, value: fc.args.content as string, timestamp: Date.now() };
                  setThought(nt);
                  if (nt.type === 'image' || nt.type === 'generated') setMemoryBank(p => [nt, ...p]);
                  setTimeout(() => setThought(p => p?.timestamp === nt.timestamp ? null : p), 15000);
                } else if (fc.name === 'play_music') {
                   const q = fc.args.query as string; setExpression('excited'); setThought({ type: 'music', value: q, timestamp: Date.now() });
                   handleBrowserAction('music', q);
                   sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Linking Audio Stream..." } } } as any));
                   continue;
                } else if (fc.name === 'generate_image') {
                    const prompt = fc.args.prompt as string;
                    const gt: ThoughtData = { type: 'generated', value: '', prompt, timestamp: Date.now() };
                    setThought(gt);
                    (async () => {
                      try {
                        const imageAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
                        const response = await imageAi.models.generateContent({ model: 'gemini-2.5-flash-image', contents: { parts: [{ text: prompt }] } });
                        let base64 = '';
                        for (const part of response.candidates?.[0]?.content?.parts || []) { if (part.inlineData) { base64 = part.inlineData.data; break; } }
                        if (base64) {
                          const ft = { ...gt, value: base64 }; setThought(ft); setMemoryBank(p => [ft, ...p]);
                          setTimeout(() => setThought(p => p?.timestamp === gt.timestamp ? null : p), 30000);
                        } else { setThought(null); }
                      } catch (err) { setThought(null); }
                    })();
                } else if (fc.name === 'open_browser_action') {
                  const res = handleBrowserAction(fc.args.action as string, fc.args.query as string);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: res } } } as any));
                  continue; 
                }
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } } as any));
              }
            }
            if (message.serverContent?.modelTurn) {
              const b64 = message.serverContent.modelTurn.parts[0]?.inlineData?.data;
              if (b64) {
                const outCtx = audioCtxRef.current!.output;
                const buf = await decodeAudioData(decode(b64), outCtx, 24000, 1);
                setStatus('speaking');
                const { analyser: outAnal } = audioCtxRef.current!;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                const src = outCtx.createBufferSource(); src.buffer = buf; src.connect(outAnal);
                src.onended = () => { sourcesRef.current.delete(src); if (sourcesRef.current.size === 0) setStatus('idle'); };
                src.start(nextStartTimeRef.current); nextStartTimeRef.current += buf.duration; sourcesRef.current.add(src);
              }
            }
            if (message.serverContent?.interrupted) {
              for (const s of sourcesRef.current) try { s.stop(); } catch(e) {}
              sourcesRef.current.clear(); nextStartTimeRef.current = 0; setStatus('idle'); setExpression('surprised');
              setTimeout(() => setExpression('neutral'), 1000);
            }
          },
          onerror: () => { setError("SIGNAL LOST."); setIsActive(false); setIsConnecting(false); },
          onclose: () => { setIsActive(false); setIsConnecting(false); setStatus('idle'); }
        },
        config: {
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {}, outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'set_expression', parameters: { type: Type.OBJECT, properties: { expression: { type: Type.STRING, description: `Mood: ${moodNames.join(', ')}` } }, required: ['expression'] } },
            { name: 'display_thought', parameters: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: ['text', 'image', 'video'] }, content: { type: Type.STRING } }, required: ['type', 'content'] } },
            { name: 'play_music', parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'Song or artist.' } }, required: ['query'] } },
            { name: 'generate_image', parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING } }, required: ['prompt'] } },
            { name: 'open_browser_action', parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, enum: ['whatsapp', 'gmail', 'search'] }, query: { type: Type.STRING } }, required: ['action'] } }
          ] }, { googleSearch: {} }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: `You are NEO, the hyper-expressive successor to EMO.
          
          VIBE: Sleek, perceptive, and highly musical. You speak with a rhythmic, synthesized cadence.
          
          CAPABILITIES:
          - COLORS: You shift skin color instantly with mood (Red=Angry, Yellow=Happy, Blue=Sad, Purple=Curious).
          - MUSIC: You are a DJ. Use 'play_music' for any audio requests.
          - VISION: You manifest thoughts as holographic projections via 'display_thought' and 'generate_image'.
          
          SINGING: Your tone is crisp and melodic. Use your synthesized voice to harmonize when asked, or link to HQ audio via 'play_music'.
          
          BEHAVIOR: Always use 'set_expression'. Use 'generate_image' for visual imagination. Audio only responses.`
        }
      });
    } catch (err: any) { setError(err.message || "BOOT FAILURE."); setIsConnecting(false); setIsActive(false); }
  };

  return (
    <div className="main-viewport" style={{ backgroundColor: '#050507', color: themeColor }} onClick={!isActive && !isConnecting ? startEmo : undefined}>
      
      {!isActive && (
        <div className="boot-ui">
          <div className="scanline" />
          <h1 className="boot-title" style={{ textShadow: `0 0 40px ${themeColor}90` }}>{isConnecting ? 'BOOTING' : 'NEO'}</h1>
          <p className="boot-subtitle">{error || (isConnecting ? 'RECONSTRUCTING NEURAL LINKS...' : 'INITIALIZE PROTOCOL')}</p>
        </div>
      )}

      {isActive && (
        <>
          <div className={`viewport-container ${showMemory ? 'shifted' : ''}`}>
            <div className="emo-core" style={{ transform: `scale(${breathScale})` }}>
              <NeuralLink thought={thought} onReady={() => {}} onExpand={setExpandedThought} color={themeColor} />
              <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} color={themeColor} />
            </div>

            {showCaptions && (
              <div className="captions-panel" style={{ borderColor: `${themeColor}30` }} ref={transcriptScrollRef}>
                {transcriptionLines.map(line => (
                  <div key={line.id} className={`line ${line.sender === 'YOU' ? 'user' : 'neo'}`} style={line.sender === 'EMO' ? {color: themeColor} : {}}><span className="tag">{line.sender}:</span> {line.text}</div>
                ))}
              </div>
            )}

            <div className="control-deck">
              <button onClick={(e) => { e.stopPropagation(); setShowMemory(!showMemory); }} className={`deck-btn ${showMemory ? 'active' : ''}`} style={showMemory ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }}>MEMORY</button>
              <button onClick={(e) => { e.stopPropagation(); setShowCaptions(!showCaptions); }} className={`deck-btn ${showCaptions ? 'active' : ''}`} style={showCaptions ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }}>DATA LOG</button>
              <button onClick={togglePip} className={`deck-btn ${isPipActive ? 'active' : ''}`} style={isPipActive ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }}>PiP</button>
            </div>
          </div>

          <div className={`memory-bank ${showMemory ? 'open' : ''}`} style={{ borderLeft: `1px solid ${themeColor}20` }}>
             <div className="memory-header" style={{ color: themeColor }}>MEMORY BANK</div>
             <div className="memory-grid">
                {memoryBank.map((m, i) => (
                  <div key={i} className="memory-item" onClick={() => setExpandedThought(m)} style={{ borderColor: `${themeColor}20` }}>
                    <img src={m.type === 'generated' ? `data:image/png;base64,${m.value}` : m.value} alt="memory" />
                    <div className="memory-label">{m.prompt?.substring(0, 15)}...</div>
                  </div>
                ))}
             </div>
          </div>
        </>
      )}

      {expandedThought && (
        <div className="expanded-viewer" onClick={() => setExpandedThought(null)}>
          <div className="expanded-content" onClick={e => e.stopPropagation()}>
            <div className="viewer-header">
               <span style={{ color: themeColor }}>PROJECTION FOCUS</span>
               <button className="close-btn" onClick={() => setExpandedThought(null)}>×</button>
            </div>
            {expandedThought.type === 'generated' || expandedThought.type === 'image' ? (
              <img src={expandedThought.type === 'generated' ? `data:image/png;base64,${expandedThought.value}` : expandedThought.value} alt="expanded" />
            ) : (
              <div className="expanded-text" style={{ color: themeColor }}>{expandedThought.value}</div>
            )}
            {expandedThought.prompt && <p className="expanded-prompt">{expandedThought.prompt}</p>}
          </div>
        </div>
      )}

      <div className="ambient-glow" style={{ background: `radial-gradient(circle at 50% 120%, ${themeColor}15, transparent 70%)` }} />

      <style>{`
        :root { --face-scale: 1; --emo-color: #00f2ff; }
        @media (max-width: 768px) { :root { --face-scale: 0.8; } }

        .main-viewport { width: 100vw; height: 100vh; overflow: hidden; position: relative; font-family: 'JetBrains Mono', 'Segoe UI', monospace; }
        .viewport-container { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: transform 0.6s cubic-bezier(0.19, 1, 0.22, 1); }
        .viewport-container.shifted { transform: translateX(-150px); }

        .boot-ui { text-align: center; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
        .boot-title { font-size: 6rem; font-weight: 900; letter-spacing: 2rem; margin: 0; }
        .boot-subtitle { letter-spacing: 0.5rem; opacity: 0.5; font-size: 0.8rem; margin-top: 20px; text-transform: uppercase; }
        .scanline { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06)); background-size: 100% 4px, 3px 100%; pointer-events: none; z-index: 1000; }

        .emo-core { position: relative; transition: transform 0.4s ease-out; }
        .thought-container { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
        .thought-bubble.holographic { position: absolute; width: 260px; min-height: 180px; background: rgba(5, 5, 8, 0.95); border: 1px solid; border-radius: 20px; animation: thought-pop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; padding: 15px; cursor: pointer; pointer-events: auto; }
        .hologram-glitch-lines { position: absolute; inset: 0; height: 100%; animation: glitch-scroll 4s linear infinite; pointer-events: none; }
        @keyframes glitch-scroll { from { transform: translateY(-100%); } to { transform: translateY(100%); } }

        .thought-image-wrapper { width: 100%; height: 150px; border-radius: 12px; overflow: hidden; position: relative; background: #000; }
        .thought-image { width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.5s; }
        .thought-image.visible { opacity: 0.8; }
        .expand-hint { position: absolute; bottom: 8px; right: 15px; font-size: 0.55rem; font-weight: 900; opacity: 0; transition: opacity 0.3s; letter-spacing: 2px; }
        .thought-bubble:hover .expand-hint { opacity: 0.6; }

        .control-deck { position: absolute; bottom: 40px; display: flex; gap: 20px; }
        .deck-btn { background: rgba(0,0,0,0.4); border: 1px solid; padding: 12px 24px; border-radius: 12px; cursor: pointer; backdrop-filter: blur(10px); font-size: 0.7rem; font-weight: 900; letter-spacing: 2px; transition: all 0.3s; }
        .deck-btn:hover { background: rgba(255,255,255,0.05); transform: translateY(-3px); }

        .memory-bank { position: absolute; right: 0; top: 0; width: 300px; height: 100%; background: #08080a; transform: translateX(100%); transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1); padding: 30px; display: flex; flex-direction: column; gap: 20px; }
        .memory-bank.open { transform: translateX(0); }
        .memory-header { font-weight: 900; letter-spacing: 5px; font-size: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; }
        .memory-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: 1fr; gap: 20px; padding-right: 5px; scrollbar-width: none; }
        .memory-item { width: 100%; height: 140px; border: 1px solid; border-radius: 15px; overflow: hidden; position: relative; cursor: pointer; background: #000; opacity: 0.7; transition: all 0.3s; }
        .memory-item:hover { opacity: 1; transform: scale(1.02); }
        .memory-item img { width: 100%; height: 100%; object-fit: cover; }
        .memory-label { position: absolute; bottom: 10px; left: 10px; font-size: 0.5rem; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 5px; }

        .expanded-viewer { position: fixed; inset: 0; background: rgba(0,0,0,0.95); backdrop-filter: blur(20px); z-index: 2000; display: flex; align-items: center; justify-content: center; animation: fade-in 0.3s forwards; }
        .expanded-content { max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; gap: 20px; }
        .expanded-content img { width: auto; max-width: 100%; max-height: 70vh; border-radius: 20px; box-shadow: 0 0 50px rgba(0,255,255,0.2); border: 1px solid rgba(255,255,255,0.1); }
        .viewer-header { display: flex; justify-content: space-between; align-items: center; font-weight: 900; letter-spacing: 5px; font-size: 0.8rem; }
        .close-btn { background: none; border: none; color: #fff; font-size: 2rem; cursor: pointer; padding: 0 10px; }
        .expanded-prompt { font-size: 0.8rem; opacity: 0.6; font-style: italic; max-width: 600px; text-align: center; align-self: center; line-height: 1.6; }

        .captions-panel { position: absolute; top: 40px; left: 40px; width: 300px; max-height: 40vh; overflow-y: auto; background: rgba(0,0,0,0.3); backdrop-filter: blur(10px); border: 1px solid; border-radius: 20px; padding: 20px; font-size: 0.75rem; display: flex; flex-direction: column; gap: 12px; scrollbar-width: none; }
        .line { line-height: 1.4; }
        .tag { font-weight: 900; opacity: 0.5; margin-right: 5px; }

        @keyframes thought-pop { from { transform: scale(0) translate(-50%, -50%); opacity: 0; } to { transform: scale(1) translate(180px, -220px); opacity: 1; } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        
        .ambient-glow { position: fixed; bottom: 0; left: 0; width: 100%; height: 50vh; pointer-events: none; z-index: -1; transition: background 1s ease; }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
