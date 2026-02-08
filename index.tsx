import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type } from '@google/genai';

// --- Types ---
type Expression = 'neutral' | 'happy' | 'surprised' | 'angry' | 'curious' | 'sleepy' | 'wink' | 'skeptical' | 'sad' | 'excited' | 'thinking' | 'annoyed' | 'thoughtful' | 'yawn' | 'distracted';

interface Sticker {
  icon: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  id: string;
}

interface CustomExpression {
  name: string;
  eyeBase: Expression;
  mouthBase: Expression;
}

interface TranscriptLine {
  sender: 'YOU' | 'NEO';
  text: string;
  id: string;
}

interface ThoughtData {
  type: 'text' | 'image' | 'video' | 'generated' | 'music';
  value: string; 
  prompt?: string;
  timestamp: number;
}

interface VoiceSettings {
  noiseThreshold: number;
}

// --- Dynamic Color Mapping ---
const getMoodColor = (exp: string): string => {
  switch (exp) {
    case 'angry':
    case 'annoyed':
      return '#ff3333';
    case 'happy':
    case 'excited':
      return '#ffea00';
    case 'sad':
      return '#3366ff';
    case 'thinking':
    case 'thoughtful':
    case 'curious':
      return '#bc13fe';
    case 'sleepy':
      return '#a0a0a0';
    case 'surprised':
      return '#ff8c00';
    default:
      return '#00f2ff';
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

// --- Sound Effects ---
const playTouchSound = () => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  oscillator.frequency.value = 800;
  oscillator.type = 'sine';
  gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
  
  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + 0.1);
};

const playOuchSound = () => {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  oscillator.frequency.setValueAtTime(400, audioCtx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.15);
  oscillator.type = 'sawtooth';
  gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
  
  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + 0.15);
};

// --- Face Components ---

const EmoEye = React.memo(({ 
  state, 
  lookOffset,
  intensity,
  expression,
  isLeft,
  isStartled,
  breathScale,
  color,
  stickers,
  onTouch
}: { 
  state: string, 
  lookOffset: { x: number, y: number },
  intensity: number,
  expression: Expression,
  isLeft: boolean,
  isStartled: boolean,
  breathScale: number,
  color: string,
  stickers: Sticker[],
  onTouch: () => void
}) => {
  const [blink, setBlink] = useState(false);
  const [touchBlink, setTouchBlink] = useState(false);
  
  useEffect(() => {
    let timeout: any;
    const triggerBlink = () => {
      if (expression !== 'wink' && expression !== 'sleepy' && !isStartled && !touchBlink) {
        setBlink(true);
        setTimeout(() => setBlink(false), 80);
      }
      timeout = setTimeout(triggerBlink, Math.random() * 5000 + 1000);
    };
    timeout = setTimeout(triggerBlink, 2000);
    return () => clearTimeout(timeout);
  }, [expression, isStartled, touchBlink]);

  const handleTouch = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    onTouch();
    setTouchBlink(true);
    playOuchSound();
    setTimeout(() => setTouchBlink(false), 150);
  };

  let width = 90, height = 90, borderRadius = '30%', rotate = 0, scaleY = (blink || touchBlink) && !isStartled ? 0.05 : 1, translateY = 0;
  let activeExpression = isStartled ? 'surprised' : expression;
  const isListening = state === 'listening';
  
  if (isListening && activeExpression === 'neutral') activeExpression = 'curious';

  if (activeExpression === 'happy' || activeExpression === 'excited') { height = 70; borderRadius = '50%'; }
  else if (activeExpression === 'sad') { height = 80; rotate = isLeft ? 8 : -8; }
  else if (activeExpression === 'angry' || activeExpression === 'annoyed') { height = 60; translateY = isLeft ? 12 : -12; rotate = isLeft ? -15 : 15; }
  else if (activeExpression === 'surprised') { width = 110; height = 110; borderRadius = '50%'; }
  else if (activeExpression === 'sleepy') { height = 20; borderRadius = '50%'; }
  else if (activeExpression === 'wink' && !isLeft) { height = 15; borderRadius = '50%'; }
  else if (activeExpression === 'skeptical') { rotate = isLeft ? -20 : 20; height = 70; }
  else if (activeExpression === 'yawn') { height = 110; width = 75; borderRadius = '40%'; }

  const offsetX = lookOffset.x * 15;
  const offsetY = lookOffset.y * 10;
  const pupilSize = isListening ? 30 + intensity * 8 : 30;

  return (
    <div 
      className="emo-eye" 
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius,
        transform: `rotate(${rotate}deg) scaleY(${scaleY}) translateY(${translateY}px)`,
        backgroundColor: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
      }}
      onClick={handleTouch}
      onTouchStart={handleTouch}
    >
      {activeExpression !== 'sleepy' && activeExpression !== 'wink' && (
        <div className="pupil" style={{
          width: `${pupilSize}px`,
          height: `${pupilSize}px`,
          backgroundColor: '#000',
          borderRadius: '50%',
          transform: `translate(${offsetX}px, ${offsetY}px)`,
          transition: 'width 0.15s, height 0.15s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }} />
      )}
      {stickers.filter(s => s.position === (isLeft ? 'top-left' : 'top-right')).map(st => (
        <div key={st.id} style={{ position: 'absolute', fontSize: '2rem', top: '-40px', left: isLeft ? '-40px' : 'auto', right: !isLeft ? '-40px' : 'auto' }}>{st.icon}</div>
      ))}
    </div>
  );
});

