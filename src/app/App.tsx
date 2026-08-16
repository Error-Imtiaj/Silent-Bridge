import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera, Hand, Volume2, Users, BookOpen,
  Moon, Sun, MessageSquare, PlusCircle, Search,
  X, ArrowRight, Sparkles, Shield, Zap, Star,
  Edit3, Trash2, Globe, CheckCircle, Mic,
  ChevronRight, Eye, EyeOff, Play, Square,
  ThumbsUp, Share2, Tag, Clock, Wifi, Github, Linkedin
} from "lucide-react";
import {
  getGestures, saveGestures, getCommunitySignsFromDB,
  postCommunitySigns, updateCommunitySignsInDB,
  type CustomGesture, type CommunitySigns
} from "../lib/api";

// === Types ====================================================================
type View = "landing" | "live" | "cards" | "teach" | "community";
type Theme = "dark" | "light";
type RecordState = "idle" | "countdown" | "recording" | "saving";

// === MediaPipe window augmentation ===========================================
declare global {
  interface Window {
    Hands: any; Camera: any;
    drawConnectors: any; drawLandmarks: any; HAND_CONNECTIONS: any[];
  }
}

// === Gesture heuristics =======================================================
const BUILTIN_GESTURES = [
  { id: "open_palm",   label: "Hello",     phrase: "Hello! Nice to meet you.",     emoji: "👋" },
  { id: "thumbs_up",   label: "Yes",       phrase: "Yes, absolutely!",             emoji: "👍" },
  { id: "index_point", label: "Help",      phrase: "I need help, please.",         emoji: "☝️" },
  { id: "peace",       label: "Thank You", phrase: "Thank you so much!",           emoji: "✌️" },
];

// === Quick communication cards ================================================
const COMM_CARDS = [
  { id: "e1",  cat: "Emergency",  phrase: "I Need Help",           icon: "🆘",  color: "from-red-500 to-rose-600" },
  { id: "e2",  cat: "Emergency",  phrase: "Call 911",              icon: "🚨",  color: "from-red-600 to-red-700" },
  { id: "e3",  cat: "Emergency",  phrase: "I Am In Pain",         icon: "😣",  color: "from-rose-500 to-rose-700" },
  { id: "m1",  cat: "Medical",    phrase: "I Need Medicine",       icon: "💊",  color: "from-violet-500 to-purple-600" },
  { id: "m2",  cat: "Medical",    phrase: "Take Me To A Doctor",   icon: "🏥",  color: "from-purple-500 to-purple-700" },
  { id: "m3",  cat: "Medical",    phrase: "I Feel Dizzy",          icon: "🌀",  color: "from-indigo-400 to-indigo-600" },
  { id: "b1",  cat: "Basic",      phrase: "Yes",                   icon: "✅",  color: "from-emerald-500 to-teal-600" },
  { id: "b2",  cat: "Basic",      phrase: "No",                    icon: "❌",  color: "from-slate-500 to-slate-700" },
  { id: "b3",  cat: "Basic",      phrase: "Thank You",             icon: "🙏",  color: "from-amber-500 to-orange-600" },
  { id: "b4",  cat: "Basic",      phrase: "Please",                icon: "🤲",  color: "from-sky-500 to-blue-600" },
  { id: "b5",  cat: "Basic",      phrase: "Water Please",          icon: "💧",  color: "from-cyan-500 to-teal-600" },
  { id: "b6",  cat: "Basic",      phrase: "Food Please",           icon: "🍽️", color: "from-orange-500 to-amber-600" },
  { id: "n1",  cat: "Navigate",   phrase: "Where Am I?",           icon: "📍",  color: "from-blue-500 to-indigo-600" },
  { id: "n2",  cat: "Navigate",   phrase: "I Am Lost",             icon: "🗺️", color: "from-indigo-500 to-purple-600" },
  { id: "n3",  cat: "Navigate",   phrase: "Take Me Home",          icon: "🏠",  color: "from-teal-500 to-cyan-600" },
  { id: "s1",  cat: "Social",     phrase: "Nice To Meet You",      icon: "🤝",  color: "from-pink-500 to-rose-600" },
  { id: "s2",  cat: "Social",     phrase: "I Understand",          icon: "💡",  color: "from-yellow-500 to-amber-600" },
  { id: "s3",  cat: "Social",     phrase: "Please Speak Slowly",   icon: "🐢",  color: "from-green-500 to-emerald-600" },
];

// === Utility ==================================================================
function normalizeLandmarks(lm: any[]): number[] {
  const wrist = lm[0], mid = lm[9];
  const scale = Math.sqrt((mid.x - wrist.x) ** 2 + (mid.y - wrist.y) ** 2);
  if (scale < 0.001) return new Array(42).fill(0);
  return lm.flatMap(({ x, y }) => [(x - wrist.x) / scale, (y - wrist.y) / scale]);
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / Math.min(a.length, b.length));
}

function detectBuiltinGesture(lm: any[]): string | null {
  const fingerTips = [8, 12, 16, 20];
  const fingerPIPs = [6, 10, 14, 18];
  const fingerMCPs = [5, 9, 13, 17];
  const thumbTip = lm[4], thumbIP = lm[3], thumbMCP = lm[2], wrist = lm[0];

  const extended = fingerTips.map((tip, i) => lm[tip].y < lm[fingerPIPs[i]].y);
  const thumbUp = thumbTip.y < thumbIP.y;
  const extCount = extended.filter(Boolean).length;

  // Open palm (Hello): all 4 fingers extended
  if (extCount === 4 && thumbUp) {
    return "open_palm";
  }

  // Fist (No): no fingers extended, check if truly curled into fist
  if (extCount === 0 && !thumbUp) {
    // Verify fingers are curled by checking if fingertips are close to palm
    const fingersCurled = fingerTips.every((tip, i) => {
      const distToPalm = Math.abs(lm[tip].y - lm[fingerMCPs[i]].y);
      return distToPalm < 0.15;
    });
    if (fingersCurled) return "fist";
  }

  // Thumbs up: thumb up, others closed
  if (extCount === 0 && thumbUp) return "thumbs_up";

  // Index only: point/help
  if (extended[0] && !extended[1] && !extended[2] && !extended[3]) return "index_point";

  // Peace: index + middle
  if (extended[0] && extended[1] && !extended[2] && !extended[3]) return "peace";

  // Rock: index + pinky extended
  if (extended[0] && !extended[1] && !extended[2] && extended[3]) return "rock";

  return null;
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.95;
  utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
}

function matchCustomGesture(vec: number[], gestures: CustomGesture[]): CustomGesture | null {
  const THRESHOLD = 0.32;
  let best: CustomGesture | null = null;
  let bestDist = Infinity;
  for (const g of gestures) {
    for (const sample of g.samples) {
      const d = euclidean(vec, sample);
      if (d < bestDist) { bestDist = d; best = g; }
    }
  }
  return bestDist < THRESHOLD ? best : null;
}

