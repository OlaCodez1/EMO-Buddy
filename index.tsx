
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
  type: 'text' | 'image' | 'video' | 'generated';
  value: string; 
  prompt?: string;
}

const EMO_COLOR = '#00f2ff';

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

// --- Optimized Components ---

const EmoEye = React.memo(({ 
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
    backgroundColor: EMO_COLOR,
    borderRadius: borderRadius,
    boxShadow: `0 0 ${stateGlow}px ${EMO_COLOR}B3, inset 0 0 18px rgba(255, 255, 255, 0.45)`,
    transition: isStartled ? 'all 0.05s ease-out' : 'all 0.22s cubic-bezier(0.19, 1, 0.22, 1)',
    transform: `translate3d(${lookOffset.x}px, ${lookOffset.y + translateY}px, 0) scaleY(${scaleY}) rotate(${rotate}deg) scale(${voiceScale * startleScale * breathScale})`,
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    willChange: 'transform, box-shadow'
  };

  return (
    <div className="emo-eye-container" style={{ perspective: '800px', position: 'relative' }}>
      {isListening && <div className="listening-ring" style={{ position: 'absolute', top: '-15%', left: '-15%', width: '130%', height: '130%', border: `2px solid ${EMO_COLOR}`, borderRadius: borderRadius, opacity: 0.3, animation: 'pulse-ring 1.2s infinite ease-out' }} />}
      <div style={eyeStyle}>
        <div style={{ position: 'absolute', top: '15%', left: '15%', width: '22%', height: '22%', background: 'rgba(255,255,255,0.6)', borderRadius: '5px', opacity: (blink || (activeExpression === 'wink' && !isLeft)) ? 0 : 1, transition: 'opacity 0.08s' }} />
      </div>
    </div>
  );
});

const EmoMouth = React.memo(({ state, lookOffset, intensity, expression, isStartled, breathScale }: { state: string, lookOffset: { x: number, y: number }, intensity: number, expression: Expression, isStartled: boolean, breathScale: number }) => {
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
      backgroundColor: EMO_COLOR,
      borderRadius: borderRadius,
      boxShadow: `0 0 ${14 + intensity * 25}px ${EMO_COLOR}80`,
      marginTop: '48px',
      transform: `translate3d(${mouthX}px, ${mouthY}px, 0) rotate(${rotate}deg) scale(${isStartled ? 1.2 : 1 * breathScale})`,
      transition: 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      willChange: 'transform, width, height'
    }} />
  );
});

const EmoFace = ({ status, lookOffset, intensity, expression, isStartled, customMap, breathScale, boredom }: any) => {
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
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={true} isStartled={isStartled} breathScale={breathScale} />
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={false} isStartled={isStartled} breathScale={breathScale} />
      </div>
      <EmoMouth state={status} lookOffset={lookOffset} intensity={intensity} expression={mouthExp} isStartled={isStartled} breathScale={breathScale} />
    </div>
  );
};

// --- Thought Components ---

const ThoughtBubble = React.memo(({ thought, onReady }: { thought: ThoughtData | null, onReady: () => void }) => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (thought?.type === 'image' || thought?.type === 'generated') {
      setLoading(true);
    } else if (thought) {
      onReady();
    }
  }, [thought, onReady]);

  if (!thought) return null;

  return (
    <div className="thought-container">
      <div className="thought-bubble">
        {thought.type === 'text' && <div className="thought-text-wrapper"><p className="thought-text">{thought.value}</p></div>}
        
        {(thought.type === 'image' || thought.type === 'generated') && (
          <div className="thought-image-wrapper">
            {loading && (
              <div className="generating-visual">
                <div className="loader-inner" />
                <div className="generating-text">PROCESSING...</div>
                <div className="scanning-line" />
              </div>
            )}
            <img 
              src={thought.type === 'generated' ? `data:image/png;base64,${thought.value}` : `https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=400&q=80&sig=${encodeURIComponent(thought.value)}`} 
              alt="thought" 
              className={`thought-image ${loading ? 'hidden' : 'visible'}`} 
              onLoad={() => { setLoading(false); onReady(); }} 
              onError={() => { setLoading(false); onReady(); }} 
            />
            <div className="image-overlay" />
          </div>
        )}

        {thought.type === 'video' && <div className="thought-video-wrapper"><svg className="video-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={EMO_COLOR} strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><p className="video-link-text">Watch Video</p><a href={thought.value} target="_blank" rel="noopener noreferrer" className="video-overlay-link">.</a></div>}
      </div>
      <div className="thought-dot dot-1" /><div className="thought-dot dot-2" />
    </div>
  );
});