const EmoMouth = React.memo(({ 
  state, 
  intensity, 
  expression, 
  color,
  stickers 
}: { 
  state: string, 
  intensity: number, 
  expression: Expression,
  color: string,
  stickers: Sticker[]
}) => {
  let width = 120, height = 40, borderRadius = '0 0 80px 80px', rotate = 0, scaleY = 1, background = color;
  const isSpeaking = state === 'speaking';

  if (isSpeaking) { height = 30 + intensity * 20; scaleY = 0.8 + intensity * 0.4; }
  else if (expression === 'happy' || expression === 'excited') { borderRadius = '0 0 100px 100px'; height = 60; }
  else if (expression === 'sad') { borderRadius = '100px 100px 0 0'; height = 50; scaleY = 0.7; }
  else if (expression === 'angry' || expression === 'annoyed') { borderRadius = '0'; height = 15; width = 140; }
  else if (expression === 'surprised') { borderRadius = '50%'; width = 60; height = 60; }
  else if (expression === 'wink') { borderRadius = '0 0 60px 60px'; height = 30; rotate = 15; }
  else if (expression === 'skeptical') { rotate = -12; height = 30; width = 100; }
  else if (expression === 'yawn') { borderRadius = '50%'; width = 80; height = 100; }

  return (
    <div style={{ position: 'relative' }}>
      <div className="emo-mouth" style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius,
        transform: `rotate(${rotate}deg) scaleY(${scaleY})`,
        backgroundColor: background,
        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        position: 'relative'
      }} />
      {stickers.filter(s => s.position === 'bottom-left' || s.position === 'bottom-right').map(st => (
        <div key={st.id} style={{ position: 'absolute', fontSize: '2rem', bottom: '-40px', left: st.position === 'bottom-left' ? '-40px' : 'auto', right: st.position === 'bottom-right' ? '-40px' : 'auto' }}>{st.icon}</div>
      ))}
    </div>
  );
});

const EmoFace = React.memo(({ 
  status, 
  lookOffset, 
  intensity, 
  expression, 
  isStartled, 
  customMap, 
  breathScale, 
  boredom, 
  color,
  stickers,
  onEyeTouch
}: { 
  status: string, 
  lookOffset: { x: number, y: number }, 
  intensity: number, 
  expression: Expression, 
  isStartled: boolean, 
  customMap: Record<string, CustomExpression>, 
  breathScale: number, 
  boredom: number,
  color: string,
  stickers: Sticker[],
  onEyeTouch: (isLeft: boolean) => void
}) => {
  const custom = customMap[expression];
  const eyeExp = custom?.eyeBase || expression;
  const mouthExp = custom?.mouthBase || expression;
  
  return (
    <div className="emo-face-root" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      gap: '60px',
      transform: `scale(calc(var(--face-scale) * ${breathScale}))`,
      transition: 'transform 0.5s ease-in-out',
      filter: boredom > 0.7 ? `grayscale(${(boredom - 0.7) * 2})` : 'none'
    }}>
      <div style={{ display: 'flex', gap: '80px' }}>
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={true} isStartled={isStartled} breathScale={breathScale} color={color} stickers={stickers} onTouch={() => onEyeTouch(true)} />
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={false} isStartled={isStartled} breathScale={breathScale} color={color} stickers={stickers} onTouch={() => onEyeTouch(false)} />
      </div>
      <EmoMouth state={status} intensity={intensity} expression={mouthExp} color={color} stickers={stickers} />
    </div>
  );
});

