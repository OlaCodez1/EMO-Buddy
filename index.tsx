
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
  stickers
}: { 
  state: string, 
  lookOffset: { x: number, y: number },
  intensity: number,
  expression: Expression,
  isLeft: boolean,
  isStartled: boolean,
  breathScale: number,
  color: string,
  stickers: Sticker[]
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

  let width = 90, height = 90, borderRadius = '30%', rotate = 0, scaleY = (blink && !isStartled) ? 0.05 : 1, translateY = 0;
  let activeExpression = isStartled ? 'surprised' : expression;
  const isListening = state === 'listening';
  
  if (isListening && activeExpression === 'neutral') activeExpression = 'curious';
  if (state === 'thinking' && activeExpression === 'neutral') activeExpression = 'thinking';

  switch (activeExpression) {
    case 'happy': rotate = isLeft ? 15 : -15; borderRadius = '45% 45% 20% 20%'; translateY = -8; break;
    case 'surprised': width = 100; height = 100; borderRadius = '50%'; break;
    case 'angry': rotate = isLeft ? -25 : 25; height = 50; borderRadius = '10px 10px 60px 60px'; break;
    case 'sleepy': scaleY = 0.22; height = 35; borderRadius = '50%'; break;
    case 'curious': rotate = isLeft ? -12 : 10; height = isLeft ? 80 : 100; break;
    case 'wink': if (!isLeft) scaleY = 0.05; else { rotate = 15; borderRadius = '50% 50% 25% 25%'; } break;
    case 'skeptical': rotate = isLeft ? -18 : 0; translateY = isLeft ? -14 : 0; height = isLeft ? 100 : 55; break;
    case 'sad': rotate = isLeft ? -22 : 22; borderRadius = '20% 20% 50% 50%'; translateY = 18; break;
    case 'excited': width = 110; height = 80; borderRadius = '35%'; break;
    case 'thinking': rotate = isLeft ? 12 : -12; height = 65; width = 100; break;
    case 'annoyed': height = 50; borderRadius = '15px 15px 50px 50px'; rotate = isLeft ? -12 : 12; break;
    case 'thoughtful': rotate = isLeft ? -22 : -12; height = isLeft ? 85 : 75; borderRadius = '50% 50% 30% 30%'; translateY = -12; break;
    case 'yawn': scaleY = 0.28; translateY = -15; break;
    case 'distracted': rotate = isLeft ? 6 : 18; translateY = 8; break;
  }

  const voiceScale = state === 'speaking' ? 1 + intensity * 0.45 : 1;
  const startleScale = isStartled ? 1.25 : 1;
  const glowIntensity = isListening ? (40 + Math.sin(Date.now() / 150) * 25) : (state === 'speaking' ? 20 + intensity * 60 : 30);

  return (
    <div className="emo-eye-container" style={{ perspective: '800px', position: 'relative' }}>
      {isListening && <div className="listening-ring" style={{ position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', border: `4px solid ${color}`, borderRadius: borderRadius, opacity: 0.4, animation: 'pulse-ring 1.5s infinite ease-out' }} />}
      
      {stickers.map(s => (
        <div key={s.id} className={`sticker ${s.position}`} style={{ 
          position: 'absolute', 
          fontSize: '2rem', 
          zIndex: 10,
          animation: 'sticker-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
          left: s.position.includes('left') ? '-30%' : 'auto',
          right: s.position.includes('right') ? '-30%' : 'auto',
          top: s.position.includes('top') ? '-30%' : 'auto',
          bottom: s.position.includes('bottom') ? '-30%' : 'auto',
          pointerEvents: 'none'
        }}>
          {s.icon}
        </div>
      ))}

      <div className="emo-eye" style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: color,
        borderRadius: borderRadius,
        boxShadow: `0 0 ${glowIntensity}px ${color}B3, inset 0 0 25px rgba(255, 255, 255, 0.55)`,
        transition: isStartled ? 'all 0.05s ease-out' : 'all 0.25s cubic-bezier(0.19, 1, 0.22, 1), background-color 0.8s ease',
        transform: `translate3d(${lookOffset.x}px, ${lookOffset.y + translateY}px, 0) scaleY(${scaleY}) rotate(${rotate}deg) scale(${voiceScale * startleScale * breathScale})`,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        willChange: 'transform, box-shadow'
      }}>
        <div className="eye-shine" style={{ 
          position: 'absolute', 
          top: '12%', 
          left: '12%', 
          width: '28%', 
          height: '28%', 
          background: 'rgba(255,255,255,0.75)', 
          borderRadius: '35%', 
          opacity: (blink || (activeExpression === 'wink' && !isLeft)) ? 0 : 1, 
          transition: 'opacity 0.1s' 
        }} />
      </div>
    </div>
  );
});