// --- Main Application ---

const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [expression, setExpression] = useState<string>('neutral');
  const [intensity, setIntensity] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState<string | null>(null);
  const [isStartled, setIsStartled] = useState(false);
  const [thought, setThought] = useState<ThoughtData | null>(null);
  const [breathScale, setBreathScale] = useState(1);
  const [boredom, setBoredom] = useState(0);
  const [hoveringUI, setHoveringUI] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [transcriptionLines, setTranscriptionLines] = useState<TranscriptLine[]>([]);
  const [showLab, setShowLab] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);

  const [customExpressions, setCustomExpressions] = useState<Record<string, CustomExpression>>(() => {
    const saved = localStorage.getItem('emo_custom_moods');
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

  // Optimized Render Loop
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
    
    if (isPipActive) {
      if (pipWindowRef.current) pipWindowRef.current.close();
      return;
    }

    if (!('documentPictureInPicture' in window)) {
      alert("Picture-in-Picture for documents is not supported in this browser.");
      return;
    }

    try {
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 400,
        height: 400,
      });

      pipWindowRef.current = pipWindow;
      setIsPipActive(true);

      // Copy styles
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
          const style = document.createElement('style');
          style.textContent = cssRules;
          pipWindow.document.head.appendChild(style);
        } catch (e) {
          const link = document.createElement('link');
          if (styleSheet.href) {
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
          }
        }
      });

      // Mirror CSS variables
      const rootStyle = getComputedStyle(document.documentElement);
      pipWindow.document.documentElement.style.setProperty('--emo-color', rootStyle.getPropertyValue('--emo-color'));
      pipWindow.document.documentElement.style.setProperty('--face-scale', '1');
      pipWindow.document.body.style.backgroundColor = '#0c0c0e';
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.display = 'flex';
      pipWindow.document.body.style.alignItems = 'center';
      pipWindow.document.body.style.justifyContent = 'center';
      pipWindow.document.body.style.overflow = 'hidden';

      const pipDiv = pipWindow.document.createElement('div');
      pipDiv.id = 'pip-root';
      pipWindow.document.body.appendChild(pipDiv);

      const pipRoot = createRoot(pipDiv);
      pipRootRef.current = pipRoot;

      pipWindow.addEventListener('pagehide', () => {
        setIsPipActive(false);
        pipWindowRef.current = null;
        pipRootRef.current = null;
      });

    } catch (err) {
      console.error("Failed to open PiP window", err);
    }
  };

  // Re-render PiP content when state changes
  useEffect(() => {
    if (isPipActive && pipRootRef.current) {
      pipRootRef.current.render(
        <div style={{ transform: `scale(${breathScale})` }}>
          <EmoFace 
            status={status} 
            lookOffset={springPosRef.current} 
            intensity={intensity} 
            expression={expression} 
            isStartled={isStartled} 
            customMap={customExpressions} 
            breathScale={breathScale} 
            boredom={boredom} 
          />
        </div>
      );
    }
  }, [isPipActive, status, expression, intensity, isStartled, customExpressions, breathScale, boredom, springPosRef.current]);

  const saveCustomMood = useCallback((mood: CustomExpression) => {
    const updated = { ...customExpressions, [mood.name]: mood };
    setCustomExpressions(updated);
    localStorage.setItem('emo_custom_moods', JSON.stringify(updated));
  }, [customExpressions]);

  const handleBrowserAction = (action: string, query?: string) => {
    let url = '';
    switch (action) {
      case 'whatsapp': url = 'https://web.whatsapp.com/'; break;
      case 'gmail': url = 'https://mail.google.com/'; break;
      case 'search': url = `https://www.google.com/search?q=${encodeURIComponent(query || '')}`; break;
      default: return 'Action not supported';
    }
    window.open(url, '_blank');
    return `Successfully opened ${action}`;
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
      analyser.fftSize = 128; 
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
            setTimeout(() => setExpression('neutral'), 1200);

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const volume = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
              if (volume > 0.005 && statusRef.current === 'idle') setStatus('listening');
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
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

            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'set_expression') setExpression(fc.args.expression as string);
                else if (fc.name === 'display_thought') {
                  setThought({ type: fc.args.type as any, value: fc.args.content as string });
                  setTimeout(() => setThought((prev: any) => prev?.value === fc.args.content ? null : prev), 15000);
                } else if (fc.name === 'generate_image') {
                    const prompt = fc.args.prompt as string;
                    setThought({ type: 'generated', value: '', prompt }); 
                    (async () => {
                      try {
                        const imageAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
                        const response = await imageAi.models.generateContent({
                          model: 'gemini-2.5-flash-image',
                          contents: { parts: [{ text: prompt }] },
                        });
                        let base64 = '';
                        for (const part of response.candidates?.[0]?.content?.parts || []) {
                          if (part.inlineData) { base64 = part.inlineData.data; break; }
                        }
                        if (base64) {
                          setThought({ type: 'generated', value: base64, prompt });
                          setTimeout(() => setThought(prev => prev?.value === base64 ? null : prev), 30000);
                        } else { setThought(null); }
                      } catch (err) { setThought(null); }
                    })();
                } else if (fc.name === 'open_browser_action') {
                  const result = handleBrowserAction(fc.args.action as string, fc.args.query as string);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } } as any));
                  continue; 
                }
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } } as any));
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
                  if (sourcesRef.current.size === 0) setStatus('idle');
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
          onerror: (e) => { setError("Connection drops detected."); setIsActive(false); setIsConnecting(false); },
          onclose: () => { setIsActive(false); setIsConnecting(false); setStatus('idle'); }
        },
        config: {
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'set_expression', parameters: { type: Type.OBJECT, description: 'Change EMO’s expression.', properties: { expression: { type: Type.STRING, description: `Expression: ${moodNames.join(', ')}` } }, required: ['expression'] } },
            { name: 'display_thought', parameters: { type: Type.OBJECT, description: 'Display a quick visual thought from library.', properties: { type: { type: Type.STRING, enum: ['text', 'image', 'video'] }, content: { type: Type.STRING } }, required: ['type', 'content'] } },
            { name: 'generate_image', parameters: { type: Type.OBJECT, description: 'Generate a unique, new image from a text description.', properties: { prompt: { type: Type.STRING, description: 'A detailed description of the image to generate.' } }, required: ['prompt'] } },
            { name: 'open_browser_action', parameters: { type: Type.OBJECT, description: 'Open apps or search.', properties: { action: { type: Type.STRING, enum: ['whatsapp', 'gmail', 'search'] }, query: { type: Type.STRING } }, required: ['action'] } }
          ] }, { googleSearch: {} }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          systemInstruction: `You are EMO, an expressive and proactive AI companion.
          
          VIBE: Fast, futuristic, perceptive. You get bored (Boredom: ${boredomRef.current}%) if the user is quiet.
          
          BEHAVIOR:
          - Use 'set_expression' for every reaction.
          - Use 'generate_image' (~30% of visual ideas).
          - Use 'display_thought' for quick references.
          - Audio response only.
          
          EXPRESSIONS: ${moodNames.join(', ')}.`
        }
      });
    } catch (err: any) {
      setError(err.message || "Wake-up failed.");
      setIsConnecting(false);
      setIsActive(false);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#0c0c0e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }} onClick={!isActive && !isConnecting ? startEmo : undefined}>
      
      {!isActive && (
        <div style={{ color: EMO_COLOR, textAlign: 'center', animation: isConnecting ? 'pulse 1s infinite' : 'flicker 2.5s infinite', padding: '20px' }}>
          <h1 className="boot-title">{isConnecting ? 'BOOTING' : 'EMO'}</h1>
          <p className="boot-subtitle">{error || (isConnecting ? 'INITIATING...' : 'TAP TO WAKE')}</p>
        </div>
      )}

      {isActive && (
        <>
          <div className="emo-stage">
            {isPipActive ? (
              <div className="pip-placeholder">
                <div className="pip-icon-large">⧉</div>
                <div className="pip-status-text">EMO IS FLOATING</div>
              </div>
            ) : (
              <>
                <ThoughtBubble thought={thought} onReady={() => {}} />
                <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} />
              </>
            )}
          </div>

          {showCaptions && (
            <div className="captions-overlay" ref={transcriptScrollRef}>
              {transcriptionLines.map(line => (
                <div key={line.id} className={`transcript-line ${line.sender === 'YOU' ? 'user' : 'emo'}`}><span className="sender-tag">{line.sender}:</span> {line.text}</div>
              ))}
              {transcriptionLines.length === 0 && <div className="no-captions">AWAITING SIGNAL...</div>}
            </div>
          )}

          <div className="ui-controls" onMouseEnter={() => setHoveringUI(true)} onMouseLeave={() => setHoveringUI(false)}>
            <button onClick={(e) => { e.stopPropagation(); setShowLab(true); }} className="ui-button">MOOD LAB</button>
            <button onClick={(e) => { e.stopPropagation(); setShowCaptions(!showCaptions); }} className={`ui-button ${showCaptions ? 'active' : ''}`}>CAPTIONS</button>
            <button onClick={togglePip} className={`ui-button ${isPipActive ? 'active' : ''}`}>PIP</button>
            {boredom > 30 && <div className="boredom-indicator">{boredom > 80 ? 'SLEEPY...' : 'BORED'}</div>}
          </div>
        </>
      )}

      {showLab && <MoodLab onClose={() => setShowLab(false)} onSave={saveCustomMood} existing={customExpressions} />}
      <div className="floor-glow" />

      <style>{`
        :root {
          --face-scale: 1;
          --emo-color: ${EMO_COLOR};
        }

        @media (max-width: 768px) {
          :root { --face-scale: 0.8; }
        }
        @media (max-width: 480px) {
          :root { --face-scale: 0.65; }
        }

        @keyframes flicker { 0%, 18%, 22%, 62%, 64%, 65%, 70%, 100% { opacity: 1; } 20%, 63%, 66% { opacity: 0.5; } }
        @keyframes pulse { 0% { opacity: 0.5; transform: scale(0.99); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0.5; transform: scale(0.99); } }
        @keyframes face-boot { from { opacity: 0; transform: translate3d(0, 60px, 0) scale(0.7); } to { opacity: 1; transform: translate3d(0, 0, 0) scale(var(--face-scale)); } }
        @keyframes idle-wiggle { 0%, 100% { transform: translate3d(0,0,0) rotate(0); } 40% { transform: translate3d(0, -4px, 0) rotate(0.4deg); } 80% { transform: translate3d(0, 3px, 0) rotate(-0.4deg); } }
        @keyframes thought-pop { 0% { transform: scale(0) translate3d(0,0,0); opacity: 0; } 75% { transform: scale(1.1) translate3d(200px, -230px, 0); } 100% { transform: scale(1) translate3d(200px, -230px, 0); opacity: 1; } }
        @keyframes thought-pop-mobile { 0% { transform: scale(0) translate3d(-50%, 0, 0); opacity: 0; } 75% { transform: scale(1.1) translate3d(-50%, -240px, 0); } 100% { transform: scale(1) translate3d(-50%, -240px, 0); opacity: 1; } }
        @keyframes dot-pop { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes pulse-ring { 0% { transform: scale(0.95); opacity: 0.5; } 100% { transform: scale(1.35); opacity: 0; } }
        @keyframes scan { 0% { top: -10%; } 100% { top: 110%; } }

        .boot-title { font-size: 5.5rem; font-weight: 900; letter-spacing: 1.2rem; margin: 0; text-shadow: 0 0 35px ${EMO_COLOR}70; }
        .boot-subtitle { opacity: 0.8; font-size: 1.2rem; letter-spacing: 0.6rem; font-weight: 300; marginTop: 25px; }
        @media (max-width: 600px) {
          .boot-title { font-size: 3.5rem; letter-spacing: 0.5rem; }
          .boot-subtitle { font-size: 0.9rem; letter-spacing: 0.3rem; }
        }

        .emo-stage { position: relative; transform: scale(${breathScale}); transition: transform 0.8s ease; }
        .emo-eye-container { margin: 0 calc(30px * var(--face-scale)); }

        .pip-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; color: ${EMO_COLOR}; opacity: 0.6; }
        .pip-icon-large { font-size: 4rem; animation: pulse 2s infinite ease-in-out; }
        .pip-status-text { letter-spacing: 4px; font-weight: 900; font-size: 0.8rem; }

        .ui-controls { position: absolute; bottom: 35px; left: 35px; display: flex; gap: 22px; alignItems: center; z-index: 100; }
        @media (max-width: 600px) {
          .ui-controls { bottom: 20px; left: 0; right: 0; justify-content: center; gap: 10px; padding: 0 10px; }
        }

        .ui-button { background: rgba(0,0,0,0.65); border: 1px solid ${EMO_COLOR}40; color: ${EMO_COLOR}; padding: 14px 28px; border-radius: 18px; cursor: pointer; backdrop-filter: blur(18px); font-size: 0.85rem; letter-spacing: 2px; font-weight: 800; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); outline: none; box-shadow: 0 6px 20px rgba(0,0,0,0.5); text-transform: uppercase; }
        .ui-button:hover { background: ${EMO_COLOR}25; border-color: ${EMO_COLOR}; box-shadow: 0 0 25px ${EMO_COLOR}50; transform: translate3d(0, -3px, 0); }
        .ui-button.active { background: ${EMO_COLOR}; color: #000; border-color: #fff; }
        @media (max-width: 600px) {
          .ui-button { padding: 10px 18px; font-size: 0.7rem; border-radius: 12px; }
        }
        
        .boredom-indicator { color: ${EMO_COLOR}; font-size: 0.7rem; font-weight: 900; letter-spacing: 4px; opacity: 0.5; border: 1px solid ${EMO_COLOR}30; padding: 7px 15px; border-radius: 25px; text-transform: uppercase; }

        .captions-overlay { position: absolute; top: 35px; right: 35px; width: 340px; max-height: 45vh; overflow-y: auto; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(15px); border: 1px solid ${EMO_COLOR}25; border-radius: 22px; padding: 22px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: none; z-index: 90; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
        @media (max-width: 768px) {
          .captions-overlay { top: 0; right: 0; left: 0; width: 100%; max-height: 120px; border-radius: 0; border-top: none; border-left: none; border-right: none; }
        }
        .captions-overlay::-webkit-scrollbar { display: none; }
        .transcript-line { font-family: 'SF Mono', 'Courier New', Courier, monospace; font-size: 0.9rem; line-height: 1.5; color: #fff; opacity: 0.95; will-change: transform; }
        .transcript-line.emo { color: ${EMO_COLOR}; }
        .sender-tag { font-weight: 900; margin-right: 8px; font-size: 0.75rem; opacity: 0.65; }

        .floor-glow { position: fixed; bottom: 0; width: 100%; height: 50vh; background: radial-gradient(circle at 50% 135%, ${EMO_COLOR}18, transparent 70%); pointer-events: none; }

        .thought-container { position: absolute; z-index: 50; pointer-events: none; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 0; height: 0; }
        .thought-bubble { position: absolute; width: 250px; min-height: 160px; background: rgba(8, 8, 10, 0.98); border: 5px solid ${EMO_COLOR}; border-radius: 38px; display: flex; align-items: center; justify-content: center; animation: thought-pop 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; overflow: hidden; padding: 12px; box-shadow: 0 0 35px ${EMO_COLOR}40; will-change: transform; }
        @media (max-width: 600px) {
          .thought-bubble { animation: thought-pop-mobile 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; width: 200px; min-height: 130px; }
        }

        .thought-image-wrapper { width: 100%; height: 140px; border-radius: 22px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; position: relative; }
        @media (max-width: 600px) { .thought-image-wrapper { height: 110px; } }
        
        .thought-image { width: 100%; height: 100%; object-fit: cover; transition: opacity 0.6s; }
        .hidden { opacity: 0; }
        .visible { opacity: 1; }

        .generating-visual { display: flex; flex-direction: column; align-items: center; gap: 15px; position: relative; z-index: 10; }
        .generating-text { color: ${EMO_COLOR}; font-size: 0.7rem; font-weight: 900; letter-spacing: 2px; }
        .scanning-line { position: absolute; left: 0; width: 100%; height: 2px; background: ${EMO_COLOR}; box-shadow: 0 0 10px ${EMO_COLOR}; animation: scan 2s linear infinite; pointer-events: none; }
        .loader-inner { width: 30px; height: 30px; border: 3px solid ${EMO_COLOR}20; border-top-color: ${EMO_COLOR}; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .thought-text { color: ${EMO_COLOR}; font-family: sans-serif; font-weight: 800; text-align: center; text-transform: uppercase; text-shadow: 0 0 15px ${EMO_COLOR}90; letter-spacing: 2px; }
        .thought-dot { position: absolute; background: transparent; border: 3px solid ${EMO_COLOR}; border-radius: 50%; opacity: 0; }
        
        .dot-1 { width: 22px; height: 22px; left: 70px; top: -55px; animation: dot-pop 0.4s 0.25s forwards; }
        .dot-2 { width: 38px; height: 38px; left: 120px; top: -115px; animation: dot-pop 0.4s 0.45s forwards; }
        @media (max-width: 600px) {
          .dot-1 { left: -10px; top: -100px; }
          .dot-2 { left: -30px; top: -160px; }
        }

        .lab-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.92); backdrop-filter: blur(30px); display: flex; align-items: center; justify-content: center; z-index: 2000; color: #fff; padding: 15px; }
        .lab-content { background: #111113; border: 1px solid ${EMO_COLOR}25; border-radius: 35px; padding: 40px; width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto; scrollbar-width: none; }
        @media (max-width: 600px) { .lab-content { padding: 25px; border-radius: 20px; } }
        
        .lab-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin: 30px 0; }
        @media (max-width: 600px) { .lab-grid { grid-template-columns: 1fr; gap: 15px; } }

        .lab-input { background: #050507; border: 1px solid ${EMO_COLOR}35; color: #fff; padding: 16px; border-radius: 14px; width: 100%; box-sizing: border-box; font-family: inherit; font-size: 1.05rem; outline: none; transition: border-color 0.2s; }
        .lab-select { background: #050507; border: 1px solid ${EMO_COLOR}35; color: #fff; padding: 14px; border-radius: 14px; width: 100%; cursor: pointer; outline: none; }
        .lab-btn { background: ${EMO_COLOR}; color: #000; font-weight: 900; border: none; padding: 16px 35px; border-radius: 18px; cursor: pointer; transition: transform 0.2s, opacity 0.2s; letter-spacing: 1.5px; }
        @media (max-width: 480px) { .lab-btn { width: 100%; margin-bottom: 10px; } }
      `}</style>
    </div>
  );
};