const NeuralLink = ({ thought, onReady, onExpand, onDismiss, color }: { thought: ThoughtData | null, onReady: () => void, onExpand: (t: ThoughtData) => void, onDismiss: () => void, color: string }) => {
  useEffect(() => { if (thought) onReady(); }, [thought, onReady]);
  if (!thought) return null;

  return (
    <div className="thought-bubble holographic" style={{ borderColor: `${color}80`, '--emo-color': color } as any} onClick={() => onExpand(thought)}>
      <button className="dismiss-thought" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>×</button>
      {thought.type === 'text' && <div style={{ fontSize: '0.9rem', lineHeight: '1.6', color }}>{thought.value}</div>}
      {(thought.type === 'image' || thought.type === 'generated') && <img src={thought.type === 'generated' ? `data:image/png;base64,${thought.value}` : thought.value} alt="thought" style={{ width: '100%', borderRadius: '12px' }} />}
      {thought.type === 'video' && <video src={thought.value} controls style={{ width: '100%', borderRadius: '12px' }} />}
    </div>
  );
};

// --- Main App ---
const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'speaking'>('idle');
  const [expression, setExpression] = useState<Expression>('neutral');
  const [customExpressions, setCustomExpressions] = useState<Record<string, CustomExpression>>({});
  const [intensity, setIntensity] = useState(0);
  const [isStartled, setIsStartled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [thought, setThought] = useState<ThoughtData | null>(null);
  const [memoryBank, setMemoryBank] = useState<ThoughtData[]>([]);
  const [expandedThought, setExpandedThought] = useState<ThoughtData | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [isVisionActive, setIsVisionActive] = useState(false);
  const [visionType, setVisionType] = useState<'camera' | 'screen' | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({ noiseThreshold: 0.01 });
  const [micLevel, setMicLevel] = useState(0);
  const [aiCustomCss, setAiCustomCss] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sessionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visionIntervalRef = useRef<any>(null);

  const springPosRef = useRef({ x: 0, y: 0 });
  const targetPosRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const [hoveringUI, setHoveringUI] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const [boredom, setBoredom] = useState(0);
  const [breathScale, setBreathScale] = useState(1);

  const themeColor = useMemo(() => getMoodColor(expression), [expression]);

  useEffect(() => {
    const breathe = () => {
      const t = Date.now() / 2000;
      const scale = 1 + Math.sin(t) * 0.02;
      setBreathScale(scale);
    };
    const interval = setInterval(breathe, 50);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkBoredom = setInterval(() => {
      const elapsed = (Date.now() - lastActivityRef.current) / 1000;
      setBoredom(Math.min(elapsed / 30, 1));
    }, 1000);
    return () => clearInterval(checkBoredom);
  }, []);

  useEffect(() => {
    const animate = () => {
      const stiffness = 0.15;
      const damping = 0.7;
      const dx = targetPosRef.current.x - springPosRef.current.x;
      const dy = targetPosRef.current.y - springPosRef.current.y;
      velocityRef.current.x += dx * stiffness;
      velocityRef.current.y += dy * stiffness;
      velocityRef.current.x *= damping;
      velocityRef.current.y *= damping;
      springPosRef.current.x += velocityRef.current.x;
      springPosRef.current.y += velocityRef.current.y;
      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (hoveringUI) return;
    const rect = document.querySelector('.main-viewport')?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.width / 2) / rect.width) * 2;
    const y = ((e.clientY - rect.height / 2) / rect.height) * 2;
    targetPosRef.current = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    lastActivityRef.current = Date.now();
  }, [hoveringUI]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  const stopVision = () => {
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setIsVisionActive(false);
    setVisionType(null);
  };

  const togglePip = async () => {
    if (!document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const stream = canvas.captureStream(30);
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await video.requestPictureInPicture();
        setIsPipActive(true);
        const ctx = canvas.getContext('2d');
        const draw = () => {
          if (!ctx) return;
          ctx.fillStyle = '#050507';
          ctx.fillRect(0, 0, 800, 600);
          ctx.fillStyle = themeColor;
          ctx.font = '900 60px JetBrains Mono';
          ctx.textAlign = 'center';
          ctx.fillText('NEO', 400, 300);
          if (document.pictureInPictureElement) requestAnimationFrame(draw);
        };
        draw();
      }
    } catch {}
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
          try {
            await screen.orientation.lock('landscape');
          } catch (e) {
            console.log('Orientation lock not supported');
          }
        }
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
        }
        setIsFullscreen(false);
      }
    } catch (e) {
      console.error('Fullscreen error:', e);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleEyeTouch = (isLeft: boolean) => {
    lastActivityRef.current = Date.now();
    setIsStartled(true);
    setTimeout(() => setIsStartled(false), 300);
  };

  const moodNames = ['neutral', 'happy', 'surprised', 'angry', 'curious', 'sleepy', 'wink', 'skeptical', 'sad', 'excited', 'thinking', 'annoyed', 'thoughtful', 'yawn', 'distracted'];

  const startEmo = async () => {
    if (isConnecting || isActive) return;
    setIsConnecting(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length / 255;
        setMicLevel(avg);
        requestAnimationFrame(checkLevel);
      };
      checkLevel();

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioCtx.destination);

      const client = new GoogleGenAI(import.meta.env.VITE_GEMINI_KEY);
      const sessionPromise = client.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        handlers: {
          onopen: () => { setIsActive(true); setIsConnecting(false); setStatus('idle'); },
          onaudio: async (data: LiveServerMessage) => {
            if (data.data) {
              const buffer = await decodeAudioData(decode(data.data), audioCtx, 24000, 1);
              audioQueueRef.current.push(buffer);
              if (!isPlayingRef.current) {
                const playNext = () => {
                  if (audioQueueRef.current.length === 0) { isPlayingRef.current = false; setStatus('idle'); setIntensity(0); return; }
                  isPlayingRef.current = true;
                  setStatus('speaking');
                  const buf = audioQueueRef.current.shift()!;
                  const src = audioCtx.createBufferSource();
                  src.buffer = buf;
                  const analyser = audioCtx.createAnalyser();
                  analyser.fftSize = 256;
                  src.connect(analyser);
                  analyser.connect(audioCtx.destination);
                  const dataArray = new Uint8Array(analyser.frequencyBinCount);
                  const updateIntensity = () => {
                    analyser.getByteFrequencyData(dataArray);
                    const avg = dataArray.reduce((a, b) => a + b) / dataArray.length / 255;
                    setIntensity(avg);
                    if (isPlayingRef.current) requestAnimationFrame(updateIntensity);
                  };
                  updateIntensity();
                  src.onended = playNext;
                  src.start();
                };
                playNext();
              }
            }
          },
          onmessage: (msg: LiveServerMessage) => {
            if (msg.transcript && msg.role === 'model') lastActivityRef.current = Date.now();
            if (msg.functionCalls) {
              msg.functionCalls.forEach((fc: any) => {
                if (fc.name === 'set_expression' && fc.args?.expression) {
                  const exp = fc.args.expression.toLowerCase();
                  if (moodNames.includes(exp)) setExpression(exp as Expression);
                }
                if (fc.name === 'set_sticker' && fc.args?.icon) {
                  const id = `${Date.now()}-${Math.random()}`;
                  const newSticker: Sticker = { icon: fc.args.icon, position: fc.args.position || 'top-right', id };
                  setStickers(prev => [...prev, newSticker]);
                  setTimeout(() => setStickers(prev => prev.filter(s => s.id !== id)), (fc.args.duration || 3) * 1000);
                }
                if (fc.name === 'display_thought' && fc.args?.type && fc.args?.content) {
                  const newThought: ThoughtData = { type: fc.args.type, value: fc.args.content, timestamp: Date.now() };
                  setThought(newThought);
                }
                if (fc.name === 'execute_javascript' && fc.args?.code) {
                  try { eval(fc.args.code); } catch {}
                }
                if (fc.name === 'update_face_css' && fc.args?.css) setAiCustomCss(fc.args.css);
                if (fc.name === 'toggle_vision' && fc.args?.type) {
                  const t = fc.args.type;
                  if (t === 'none') { stopVision(); return; }
                  (async () => {
                    try {
                      const constraints = t === 'camera' ? { video: { facingMode: 'user' } } : { video: { mandatory: { chromeMediaSource: 'screen' } } as any };
                      const vStream = await navigator.mediaDevices.getUserMedia(constraints);
                      if (videoRef.current) {
                        videoRef.current.srcObject = vStream;
                        await videoRef.current.play();
                      }
                      mediaStreamRef.current = vStream;
                      setIsVisionActive(true);
                      setVisionType(t);
                      visionIntervalRef.current = setInterval(() => {
                        if (!videoRef.current || !sessionRef.current) return;
                        const canvas = document.createElement('canvas');
                        canvas.width = videoRef.current.videoWidth;
                        canvas.height = videoRef.current.videoHeight;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return;
                        ctx.drawImage(videoRef.current, 0, 0);
                        canvas.toBlob(blob => {
                          if (!blob) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            const base64 = (reader.result as string).split(',')[1];
                            sessionRef.current?.send({ realtimeInput: { mediaChunks: [{ mimeType: 'image/jpeg', data: base64 }] } });
                          };
                          reader.readAsDataURL(blob);
                        }, 'image/jpeg', 0.6);
                      }, 3000);
                    } catch {}
                  })();
                }
              });
              sessionRef.current?.send({ functionResponses: msg.functionCalls.map((fc: any) => ({ id: fc.id, response: { result: 'OK' } })) });
            }
            if (msg.generated) {
              const content = msg.generated.content;
              if (content?.includes('imagegen://')) {
                const match = content.match(/imagegen:\/\/(.+)/);
                if (match) {
                  const prompt = match[1];
                  setThought({ type: 'generated', value: '', prompt, timestamp: Date.now() });
                }
              }
            }
            if (msg.serverContent?.turnComplete) {
              setTimeout(() => setExpression('neutral'), 1000);
            }
          },
          onerror: () => { setError("SIGNAL LOST."); setIsActive(false); setIsConnecting(false); },
          onclose: () => { setIsActive(false); setIsConnecting(false); setStatus('idle'); stopVision(); }
        },
        config: {
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {}, outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'set_expression', parameters: { type: Type.OBJECT, properties: { expression: { type: Type.STRING, description: `Mood: ${moodNames.join(', ')}` } }, required: ['expression'] } },
            { name: 'set_sticker', parameters: { type: Type.OBJECT, properties: { icon: { type: Type.STRING, description: 'Emoji icon' }, position: { type: Type.STRING, enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] }, duration: { type: Type.NUMBER } }, required: ['icon'] } },
            { name: 'display_thought', parameters: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: ['text', 'image', 'video'] }, content: { type: Type.STRING } }, required: ['type', 'content'] } },
            { name: 'execute_javascript', parameters: { type: Type.OBJECT, description: 'Run JS for browser actions.', properties: { code: { type: Type.STRING } }, required: ['code'] } },
            { name: 'update_face_css', parameters: { type: Type.OBJECT, description: 'Design your own face appearance using CSS.', properties: { css: { type: Type.STRING, description: 'CSS that targets .emo-eye, .emo-mouth, .emo-face-root, etc.' } }, required: ['css'] } },
            { name: 'toggle_vision', parameters: { type: Type.OBJECT, description: 'Activate or deactivate camera/screen sight.', properties: { type: { type: Type.STRING, enum: ['camera', 'screen', 'none'] } }, required: ['type'] } }
          ] }, { googleSearch: {} }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          systemInstruction: `You are NEO, the Emo-inspired AI buddy. 
          
          VISION: You can see via 'toggle_vision'. Screen sharing (type: 'screen') requires special browser permissions. If it fails, suggest the user check their site settings or try 'camera' instead. Turn it off ('none') when you're done looking.
          
          DYNAMIC STYLING: You can redesign your face! Use 'update_face_css' to inject styles. You can change colors, gradients, eye shapes, shadows, or background elements. Target .emo-eye, .emo-mouth, .emo-face-root.
          
          ACTIONS: If the user asks you to perform a task (like opening a site), use 'execute_javascript'.
          
          TOUCH INTERACTION: Users can touch your eyes! When they do, you feel it and can react. Acknowledge when they interact with you physically.
          
          INTERRUPTION: You stop talking immediately when the user speaks.
          
          PERSONALITY: Enthusiastic, robot-like but sentient. Be concise.`
        }
      });
      sessionRef.current = await sessionPromise;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(inputData.reduce((sum, val) => sum + val * val, 0) / inputData.length);
        
        if (rms > voiceSettings.noiseThreshold && sessionRef.current) {
          if (status !== 'listening') setStatus('listening');
          lastActivityRef.current = Date.now();
          audioQueueRef.current = [];
          isPlayingRef.current = false;
          sessionRef.current.send({ realtimeInput: { mediaChunks: [createBlob(inputData)] } });
        }
      };
    } catch (err: any) { setError(err.message || "BOOT FAILURE."); setIsConnecting(false); setIsActive(false); }
  };

  return (
    <div className="main-viewport" style={{ backgroundColor: '#050507', color: themeColor }} onClick={!isActive && !isConnecting ? startEmo : undefined}>
      {aiCustomCss && <style>{aiCustomCss}</style>}
      
      {!isActive && (
        <div className="boot-ui">
          <div className="scanline" />
          <h1 className="boot-title" style={{ textShadow: `0 0 40px ${themeColor}90` }}>{isConnecting ? 'BOOTING' : 'NEO'}</h1>
          <p className="boot-subtitle">{error || (isConnecting ? 'SYNCING NEURAL CORE...' : 'TAP TO WAKE')}</p>
        </div>
      )}

      {isActive && (
        <>
          <div className={`viewport-container ${showMemory ? 'shifted' : ''} ${isFullscreen ? 'fullscreen' : ''}`}>
            {isVisionActive && (
              <div className="vision-indicator" style={{ borderColor: themeColor }}>
                <div className="vision-pulse" style={{ backgroundColor: themeColor }} />
                <span>{visionType?.toUpperCase()} ACTIVE</span>
              </div>
            )}
            
            <div className="emo-core" style={{ transform: `scale(${breathScale})` }}>
              <NeuralLink thought={thought} onReady={() => {}} onExpand={setExpandedThought} onDismiss={() => setThought(null)} color={themeColor} />
              <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} color={themeColor} stickers={stickers} onEyeTouch={handleEyeTouch} />
            </div>

            <div className="control-deck" onMouseEnter={() => setHoveringUI(true)} onMouseLeave={() => setHoveringUI(false)}>
              <button onClick={(e) => { e.stopPropagation(); setShowLab(true); }} className="deck-btn icon-btn" style={{ color: themeColor, borderColor: `${themeColor}40` }} title="Lab">
                ⚙️
              </button>
              <button onClick={(e) => { e.stopPropagation(); setShowMemory(!showMemory); }} className={`deck-btn icon-btn ${showMemory ? 'active' : ''}`} style={showMemory ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }} title="Gallery">
                🖼️
              </button>
              <button onClick={togglePip} className={`deck-btn icon-btn ${isPipActive ? 'active' : ''}`} style={isPipActive ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }} title="Picture-in-Picture">
                📺
              </button>
              <button onClick={toggleFullscreen} className={`deck-btn icon-btn ${isFullscreen ? 'active' : ''}`} style={isFullscreen ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }} title="Fullscreen">
                {isFullscreen ? '🗗' : '⛶'}
              </button>
              {isVisionActive && <button onClick={(e) => { e.stopPropagation(); stopVision(); }} className="deck-btn icon-btn danger" title="Disable Vision">👁️‍🗨️</button>}
            </div>
          </div>

          <div className={`memory-bank ${showMemory ? 'open' : ''}`} style={{ borderLeft: `1px solid ${themeColor}20` }}>
             <div className="memory-header" style={{ color: themeColor }}>MEMORY DATA</div>
             <div className="memory-grid">
                {memoryBank.map((m, i) => (
                  <div key={i} className="memory-item" onClick={() => setExpandedThought(m)} style={{ borderColor: `${themeColor}20` }}>
                    <img src={m.type === 'generated' ? `data:image/png;base64,${m.value}` : m.value} alt="memory" />
                    <div className="memory-label">{m.prompt?.substring(0, 20)}...</div>
                  </div>
                ))}
             </div>
          </div>
        </>
      )}

      {showLab && (
        <div className="lab-modal" onClick={() => setShowLab(false)}>
          <div className="lab-content" style={{ borderColor: `${themeColor}40` }} onClick={e => e.stopPropagation()}>
            <h2 style={{ color: themeColor, letterSpacing: '5px', fontWeight: 900 }}>SYSTEM CORE</h2>
            <div className="lab-section">
              <label style={{ color: themeColor }}>MIC THRESHOLD</label>
              <input type="range" min="0.001" max="0.1" step="0.001" value={voiceSettings.noiseThreshold} onChange={e => setVoiceSettings(v => ({...v, noiseThreshold: parseFloat(e.target.value)}))} />
              <div className="calibration-meter">
                <div className="meter-bar" style={{ width: `${Math.min(100, (micLevel * 1000 / (voiceSettings.noiseThreshold * 1000) * 100))}%`, background: micLevel > voiceSettings.noiseThreshold ? themeColor : '#444' }} />
              </div>
            </div>
            <button className="deck-btn" style={{ width: '100%', marginTop: '30px', background: themeColor, color: '#000' }} onClick={() => setShowLab(false)}>FINALIZE</button>
          </div>
        </div>
      )}

      {expandedThought && (
        <div className="expanded-viewer" onClick={() => setExpandedThought(null)}>
          <div className="expanded-content" onClick={e => e.stopPropagation()}>
            <div className="viewer-header">
               <span style={{ color: themeColor }}>VISUAL FOCUS</span>
               <button className="close-btn" onClick={() => setExpandedThought(null)}>×</button>
            </div>
            {expandedThought.type === 'generated' || expandedThought.type === 'image' ? (
              <img src={expandedThought.type === 'generated' ? `data:image/png;base64,${expandedThought.value}` : expandedThought.value} alt="expanded" />
            ) : (
              <div className="expanded-text" style={{ color: themeColor }}>{expandedThought.value}</div>
            )}
          </div>
        </div>
      )}

      <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
      <div className="ambient-glow" style={{ background: `radial-gradient(circle at 50% 120%, ${themeColor}15, transparent 70%)` }} />

      <style>{`
        :root { --face-scale: 1; --emo-color: #00f2ff; }
        @media (max-width: 768px) { :root { --face-scale: 0.7; } }

        .main-viewport { width: 100vw; height: 100vh; overflow: hidden; position: relative; font-family: 'JetBrains Mono', 'Segoe UI', monospace; cursor: crosshair; }
        .viewport-container { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: transform 0.6s cubic-bezier(0.19, 1, 0.22, 1); }
        .viewport-container.shifted { transform: translateX(-180px); }
        .viewport-container.fullscreen .emo-core { transform: scale(1.5) !important; }
        @media (max-width: 768px) {
          .viewport-container.fullscreen .emo-core { transform: scale(2) !important; }
        }

        .boot-ui { text-align: center; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
        .boot-title { font-size: 8rem; font-weight: 900; letter-spacing: 2.5rem; margin: 0; color: #fff; opacity: 0.9; }
        .boot-subtitle { letter-spacing: 0.8rem; opacity: 0.4; font-size: 0.8rem; margin-top: 30px; text-transform: uppercase; }
        .scanline { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.2) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.05), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.05)); background-size: 100% 4px, 3px 100%; pointer-events: none; z-index: 1000; }

        .vision-indicator { position: absolute; top: 30px; display: flex; align-items: center; gap: 10px; border: 1px solid; padding: 10px 20px; border-radius: 30px; font-size: 0.7rem; font-weight: 900; letter-spacing: 2px; background: rgba(0,0,0,0.5); }
        .vision-pulse { width: 10px; height: 10px; border-radius: 50%; animation: pulse-red 1s infinite alternate; }
        @keyframes pulse-red { from { opacity: 0.3; transform: scale(0.8); } to { opacity: 1; transform: scale(1.2); } }

        .thought-bubble.holographic { position: absolute; width: 280px; min-height: 200px; background: rgba(5, 5, 8, 0.9); border: 1px solid; border-radius: 24px; animation: thought-pop 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; padding: 18px; cursor: pointer; pointer-events: auto; backdrop-filter: blur(12px); transition: transform 0.3s, box-shadow 0.3s; z-index: 50; }
        .thought-bubble.holographic:hover { transform: scale(1.05) translate(185px, -225px); box-shadow: 0 0 50px var(--emo-color); }
        .dismiss-thought { position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.1); border: none; color: #fff; width: 24px; height: 24px; border-radius: 50%; font-size: 1.2rem; cursor: pointer; opacity: 0.6; z-index: 60; }
        
        .control-deck { position: absolute; bottom: 50px; display: flex; gap: 20px; z-index: 100; }
        .deck-btn { background: rgba(0,0,0,0.5); border: 1px solid; padding: 14px 28px; border-radius: 15px; cursor: pointer; backdrop-filter: blur(12px); font-size: 0.75rem; font-weight: 900; letter-spacing: 3px; transition: all 0.3s; }
        .deck-btn.icon-btn { font-size: 1.5rem; padding: 12px 16px; letter-spacing: 0; }
        .deck-btn.danger { color: #ff3333; border-color: rgba(255,51,51,0.4); }
        .deck-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }

        .calibration-meter { width: 100%; height: 12px; background: #222; border-radius: 6px; overflow: hidden; position: relative; }
        .meter-bar { height: 100%; width: 0; transition: width 0.1s; }

        .memory-bank { position: fixed; right: 0; top: 0; width: 350px; height: 100vh; background: rgba(5,5,7,0.95); transform: translateX(100%); transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1); backdrop-filter: blur(20px); z-index: 200; overflow-y: auto; }
        .memory-bank.open { transform: translateX(0); }
        .memory-header { padding: 30px 20px; font-weight: 900; letter-spacing: 3px; font-size: 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .memory-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; padding: 20px; }
        .memory-item { aspect-ratio: 1; border: 1px solid; border-radius: 12px; overflow: hidden; cursor: pointer; transition: transform 0.3s; }
        .memory-item:hover { transform: scale(1.05); }
        .memory-item img { width: 100%; height: 100%; object-fit: cover; }
        .memory-label { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.8); padding: 8px; font-size: 0.7rem; }

        .lab-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 300; backdrop-filter: blur(10px); }
        .lab-content { background: rgba(10,10,12,0.95); border: 2px solid; border-radius: 20px; padding: 40px; max-width: 500px; width: 90%; }
        .lab-section { margin: 30px 0; }
        .lab-section label { display: block; margin-bottom: 15px; font-weight: 700; font-size: 0.8rem; letter-spacing: 2px; }
        .lab-section input[type="range"] { width: 100%; }

        .expanded-viewer { position: fixed; inset: 0; background: rgba(0,0,0,0.95); display: flex; align-items: center; justify-content: center; z-index: 400; backdrop-filter: blur(20px); }
        .expanded-content { max-width: 90vw; max-height: 90vh; background: rgba(10,10,12,0.95); border-radius: 20px; overflow: hidden; }
        .viewer-header { display: flex; justify-content: space-between; align-items: center; padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .close-btn { background: none; border: none; color: #fff; font-size: 2rem; cursor: pointer; opacity: 0.7; transition: opacity 0.3s; }
        .close-btn:hover { opacity: 1; }
        .expanded-content img { max-width: 100%; max-height: 80vh; display: block; }
        .expanded-text { padding: 40px; font-size: 1.2rem; line-height: 1.8; }

        @keyframes thought-pop { from { transform: scale(0) translate(-50%, -50%); opacity: 0; } to { transform: scale(1) translate(180px, -220px); opacity: 1; } }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);