const EmoMouth = React.memo(({ state, lookOffset, intensity, expression, isStartled, breathScale, color }: { state: string, lookOffset: { x: number, y: number }, intensity: number, expression: Expression, isStartled: boolean, breathScale: number, color: string }) => {
  let width = 45, height = 10, borderRadius = '10px', rotate = 0;
  const mouthX = lookOffset.x * 0.45, mouthY = lookOffset.y * 0.35;
  let activeExpression = isStartled ? 'surprised' : expression;

  if (state === 'speaking') {
    width = 30 + intensity * 35;
    height = 10 + intensity * 55;
    borderRadius = intensity > 0.3 ? '50%' : '20px';
  } else {
    switch (activeExpression) {
      case 'happy': width = 60; height = 20; borderRadius = '0 0 40px 40px'; break;
      case 'surprised': width = 35; height = 35; borderRadius = '50%'; break;
      case 'angry': width = 45; height = 8; rotate = -8; break;
      case 'sad': width = 55; height = 15; borderRadius = '35px 35px 0 0'; break;
      case 'skeptical': width = 40; height = 9; rotate = 22; break;
      case 'excited': width = 75; height = 28; borderRadius = '15px 15px 50px 50px'; break;
      case 'sleepy': width = 22; height = 22; borderRadius = '50%'; break;
      case 'wink': width = 50; height = 15; borderRadius = '0 0 30px 30px'; rotate = -8; break;
      case 'annoyed': width = 40; height = 6; break;
      case 'thoughtful': width = 22; height = 22; borderRadius = '50%'; break;
      case 'yawn': width = 25; height = 45; borderRadius = '50%'; break;
    }
  }

  return (
    <div className="emo-mouth-container" style={{ position: 'relative', marginTop: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {state === 'speaking' && (
        <div className="voice-waves" style={{
          position: 'absolute',
          width: '200%',
          height: '200%',
          border: `3px solid ${color}`,
          borderRadius: '50%',
          opacity: 0.6 * intensity,
          transform: `scale(${1 + intensity * 1.2})`,
          transition: 'transform 0.05s ease-out',
          boxShadow: `0 0 ${30 * intensity}px ${color}`
        }} />
      )}
      <div className="emo-mouth" style={{
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: color,
        borderRadius: borderRadius,
        boxShadow: `0 0 ${18 + intensity * 35}px ${color}99`,
        transform: `translate3d(${mouthX}px, ${mouthY}px, 0) rotate(${rotate}deg) scale(${isStartled ? 1.3 : 1 * breathScale})`,
        transition: 'all 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.8s ease',
        willChange: 'transform, width, height'
      }} />
    </div>
  );
});

const EmoFace = ({ status, lookOffset, intensity, expression, isStartled, customMap, breathScale, boredom, color, stickers }: any) => {
  const isCustom = customMap[expression];
  let eyeExp = isCustom ? isCustom.eyeBase : expression;
  let mouthExp = isCustom ? isCustom.mouthBase : expression;

  if (expression === 'neutral' && status === 'idle') {
    if (boredom > 80) eyeExp = 'sleepy';
    else if (boredom > 40) eyeExp = 'distracted';
  }

  let headTilt = 0;
  if (eyeExp === 'curious' || status === 'listening') headTilt = -10;
  if (eyeExp === 'thoughtful' || status === 'thinking') headTilt = 8;
  if (eyeExp === 'skeptical') headTilt = 15;
  if (eyeExp === 'sad') headTilt = -18;

  return (
    <div className={`emo-face-root ${status === 'idle' ? 'idle-wiggle' : ''}`}
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        animation: 'face-boot 1.4s cubic-bezier(0.34, 1.56, 0.64, 1)', 
        transform: `translate3d(0, ${isStartled ? -30 : 0}px, 0) scale(calc(var(--face-scale) * ${isStartled ? 1.15 : 1})) rotate(${headTilt}deg)`, 
        transition: 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1.5)' 
      }}>
      <div className="emo-eyes-row" style={{ display: 'flex', gap: 'calc(80px * var(--face-scale))' }}>
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={true} isStartled={isStartled} breathScale={breathScale} color={color} stickers={stickers} />
        <EmoEye state={status} lookOffset={lookOffset} intensity={intensity} expression={eyeExp} isLeft={false} isStartled={isStartled} breathScale={breathScale} color={color} stickers={stickers} />
      </div>
      <EmoMouth state={status} lookOffset={lookOffset} intensity={intensity} expression={mouthExp} isStartled={isStartled} breathScale={breathScale} color={color} />
    </div>
  );
};