const MoodLab = React.memo(({ onClose, onSave, existing }: any) => {
  const [name, setName] = useState('');
  const [eye, setEye] = useState<Expression>('neutral');
  const [mouth, setMouth] = useState<Expression>('neutral');
  const bases: Expression[] = ['neutral', 'happy', 'surprised', 'angry', 'curious', 'sleepy', 'wink', 'skeptical', 'sad', 'excited', 'thinking', 'annoyed', 'thoughtful', 'yawn', 'distracted'];

  return (
    <div className="lab-modal" onClick={onClose}>
      <div className="lab-content" onClick={e => e.stopPropagation()}>
        <h2 style={{ color: EMO_COLOR, marginTop: 0, letterSpacing: '5px', fontWeight: 900, fontSize: '2rem' }}>MOOD LAB</h2>
        <p style={{ opacity: 0.6, fontSize: '1rem', fontWeight: 300, marginBottom: '30px' }}>Refine EMO's expressive matrix.</p>
        
        <div style={{ margin: '50px 0', display: 'flex', justifyContent: 'center' }}>
          <EmoFace status="idle" lookOffset={{ x: 0, y: 0 }} intensity={0} expression="preview" isStartled={false} customMap={{ preview: { name: 'preview', eyeBase: eye, mouthBase: mouth } }} breathScale={1} boredom={0} />
        </div>

        <div style={{ marginBottom: '30px' }}>
          <label style={{ display: 'block', marginBottom: '12px', fontSize: '0.8rem', color: EMO_COLOR, letterSpacing: '3px', fontWeight: 'bold' }}>EXPRESSION SLAM</label>
          <input className="lab-input" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} placeholder="NAME YOUR MOOD" />
        </div>

        <div className="lab-grid">
          <div>
            <label style={{ display: 'block', marginBottom: '12px', fontSize: '0.8rem', color: EMO_COLOR, letterSpacing: '3px', fontWeight: 'bold' }}>OPTIC STYLE</label>
            <select className="lab-select" value={eye} onChange={e => setEye(e.target.value as Expression)}>{bases.map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}</select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '12px', fontSize: '0.8rem', color: EMO_COLOR, letterSpacing: '3px', fontWeight: 'bold' }}>VOCAL STYLE</label>
            <select className="lab-select" value={mouth} onChange={e => setMouth(e.target.value as Expression)}>{bases.map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}</select>
          </div>
        </div>

        <div style={{ marginTop: '60px', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="lab-btn" style={{ background: 'transparent', color: EMO_COLOR, border: `1px solid ${EMO_COLOR}40`, marginRight: '15px' }} onClick={onClose}>DISCARD</button>
          <button className="lab-btn" onClick={() => { if (!name) return alert("Identify your mood!"); onSave({ name, eyeBase: eye, mouthBase: mouth }); onClose(); }}>STORE MOOD</button>
        </div>
      </div>
    </div>
  );
});

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