const loadMediaPipe = (): Promise<void> => new Promise((resolve, reject) => {
  if (window.Hands) { resolve(); return; }
  const urls = [
    "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
    "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js",
    "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
  ];
  let loaded = 0;
  urls.forEach(src => {
    if (document.querySelector(`script[src="${src}"]`)) { if (++loaded === urls.length) resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous";
    s.onload = () => { if (++loaded === urls.length) resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
});

// === App ======================================================================
export default function App() {
  const [view, setView] = useState<View>("landing");
  const [theme, setTheme] = useState<Theme>("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState<boolean | null>(null);

  // Live mode
  const [mpLoaded, setMpLoaded] = useState(false);
  const [mpError, setMpError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [detectedLabel, setDetectedLabel] = useState("");
  const [detectedPhrase, setDetectedPhrase] = useState("");
  const [confidence, setConfidence] = useState(0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [transcript, setTranscript] = useState<{ label: string; phrase: string; ts: number }[]>([]);
  const [handDetectedTime, setHandDetectedTime] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastDetectRef = useRef<string>("");
  const detectCoolRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const handDetectedTimeRef = useRef<number | null>(null);

  // Custom gestures
  const [customGestures, setCustomGestures] = useState<CustomGesture[]>([]);
  const [gesturesLoaded, setGesturesLoaded] = useState(false);

  // Teach mode
  const [teachName, setTeachName] = useState("");
  const [teachPhrase, setTeachPhrase] = useState("");
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [countdown, setCountdown] = useState(3);
  const [recordSamples, setRecordSamples] = useState<number[][]>([]);
  const [teachError, setTeachError] = useState("");
  const [teachSuccess, setTeachSuccess] = useState("");
  const [teachCameraReady, setTeachCameraReady] = useState(false);
  const [teachCameraLoading, setTeachCameraLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const teachVideoRef = useRef<HTMLVideoElement>(null);
  const teachCanvasRef = useRef<HTMLCanvasElement>(null);
  const teachHandsRef = useRef<any>(null);
  const teachCameraRef = useRef<any>(null);
  const teachStreamRef = useRef<MediaStream | null>(null);
  const samplesRef = useRef<number[][]>([]);
  const recordingRef = useRef(false);

  // Quick cards
  const [cardCat, setCardCat] = useState("All");
  const [cardSearch, setCardSearch] = useState("");
  const [recentCards, setRecentCards] = useState<string[]>([]);

  // Community
  const [communityDb, setCommunityDb] = useState<CommunitySigns[]>([]);
  const [commSearch, setCommSearch] = useState("");
  const [commTag, setCommTag] = useState("All");
  const [shareForm, setShareForm] = useState(false);
  const [shareData, setShareData] = useState({ name: "", phrase: "", description: "", authorName: "", tags: "" });

  // Theme toggle
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Check camera permission on load
  useEffect(() => {
    const checkPermission = async () => {
      try {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        setCameraPermissionGranted(result.state === 'granted');
        result.onchange = () => {
          setCameraPermissionGranted(result.state === 'granted');
        };
      } catch {
        // Permissions API not supported, will ask on demand
        setCameraPermissionGranted(null);
      }
    };
    checkPermission();
  }, []);

  // Load custom gestures + community from Supabase
  useEffect(() => {
    getGestures().then(g => { setCustomGestures(g ?? []); setGesturesLoaded(true); }).catch(() => setGesturesLoaded(true));
    getCommunitySignsFromDB().then(s => { if (s?.length) setCommunityDb(s); }).catch(() => {});
  }, []);

  // == Navigate helper ==========================================================
  const navigate = useCallback((v: View) => {
    setView(v);
    setMenuOpen(false);
  }, []);

  // == Live mode: navigate to live view =====================================
  const startLiveMode = useCallback(async () => {
    navigate("live");
    // Don't auto-start camera - let user control it
  }, [navigate]);

  // == Start live camera =====================================================
  const startLiveCamera = useCallback(async () => {
    setCameraActive(false);
    setCameraLoading(true);
    setMpError("");
    setHandDetectedTime(null);
    try {
      // Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());

      // Load MediaPipe if needed
      await loadMediaPipe();
      setMpLoaded(true);
      setCameraLoading(false);

      // Camera will start in the useEffect below
    } catch (e: any) {
      setCameraLoading(false);
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setMpError("camera_denied");
      } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
        setMpError("camera_not_found");
      } else {
        setMpError(e.message || "Failed to start camera");
      }
    }
  }, []);

  const stopLiveCamera = useCallback(() => {
    if (cameraRef.current) {
      try {
        cameraRef.current.stop();
      } catch (e) {
        console.error("Error stopping camera:", e);
      }
      cameraRef.current = null;
    }
    if (handsRef.current) {
      try {
        handsRef.current.close();
      } catch (e) {
        console.error("Error closing hands:", e);
      }
      handsRef.current = null;
    }
    setCameraActive(false);
    setMpLoaded(false);
    setCameraLoading(false);
    setMpError("");
    handDetectedTimeRef.current = null;
    setHandDetectedTime(null);
    lastDetectRef.current = "";
    detectCoolRef.current = 0;
    setDetectedLabel("");
    setDetectedPhrase("");
    setConfidence(0);
  }, []);

  useEffect(() => {
    if (view !== "live") {
      stopLiveCamera();
      return;
    }

    // If coming back to live view, reset state to allow re-initialization
    if (view === "live" && !mpLoaded && !cameraLoading && !mpError) {
      // Ready for user to click initialize
      return;
    }

    if (!mpLoaded || !videoRef.current || !canvasRef.current) return;

    const hands = new window.Hands({ locateFile: (f: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    handsRef.current = hands;

    hands.onResults((results: any) => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (results.multiHandLandmarks?.length) {
        // Draw all detected hands
        results.multiHandLandmarks.forEach((lm: any) => {
          if (showOverlay) {
            // Scale drawing based on canvas size for better mobile display
            const scale = canvas.width / 1280;
            const lineWidth = Math.max(1, Math.round(2 * scale));
            const radius = Math.max(2, Math.round(3 * scale));
            window.drawConnectors(ctx, lm, window.HAND_CONNECTIONS, { color: "#10D9A0", lineWidth });
            window.drawLandmarks(ctx, lm, { color: "#10D9A0", lineWidth: 1, radius, fillColor: "#10D9A0" });
          }
        });

        // Use the first hand for gesture detection
        const lm = results.multiHandLandmarks[0];

        // Validate that we have a complete hand with 21 landmarks
        if (lm && lm.length === 21) {
          const now = Date.now();

          // Track when hand was first detected
          if (!handDetectedTimeRef.current) {
            handDetectedTimeRef.current = now;
            setHandDetectedTime(now);
          }

          // Wait 2 seconds after hand detection before starting recognition
          const timeSinceDetection = now - (handDetectedTimeRef.current || now);
          if (timeSinceDetection >= 2000) {
            // Detection cooldown - 2 seconds between gestures
            if (now - detectCoolRef.current > 2000) {
              const vec = normalizeLandmarks(lm);

              // Only proceed if normalization was successful (not all zeros)
              const isValidVector = vec.some(v => Math.abs(v) > 0.001);
              if (isValidVector) {
                // Check custom first
                const custom = matchCustomGesture(vec, customGestures);
                if (custom) {
                  if (lastDetectRef.current !== custom.id) {
                    lastDetectRef.current = custom.id;
                    detectCoolRef.current = now;
                    setDetectedLabel(custom.name);
                    setDetectedPhrase(custom.phrase);
                    setConfidence(0.92);
                    setTranscript(t => [{ label: custom.name, phrase: custom.phrase, ts: now }, ...t].slice(0, 30));
                    speak(custom.phrase);
                  }
                } else {
                  const builtinId = detectBuiltinGesture(lm);
                  if (builtinId && builtinId !== lastDetectRef.current) {
                    const g = BUILTIN_GESTURES.find(b => b.id === builtinId);
                    if (g) {
                      lastDetectRef.current = builtinId;
                      detectCoolRef.current = now;
                      setDetectedLabel(g.label);
                      setDetectedPhrase(g.phrase);
                      setConfidence(0.85);
                      setTranscript(t => [{ label: g.label, phrase: g.phrase, ts: now }, ...t].slice(0, 30));
                      speak(g.phrase);
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        // Clear detection when no hands detected
        handDetectedTimeRef.current = null;
        setHandDetectedTime(null);
        if (lastDetectRef.current) {
          lastDetectRef.current = "";
          setDetectedLabel("");
          setDetectedPhrase("");
          setConfidence(0);
        }
      }
    });

    const camera = new window.Camera(videoRef.current, {
      onFrame: async () => { await hands.send({ image: videoRef.current! }); },
      width: 1280, height: 720,
    });
    cameraRef.current = camera;
    camera.start().then(() => setCameraActive(true)).catch((e: any) => setMpError(e.message));

    return () => {
      camera.stop();
      hands.close();
      cameraRef.current = null;
      handsRef.current = null;
      setCameraActive(false);
    };
  }, [view, mpLoaded, customGestures, showOverlay, stopLiveCamera]);

  // Sync canvas size to video
  useEffect(() => {
    if (!cameraActive || !videoRef.current || !canvasRef.current) return;
    const sync = () => {
      const v = videoRef.current!;
      const c = canvasRef.current!;
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 720;
    };
    const v = videoRef.current;
    v.addEventListener("loadedmetadata", sync);
    sync();
    return () => v.removeEventListener("loadedmetadata", sync);
  }, [cameraActive]);

  // Update cooldown countdown
  useEffect(() => {
    if (!cameraActive || view !== "live") {
      setCooldownRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const timeSinceDetect = now - detectCoolRef.current;
      const remaining = Math.max(0, 2000 - timeSinceDetect); // 2 second cooldown
      setCooldownRemaining(remaining);
    }, 50); // Update every 50ms for smooth countdown

    return () => clearInterval(interval);
  }, [cameraActive, view]);

  // == Teach mode camera ====================================================
  const startTeachCamera = useCallback(async () => {
    if (!teachVideoRef.current || !teachCanvasRef.current) return;

    setTeachCameraReady(false);
    setTeachCameraLoading(true);
    setTeachError("");

    try {
      // Request camera permission and keep stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      teachStreamRef.current = stream;
      teachVideoRef.current.srcObject = stream;

      // Update camera permission state
      setCameraPermissionGranted(true);

      // Load MediaPipe if not loaded
      await loadMediaPipe();

      // Initialize MediaPipe Hands with support for 2 hands
      const hands = new window.Hands({ 
        locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` 
      });
      hands.setOptions({ 
        maxNumHands: 2, 
        modelComplexity: 1, 
        minDetectionConfidence: 0.7, 
        minTrackingConfidence: 0.5 
      });
      teachHandsRef.current = hands;

      hands.onResults((results: any) => {
        const canvas = teachCanvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (results.multiHandLandmarks?.length) {
          // Draw all detected hands
          results.multiHandLandmarks.forEach((lm: any) => {
            // Scale drawing based on canvas size for better mobile display
            const scale = canvas.width / 1280;
            const lineWidth = Math.max(1, Math.round(2 * scale));
            const radius = Math.max(2, Math.round(3 * scale));
            window.drawConnectors(ctx, lm, window.HAND_CONNECTIONS, { color: "#818CF8", lineWidth });
            window.drawLandmarks(ctx, lm, { color: "#10D9A0", lineWidth: 1, radius });
          });

          // Record using the first hand
          if (recordingRef.current && results.multiHandLandmarks[0]) {
            const normalized = normalizeLandmarks(results.multiHandLandmarks[0]);
            samplesRef.current.push(normalized);
          }
        }
      });

      // Initialize MediaPipe Camera
      const camera = new window.Camera(teachVideoRef.current, {
        onFrame: async () => {
          if (teachVideoRef.current && teachHandsRef.current) {
            await hands.send({ image: teachVideoRef.current });
          }
        },
        width: 1280,
        height: 720,
      });
      teachCameraRef.current = camera;
      
      await camera.start();
      setTeachCameraReady(true);
      setTeachCameraLoading(false);

    } catch (e: any) {
      console.error("Teach camera error:", e);
      setTeachCameraLoading(false);
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setTeachError("Camera access denied. Please allow camera permissions to record gestures.");
        setCameraPermissionGranted(false);
      } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
        setTeachError("No camera found. Please connect a camera to use this feature.");
      } else {
        setTeachError("Failed to start camera: " + (e.message || "Unknown error"));
      }
    }
  }, []);

  const stopTeachCamera = useCallback(() => {
    // Stop MediaPipe camera
    if (teachCameraRef.current) {
      try {
        teachCameraRef.current.stop();
      } catch (e) {
        console.error("Error stopping MediaPipe camera:", e);
      }
      teachCameraRef.current = null;
    }

    // Stop media stream
    if (teachStreamRef.current) {
      teachStreamRef.current.getTracks().forEach(track => track.stop());
      teachStreamRef.current = null;
    }

    // Close MediaPipe Hands
    if (teachHandsRef.current) {
      try {
        teachHandsRef.current.close();
      } catch (e) {
        console.error("Error closing MediaPipe Hands:", e);
      }
      teachHandsRef.current = null;
    }

    setTeachCameraReady(false);
    setTeachCameraLoading(false);
  }, []);

  useEffect(() => {
    if (view !== "teach") {
      stopTeachCamera();
      setTeachError("");
      setTeachSuccess("");
      setTeachCameraLoading(false);
    }
    // Don't auto-start - let user control it with the button
  }, [view, stopTeachCamera]);

  // Sync teach canvas size to video
  useEffect(() => {
    if (view !== "teach" || !teachVideoRef.current || !teachCanvasRef.current) return;
    const sync = () => {
      const v = teachVideoRef.current!;
      const c = teachCanvasRef.current!;
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 720;
    };
    const v = teachVideoRef.current;
    v.addEventListener("loadedmetadata", sync);
    sync();
    return () => v.removeEventListener("loadedmetadata", sync);
  }, [view]);

  // == Teach: record gesture ================================================
  const startRecording = useCallback(() => {
    if (!teachCameraReady) {
      setTeachError("Camera is not ready. Please wait for camera initialization.");
      return;
    }
    if (!teachName.trim() || !teachPhrase.trim()) {
      setTeachError("Please enter a name and phrase first.");
      return;
    }
    setTeachError("");
    setTeachSuccess("");
    samplesRef.current = [];
    setRecordSamples([]);
    setCountdown(3);
    setRecordState("countdown");

    let c = 3;
    const cdInterval = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(cdInterval);
        setRecordState("recording");
        recordingRef.current = true;
        setTimeout(() => {
          recordingRef.current = false;
          setRecordSamples([...samplesRef.current]);
          setRecordState("idle");
        }, 4000);
      }
    }, 1000);
  }, [teachName, teachPhrase, teachCameraReady]);

  const saveGesture = useCallback(async () => {
    if (!teachName.trim() || !teachPhrase.trim()) { setTeachError("Name and phrase required."); return; }
    if (recordSamples.length < 5) { setTeachError("Not enough samples. Please record again."); return; }
    setRecordState("saving");
    setTeachError("");
    const gesture: CustomGesture = {
      id: Date.now().toString(),
      name: teachName.trim(),
      phrase: teachPhrase.trim(),
      samples: recordSamples,
      createdAt: new Date().toISOString(),
    };
    const updated = [...customGestures, gesture];
    try {
      console.log("Saving gesture:", gesture.name, "with", gesture.samples.length, "samples");
      await saveGestures(updated);
      console.log("Gesture saved successfully");
      setCustomGestures(updated);
      setTeachName("");
      setTeachPhrase("");
      setRecordSamples([]);
      setTeachSuccess(`"${gesture.name}" saved! It will now be recognized.`);
      setTimeout(() => setTeachSuccess(""), 5000);
    } catch (e: any) {
      console.error("Failed to save gesture:", e);
      setTeachError(`Failed to save gesture: ${e.message || "Unknown error"}. Check console for details.`);
    }
    setRecordState("idle");
  }, [teachName, teachPhrase, recordSamples, customGestures]);

  const deleteGesture = useCallback(async (id: string) => {
    const updated = customGestures.filter(g => g.id !== id);
    try {
      await saveGestures(updated);
      setCustomGestures(updated);
    } catch {}
  }, [customGestures]);

  const clearAllGestures = useCallback(async () => {
    try {
      await saveGestures([]);
      setCustomGestures([]);
      setShowClearConfirm(false);
      setTeachSuccess("All custom gestures deleted successfully!");
      setTimeout(() => setTeachSuccess(""), 5000);
    } catch (e: any) {
      setTeachError(`Failed to delete gestures: ${e.message || "Unknown error"}`);
      setTimeout(() => setTeachError(""), 5000);
    }
  }, []);

  // == Cards ================================================================
  const cardCategories = ["All", ...Array.from(new Set(COMM_CARDS.map(c => c.cat)))];
  const filteredCards = COMM_CARDS.filter(c =>
    (cardCat === "All" || c.cat === cardCat) &&
    (cardSearch === "" || c.phrase.toLowerCase().includes(cardSearch.toLowerCase()))
  );

  const speakCard = useCallback((card: typeof COMM_CARDS[0]) => {
    speak(card.phrase);
    setRecentCards(r => [card.id, ...r.filter(id => id !== card.id)].slice(0, 5));
  }, []);

  // == Community ============================================================
  const allTags = ["All", ...Array.from(new Set(communityDb.flatMap(s => s.tags ?? [])))];
  const filteredComm = communityDb.filter(s =>
    (commTag === "All" || s.tags?.includes(commTag)) &&
    (commSearch === "" || s.name.toLowerCase().includes(commSearch.toLowerCase()) ||
     s.phrase.toLowerCase().includes(commSearch.toLowerCase()))
  );

  const likeSigns = useCallback(async (id: string) => {
    const updated = communityDb.map(s => s.id === id ? { ...s, likes: (s.likes ?? 0) + 1 } : s);
    setCommunityDb(updated);
    try { await updateCommunitySignsInDB(updated); } catch {}
  }, [communityDb]);

  const submitShare = useCallback(async () => {
    if (!shareData.name.trim() || !shareData.phrase.trim()) return;
    const sign: CommunitySigns = {
      id: Date.now().toString(),
      name: shareData.name.trim(),
      phrase: shareData.phrase.trim(),
      description: shareData.description.trim(),
      authorName: shareData.authorName.trim() || "Anonymous",
      likes: 0,
      tags: shareData.tags.split(",").map(t => t.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
    };
    const updated = [sign, ...communityDb];
    try {
      await postCommunitySigns(sign);
      setCommunityDb(updated);
      setShareForm(false);
      setShareData({ name: "", phrase: "", description: "", authorName: "", tags: "" });
    } catch {}
  }, [shareData, communityDb]);

  const deleteCommunitySigns = useCallback(async (id: string) => {
    const updated = communityDb.filter(s => s.id !== id);
    setCommunityDb(updated);
    try { await updateCommunitySignsInDB(updated); } catch {}
  }, [communityDb]);

  // === Render helpers ========================================================

  const NavBar = () => (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-xl bg-background/80 border-b border-border">
      <button onClick={() => navigate("landing")} className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <Hand className="w-4 h-4 text-primary" />
        </div>
        <span className="font-bold text-base tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          Silent Bridge
        </span>
      </button>
       {/* TODO NEED TO FIX LATER  */}
      {/* Desktop nav */}
      <div className="hidden md:flex items-center gap-1">
        {([
          ["live", "Live", Camera],
          ["cards", "Quick Cards", MessageSquare],
          ["teach", "Teach", BookOpen],
          ["community", "Community", Users],
        ] as [View, string, any][]).map(([v, label, Icon]) => (
          <button
            key={v}
            // TODO NEED TO FIX LATER
            // onClick={()=>{
            //   console.log("Navigating to view:", v);
            // }}
           // onClick={() => v === "live" ? startLiveMode() : navigate(v)}
            onClick={() => v === "live" ? console.log("Navigating to view:"): navigate(v)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              view === v
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* Social Links - Desktop only */}
        <div className="hidden md:flex items-center gap-1.5 mr-1">
          <a
            href="https://github.com/error-imtiaj"
            target="_blank"
            rel="noopener noreferrer"
            className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
            title="GitHub"
          >
            <Github className="w-4 h-4" />
          </a>
          {/* TODO NEED TO FIX LATER  */}
          <a
            href="https://www.linkedin.com/in/error-imtiaj/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
            title="LinkedIn"
          >
            <Linkedin className="w-4 h-4" />
          </a>
          {/* <a
            href="https://x.com/Im_Tu_T"
            target="_blank"
            rel="noopener noreferrer"
            className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
            title="X (Twitter)"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a> */}
        </div>
        <button
          onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
          className="w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setMenuOpen(m => !m)}
          className="md:hidden w-9 h-9 rounded-xl bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground"
        >
          {menuOpen ? <X className="w-4 h-4" /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>}
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute top-full left-0 right-0 bg-card border-b border-border p-4 flex flex-col gap-2 md:hidden"
          >
            {([
              ["live", "Live Communication", Camera],
              ["cards", "Quick Cards", MessageSquare],
              ["teach", "Teach Silent Bridge", BookOpen],
              ["community", "Community Signs", Users],
            ] as [View, string, any][]).map(([v, label, Icon]) => (
              <button
                key={v}
                onClick={() => { v === "live" ? startLiveMode() : navigate(v); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-foreground hover:bg-muted/50 transition-all"
              >
                <Icon className="w-4 h-4 text-primary" />
                {label}
              </button>
            ))}
            <div className="border-t border-border mt-2 pt-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-4">Connect</p>
              <div className="flex items-center gap-2 px-4">
                <a
                  href="https://github.com/error-imtiaj"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                >
                  <Github className="w-4 h-4" />
                  <span className="text-xs font-medium">GitHub</span>
                </a>
                <a
                  href="https://www.linkedin.com/in/error-imtiaj/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                >
                  <Linkedin className="w-4 h-4" />
                  <span className="text-xs font-medium">LinkedIn</span>
                </a>
                <a
                  href="https://x.com/Im_Tu_T"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  <span className="text-xs font-medium">X</span>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );

  // === Landing ================================================================
  const renderLanding = () => (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pt-32 pb-20 text-center relative overflow-hidden">
        {/* Background orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/8 rounded-full blur-3xl" />
        </div>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}
          className="relative z-10 flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary tracking-wide uppercase">Communication Without Barriers</span>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]"
            style={{ fontFamily: "var(--font-display)" }}>
            Every Gesture<br />
            <span className="bg-gradient-to-r from-primary via-violet-500 to-accent bg-clip-text text-transparent">
              Has Meaning.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed">
            Create, teach, save, and recognize custom visual gestures using only a camera. Silent Bridge empowers communication when speech isn't enough.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
            // TODO NEED TO SETUP LIVE MODE LATER
              // onClick={startLiveMode}
              className="flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-base hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-primary/25"
            >
              <Camera className="w-5 h-5" />
              Try Live Recognition
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
            // TODO NEED TO SETUP TEACH MODE LATER
             // onClick={() => navigate("teach")}
              className="flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-card border border-border text-foreground font-semibold text-base hover:bg-muted/30 active:scale-95 transition-all"
            >
              <BookOpen className="w-5 h-5" />
              Teach a Gesture
            </button>
          </div>
        </motion.div>
      </section>

      {/* Quote Section */}
      <section className="px-6 py-20 bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-accent/10 animate-pulse opacity-30" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-4xl mx-auto text-center relative z-10"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground leading-tight" style={{ fontFamily: "var(--font-display)" }}>
            "Technology should not create barriers.<br />
            <span className="bg-gradient-to-r from-primary via-violet-500 to-accent bg-clip-text text-transparent">
              It should remove them."
            </span>
          </h2>
        </motion.div>
      </section>

      {/* Why Silent Bridge */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4" style={{ fontFamily: "var(--font-display)" }}>
            Why Silent Bridge?
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Most communication tools expect people to adapt to technology. Silent Bridge does the opposite. Instead of forcing people to learn a system, it learns how people already communicate.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: Camera,
              title: "Real-Time Recognition",
              desc: "Instant gesture detection powered by advanced AI that understands your movements naturally.",
              color: "text-primary",
              bg: "bg-primary/10",
              border: "border-primary/20"
            },
            {
              icon: Hand,
              title: "Camera Powered",
              desc: "No special equipment needed. Works with any webcam to recognize gestures instantly.",
              color: "text-accent",
              bg: "bg-accent/10",
              border: "border-accent/20"
            },
            {
              icon: MessageSquare,
              title: "Built-In Communication Tools",
              desc: "Pre-made phrases and quick cards for immediate communication in any situation.",
              color: "text-violet-500",
              bg: "bg-violet-500/10",
              border: "border-violet-500/20"
            },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className={`bg-card border-2 ${f.border} rounded-3xl p-8 hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 group`}
            >
              <div className={`w-14 h-14 rounded-2xl ${f.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                <f.icon className={`w-7 h-7 ${f.color}`} />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3" style={{ fontFamily: "var(--font-display)" }}>{f.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8 text-center"
        >
          <div className={`bg-card border-2 border-amber-500/20 rounded-3xl p-8 hover:shadow-xl hover:shadow-amber-500/10 transition-all duration-300`}>
            <div className={`w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-6 mx-auto`}>
              <Sparkles className={`w-7 h-7 text-amber-500`} />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-3" style={{ fontFamily: "var(--font-display)" }}>Unlimited Custom Gestures</h3>
            <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">Create your own communication system. Record any gesture, assign it meaning, and Silent Bridge will remember it forever.</p>
          </div>
        </motion.div>
      </section>

      {/* The Communication Gap */}
      <section className="px-6 py-20 bg-gradient-to-br from-slate-900/5 to-slate-950/5 dark:from-slate-900/20 dark:to-slate-950/20">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6" style={{ fontFamily: "var(--font-display)" }}>
              The Communication Gap
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto mb-12">
              Millions of people rely on visual communication every day. Yet most technology is built for voices and keyboards. Silent Bridge helps technology understand gestures instead.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {[
              { icon: Shield, label: "Privacy First", desc: "All processing happens on your device. Your gestures never leave your computer." },
              { icon: Zap, label: "Instant Recognition", desc: "See results in real-time as you communicate. No delay, no waiting." },
              { icon: Star, label: "Always Learning", desc: "Teach Silent Bridge new gestures anytime. It adapts to how you communicate." },
              { icon: Globe, label: "Works Anywhere", desc: "No internet required. Communicate freely wherever you are." },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="bg-card border border-border rounded-2xl p-6 text-left hover:border-primary/30 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <item.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-1" style={{ fontFamily: "var(--font-display)" }}>{item.label}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Teach Your Own Language */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4" style={{ fontFamily: "var(--font-display)" }}>
            Teach Your Own Language
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Record a gesture, assign a meaning, and let Silent Bridge learn how you communicate. Build a communication system that works for your family, classroom, workplace, or community.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-primary/5 to-accent/5 border-2 border-primary/20 rounded-3xl p-8 sm:p-12"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-6">
            {[
              { step: "1", icon: Camera, title: "Record Gesture", desc: "Perform the gesture in front of your camera" },
              { step: "2", icon: Edit3, title: "Assign Meaning", desc: "Give it a name and spoken phrase" },
              { step: "3", icon: CheckCircle, title: "Save Sign", desc: "Store it in your personal library" },
              { step: "4", icon: Sparkles, title: "Recognize Later", desc: "Silent Bridge remembers forever" },
            ].map((item, i) => (
              <div key={item.step} className="flex flex-col items-center text-center relative">
                {/* Step number badge at top */}
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold mb-4 shadow-lg shadow-primary/30">
                  {item.step}
                </div>

                {/* Icon box */}
                <div className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center border-2 border-primary/30 mb-4 group-hover:scale-110 transition-transform">
                  <item.icon className="w-9 h-9 text-primary" />
                </div>

                {/* Text content */}
                <h4 className="font-bold text-foreground mb-2 text-base" style={{ fontFamily: "var(--font-display)" }}>{item.title}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>

                {/* Arrow between steps - desktop only */}
                {i < 3 && (
                  <div className="hidden lg:block absolute top-[4.5rem] -right-3 transform translate-x-full">
                    <ChevronRight className="w-6 h-6 text-primary/40" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Built For Real People */}
      <section className="px-6 py-20 bg-gradient-to-br from-accent/5 to-primary/5">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4" style={{ fontFamily: "var(--font-display)" }}>
              Built For Real People
            </h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Silent Bridge is designed to help real people communicate more effectively in their daily lives.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Users, title: "Families", desc: "Help family members communicate when words aren't enough. Create gestures that mean something special to your loved ones.", color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" },
              { icon: BookOpen, title: "Students", desc: "Learn and practice sign language at your own pace. Build confidence in visual communication.", color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
              { icon: Users, title: "Teachers", desc: "Create custom classroom gestures. Make learning more accessible for all students.", color: "text-green-500", bg: "bg-green-500/10", border: "border-green-500/20" },
              { icon: Hand, title: "Caregivers", desc: "Bridge communication gaps with those in your care. Understand needs quickly and clearly.", color: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
              { icon: Shield, title: "Healthcare Workers", desc: "Communicate with patients who can't speak. Ensure understanding in critical moments.", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
              { icon: Globe, title: "Communities", desc: "Share gestures within your community. Build a shared visual language together.", color: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20" },
            ].map((audience, i) => (
              <motion.div
                key={audience.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className={`bg-card border-2 ${audience.border} rounded-2xl p-6 hover:shadow-xl transition-all duration-300 group`}
              >
                <div className={`w-12 h-12 rounded-xl ${audience.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <audience.icon className={`w-6 h-6 ${audience.color}`} />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2" style={{ fontFamily: "var(--font-display)" }}>{audience.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{audience.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer / Creator section */}
      <div className="border-t border-border px-6 py-16 bg-gradient-to-br from-primary/5 via-transparent to-accent/5">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 mb-6">
            <Star className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary tracking-wide uppercase">Building with Purpose</span>
          </div>

          <h3 className="text-xl font-bold text-foreground mb-2" style={{ fontFamily: "var(--font-display)" }}>
            Built for the Web Dev project
          </h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto leading-relaxed">
            To make communication more accessible for everyone.
          </p>

          <p className="text-sm font-medium text-muted-foreground mb-8">
            Designed and Developed by Imtiaj
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a
              href="https://github.com/error-imtiaj"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-card border-2 border-border hover:border-primary/50 text-foreground font-medium transition-all hover:shadow-lg hover:shadow-primary/10 active:scale-95 group"
            >
              <Github className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="text-sm">GitHub</span>
            </a>
            {/* <a
              href="https://www.linkedin.com/in/error-imtiaj/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-card border-2 border-border hover:border-primary/50 text-foreground font-medium transition-all hover:shadow-lg hover:shadow-primary/10 active:scale-95 group"
            >
              <Linkedin className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="text-sm">LinkedIn</span>
            </a> */} 
            <a
              href="https://www.linkedin.com/in/error-imtiaj/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold transition-all hover:shadow-lg hover:shadow-primary/30 active:scale-95"
            >
               <Linkedin className="w-5 h-5 text-muted-background group-hover:text-primary transition-colors" />    
              {/* <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
               */}
              <span className="text-sm">LinkedIn</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );

  // === Live Communication =====================================================
  const renderLive = () => {
    const now = Date.now();
    const timeSinceHandDetection = handDetectedTime ? now - handDetectedTime : 0;
    const isWaitingForRecognition = handDetectedTime && timeSinceHandDetection < 2000;
    const progressPercent = isWaitingForRecognition ? (timeSinceHandDetection / 2000) * 100 : 0;

    return (
    <div className="min-h-screen pt-20 flex flex-col bg-gradient-to-br from-background via-muted/30 to-background">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-0 max-w-[1800px] mx-auto w-full px-4 sm:px-6 py-6 gap-6">
        {/* Camera panel */}
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-1 h-8 bg-gradient-to-b from-primary to-accent rounded-full" />
                <h2 className="text-2xl font-bold text-foreground tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                  LIVE COMMUNICATION CHANNEL
                </h2>
              </div>
              <p className="text-sm text-muted-foreground pl-7 font-mono">
                SYS.STATUS: <span className="text-accent">ACTIVE</span> • HANDS: <span className="text-primary">2-TRACKING</span> • MODE: <span className="text-emerald-400">REAL-TIME</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {cameraActive && (
                <button
                  onClick={() => setShowOverlay(s => !s)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted/50 hover:bg-muted border border-border text-muted-foreground text-xs font-mono uppercase tracking-wider transition-all backdrop-blur-sm"
                >
                  {showOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showOverlay ? "HIDE" : "SHOW"} SKELETON
                </button>
              )}
            </div>
          </div>

          {/* Camera viewport - NASA style */}
          <div className="relative w-full h-[60vh] sm:h-auto sm:aspect-video bg-gradient-to-br from-card to-muted rounded-2xl overflow-hidden border-2 border-border shadow-2xl shadow-primary/10">
            {/* Grid overlay background */}
            <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
              backgroundImage: `
                linear-gradient(to right, rgba(16, 217, 160, 0.15) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(16, 217, 160, 0.15) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px'
            }} />

            {/* Corner brackets */}
            <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-primary/60 pointer-events-none" />
            <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-primary/60 pointer-events-none" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-primary/60 pointer-events-none" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-primary/60 pointer-events-none" />

            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              autoPlay playsInline muted
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
            />

            {/* Scan line effect */}
            {cameraActive && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-scan" />
              </div>
            )}

            {/* Top status bar */}
            {cameraActive && (
              <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/50 to-transparent backdrop-blur-sm pt-3 pb-6 px-3 sm:pt-4 sm:pb-8 sm:px-6 z-20">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 sm:gap-3">
                    <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-red-500/20 border border-red-500/30">
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-red-500 animate-pulse shadow-lg shadow-red-500/50" />
                      <span className="text-red-400 text-[10px] sm:text-xs font-mono font-bold tracking-wider">REC</span>
                    </div>
                    <div className="hidden sm:block text-xs font-mono text-muted-foreground">
                      {new Date().toLocaleTimeString('en-US', { hour12: false })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <div className="text-[10px] sm:text-xs font-mono text-muted-foreground">
                      <span className="text-accent font-bold">60</span><span className="hidden xs:inline"> FPS</span>
                    </div>
                    <div className="w-px h-3 bg-border hidden xs:block" />
                    <div className="text-[10px] sm:text-xs font-mono text-muted-foreground hidden xs:block">
                      <span className="text-primary font-bold">HD</span>
                    </div>
                    <div className="w-px h-3 bg-slate-600" />
                    <button
                      onClick={stopLiveCamera}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-[9px] sm:text-[10px] font-mono uppercase tracking-wider transition-all"
                    >
                      <div className="w-1.5 h-1.5 rounded-sm bg-red-500" />
                      <span className="hidden xs:inline">DISCONNECT</span>
                      <span className="xs:hidden">END</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Camera off state */}
            {!cameraActive && !mpError && !cameraLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-card/95 backdrop-blur-sm">
                <button
                  onClick={startLiveCamera}
                  className="flex flex-col items-center gap-6 px-10 py-8 rounded-2xl bg-muted/50 border-2 border-border hover:border-primary/50 transition-all group backdrop-blur-md"
                >
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center group-hover:from-primary/30 group-hover:to-accent/30 transition-all shadow-lg shadow-primary/20">
                    <Camera className="w-10 h-10 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-foreground font-bold text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>INITIALIZE CAMERA</p>
                    <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Click to activate visual feed</p>
                  </div>
                </button>
              </div>
            )}

            {/* Camera loading */}
            {cameraLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-card/95 backdrop-blur-sm">
                <div className="relative">
                  <div className="w-20 h-20 border-4 border-border border-t-primary rounded-full animate-spin" />
                  <Camera className="absolute inset-0 m-auto w-8 h-8 text-primary" />
                </div>
              </div>
            )}

            {/* Error state */}
            {mpError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-card/95 backdrop-blur-sm p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-red-500/10 border-2 border-red-500/30 flex items-center justify-center">
                  <X className="w-8 h-8 text-red-500" />
                </div>
                {mpError === "camera_denied" ? (
                  <div className="max-w-md">
                    <p className="text-foreground font-bold text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>CAMERA ACCESS DENIED</p>
                    <p className="text-muted-foreground text-sm mb-2">
                      Visual feed requires camera permissions to detect hand gestures.
                    </p>
                    <p className="text-muted-foreground text-xs font-mono">
                      Enable camera access in your browser settings and retry connection.
                    </p>
                  </div>
                ) : mpError === "camera_not_found" ? (
                  <div className="max-w-md">
                    <p className="text-foreground font-bold text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>NO CAMERA DETECTED</p>
                    <p className="text-muted-foreground text-sm font-mono">
                      Please connect a camera device to establish visual feed.
                    </p>
                  </div>
                ) : (
                  <div className="max-w-md">
                    <p className="text-foreground font-bold text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>SYSTEM ERROR</p>
                    <p className="text-muted-foreground text-sm font-mono">{mpError}</p>
                  </div>
                )}
                <button onClick={startLiveCamera} className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-lg shadow-primary/30">
                  <Camera className="w-4 h-4" /> RETRY CONNECTION
                </button>
              </div>
            )}

            {/* Hand detection waiting indicator - top left corner */}
            {isWaitingForRecognition && cameraActive && (
              <div className="absolute top-16 left-4 z-30">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="px-3 py-2 rounded-lg bg-card/90 backdrop-blur-md border border-primary/30"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-foreground text-xs font-mono uppercase tracking-wider">CALIBRATING</span>
                  </div>
                  <div className="w-32 h-1 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                </motion.div>
              </div>
            )}

            {/* Detection overlay - compact top left below calibrating */}
            <AnimatePresence>
              {detectedLabel && cameraActive && !isWaitingForRecognition && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="absolute top-16 left-4 z-30 max-w-xs"
                >
                  <div className="bg-card/95 backdrop-blur-xl rounded-xl px-4 py-3 border border-primary/40 shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                          <div className="text-accent text-[10px] font-mono uppercase tracking-wider font-bold">DETECTED</div>
                          <div className="ml-auto text-[10px] text-muted-foreground font-mono">{Math.round(confidence * 100)}%</div>
                        </div>
                        <div className="text-foreground text-sm font-bold truncate mb-0.5" style={{ fontFamily: "var(--font-display)" }}>{detectedLabel}</div>
                        <div className="text-muted-foreground text-xs font-mono line-clamp-2">"{detectedPhrase}"</div>
                      </div>
                      <button
                        onClick={() => speak(detectedPhrase)}
                        className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg flex-shrink-0"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-primary-foreground" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Cooldown countdown - bottom left corner */}
            <AnimatePresence>
              {cooldownRemaining > 0 && cameraActive && detectedLabel && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-4 left-4 z-30"
                >
                  <div className="px-3 py-2 rounded-lg bg-card/90 backdrop-blur-md border border-amber-500/30">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span className="text-amber-400 text-xs font-mono font-bold">
                        {(cooldownRemaining / 1000).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Built-in gesture reference - NASA style */}
          <div className="bg-card/50 border-2 border-border rounded-2xl p-5 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-5 bg-gradient-to-b from-primary to-accent rounded-full" />
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider font-mono">AVAILABLE GESTURES</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {BUILTIN_GESTURES.map(g => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-xs text-foreground font-mono hover:border-primary/30 transition-all">
                  <span className="text-base">{g.emoji}</span>
                  <span className="uppercase tracking-wide">{g.label}</span>
                </div>
              ))}
              {customGestures.map(g => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/30 text-xs text-accent font-mono hover:border-accent/50 transition-all">
                  <Star className="w-3 h-3" />
                  <span className="uppercase tracking-wide">{g.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Transcript panel - NASA style */}
        <div className="flex flex-col gap-4">
          <div className="bg-card/50 border-2 border-border rounded-2xl p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 bg-gradient-to-b from-primary to-accent rounded-full" />
                <h3 className="font-bold text-foreground uppercase tracking-wider text-sm font-mono" style={{ fontFamily: "var(--font-display)" }}>TRANSMISSION LOG</h3>
              </div>
              {transcript.length > 0 && (
                <button
                  onClick={() => setTranscript([])}
                  className="text-xs text-muted-foreground hover:text-accent transition-colors font-mono uppercase tracking-wider hover:bg-muted px-2 py-1 rounded"
                >
                  CLEAR
                </button>
              )}
            </div>

            <div className="flex-1 min-h-[300px] max-h-[500px] lg:max-h-none overflow-y-auto flex flex-col gap-3 pr-2 custom-scrollbar">
              {transcript.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center">
                    <Mic className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-sm font-mono uppercase tracking-wide mb-1">AWAITING TRANSMISSION</p>
                    <p className="text-muted-foreground/50 text-xs font-mono">Detected gestures will appear here</p>
                  </div>
                </div>
              ) : (
                transcript.map((t, i) => (
                  <motion.div
                    key={t.ts}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`rounded-xl p-4 border transition-all ${
                      i === 0
                        ? "bg-gradient-to-br from-primary/10 to-accent/5 border-primary/40 shadow-lg shadow-primary/10"
                        : "bg-muted/30 border-border hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {i === 0 && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                        <span className="text-xs font-bold text-primary font-mono uppercase tracking-wider">{t.label}</span>
                      </div>
                      <button
                        onClick={() => speak(t.phrase)}
                        className="text-muted-foreground hover:text-primary transition-colors hover:bg-muted p-1.5 rounded-lg"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm text-foreground mb-2 font-mono leading-relaxed">"{t.phrase}"</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                      <Clock className="w-3 h-3" />
                      {new Date(t.ts).toLocaleTimeString('en-US', { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  };

  // === Quick Cards ============================================================
  const renderCards = () => (
    <div className="min-h-screen pt-20 px-4 sm:px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: "var(--font-display)" }}>Quick Communication</h2>
        <p className="text-muted-foreground text-sm">Tap any card to speak the phrase aloud instantly</p>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={cardSearch}
            onChange={e => setCardSearch(e.target.value)}
            placeholder="Search phrases…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {cardCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setCardCat(cat)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                cardCat === cat ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Recent */}
      {recentCards.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recently Used</p>
          <div className="flex gap-2 flex-wrap">
            {recentCards.map(id => {
              const card = COMM_CARDS.find(c => c.id === id);
              if (!card) return null;
              return (
                <button key={id} onClick={() => speakCard(card)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/20 transition-all">
                  <span>{card.icon}</span> {card.phrase}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filteredCards.map((card, i) => (
          <motion.button
            key={card.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => speakCard(card)}
            className={`relative group flex flex-col items-center justify-center gap-2 p-5 rounded-2xl bg-gradient-to-br ${card.color} text-white aspect-square hover:scale-105 active:scale-95 transition-all shadow-lg`}
          >
            <span className="text-3xl">{card.icon}</span>
            <span className="text-sm font-semibold text-center leading-tight">{card.phrase}</span>
            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Volume2 className="w-3.5 h-3.5 text-white/70" />
            </div>
          </motion.button>
        ))}
      </div>

      {filteredCards.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p>No cards match your search</p>
        </div>
      )}
    </div>
  );

  // === Teach =================================================================
  const renderTeach = () => (
    <div className="min-h-screen pt-20 px-4 sm:px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: "var(--font-display)" }}>Teach Silent Bridge</h2>
        <p className="text-muted-foreground text-sm">Record your own hand gestures and link them to custom phrases • Supports both one and two-hand gestures</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Record form */}
        <div className="bg-card border border-border rounded-3xl p-6 flex flex-col gap-5">
          <h3 className="font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>Record New Gesture</h3>

          <div className="flex flex-col gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">Gesture Name</label>
              <input
                value={teachName}
                onChange={e => setTeachName(e.target.value)}
                placeholder='e.g. "Morning greeting"'
                className="w-full px-4 py-2.5 rounded-xl bg-input-background border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">Spoken Phrase</label>
              <input
                value={teachPhrase}
                onChange={e => setTeachPhrase(e.target.value)}
                placeholder='e.g. "Good morning, how are you?"'
                className="w-full px-4 py-2.5 rounded-xl bg-input-background border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
              />
            </div>
          </div>

          {/* Camera preview */}
          <div className="relative w-full h-[50vh] sm:h-auto sm:aspect-video bg-muted/30 rounded-2xl overflow-hidden border border-border">
            <video ref={teachVideoRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" autoPlay playsInline muted />
            <canvas ref={teachCanvasRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none" />

            {/* Camera off state - show button to turn on */}
            {!teachCameraReady && !teachError && !teachCameraLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/80 to-muted/60 backdrop-blur-sm">
                <button
                  onClick={startTeachCamera}
                  className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl bg-card border-2 border-border hover:border-primary/40 transition-all group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                    <Camera className="w-8 h-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-foreground font-semibold mb-1">Turn On Camera</p>
                    <p className="text-xs text-muted-foreground">Click to start recording gestures</p>
                  </div>
                </button>
              </div>
            )}

            {/* Camera loading state */}
            {teachCameraLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {/* Countdown */}
            <AnimatePresence>
              {recordState === "countdown" && (
                <motion.div initial={{ opacity: 0, scale: 1.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                  <span className="text-foreground text-8xl font-bold">{countdown}</span>
                </motion.div>
              )}
              {recordState === "recording" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/90">
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span className="text-white text-xs font-bold">REC • Hold your gesture</span>
                </motion.div>
              )}
              {teachCameraReady && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/90">
                  <div className="w-2 h-2 rounded-full bg-white" />
                  <span className="text-white text-xs font-bold">Camera Ready • 2 Hands Supported</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Camera control button - top right */}
            {recordState === "idle" && (
              <div className="absolute top-3 right-3 z-10">
                {teachCameraReady ? (
                  <button
                    onClick={stopTeachCamera}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/70 hover:bg-card/80 backdrop-blur-sm text-foreground text-xs font-medium transition-all border border-border"
                  >
                    <div className="w-2 h-2 rounded-sm bg-red-500" />
                    Turn Off Camera
                  </button>
                ) : !teachError && (
                  <button
                    onClick={startTeachCamera}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-all shadow-lg"
                  >
                    <Camera className="w-3 h-3" />
                    Turn On Camera
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sample progress */}
          {recordSamples.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.min(100, (recordSamples.length / 50) * 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{recordSamples.length} frames</span>
            </div>
          )}

          {/* Errors / Success */}
          <AnimatePresence>
            {teachError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-col gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
                <p>{teachError}</p>
                <button 
                  onClick={startTeachCamera}
                  className="self-start text-xs px-3 py-1.5 rounded-lg bg-destructive/20 hover:bg-destructive/30 transition-colors font-medium"
                >
                  Retry Camera Access
                </button>
              </motion.div>
            )}
            {teachSuccess && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-sm text-accent bg-accent/10 rounded-xl px-4 py-3">
                <CheckCircle className="w-4 h-4" /> {teachSuccess}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={startRecording}
              disabled={recordState !== "idle" || !teachCameraReady}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
            >
              {recordState === "idle" ? <><Play className="w-4 h-4" /> Record Gesture (4s)</> :
               recordState === "countdown" ? <><Clock className="w-4 h-4" /> Get ready…</> :
               recordState === "recording" ? <><Square className="w-4 h-4" /> Recording…</> :
               <><Wifi className="w-4 h-4" /> Saving…</>}
            </button>
            {recordSamples.length >= 5 && recordState === "idle" && (
              <button
                onClick={saveGesture}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm hover:opacity-90 active:scale-95 transition-all"
              >
                <CheckCircle className="w-4 h-4" /> Save
              </button>
            )}
          </div>
        </div>

        {/* Saved gestures */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              Your Gestures
              <span className="ml-2 text-sm font-normal text-muted-foreground">({customGestures.length})</span>
            </h3>
            {customGestures.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 text-destructive text-xs font-medium transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Clear All
              </button>
            )}
          </div>

          {!gesturesLoaded ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
          ) : customGestures.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center bg-card border border-border rounded-3xl">
              <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-foreground font-medium mb-1">No custom gestures yet</p>
                <p className="text-sm text-muted-foreground">Record your first gesture using the form</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-h-[600px] overflow-y-auto">
              {customGestures.map(g => (
                <motion.div
                  key={g.id}
                  layout
                  className="flex items-center gap-4 bg-card border border-border rounded-2xl px-5 py-4 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <Star className="w-5 h-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">{g.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{g.phrase}</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">{g.samples.length} frames</p>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => speak(g.phrase)} className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors">
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteGesture(g.id)} className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center text-destructive hover:bg-destructive/20 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Clear All Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowClearConfirm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-card border border-border rounded-2xl p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-lg" style={{ fontFamily: "var(--font-display)" }}>Delete All Gestures?</h3>
                  <p className="text-sm text-muted-foreground">This action cannot be undone</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-6">
                You are about to delete <span className="font-semibold text-foreground">{customGestures.length} custom gesture{customGestures.length !== 1 ? 's' : ''}</span>. This will permanently remove all your recorded gestures from the system.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-muted/50 text-foreground text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={clearAllGestures}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:opacity-90 active:scale-95 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // === Community ==============================================================
  const renderCommunity = () => (
    <div className="min-h-screen pt-20 px-4 sm:px-6 py-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-8">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1" style={{ fontFamily: "var(--font-display)" }}>Community Signs</h2>
          <p className="text-muted-foreground text-sm">Discover and share sign language phrases with the world</p>
        </div>
        <button
          onClick={() => setShareForm(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-95 transition-all"
        >
          <PlusCircle className="w-4 h-4" />
          Share a Sign
        </button>
      </div>

      {/* Search + tags */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={commSearch}
            onChange={e => setCommSearch(e.target.value)}
            placeholder="Search community signs…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
          />
        </div>
        {allTags.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setCommTag(tag)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  commTag === tag ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Tag className="w-3 h-3" /> {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {filteredComm.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <Globe className="w-10 h-10 mx-auto mb-4 opacity-30" />
          <p className="font-medium mb-1">No community signs yet</p>
          <p className="text-sm">Be the first to share one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredComm.map((sign, i) => (
            <motion.div
              key={sign.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-card border border-border rounded-2xl p-5 hover:border-primary/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>{sign.name}</h4>
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{sign.description}</p>
                </div>
                <button
                  onClick={() => deleteCommunitySigns(sign.id)}
                  className="ml-2 w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center text-destructive hover:bg-destructive/20 transition-colors flex-shrink-0"
                  title="Delete sign"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="bg-muted/30 rounded-xl px-4 py-3 mb-4">
                <p className="text-sm text-foreground font-medium">"{sign.phrase}"</p>
              </div>

              {sign.tags?.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-4">
                  {sign.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-primary/8 text-primary text-xs">{t}</span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Globe className="w-3 h-3" />
                  <span>{sign.authorName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => speak(sign.phrase)} className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors">
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => likeSigns(sign.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-rose-500/10 hover:text-rose-500 text-muted-foreground text-xs font-medium transition-all">
                    <ThumbsUp className="w-3 h-3" />
                    {sign.likes ?? 0}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Share modal */}
      <AnimatePresence>
        {shareForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShareForm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              className="w-full max-w-lg bg-card border border-border rounded-3xl p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-foreground text-lg" style={{ fontFamily: "var(--font-display)" }}>Share a Sign</h3>
                <button onClick={() => setShareForm(false)} className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {[
                  { key: "name", label: "Sign Name", placeholder: 'e.g. "Morning greeting"' },
                  { key: "phrase", label: "Spoken Phrase", placeholder: 'e.g. "Good morning!"' },
                  { key: "description", label: "Description", placeholder: "Describe the hand gesture…" },
                  { key: "authorName", label: "Your Name (optional)", placeholder: "Anonymous" },
                  { key: "tags", label: "Tags (comma separated)", placeholder: "greetings, daily, ASL" },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{f.label}</label>
                    <input
                      value={(shareData as any)[f.key]}
                      onChange={e => setShareData(s => ({ ...s, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-4 py-2.5 rounded-xl bg-input-background border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => setShareForm(false)}
                  className="flex-1 py-3 rounded-xl bg-muted/50 text-foreground text-sm font-medium hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button onClick={submitShare}
                  className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-95 transition-all">
                  Share Sign
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // Render
  return (
    <div className={`min-h-screen bg-background text-foreground ${theme}`}>
      <NavBar />
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {view === "landing" && renderLanding()}
          {view === "live" && renderLive()}
          {view === "cards" && renderCards()}
          {view === "teach" && renderTeach()}
          {view === "community" && renderCommunity()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