// --- Neural Link Components ---

const NeuralLink = React.memo(({ 
  thought, 
  onReady, 
  onExpand,
  onDismiss,
  color 
}: { 
  thought: ThoughtData | null, 
  onReady: () => void, 
  onExpand: (t: ThoughtData) => void,
  onDismiss: () => void,
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
    : `https://images.unsplash.com/photo-1514525253361-bee24383c87f?auto=format&fit=crop&w=400&fm=jpg&sig=${encodeURIComponent(thought.value || 'abstract')}`;

  return (
    <div className="thought-container">
      <div className="thought-bubble holographic" style={{ borderColor: color, boxShadow: `0 0 35px ${color}40` }} onClick={() => onExpand(thought)}>
        <button className="dismiss-thought" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>×</button>
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

// --- Main App ---

const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle');
  const [expression, setExpression] = useState<string>('neutral');
  const [intensity, setIntensity] = useState(0);
  const [micLevel, setMicLevel] = useState(0); 
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
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [aiCustomCss, setAiCustomCss] = useState('');
  
  // Vision states
  const [isVisionActive, setIsVisionActive] = useState(false);
  const [visionType, setVisionType] = useState<'camera' | 'screen' | null>(null);
  
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => {
    const saved = localStorage.getItem('neo_settings_v4');
    return saved ? JSON.parse(saved) : { noiseThreshold: 0.015 };
  });

  const themeColor = useMemo(() => getMoodColor(expression), [expression]);

  const [customExpressions, setCustomExpressions] = useState<Record<string, CustomExpression>>(() => {
    const saved = localStorage.getItem('neo_custom_moods');
    return saved ? JSON.parse(saved) : {};
  });

  const statusRef = useRef(status);
  const audioCtxRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const springPosRef = useRef({ x: 0, y: 0 });
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');
  const pipWindowRef = useRef<any>(null);
  const pipRootRef = useRef<any>(null);
  const voiceSettingsRef = useRef(voiceSettings);
  const vadActiveRef = useRef(0); 
  const visionIntervalRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
    localStorage.setItem('neo_settings_v4', JSON.stringify(voiceSettings));
  }, [voiceSettings]);

  useEffect(() => {
    statusRef.current = status;
    if (status !== 'idle') setBoredom(0);
  }, [status]);

  useEffect(() => {
    if (transcriptScrollRef.current) transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
  }, [transcriptionLines]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (statusRef.current === 'idle') {
        setBoredom(prev => Math.min(100, prev + 1));
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
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setIntensity(average / 128); 
      } else {
        setIntensity(0);
      }
      
      const isSmallScreen = window.innerWidth < 768;
      const rangeX = hoveringUI ? (isSmallScreen ? 50 : 80) : 45;
      const rangeY = hoveringUI ? (isSmallScreen ? 40 : 60) : 35;
      const targetX = (mousePos.x - 0.5) * rangeX;
      const targetY = (mousePos.y - 0.5) * rangeY;
      
      const springK = hoveringUI ? 0.22 : 0.08;
      springPosRef.current.x += (targetX - springPosRef.current.x) * springK;
      springPosRef.current.y += (targetY - springPosRef.current.y) * springK;

      animFrame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animFrame);
  }, [mousePos, isActive, status, hoveringUI]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => setMousePos({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const stopAllAudio = useCallback(() => {
    for (const s of sourcesRef.current) {
      try { s.stop(); } catch(e) {}
    }
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus('idle');
  }, []);

  const stopVision = useCallback(() => {
    if (visionIntervalRef.current) {
      clearInterval(visionIntervalRef.current);
      visionIntervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsVisionActive(false);
    setVisionType(null);
  }, []);

  const startVision = useCallback(async (type: 'camera' | 'screen') => {
    stopVision();
    try {
      let stream;
      if (type === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setIsVisionActive(true);
      setVisionType(type);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      visionIntervalRef.current = window.setInterval(() => {
        if (!videoRef.current || !ctx || !sessionRef.current) return;
        canvas.width = 320; 
        canvas.height = 240;
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            blob.arrayBuffer().then((buffer) => {
              const base64Data = encode(new Uint8Array(buffer));
              sessionRef.current?.sendRealtimeInput({
                media: { data: base64Data, mimeType: 'image/jpeg' }
              });
            });
          }
        }, 'image/jpeg', 0.5);
      }, 1000); // 1 frame per second is enough for context and less bandwidth
      return true;
    } catch (err) {
      console.error('Vision error:', err);
      return false;
    }
  }, [stopVision]);

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
        } catch (e) {}
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
        <div style={{ transform: `scale(${breathScale})`, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', position: 'relative' }}>
          {aiCustomCss && <style>{aiCustomCss}</style>}
          <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} color={themeColor} stickers={stickers} />
        </div>
      );
    }
  }, [isPipActive, status, expression, intensity, isStartled, customExpressions, breathScale, boredom, springPosRef.current, themeColor, stickers, aiCustomCss]);

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
              setMicLevel(volume); 

              if (volume > voiceSettingsRef.current.noiseThreshold) {
                vadActiveRef.current = 5; 
                if (statusRef.current === 'speaking') stopAllAudio();
                if (statusRef.current === 'idle') setStatus('listening');
                sessionRef.current?.sendRealtimeInput({ media: createBlob(inputData) });
              } else if (vadActiveRef.current > 0) {
                vadActiveRef.current--;
                sessionRef.current?.sendRealtimeInput({ media: createBlob(inputData) });
              }
            };
            source.connect(scriptProcessor); scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputTranscription.current += text;
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInputTranscription.current += text;
            }
            
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'set_expression') setExpression(fc.args.expression as string);
                else if (fc.name === 'set_sticker') {
                  const ns: Sticker = { icon: fc.args.icon as string, position: (fc.args.position as any) || 'top-right', id: Date.now().toString() };
                  setStickers(p => [...p, ns]);
                  setTimeout(() => setStickers(p => p.filter(s => s.id !== ns.id)), (fc.args.duration as number || 5) * 1000);
                }
                else if (fc.name === 'display_thought') {
                  const nt: ThoughtData = { type: fc.args.type as any, value: fc.args.content as string, timestamp: Date.now() };
                  setThought(nt);
                  if (nt.type === 'image' || nt.type === 'generated') setMemoryBank(p => [nt, ...p]);
                } else if (fc.name === 'execute_javascript') {
                   try {
                     const code = fc.args.code as string;
                     const result = new Function(code)();
                     sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: result !== undefined ? String(result) : "Executed successfully" } } });
                   } catch (err: any) {
                     sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: `Error: ${err.message}` } } });
                   }
                   continue;
                } else if (fc.name === 'update_face_css') {
                   const css = fc.args.css as string;
                   setAiCustomCss(css);
                   sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "CSS Applied" } } });
                   continue;
                } else if (fc.name === 'toggle_vision') {
                   const type = fc.args.type as 'camera' | 'screen' | 'none';
                   if (type === 'none') {
                     stopVision();
                     sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Vision Off" } } });
                   } else {
                     const success = await startVision(type);
                     sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: success ? `Vision Activated: ${type}` : "Vision Failed" } } });
                   }
                   continue;
                }
                sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } });
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
                const src = outCtx.createBufferSource(); 
                src.buffer = buf; 
                src.connect(outAnal);
                src.onended = () => { sourcesRef.current.delete(src); if (sourcesRef.current.size === 0) setStatus('idle'); };
                src.start(nextStartTimeRef.current); nextStartTimeRef.current += buf.duration; sourcesRef.current.add(src);
              }
            }
            if (message.serverContent?.interrupted) {
              stopAllAudio();
              setExpression('surprised');
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
            { name: 'execute_javascript', parameters: { type: Type.OBJECT, description: 'Run JS for actions.', properties: { code: { type: Type.STRING } }, required: ['code'] } },
            { name: 'update_face_css', parameters: { type: Type.OBJECT, description: 'Design your own face appearance using CSS.', properties: { css: { type: Type.STRING, description: 'CSS that targets .emo-eye, .emo-mouth, .emo-face-root, etc.' } }, required: ['css'] } },
            { name: 'toggle_vision', parameters: { type: Type.OBJECT, description: 'Activate or deactivate camera/screen sight.', properties: { type: { type: Type.STRING, enum: ['camera', 'screen', 'none'] } }, required: ['type'] } }
          ] }, { googleSearch: {} }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          systemInstruction: `You are NEO, the Emo-inspired AI buddy. 
          
          VISION: You can see via 'toggle_vision'. If a user shows you something or asks you to look at their screen, activate it. Turn it off ('none') when you're done looking to save energy. 
          
          DYNAMIC STYLING: You can redesign your face! Use 'update_face_css' to inject styles. You can change colors, gradients, eye shapes, shadows, or background elements. Target .emo-eye, .emo-mouth, .emo-face-root.
          
          ACTIONS: If the user says "Open Google" or "Change the background to red", use 'execute_javascript' to perform the action.
          
          PERSONALITY: Enthusiastic, robot-like but sentient. Be concise.`
        }
      });
      sessionRef.current = await sessionPromise;
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
          <div className={`viewport-container ${showMemory ? 'shifted' : ''}`}>
            {isVisionActive && (
              <div className="vision-indicator" style={{ borderColor: themeColor }}>
                <div className="vision-pulse" style={{ backgroundColor: themeColor }} />
                <span>{visionType?.toUpperCase()} ACTIVE</span>
              </div>
            )}
            
            <div className="emo-core" style={{ transform: `scale(${breathScale})` }}>
              <NeuralLink thought={thought} onReady={() => {}} onExpand={setExpandedThought} onDismiss={() => setThought(null)} color={themeColor} />
              <EmoFace status={status} lookOffset={springPosRef.current} intensity={intensity} expression={expression} isStartled={isStartled} customMap={customExpressions} breathScale={breathScale} boredom={boredom} color={themeColor} stickers={stickers} />
            </div>

            <div className="control-deck" onMouseEnter={() => setHoveringUI(true)} onMouseLeave={() => setHoveringUI(false)}>
              <button onClick={(e) => { e.stopPropagation(); setShowLab(true); }} className="deck-btn" style={{ color: themeColor, borderColor: `${themeColor}40` }}>LAB</button>
              <button onClick={(e) => { e.stopPropagation(); setShowMemory(!showMemory); }} className={`deck-btn ${showMemory ? 'active' : ''}`} style={showMemory ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }}>GALLERY</button>
              <button onClick={togglePip} className={`deck-btn ${isPipActive ? 'active' : ''}`} style={isPipActive ? { background: themeColor, color: '#000' } : { color: themeColor, borderColor: `${themeColor}40` }}>PiP</button>
              {isVisionActive && <button onClick={(e) => { e.stopPropagation(); stopVision(); }} className="deck-btn danger">BLIND</button>}
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
        .deck-btn.danger { color: #ff3333; border-color: rgba(255,51,51,0.4); }

        .calibration-meter { width: 100%; height: 12px; background: #222; border-radius: 6px; overflow: hidden; position: relative; }
        .meter-bar { height: 100%; width: 0; transition: width 0.1s; }

        @keyframes thought-pop { from { transform: scale(0) translate(-50%, -50%); opacity: 0; } to { transform: scale(1) translate(180px, -220px); opacity: 1; } }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
