import { useEffect, useRef, useState } from "react";
import {
  Radio,
  Play,
  Square,
  Cpu,
  Download,
  ArrowLeft,
  Plus,
  ZoomIn,
  ZoomOut,
  CheckCircle,
} from "lucide-react";
import { serialManager } from "@/lib/emg/serial";
import { useEmgStore } from "@/lib/emg/store";
import {
  CHANNEL_LABELS,
  CHANNEL_COLORS,
  rms,
  preprocessDataset,
  type Channel,
  type EmgDataset,
  type EmgSample,
} from "@/lib/emg/signal";
import { Button } from "@/components/ui/button";

const LIMB_EXERCISES: Record<string, { value: string; label: string }[]> = {
  leg: [
    { value: "walking", label: "Walking" },
    { value: "stair_ascent", label: "Stair Ascent" },
    { value: "stair_descent", label: "Stair Descent" },
    { value: "calf_raises", label: "Calf Raises" },
    { value: "leg_curl", label: "Leg Curl" },
    { value: "lunges", label: "Lunges" },
    { value: "leg_press", label: "Leg Press" },
    { value: "squats", label: "Squats" },
    { value: "jumping", label: "Jumping" },
    { value: "cycling", label: "Cycling" },
  ],
  arm: [
    { value: "bicep_curl", label: "Bicep Curl" },
    { value: "tricep_ext", label: "Tricep Extension" },
    { value: "wrist_curl", label: "Wrist Curl" },
    { value: "pushup", label: "Push-up" },
    { value: "shoulder_press", label: "Shoulder Press" },
  ],
  weightlifting: [
    { value: "bicep_curl", label: "Bicep Curl" },
    { value: "wrist_curl", label: "Wrist Curl" },
    { value: "reverse_wrist_curl", label: "Reverse Wrist Curl" },
    { value: "bench_press", label: "Bench Press" },
    { value: "deadlift", label: "Deadlift" },
    { value: "clean_jerk", label: "Clean & Jerk" },
    { value: "snatch", label: "Snatch" },
  ],
};

const LEG_MUSCLES = [
  {
    ch: 1,
    name: "Rectus Femoris",
    cx: 111,
    cy: 100,
    rx: 14,
    ry: 33,
    rot: 0.12,
    color: "#00e5c8",
    colorRGB: "0, 229, 200",
    desc: "To activate the Rectus Femoris (Front Thigh):\n• Straighten your knee or push leg upward.\n• Squat down and rise up under load.",
  },
  {
    ch: 2,
    name: "Biceps Femoris",
    cx: 131,
    cy: 110,
    rx: 12,
    ry: 28,
    rot: 0.14,
    color: "#ffb300",
    colorRGB: "255, 179, 0",
    desc: "To activate the Biceps Femoris (Back Thigh):\n• Bend your knee or pull your heel backward.\n• Resist extension of the leg.",
  },
  {
    ch: 3,
    name: "Gastrocnemius",
    cx: 124,
    cy: 225,
    rx: 11,
    ry: 24,
    rot: -0.1,
    color: "#9d4edd",
    colorRGB: "157, 78, 221",
    desc: "To activate the Gastrocnemius (Calf):\n• Point your toes down (plantar flexion).\n• Raise your heels off the ground.",
  },
  {
    ch: 4,
    name: "Spare Muscle",
    cx: 107,
    cy: 230,
    rx: 8,
    ry: 22,
    rot: 0.05,
    color: "#ff357a",
    colorRGB: "255, 53, 122",
    desc: "To activate the Auxiliary Target TA Muscle:\n• Flex your foot upward (dorsiflexion).\n• Ensure correct electrode placement.",
  },
];

const ARM_MUSCLES = [
  {
    ch: 1,
    name: "Biceps Brachii",
    cx: 112,
    cy: 95,
    rx: 11,
    ry: 25,
    rot: 0.15,
    color: "#00e5c8",
    colorRGB: "0, 229, 200",
    desc: "To activate the Biceps Brachii (Front Upper Arm):\n• Bend your elbow or curl a weight.\n• Rotate your forearm so your palm faces up.",
  },
  {
    ch: 2,
    name: "Triceps Brachii",
    cx: 124,
    cy: 95,
    rx: 10,
    ry: 26,
    rot: -0.15,
    color: "#ffb300",
    colorRGB: "255, 179, 0",
    desc: "To activate the Triceps Brachii (Back Upper Arm):\n• Straighten your elbow (push down or back).\n• Extend your arm backwards.",
  },
  {
    ch: 3,
    name: "Brachioradialis",
    cx: 108,
    cy: 175,
    rx: 9,
    ry: 22,
    rot: 0.12,
    color: "#9d4edd",
    colorRGB: "157, 78, 221",
    desc: "To activate the Brachioradialis (Forearm Extensor):\n• Flex your elbow with your thumb pointing upwards.\n• Squeeze your grip or raise your wrist.",
  },
  {
    ch: 4,
    name: "Flexor Carpi",
    cx: 95,
    cy: 185,
    rx: 8,
    ry: 22,
    rot: -0.22,
    color: "#ff357a",
    colorRGB: "255, 53, 122",
    desc: "To activate the Flexor Carpi (Wrist Flexor):\n• Bend your wrist inward (palm toward forearm).\n• Make a tight fist or squeeze your fingers.",
  },
];

interface HurdleAttempt {
  startTime_ms: number;
  endTime_ms: number;
  duration_ms: number;
  outcome: "success" | "fail";
  peakEMG_mV: number;
  meanEMG_mV: number;
  timeToThreshold_ms: number | null;
  channel: string;
  threshold_mV: number;
  baseline_mV: number;
  emg_trace_hz: number | null;
  emg_trace_mV: number[];
}

interface HurdleLog {
  hurdleIndex: number;
  attempts: HurdleAttempt[];
  completedAt: number | null;
}

export function GameView({ onBackToDashboard }: { onBackToDashboard?: () => void }) {
  const { addDataset } = useEmgStore();
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState(serialManager.stats);

  // Form State
  const [participant, setParticipant] = useState("P002");
  const [sex, setSex] = useState("male");
  const [age, setAge] = useState(22);
  const [weightKg, setWeightKg] = useState(52);
  const [heightCm, setHeightCm] = useState(171);
  const [targetLimb, setTargetLimb] = useState("leg");
  const [exerciseList, setExerciseList] = useState(LIMB_EXERCISES.leg);
  const [exercise, setExercise] = useState("calf_raises");
  const [trialNo, setTrialNo] = useState(1);
  const [numHurdles, setNumHurdles] = useState(10);
  const [attemptTimeLimit, setAttemptTimeLimit] = useState(5);
  const [sessionTimeLimit, setSessionTimeLimit] = useState(5); // Session total time limit in minutes
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(5 * 60); // Remaining time in seconds
  const [countdownDisplay, setCountdownDisplay] = useState<string>("0.0"); // Timer countdown display (5.0, 4.9, 4.8...)
  const [showStopButton, setShowStopButton] = useState(false); // Show stop button during game
  const [gameScale, setGameScale] = useState(1.0); // For zoom-in animation on start
  const [activeChannels, setActiveChannels] = useState<number[]>([1]); // [0] = Auto, [1..4]
  const [combMode, setCombMode] = useState<"avg" | "max" | "min">("avg");
  const [anatomyZoom, setAnatomyZoom] = useState(1.0);
  const [threshold, setThreshold] = useState(30);
  const [baseline, setBaseline] = useState(4);
  const [calibrated, setCalibrated] = useState(false);

  // Game execution state matching ref for animation updates
  const [phase, setPhase] = useState<
    | "setup"
    | "calibrating"
    | "countdown"
    | "resting"
    | "ready"
    | "approaching"
    | "at_hurdle"
    | "jumping"
    | "hit"
    | "results"
  >("setup");
  const [currentHurdle, setCurrentHurdle] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [liveCombinedRms, setLiveCombinedRms] = useState(0);

  // Custom display variables for text countdowns
  const [cdBigText, setCdBigText] = useState("");
  const [cdSubText, setCdSubText] = useState("");
  const [cdSubColor, setCdSubColor] = useState("");
  const [screenFlash, setScreenFlash] = useState<"green" | "red" | null>(null);

  // Calibration local states
  const [calibPhase, setCalibPhase] = useState<"idle" | "relax" | "flex">("idle");
  const [calibElapsed, setCalibElapsed] = useState(0);
  const [calibRms, setCalibRms] = useState(0);

  // Alignment Stats Modal
  const [showAlignModal, setShowAlignModal] = useState(false);

  // Canvas Refs
  const gameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const anatomyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mutable Game Tickers Ref (so we don't trigger React renders at 60 FPS)
  const gameRef = useRef({
    phase: "setup" as
      | "setup"
      | "calibrating"
      | "countdown"
      | "resting"
      | "ready"
      | "approaching"
      | "at_hurdle"
      | "jumping"
      | "hit"
      | "results",
    currentHurdle: 0,
    totalAttemptsThisHurdle: 0,
    currentAttemptStart: 0,
    currentPeakEMG: 0,
    charFrac: 0,
    charY: 0,
    charVy: 0,
    charAnimT: 0,
    approachStartFrac: 0,
    approachTargetFrac: 0,
    approachT: 0,
    approachDur: 1.4,
    hitTimer: 0,
    readyTimer: 0,
    restTimer: 0,
    relaxTimeHeld: 0,
    earlyFlexHeld: 0,
    restTooEarly: false,
    flexThresholdHeld: 0,
    hurdleLog: [] as HurdleLog[],
    particles: [] as any[],
    shake: { x: 0, y: 0, t: 0, mag: 0 },
    waveHistories: { 1: [], 2: [], 3: [], 4: [] } as Record<number, number[]>,
    waveHistoryCombined: [] as number[],
    sessionStartTime: 0,
    sessionEndTime: 0, // frozen at completeSession/stop
    sessionTimeLimit: 5, // in minutes
    sessionElapsedTime: 0, // in seconds
    scrollOffset: 0, // Dino-style: how far we've scrolled through hurdles (pixels)
    scrollSpeed: 60, // px/sec continuous background scroll
    width: 0,
    height: 0,
    threshold: 30,
    baseline: 4,
    numHurdles: 10,
    attemptTimeLimit: 5,
    activeChannels: [1],
    combMode: "avg" as "avg" | "max" | "min",
    liveRms: 0,
    liveChLabel: "CH1",
    isKeyboardJumping: false,
  });

  // Keep configuration in sync with loop
  useEffect(() => {
    gameRef.current.threshold = threshold;
    gameRef.current.baseline = baseline;
    gameRef.current.numHurdles = numHurdles;
    gameRef.current.attemptTimeLimit = attemptTimeLimit;
    gameRef.current.sessionTimeLimit = sessionTimeLimit;
    gameRef.current.activeChannels = activeChannels;
    gameRef.current.combMode = combMode;
  }, [threshold, baseline, numHurdles, attemptTimeLimit, sessionTimeLimit, activeChannels, combMode]);

  // Handle Serial Subscriptions
  useEffect(() => {
    const unsubscribe = serialManager.registerListener(() => {
      setConnected(serialManager.connected);
      setStats({ ...serialManager.stats });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Update exercise list on target limb changes
  useEffect(() => {
    const list = LIMB_EXERCISES[targetLimb] || [];
    setExerciseList(list);
    if (list.length > 0) {
      setExercise(list[0].value);
    }
  }, [targetLimb]);

  // Sync phase changes back to UI React state (for overlay conditions)
  const changePhase = (newPhase: typeof phase) => {
    gameRef.current.phase = newPhase;
    setPhase(newPhase);
  };

  // Keyboard Simulation Fallback for jumps
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        gameRef.current.isKeyboardJumping = true;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 60 FPS Game Loop
  useEffect(() => {
    let animFrameId: number;
    let lastTime = 0;

    const loop = (timestamp: number) => {
      if (!lastTime) lastTime = timestamp;
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTime = timestamp;

      // Ingest live EMG
      let currentCombinedRms = 0;
      let connectedSensors = false;

      // Read from Serial Manager if connected
      if (serialManager.connected) {
        const snapshots = [1, 2, 3, 4].map((ch) => serialManager.getLiveChannelSnapshot(ch));
        const liveSensors = snapshots.filter((s) => s.samples.length > 0);
        connectedSensors = liveSensors.length > 0;

        const activeChs = gameRef.current.activeChannels;
        let chosenRmsValues: number[] = [];

        if (activeChs.length === 1 && activeChs[0] === 0) {
          // Auto Mode: use highest RMS
          const highestObj = snapshots.reduce(
            (best, curr) => (curr.rms > best.rms ? curr : best),
            snapshots[0],
          );
          currentCombinedRms = highestObj.rms;
          gameRef.current.liveChLabel = `CH${snapshots.indexOf(highestObj) + 1}`;
        } else {
          // Select only active channels
          chosenRmsValues = snapshots
            .filter((_, idx) => activeChs.includes(idx + 1))
            .map((s) => s.rms);

          if (chosenRmsValues.length === 0) {
            chosenRmsValues = [snapshots[0].rms];
          }

          if (gameRef.current.combMode === "max") {
            currentCombinedRms = Math.max(...chosenRmsValues);
          } else if (gameRef.current.combMode === "min") {
            currentCombinedRms = Math.min(...chosenRmsValues);
          } else {
            // Average
            currentCombinedRms =
              chosenRmsValues.reduce((a, b) => a + b, 0) / chosenRmsValues.length;
          }
          gameRef.current.liveChLabel = activeChs.map((c) => `CH${c}`).join("+");
        }
      } else {
        // Mock keyboard simulation trigger if not connected
        if (gameRef.current.isKeyboardJumping) {
          currentCombinedRms = gameRef.current.threshold * 1.5;
          // Fade back down quickly
          setTimeout(() => {
            gameRef.current.isKeyboardJumping = false;
          }, 150);
        } else {
          currentCombinedRms = 0;
        }
        gameRef.current.liveChLabel = "KBD";
      }

      gameRef.current.liveRms = currentCombinedRms;
      setLiveCombinedRms(Math.round(currentCombinedRms));

      // Append values to rolling wave histories (120 points)
      const maxPts = 120;
      [1, 2, 3, 4].forEach((chId) => {
        let val = 0;
        if (serialManager.connected) {
          val = serialManager.getLiveChannelSnapshot(chId).rms;
        } else {
          // Fallback simulation
          const activeChs = gameRef.current.activeChannels;
          val =
            activeChs.includes(chId) || (activeChs.length === 1 && activeChs[0] === 0)
              ? currentCombinedRms
              : 0;
        }
        const hist = gameRef.current.waveHistories[chId] || [];
        hist.push(val);
        if (hist.length > maxPts) hist.shift();
        gameRef.current.waveHistories[chId] = hist;
      });

      const combinedHist = gameRef.current.waveHistoryCombined;
      combinedHist.push(currentCombinedRms);
      if (combinedHist.length > maxPts) combinedHist.shift();
      gameRef.current.waveHistoryCombined = combinedHist;

      // Track session elapsed time
      if (gameRef.current.sessionStartTime > 0 && gameRef.current.phase !== "setup" && gameRef.current.phase !== "calibrating") {
        const elapsedSeconds = (Date.now() - gameRef.current.sessionStartTime) / 1000;
        gameRef.current.sessionElapsedTime = elapsedSeconds;
        
        const sessionTimeSeconds = gameRef.current.sessionTimeLimit * 60;
        const remainingSeconds = Math.max(0, sessionTimeSeconds - elapsedSeconds);
        setSessionTimeRemaining(remainingSeconds);

        // Check if session time limit exceeded
        if (elapsedSeconds >= sessionTimeSeconds && gameRef.current.phase !== "results") {
          completeSession();
        }
      }

      // Continuous background scroll towards the dino during active gameplay
      const gameplayPhases = ["ready", "approaching", "at_hurdle", "jumping", "hit", "resting"];
      if (gameplayPhases.includes(gameRef.current.phase)) {
        gameRef.current.scrollOffset += gameRef.current.scrollSpeed * dt;
      }

      // Update Phase Logic
      const phase = gameRef.current.phase;
      if (phase === "setup") {
        // Maintain preview
      } else if (phase === "resting") {
        updateResting(dt);
      } else if (phase === "ready") {
        updateReady(dt);
      } else if (phase === "approaching") {
        updateApproaching(dt);
      } else if (phase === "at_hurdle") {
        updateAtHurdle(dt);
      } else if (phase === "jumping") {
        updateJumping(dt);
      } else if (phase === "hit") {
        updateHit(dt);
      }

      // Draw Panels
      drawGame(dt);
      drawWave();

      animFrameId = requestAnimationFrame(loop);
    };

    // --- State Machine Actions & Calculations ---

    const updateResting = (dt: number) => {
      const relaxThreshold = Math.min(
        Math.max(gameRef.current.baseline + 8, gameRef.current.threshold * 0.4, 15),
        gameRef.current.threshold * 0.75,
      );
      const rmsVal = Math.round(gameRef.current.liveRms);

      if (gameRef.current.restTimer > 0) {
        gameRef.current.restTimer -= dt;
        gameRef.current.relaxTimeHeld = 0;
        setCdBigText(`${Math.ceil(gameRef.current.restTimer)} s`);
        if (gameRef.current.restTooEarly) {
          setCdSubText("⚠️ TOO EARLY! RELAX YOUR MUSCLE");
          setCdSubColor("#ff3860");
        } else {
          setCdSubText("🧘 REST & RELAX YOUR MUSCLE");
          setCdSubColor("#ffb300");
        }
      } else {
        setCdBigText(`${rmsVal} mV`);
        if (gameRef.current.restTooEarly) {
          setCdSubText(`⚠️ RELAX YOUR MUSCLE (Target: <${Math.round(relaxThreshold)} mV)`);
          setCdSubColor("#ff3860");
        } else {
          setCdSubText(`🧘 RELAX YOUR MUSCLE (Target: <${Math.round(relaxThreshold)} mV)`);
          setCdSubColor("#ffb300");
        }

        // Must sustain relaxation for 200ms
        if (gameRef.current.liveRms < relaxThreshold) {
          gameRef.current.relaxTimeHeld += dt;
          if (gameRef.current.relaxTimeHeld >= 0.2) {
            beginReadyPhase();
          }
        } else {
          gameRef.current.relaxTimeHeld = 0; // Spike resets relaxation hold
        }
      }
    };

    const beginReadyPhase = () => {
      changePhase("ready");
      gameRef.current.readyTimer = 1.0;
      gameRef.current.earlyFlexHeld = 0;
      gameRef.current.restTooEarly = false;
      setCdBigText("1");
      const hIdx = gameRef.current.currentHurdle;
      setCdSubText(hIdx === 0 ? "GET READY FOR HURDLE 1" : "GET READY FOR NEXT HURDLE");
      setCdSubColor("#00e5c8");
    };

    const updateReady = (dt: number) => {
      // Early flex check
      if (gameRef.current.liveRms >= gameRef.current.threshold) {
        gameRef.current.earlyFlexHeld += dt;
        if (gameRef.current.earlyFlexHeld >= 0.12) {
          beginRestPhase(true);
          return;
        }
      } else {
        gameRef.current.earlyFlexHeld = 0;
      }

      gameRef.current.readyTimer -= dt;
      setCdBigText(Math.max(0, Math.ceil(gameRef.current.readyTimer)).toString());

      if (gameRef.current.readyTimer <= 0) {
        beginApproach(gameRef.current.currentHurdle);
      }
    };

    const beginApproach = (hurdleIndex: number) => {
      changePhase("approaching");
      gameRef.current.earlyFlexHeld = 0;
      gameRef.current.approachT = 0;
      // Dino-style: no charFrac movement needed
    };

    const updateApproaching = (dt: number) => {
      // Early flex check
      if (gameRef.current.liveRms >= gameRef.current.threshold) {
        gameRef.current.earlyFlexHeld += dt;
        if (gameRef.current.earlyFlexHeld >= 0.12) {
          beginRestPhase(true);
          return;
        }
      } else {
        gameRef.current.earlyFlexHeld = 0;
      }

      gameRef.current.approachT += dt;
      // In dino-style, we don't move character - just wait
      if (gameRef.current.approachT >= 0.6) {
        beginAtHurdle();
      }
    };

    const beginAtHurdle = () => {
      changePhase("at_hurdle");
      gameRef.current.currentAttemptStart = Date.now();
      gameRef.current.currentPeakEMG = 0;
      gameRef.current.flexThresholdHeld = 0;

      gameRef.current.totalAttemptsThisHurdle++;
      setTotalAttempts(gameRef.current.totalAttemptsThisHurdle);

      const hIdx = gameRef.current.currentHurdle;
      if (!gameRef.current.hurdleLog[hIdx]) {
        gameRef.current.hurdleLog[hIdx] = {
          hurdleIndex: hIdx,
          attempts: [],
          completedAt: null,
        };
      }
    };

    const updateAtHurdle = (dt: number) => {
      if (gameRef.current.liveRms > gameRef.current.currentPeakEMG) {
        gameRef.current.currentPeakEMG = gameRef.current.liveRms;
      }

      // Update countdown display (5.0, 4.9, 4.8...)
      const elapsed = (Date.now() - gameRef.current.currentAttemptStart) / 1000;
      const remaining = Math.max(0, gameRef.current.attemptTimeLimit - elapsed);
      setCountdownDisplay(remaining.toFixed(1));

      // Threshold crossing constraint check (hold 120ms to prevent high-freq spikes)
      if (gameRef.current.liveRms >= gameRef.current.threshold) {
        gameRef.current.flexThresholdHeld += dt;
        if (gameRef.current.flexThresholdHeld >= 0.12) {
          triggerJump();
          return;
        }
      } else {
        gameRef.current.flexThresholdHeld = 0;
      }

      // Timer countdown check
      if (remaining <= 0) {
        triggerHit();
      }
    };

    const triggerJump = () => {
      changePhase("jumping");
      gameRef.current.charVy = -490;
      gameRef.current.flexThresholdHeld = 0;

      // Log attempts
      const attempt = makeAttemptRecord("success");
      const hIdx = gameRef.current.currentHurdle;
      gameRef.current.hurdleLog[hIdx].attempts.push(attempt);

      // Dino-style: scroll forward when success
      gameRef.current.scrollOffset += 80;

      // Flash & particles
      const canvas = gameCanvasRef.current;
      if (canvas) {
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        const hx = w / 2; // Center of screen
        const ty = h * 0.7;
        addParticles(hx, ty - hurdleVisualH(h) / 2, "#00c97a", 18, 1.2);
      }

      setScreenFlash("green");
      setTimeout(() => setScreenFlash(null), 400);
    };

    const triggerHit = () => {
      changePhase("hit");
      gameRef.current.hitTimer = 1.2;
      gameRef.current.flexThresholdHeld = 0;

      // Log attempt
      const attempt = makeAttemptRecord("fail");
      const hIdx = gameRef.current.currentHurdle;
      gameRef.current.hurdleLog[hIdx].attempts.push(attempt);

      // Dino-style: scroll backward (rewind) when fail
      gameRef.current.scrollOffset = Math.max(0, gameRef.current.scrollOffset - 40);

      // Shake & particles
      gameRef.current.shake = { x: 0, y: 0, t: 0.35, mag: 10 };

      const canvas = gameCanvasRef.current;
      if (canvas) {
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        const hx = w / 2; // Center of screen
        const ty = h * 0.7;
        addParticles(hx, ty - 20, "#ff3860", 12, 0.9);
      }

      setScreenFlash("red");
      setTimeout(() => setScreenFlash(null), 400);
    };

    const updateJumping = (dt: number) => {
      const grav = 1900;
      gameRef.current.charVy += grav * dt;
      gameRef.current.charY += gameRef.current.charVy * dt;
      // No longer move charFrac - dino style keeps player centered

      if (gameRef.current.charY >= 0) {
        gameRef.current.charY = 0;
        gameRef.current.charVy = 0;
        onLanded();
      }
    };

    const updateHit = (dt: number) => {
      gameRef.current.hitTimer -= dt;
      if (gameRef.current.hitTimer <= 0) {
        // Dino-style: no charFrac needed - just move to rest phase
        beginRestPhase(false);
      }
    };

    const onLanded = () => {
      const hIdx = gameRef.current.currentHurdle;
      if (gameRef.current.hurdleLog[hIdx]) {
        gameRef.current.hurdleLog[hIdx].completedAt = Date.now() - gameRef.current.sessionStartTime;
      }

      const nextH = hIdx + 1;
      gameRef.current.currentHurdle = nextH;
      setCurrentHurdle(nextH);
      gameRef.current.totalAttemptsThisHurdle = 0;
      setTotalAttempts(0);

      if (nextH >= gameRef.current.numHurdles) {
        completeSession();
      } else {
        beginRestPhase(false);
      }
    };

    const beginRestPhase = (tooEarly: boolean) => {
      changePhase("resting");
      gameRef.current.restTimer = 2.0;
      gameRef.current.relaxTimeHeld = 0;
      gameRef.current.earlyFlexHeld = 0;
      gameRef.current.restTooEarly = tooEarly;
    };

    const completeSession = () => {
      gameRef.current.sessionEndTime = Date.now();
      changePhase("results");
      setShowStopButton(false);

      // Stop serialManager recording automatically if recording was active
      if (serialManager.getIsRecording()) {
        const dataset = serialManager.stopRecording(true);
        if (dataset) {
          addDataset(dataset);
        }
      }
    };

    const makeAttemptRecord = (outcome: "success" | "fail"): HurdleAttempt => {
      const now = Date.now();
      const duration = now - gameRef.current.currentAttemptStart;
      const trace = gameRef.current.waveHistoryCombined.slice();
      let meanEMG = 0;
      if (trace.length) {
        meanEMG = trace.reduce((s, v) => s + v, 0) / trace.length;
      }

      return {
        startTime_ms: gameRef.current.currentAttemptStart - gameRef.current.sessionStartTime,
        endTime_ms: now - gameRef.current.sessionStartTime,
        duration_ms: duration,
        outcome: outcome,
        peakEMG_mV: Math.round(gameRef.current.currentPeakEMG * 100) / 100,
        meanEMG_mV: Math.round(meanEMG * 100) / 100,
        timeToThreshold_ms: outcome === "success" ? duration : null,
        channel: gameRef.current.liveChLabel,
        threshold_mV: Math.round(gameRef.current.threshold * 100) / 100,
        baseline_mV: Math.round(gameRef.current.baseline * 100) / 100,
        emg_trace_hz:
          trace.length && duration > 0
            ? Math.round((trace.length / (duration / 1000)) * 100) / 100
            : null,
        emg_trace_mV: trace,
      };
    };

    const addParticles = (
      x: number,
      y: number,
      color: string,
      count: number,
      speedMult: number,
    ) => {
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
        const speed = (80 + Math.random() * 180) * speedMult;
        gameRef.current.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60,
          life: 0.45 + Math.random() * 0.35,
          maxLife: 0.8,
          r: 2.5 + Math.random() * 3,
          color: color,
        });
      }
    };

    const hurdleVisualH = (h: number) => {
      const t = (gameRef.current.threshold - 10) / 290;
      const clamped = Math.max(0, Math.min(1, t));
      return 40 + clamped * (120 - 40); // 40px to 120px
    };

    // --- Render Elements on Game Canvas ---

    const drawGame = (dt: number) => {
      const canvas = gameCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.resetTransform();
      ctx.scale(dpr, dpr);

      // === Camera shake ===
      ctx.save();
      const shake = gameRef.current.shake;
      if (shake.t > 0) {
        shake.t -= dt;
        const mag = shake.mag * (shake.t > 0 ? 1 : 0);
        ctx.translate((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag);
      }
      ctx.clearRect(-20, -20, w + 40, h + 40);

      const now = Date.now();
      const NEON = "#00e5c8";
      const NEON_DIM = "rgba(0,229,200,0.55)";
      const NEON_GHOST = "rgba(0,229,200,0.10)";
      const WARN = "#ff357a";
      const OK = "#7fffcf";

      // === 1. Scope background ===
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#060b15");
      bg.addColorStop(0.6, "#08111e");
      bg.addColorStop(1, "#03060c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // CRT scanlines
      ctx.fillStyle = "rgba(0, 229, 200, 0.025)";
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

      // Scope grid
      const grid = 40;
      ctx.strokeStyle = "rgba(0, 229, 200, 0.07)";
      ctx.lineWidth = 1;
      const offsetX = (gameRef.current.scrollOffset || 0) % grid;
      for (let gx = -offsetX; gx < w; gx += grid) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += grid) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Crosshair
      ctx.strokeStyle = "rgba(0, 229, 200, 0.12)";
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner tick marks
      ctx.strokeStyle = NEON_DIM;
      ctx.lineWidth = 1.5;
      const tick = 10;
      [[10,10],[w-10,10],[10,h-10],[w-10,h-10]].forEach(([x,y]) => {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + (x<w/2?tick:-tick), y);
        ctx.moveTo(x, y); ctx.lineTo(x, y + (y<h/2?tick:-tick));
        ctx.stroke();
      });

      // === 2. Ground / horizon ===
      const ty = h * 0.72;

      // Glow under horizon
      const hg = ctx.createLinearGradient(0, ty, 0, h);
      hg.addColorStop(0, "rgba(0, 229, 200, 0.18)");
      hg.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = hg;
      ctx.fillRect(0, ty, w, h - ty);

      // Horizon line (glowing)
      ctx.shadowColor = NEON;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = NEON;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ty); ctx.lineTo(w, ty);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Scrolling dashed ground texture
      ctx.strokeStyle = "rgba(0, 229, 200, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([12, 16]);
      ctx.lineDashOffset = -gameRef.current.scrollOffset;
      ctx.beginPath();
      ctx.moveTo(0, ty + 6); ctx.lineTo(w, ty + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // === 3. Hurdles (cactus-style neon obelisks scrolling right→left) ===
      const hH = hurdleVisualH(h);
      const hurdleSpacing = 140;
      const hurdleStartX = w * 0.92;
      const hw = 16;

      for (let i = 0; i < gameRef.current.numHurdles; i++) {
        const hx = hurdleStartX + i * hurdleSpacing - gameRef.current.scrollOffset;
        if (hx < -30 || hx > w + 30) continue;

        const top = ty - hH;
        let state: "done" | "current" | "future" = "future";
        if (i < gameRef.current.currentHurdle) state = "done";
        else if (i === gameRef.current.currentHurdle) state = "current";

        if (state === "done") {
          // Faded green ghost
          ctx.fillStyle = "rgba(127, 255, 207, 0.06)";
          ctx.strokeStyle = "rgba(127, 255, 207, 0.5)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(hx - hw / 2, top, hw, hH);
          ctx.fill(); ctx.stroke();

          ctx.strokeStyle = OK;
          ctx.shadowColor = OK; ctx.shadowBlur = 8;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(hx - 5, ty - hH / 2);
          ctx.lineTo(hx - 1, ty - hH / 2 + 5);
          ctx.lineTo(hx + 6, ty - hH / 2 - 5);
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else if (state === "current") {
          const pulse = 0.6 + 0.4 * Math.sin(now / 220);
          // Outer glow halo
          ctx.shadowColor = NEON;
          ctx.shadowBlur = 28 * pulse;
          ctx.fillStyle = `rgba(0, 229, 200, ${0.18 * pulse})`;
          ctx.strokeStyle = NEON;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.rect(hx - hw / 2, top, hw, hH);
          ctx.fill(); ctx.stroke();
          ctx.shadowBlur = 0;

          // Inner band rungs
          ctx.strokeStyle = `rgba(0, 229, 200, ${0.35 * pulse})`;
          ctx.lineWidth = 1;
          for (let b = 1; b < 5; b++) {
            ctx.beginPath();
            ctx.moveTo(hx - hw / 2 + 2, top + (hH * b) / 5);
            ctx.lineTo(hx + hw / 2 - 2, top + (hH * b) / 5);
            ctx.stroke();
          }

          // Hover arrow
          ctx.fillStyle = NEON;
          ctx.shadowColor = NEON; ctx.shadowBlur = 10;
          ctx.font = "bold 14px var(--font-mono)";
          ctx.textAlign = "center";
          ctx.fillText("▼", hx, top - 8 - Math.sin(now / 200) * 3);
          ctx.shadowBlur = 0;

          // Threshold tag
          ctx.fillStyle = NEON_DIM;
          ctx.font = "bold 9px var(--font-mono)";
          ctx.fillText(`H${i + 1}`, hx, ty + 18);
        } else {
          // Wireframe future
          ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(hx - hw / 2, top, hw, hH);
          ctx.fill(); ctx.stroke();

          ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
          ctx.font = "9px var(--font-mono)";
          ctx.textAlign = "center";
          ctx.fillText((i + 1).toString(), hx, ty + 18);
        }
      }
      ctx.textAlign = "left";

      // === 4. Neon T-Rex character ===
      gameRef.current.charAnimT += dt;
      const cx = w * 0.22;
      const cy = ty + gameRef.current.charY;
      const phaseNow = gameRef.current.phase;

      let bodyCol = NEON;
      if (phaseNow === "jumping") bodyCol = OK;
      else if (phaseNow === "hit") bodyCol = WARN;

      ctx.save();
      ctx.translate(cx, cy);

      // Ground shadow
      const shadowScale = Math.max(0.3, 1 - Math.abs(gameRef.current.charY) / 60);
      ctx.fillStyle = `rgba(0, 229, 200, ${0.25 * shadowScale})`;
      ctx.beginPath();
      ctx.ellipse(0, 2, 22 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hit rotation
      if (phaseNow === "hit") {
        const rot = (1.2 - gameRef.current.hitTimer) * Math.PI * 1.5;
        ctx.rotate(rot * 0.5);
        ctx.globalAlpha = Math.max(0.2, gameRef.current.hitTimer / 1.2);
      }

      // === T-Rex wireframe (neon outline) ===
      ctx.shadowColor = bodyCol;
      ctx.shadowBlur = phaseNow === "jumping" ? 24 : 14;
      ctx.strokeStyle = bodyCol;
      ctx.fillStyle = `${bodyCol}22`;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Body (chunky dino silhouette, baseline = feet at y=0)
      ctx.beginPath();
      // Tail
      ctx.moveTo(20, -8);
      ctx.lineTo(28, -14);
      ctx.lineTo(30, -10);
      ctx.lineTo(22, -4);
      // Back
      ctx.lineTo(10, -18);
      ctx.lineTo(-6, -26);
      // Neck + head
      ctx.lineTo(-14, -34);
      ctx.lineTo(-22, -36);
      ctx.lineTo(-26, -32);
      ctx.lineTo(-26, -26);
      ctx.lineTo(-18, -24);
      // Jaw
      ctx.lineTo(-14, -22);
      ctx.lineTo(-8, -20);
      // Belly
      ctx.lineTo(-2, -10);
      ctx.lineTo(8, -6);
      ctx.lineTo(18, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Eye
      ctx.fillStyle = bodyCol;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(-22, -31, 1.4, 0, Math.PI * 2);
      ctx.fill();

      // Tiny arm
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(-4, -18);
      ctx.lineTo(-6, -14);
      ctx.lineTo(-3, -12);
      ctx.stroke();

      // Legs — animated run cycle (only on ground phases)
      const runCycle = gameRef.current.charAnimT * 14;
      let leg1Y = 0, leg2Y = 0;
      if (phaseNow === "approaching" || phaseNow === "at_hurdle" || phaseNow === "ready" || phaseNow === "resting") {
        leg1Y = Math.max(0, Math.sin(runCycle) * 4);
        leg2Y = Math.max(0, Math.sin(runCycle + Math.PI) * 4);
      } else if (phaseNow === "jumping") {
        leg1Y = -3; leg2Y = -5;
      }

      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      // Back leg
      ctx.beginPath();
      ctx.moveTo(10, -6);
      ctx.lineTo(8, -1 - leg2Y);
      ctx.lineTo(14, 0 - leg2Y);
      ctx.stroke();
      // Front leg
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(-4, -1 - leg1Y);
      ctx.lineTo(2, 0 - leg1Y);
      ctx.stroke();

      ctx.restore();

      // === 5. Particles ===
      for (let i = gameRef.current.particles.length - 1; i >= 0; i--) {
        const p = gameRef.current.particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 350 * dt;
        p.life -= dt;
        if (p.life <= 0) { gameRef.current.particles.splice(i, 1); continue; }
        const a = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // === 6. On-canvas HUD ===
      // Top-left: hurdle counter
      ctx.fillStyle = "rgba(6,11,21,0.78)";
      ctx.strokeStyle = NEON_DIM;
      ctx.lineWidth = 1;
      ctx.fillRect(12, 12, 150, 44);
      ctx.strokeRect(12, 12, 150, 44);
      ctx.fillStyle = NEON_DIM;
      ctx.font = "8px var(--font-mono)";
      ctx.fillText("HURDLE", 20, 24);
      ctx.fillStyle = NEON;
      ctx.shadowColor = NEON; ctx.shadowBlur = 8;
      ctx.font = "bold 22px var(--font-mono)";
      ctx.fillText(
        `${Math.min(gameRef.current.currentHurdle + 1, gameRef.current.numHurdles)}/${gameRef.current.numHurdles}`,
        20, 48,
      );
      ctx.shadowBlur = 0;
      // mini progress bar
      const barW = 130;
      const barX = 20, barY = 50;
      ctx.fillStyle = "rgba(0, 229, 200, 0.15)";
      ctx.fillRect(barX, barY, barW, 3);
      ctx.fillStyle = NEON;
      ctx.fillRect(barX, barY, barW * (gameRef.current.currentHurdle / Math.max(1, gameRef.current.numHurdles)), 3);

      // Top-right: session timer
      const tw = 150;
      ctx.fillStyle = "rgba(6,11,21,0.78)";
      ctx.strokeStyle = NEON_DIM;
      ctx.fillRect(w - tw - 12, 12, tw, 44);
      ctx.strokeRect(w - tw - 12, 12, tw, 44);
      ctx.fillStyle = NEON_DIM;
      ctx.font = "8px var(--font-mono)";
      ctx.textAlign = "right";
      ctx.fillText("SESSION TIMER", w - 20, 24);
      const tSec = Math.max(0, sessionTimeRemaining);
      const mm = Math.floor(tSec / 60).toString().padStart(2, "0");
      const ss = Math.floor(tSec % 60).toString().padStart(2, "0");
      const lowTime = tSec < 30;
      ctx.fillStyle = lowTime ? WARN : NEON;
      ctx.shadowColor = ctx.fillStyle as string; ctx.shadowBlur = 8;
      ctx.font = "bold 22px var(--font-mono)";
      ctx.fillText(`${mm}:${ss}`, w - 20, 48);
      ctx.shadowBlur = 0;
      ctx.textAlign = "left";

      // Bottom: EMG vs threshold meter
      const mY = h - 38;
      const mH = 22;
      const mLeft = 14, mRight = w - 14;
      const mW = mRight - mLeft;

      ctx.fillStyle = "rgba(6,11,21,0.78)";
      ctx.strokeStyle = NEON_DIM;
      ctx.fillRect(mLeft, mY, mW, mH);
      ctx.strokeRect(mLeft, mY, mW, mH);

      const liveRms = gameRef.current.liveRms || 0;
      const thr = Math.max(1, gameRef.current.threshold);
      const scaleMax = Math.max(thr * 1.6, liveRms * 1.1, 60);
      const fillW = Math.min(1, liveRms / scaleMax) * (mW - 4);
      const over = liveRms >= thr;
      ctx.fillStyle = over ? OK : NEON_GHOST;
      if (!over) {
        ctx.fillStyle = `rgba(0, 229, 200, ${0.25 + 0.5 * (liveRms / thr)})`;
      }
      ctx.shadowColor = over ? OK : NEON;
      ctx.shadowBlur = over ? 18 : 6;
      ctx.fillRect(mLeft + 2, mY + 2, fillW, mH - 4);
      ctx.shadowBlur = 0;

      // Threshold marker
      const thrX = mLeft + 2 + (thr / scaleMax) * (mW - 4);
      ctx.strokeStyle = WARN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(thrX, mY - 4); ctx.lineTo(thrX, mY + mH + 4);
      ctx.stroke();
      ctx.fillStyle = WARN;
      ctx.font = "bold 9px var(--font-mono)";
      ctx.fillText(`THR ${thr.toFixed(0)}`, Math.min(thrX + 4, w - 60), mY - 6);

      // Live value label
      ctx.fillStyle = NEON;
      ctx.font = "bold 10px var(--font-mono)";
      ctx.fillText(`${gameRef.current.liveChLabel}  ${liveRms.toFixed(0)} mV`, mLeft + 6, mY + 15);

      // Big center text (phase prompt)
      if (cdBigText) {
        ctx.textAlign = "center";
        ctx.fillStyle = NEON;
        ctx.shadowColor = NEON; ctx.shadowBlur = 18;
        ctx.font = "bold 56px var(--font-mono)";
        ctx.fillText(cdBigText, w / 2, h * 0.35);
        ctx.shadowBlur = 0;
        if (cdSubText) {
          ctx.fillStyle = cdSubColor || NEON_DIM;
          ctx.font = "bold 12px var(--font-mono)";
          ctx.fillText(cdSubText, w / 2, h * 0.35 + 28);
        }
        ctx.textAlign = "left";
      }

      // Screen flash
      if (screenFlash) {
        ctx.fillStyle = screenFlash === "green" ? "rgba(127,255,207,0.18)" : "rgba(255,53,122,0.18)";
        ctx.fillRect(0, 0, w, h);
      }

      ctx.restore(); // shake
    };


    // --- Render wave canvas in flex HUD overlay ---

    const drawWave = () => {
      const canvas = waveCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.resetTransform();
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, w, h);

      // Draw dotted threshold line
      const tPct = Math.min(gameRef.current.threshold / 300, 1.0);
      const ty = h - tPct * h * 0.85 - 4;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(w, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      const activeChs = gameRef.current.activeChannels;
      const isAuto = activeChs.length === 1 && activeChs[0] === 0;
      const step = w / (120 - 1);

      const chColors: Record<number, string> = {
        1: "rgba(0, 229, 200, 0.45)", // Teal
        2: "rgba(255, 179, 0, 0.45)", // Amber
        3: "rgba(157, 78, 221, 0.45)", // Purple
        4: "rgba(255, 53, 122, 0.45)", // Magenta
      };

      // Draw selected sub-channel lines
      const drawChannels = isAuto ? [1, 2, 3, 4] : activeChs;
      drawChannels.forEach((ch) => {
        const pts = gameRef.current.waveHistories[ch];
        if (!pts || pts.length < 2) return;

        ctx.strokeStyle = chColors[ch] || "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const px = i * step;
          const py = h - (Math.min(pts[i], 300) / 300) * h * 0.85 - 4;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });

      // Draw combined solid glowing line
      const combPts = gameRef.current.waveHistoryCombined;
      if (combPts && combPts.length >= 2) {
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "rgba(255, 255, 255, 0.4)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0.95)");

        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 4;

        ctx.beginPath();
        for (let i = 0; i < combPts.length; i++) {
          const px = i * step;
          const py = h - (Math.min(combPts[i], 300) / 300) * h * 0.85 - 4;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Gradient fill underneath
        ctx.lineTo((combPts.length - 1) * step, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
        fillGrad.addColorStop(0, "rgba(0, 229, 200, 0.08)");
        fillGrad.addColorStop(1, "rgba(0, 229, 200, 0)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }
    };

    animFrameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, []);

  // Update anatomy canvas silhouette highlights (runs when settings change)
  useEffect(() => {
    const canvas = anatomyCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 220;
    const h = 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // Zoom scale logic
    if (anatomyZoom > 1.0) {
      let cx = 110,
        cy = 150;
      if (targetLimb === "arm" || targetLimb === "weightlifting") {
        cx = 100;
        cy = 130;
      } else {
        if (activeChannels.includes(3)) {
          cx = 120;
          cy = 220;
        } else if (activeChannels.includes(1) || activeChannels.includes(2)) {
          cx = 115;
          cy = 105;
        }
      }
      ctx.translate(w / 2, h / 2);
      ctx.scale(anatomyZoom, anatomyZoom);
      ctx.translate(-cx, -cy);
    }

    // Grid details
    ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    ctx.lineWidth = 1;
    for (let x = -100; x < w + 200; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, -100);
      ctx.lineTo(x, h + 200);
      ctx.stroke();
    }
    for (let y = -100; y < h + 200; y += 20) {
      ctx.beginPath();
      ctx.moveTo(-100, y);
      ctx.lineTo(w + 200, y);
      ctx.stroke();
    }

    const isArm = targetLimb === "arm" || targetLimb === "weightlifting";
    const points = isArm
      ? [
          { x: 75, y: 25 },
          { x: 110, y: 75 },
          { x: 115, y: 125 },
          { x: 95, y: 180 },
          { x: 82, y: 235 },
          { x: 65, y: 255 },
          { x: 55, y: 265 },
          { x: 65, y: 275 },
          { x: 92, y: 240 },
          { x: 118, y: 180 },
          { x: 130, y: 135 },
          { x: 122, y: 75 },
          { x: 100, y: 25 },
        ]
      : [
          { x: 120, y: 25 },
          { x: 95, y: 125 },
          { x: 102, y: 175 },
          { x: 95, y: 265 },
          { x: 102, y: 285 },
          { x: 80, y: 295 },
          { x: 55, y: 305 },
          { x: 55, y: 310 },
          { x: 108, y: 310 },
          { x: 118, y: 295 },
          { x: 132, y: 235 },
          { x: 122, y: 175 },
          { x: 142, y: 105 },
          { x: 145, y: 45 },
        ];

    // Silhouette
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fill();

    // Joints dot
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    if (isArm) {
      ctx.beginPath();
      ctx.arc(88, 30, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(122, 130, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(87, 237, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(112, 175, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(108, 290, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const muscles = isArm ? ARM_MUSCLES : LEG_MUSCLES;
    const isAuto = activeChannels.length === 1 && activeChannels[0] === 0;

    muscles.forEach((m) => {
      const isActive = isAuto || activeChannels.includes(m.ch);
      if (isActive) {
        ctx.save();
        ctx.shadowColor = m.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = `rgba(${m.colorRGB}, 0.35)`;
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.8;

        ctx.beginPath();
        ctx.ellipse(m.cx, m.cy, m.rx, m.ry, m.rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Dashed callout pointer line
        ctx.strokeStyle = `rgba(${m.colorRGB}, 0.65)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(m.cx, m.cy);

        const lx = m.cx > 115 ? w - 30 : 30;
        const ly = m.cy - 12;
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.shadowBlur = 0;
        ctx.fillStyle = m.color;
        ctx.font = "bold 9px var(--font-mono)";
        ctx.textAlign = m.cx > 115 ? "right" : "left";
        ctx.fillText(`CH${m.ch}`, lx, ly - 4);
        ctx.fillStyle = "#ffffff";
        ctx.font = "8px var(--font-body)";
        ctx.fillText(m.name.toUpperCase(), lx, ly + 6);

        ctx.restore();
      }
    });
  }, [targetLimb, activeChannels, anatomyZoom]);

  // Load configuration cache
  useEffect(() => {
    try {
      const cached = localStorage.getItem("emg_game_session_meta");
      if (cached) {
        const m = JSON.parse(cached);
        if (m.participant) setParticipant(m.participant);
        if (m.sex) setSex(m.sex);
        if (m.age) setAge(m.age);
        if (m.weight_kg) setWeightKg(m.weight_kg);
        if (m.height_cm) setHeightCm(m.height_cm);
        if (m.targetLimb) setTargetLimb(m.targetLimb);
        if (m.exercise) setExercise(m.exercise);
        if (m.trial_no) setTrialNo(m.trial_no);
      }
    } catch (e) {}
  }, []);

  // Save settings updates
  const saveCache = (updatedMeta: any) => {
    try {
      localStorage.setItem("emg_game_session_meta", JSON.stringify(updatedMeta));
    } catch (e) {}
  };

  // Calibration timer ticks
  const runCalibration = () => {
    if (!connected) {
      alert("Please connect your ESP32 board or skip to defaults.");
      return;
    }

    setCalibPhase("relax");
    setCalibElapsed(0);
    setCalibRms(0);
    changePhase("calibrating");

    const samples: number[] = [];
    const interval = 100; // ms
    let elapsed = 0;
    let phaseMode = "relax";

    const calibTimer = setInterval(() => {
      elapsed += interval / 1000;
      setCalibElapsed(elapsed);

      // Ingest live combined RMS
      const live = gameRef.current.liveRms;
      samples.push(live);
      setCalibRms(Math.round(live));

      const totalTime = phaseMode === "relax" ? 3.0 : 3.5;

      if (elapsed >= totalTime) {
        if (phaseMode === "relax") {
          const avgBaseline = samples.reduce((a, b) => a + b, 0) / samples.length;
          setBaseline(Math.round(avgBaseline * 10) / 10);
          samples.length = 0; // Reset sample pool
          phaseMode = "flex";
          setCalibPhase("flex");
          elapsed = 0;
        } else {
          // Completed Target Flex
          clearInterval(calibTimer);
          const maxFlex = Math.max(...samples);
          const calculatedThresh = Math.max(baseline + 5, maxFlex * 0.85);
          setThreshold(Math.round(calculatedThresh * 10) / 10);
          setCalibrated(true);
          setCalibPhase("idle");
          changePhase("setup");
        }
      }
    }, interval);
  };

  const skipCalibration = () => {
    setBaseline(4);
    setThreshold(30);
    setCalibrated(true);
    changePhase("setup");
  };

  // Initialize Protocol Execution
  const beginProtocol = () => {
    // Cache setup parameters
    const cacheMeta = {
      participant,
      sex,
      age,
      weight_kg: weightKg,
      height_cm: heightCm,
      exercise,
      trial_no: trialNo,
      targetLimb,
    };
    saveCache(cacheMeta);

    // Initialize Game Refs
    gameRef.current.phase = "setup";
    gameRef.current.currentHurdle = 0;
    setCurrentHurdle(0);
    gameRef.current.totalAttemptsThisHurdle = 0;
    setTotalAttempts(0);
    gameRef.current.charFrac = 0;
    gameRef.current.charY = 0;
    gameRef.current.charVy = 0;
    gameRef.current.charAnimT = 0;
    gameRef.current.particles = [];
    gameRef.current.hurdleLog = [];
    gameRef.current.sessionStartTime = Date.now();
    gameRef.current.sessionEndTime = 0;
    gameRef.current.sessionTimeLimit = sessionTimeLimit;
    gameRef.current.sessionElapsedTime = 0;
    gameRef.current.scrollOffset = 0; // Reset scroll for new game
    setSessionTimeRemaining(sessionTimeLimit * 60);
    
    // Zoom-in animation
    setGameScale(0.7);
    setTimeout(() => setGameScale(1.0), 800);
    setShowStopButton(true);

    // Start ESP32 Stream recording if connected
    if (connected) {
      serialManager.startRecording({
        participant,
        sex,
        age,
        weight_kg: weightKg,
        height_cm: heightCm,
        exercise,
        trial_no: trialNo,
      });
    }

    // Begin countdown rest
    beginRestPhase(false);
  };

  const beginRestPhase = (tooEarly: boolean) => {
    changePhase("resting");
    gameRef.current.restTimer = 2.0;
    gameRef.current.relaxTimeHeld = 0;
    gameRef.current.earlyFlexHeld = 0;
    gameRef.current.restTooEarly = tooEarly;
  };

  const handleResetToSetup = () => {
    if (serialManager.getIsRecording()) {
      serialManager.stopRecording(false);
    }
    setCalibrated(false);
    setShowStopButton(false);
    setGameScale(1.0);
    changePhase("setup");
  };

  const handleStopGame = () => {
    // Stop game immediately and show results
    gameRef.current.sessionEndTime = Date.now();
    setShowStopButton(false);
    changePhase("results");

    // Stop serialManager recording
    if (serialManager.getIsRecording()) {
      const dataset = serialManager.stopRecording(true);
      if (dataset) {
        addDataset(dataset);
      }
    }
  };

  // --- CSV / JSON Data Exporters ---

  const handleExportJSON = () => {
    const totalAttemptsCount = gameRef.current.hurdleLog.reduce(
      (s, h) => s + (h ? h.attempts.length : 0),
      0,
    );
    const totalTimeSec = (Date.now() - gameRef.current.sessionStartTime) / 1000;

    const data = {
      schema_version: "2.0",
      sessionId: `MH_${Date.now()}`,
      timestamp: new Date().toISOString(),
      participant: {
        id: participant,
        sex,
        age,
        weight_kg: weightKg,
        height_cm: heightCm,
      },
      protocol: {
        exercise,
        trial_no: trialNo,
        numHurdles: gameRef.current.numHurdles,
        attemptTimeLimit_s: gameRef.current.attemptTimeLimit,
        sessionTimeLimit_min: gameRef.current.sessionTimeLimit,
        threshold_mV: threshold,
        baseline_mV: baseline,
      },
      summary: {
        completedHurdles: gameRef.current.currentHurdle,
        totalHurdles: gameRef.current.numHurdles,
        completionPercentage: Math.round((gameRef.current.currentHurdle / gameRef.current.numHurdles) * 100),
        totalAttempts: totalAttemptsCount,
        totalTime_s: Math.round(totalTimeSec * 100) / 100,
        efficiency_pct:
          Math.round((gameRef.current.currentHurdle / Math.max(totalAttemptsCount, 1)) * 100 * 100) / 100,
      },
      hurdles: gameRef.current.hurdleLog
        .map((h, i) => {
          if (!h) return null;
          return {
            hurdle: i + 1,
            totalAttempts: h.attempts.length,
            completedAt_ms: h.completedAt,
            attempts: h.attempts.map((a, idx) => ({
              attempt_no: idx + 1,
              outcome: a.outcome,
              startTime_ms: a.startTime_ms,
              endTime_ms: a.endTime_ms,
              duration_ms: a.duration_ms,
              peakEMG_mV: a.peakEMG_mV,
              meanEMG_mV: a.meanEMG_mV,
              timeToThreshold_ms: a.timeToThreshold_ms,
              channel: a.channel,
              threshold_mV: a.threshold_mV,
              baseline_mV: a.baseline_mV,
              emg_trace_hz: a.emg_trace_hz,
              emg_trace_mV: a.emg_trace_mV,
            })),
          };
        })
        .filter(Boolean),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${participant}_trial${trialNo}_${exercise}_protocol.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAttemptsCSV = () => {
    const header = [
      "participant",
      "sex",
      "age",
      "weight_kg",
      "height_cm",
      "exercise",
      "trial_no",
      "hurdle",
      "attempt_no",
      "outcome",
      "peak_emg_mV",
      "mean_emg_mV",
      "time_to_threshold_ms",
      "duration_ms",
      "channel",
      "threshold_mV",
      "baseline_mV",
    ];
    const rows = [header.join(",")];

    gameRef.current.hurdleLog.forEach((h, hi) => {
      if (!h) return;
      h.attempts.forEach((a, ai) => {
        rows.push(
          [
            participant,
            sex,
            age,
            weightKg,
            heightCm,
            exercise,
            trialNo,
            hi + 1,
            ai + 1,
            a.outcome,
            a.peakEMG_mV,
            a.meanEMG_mV,
            a.timeToThreshold_ms != null ? a.timeToThreshold_ms : "",
            a.duration_ms,
            a.channel,
            a.threshold_mV,
            a.baseline_mV,
          ].join(","),
        );
      });
    });

    if (rows.length <= 1) return;
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${participant}_trial${trialNo}_${exercise}_attempts.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportEMGCSV = (filtered: boolean) => {
    // Generate CSV from live recorded samples stored in serialManager
    const rawDataset = serialManager.stopRecording(false);
    if (!rawDataset || !rawDataset.samples.length) {
      alert("No physical EMG serial samples were recorded in this trial.");
      return;
    }

    const ds = filtered ? preprocessDataset(rawDataset) : rawDataset;
    const header = "t,ch1,ch2,ch3,ch4\n";
    const rows = ds.samples
      .map((s) =>
        [
          s.t.toFixed(4),
          s.ch1.toFixed(3),
          s.ch2.toFixed(3),
          s.ch3.toFixed(3),
          s.ch4.toFixed(3),
        ].join(","),
      )
      .join("\n");

    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${participant}_trial${trialNo}_${exercise}_emg_${filtered ? "filtered" : "raw"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Alignment Calculation
  const getAlignmentStats = () => {
    const rawDataset = serialManager.stopRecording(false);
    if (!rawDataset || !rawDataset.samples.length) return null;

    const active = gameRef.current.activeChannels;
    const totalFrames = rawDataset.samples.length;

    // Count frames where active channels have valid numbers
    const chKeys = active.map((c) => `ch${c}` as keyof EmgSample);
    let alignedFrames = 0;

    rawDataset.samples.forEach((s) => {
      const allValid = chKeys.every((k) => !isNaN(s[k] as number));
      if (allValid) alignedFrames++;
    });

    const alignedPct = Math.round((alignedFrames / Math.max(1, totalFrames)) * 100);
    const durationS = totalFrames / rawDataset.sampleRate;

    return {
      alignedPct,
      totalFrames,
      alignedFrames,
      durationS,
      active,
    };
  };

  // Setup options mapping labels
  const selectedChannelText = activeChannels.map((c) => (c === 0 ? "AUTO" : `CH${c}`)).join("+");
  const channelDisplayLabels = LEG_MUSCLES;

  return (
    <div className="relative min-h-full flex flex-col bg-background text-foreground rounded-lg overflow-hidden border border-border">
      {/* 60 FPS Game Runner Screen */}
      <div className="relative w-full h-[220px] shrink-0 border-b border-border select-none flex items-center justify-center overflow-hidden">
        <div style={{
          transform: `scale(${gameScale})`,
          transformOrigin: 'center',
          width: '100%',
          height: '100%',
          transition: 'transform 0.8s ease-out'
        }}>
          <canvas ref={gameCanvasRef} className="w-full h-full block" />
        </div>

        {/* Back navigation & sync pill */}
        {onBackToDashboard && (
          <button
            onClick={onBackToDashboard}
            className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 bg-background/50 hover:bg-background/80 border border-border rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors z-20"
          >
            <ArrowLeft className="size-3" /> Dashboard
          </button>
        )}

        <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 bg-background/40 border border-border rounded-sm text-[9px] font-mono tracking-wider z-20">
          <span
            className={`size-1.5 rounded-full ${connected ? "bg-primary animate-pulse" : "bg-destructive"}`}
          />
          <span>{connected ? "EMG LINKED" : "OFFLINE"}</span>
        </div>

        {/* Stop button during gameplay */}
        {showStopButton && phase !== "setup" && phase !== "calibrating" && phase !== "results" && (
          <button
            onClick={handleStopGame}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-destructive/20 hover:bg-destructive/40 border border-destructive/50 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors z-20 text-destructive"
          >
            <Square className="size-3" /> Stop
          </button>
        )}
      </div>

      {/* Screen flash on hit/success */}
      {screenFlash && (
        <div
          className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300 ${
            screenFlash === "green" ? "bg-primary/10" : "bg-destructive/15"
          }`}
        />
      )}

      {/* ==================== SCREEN SWITCHES ==================== */}

      {/* 1. SETUP PANEL SCREEN */}
      {phase === "setup" && (
        <div className="flex-1 p-3 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Form settings card */}
            <div className="md:col-span-7 flex flex-col gap-3">
              <div className="panel flex flex-col p-3">
                <header className="text-glow-green text-primary font-bold text-xs uppercase tracking-widest border-b border-border/60 pb-2 mb-3">
                  MyoHurdle Protocol Settings
                </header>

                <div className="grid grid-cols-1 gap-3">
                  {/* Name field */}
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                      Participant ID
                    </label>
                    <input
                      type="text"
                      value={participant}
                      onChange={(e) => {
                        setParticipant(e.target.value);
                        saveCache({
                          participant: e.target.value,
                          sex,
                          age,
                          weight_kg: weightKg,
                          height_cm: heightCm,
                          exercise,
                          trial_no: trialNo,
                          targetLimb,
                        });
                      }}
                      className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                    />
                  </div>

                  {/* Sex / Age */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Sex
                      </label>
                      <select
                        value={sex}
                        onChange={(e) => {
                          setSex(e.target.value);
                          saveCache({
                            participant,
                            sex: e.target.value,
                            age,
                            weight_kg: weightKg,
                            height_cm: heightCm,
                            exercise,
                            trial_no: trialNo,
                            targetLimb,
                          });
                        }}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Age (years)
                      </label>
                      <input
                        type="number"
                        value={age}
                        onChange={(e) => {
                          setAge(parseInt(e.target.value) || 0);
                          saveCache({
                            participant,
                            sex,
                            age: parseInt(e.target.value) || 0,
                            weight_kg: weightKg,
                            height_cm: heightCm,
                            exercise,
                            trial_no: trialNo,
                            targetLimb,
                          });
                        }}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      />
                    </div>
                  </div>

                  {/* Weight / Height */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Weight (kg)
                      </label>
                      <input
                        type="number"
                        value={weightKg}
                        onChange={(e) => {
                          setWeightKg(parseFloat(e.target.value) || 0);
                          saveCache({
                            participant,
                            sex,
                            age,
                            weight_kg: parseFloat(e.target.value) || 0,
                            height_cm: heightCm,
                            exercise,
                            trial_no: trialNo,
                            targetLimb,
                          });
                        }}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Height (cm)
                      </label>
                      <input
                        type="number"
                        value={heightCm}
                        onChange={(e) => {
                          setHeightCm(parseFloat(e.target.value) || 0);
                          saveCache({
                            participant,
                            sex,
                            age,
                            weight_kg: weightKg,
                            height_cm: parseFloat(e.target.value) || 0,
                            exercise,
                            trial_no: trialNo,
                            targetLimb,
                          });
                        }}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      />
                    </div>
                  </div>

                  {/* Target limb / exercises */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1 col-span-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Target Limb
                      </label>
                      <select
                        value={targetLimb}
                        onChange={(e) => {
                          setTargetLimb(e.target.value);
                          saveCache({
                            participant,
                            sex,
                            age,
                            weight_kg: weightKg,
                            height_cm: heightCm,
                            exercise,
                            trial_no: trialNo,
                            targetLimb: e.target.value,
                          });
                        }}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      >
                        <option value="leg">🦵 Leg Muscles</option>
                        <option value="arm">💪 Arm Muscles</option>
                        <option value="weightlifting">🏋️ Weightlifting</option>
                      </select>
                    </div>
                    <div className="space-y-1 col-span-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Exercise
                      </label>
                      <div className="flex gap-1.5">
                        <select
                          value={exercise}
                          onChange={(e) => {
                            setExercise(e.target.value);
                            saveCache({
                              participant,
                              sex,
                              age,
                              weight_kg: weightKg,
                              height_cm: heightCm,
                              exercise: e.target.value,
                              trial_no: trialNo,
                              targetLimb,
                            });
                          }}
                          className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                        >
                          {exerciseList.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="icon"
                          variant="secondary"
                          onClick={() => {
                            const name = prompt("Enter name of custom exercise:");
                            if (name && name.trim()) {
                              const val = name
                                .trim()
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, "_");
                              const updatedList = [
                                ...exerciseList,
                                { value: val, label: name.trim() },
                              ];
                              setExerciseList(updatedList);
                              setExercise(val);
                            }
                          }}
                          className="shrink-0 size-8 border border-border"
                          title="Add Custom Exercise"
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1 col-span-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Trial No.
                      </label>
                      <select
                        value={trialNo}
                        onChange={(e) => {
                          setTrialNo(parseInt(e.target.value));
                          saveCache({
                            participant,
                            sex,
                            age,
                            weight_kg: weightKg,
                            height_cm: heightCm,
                            exercise,
                            trial_no: parseInt(e.target.value),
                            targetLimb,
                          });
                        }}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Hurdles count slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-muted-foreground">
                      <label>Number of Hurdles</label>
                      <span className="text-primary font-bold">{numHurdles}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={numHurdles}
                      onChange={(e) => setNumHurdles(parseInt(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>

                  {/* Attempt Time Limit slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-muted-foreground">
                      <label>Attempt Time Limit</label>
                      <span className="text-primary font-bold">{attemptTimeLimit} s</span>
                    </div>
                    <input
                      type="range"
                      min={3}
                      max={15}
                      value={attemptTimeLimit}
                      onChange={(e) => setAttemptTimeLimit(parseInt(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>

                  {/* Session Time Limit slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px] uppercase tracking-widest text-muted-foreground">
                      <label>Session Time Limit</label>
                      <span className="text-primary font-bold">{sessionTimeLimit} min</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={sessionTimeLimit}
                      onChange={(e) => setSessionTimeLimit(parseInt(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>

                  {/* Channels Selection Picker */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                      Control Channels
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setActiveChannels([0])}
                        className={`px-2.5 py-1.5 text-[10px] font-mono tracking-wider border rounded-sm transition-all ${
                          activeChannels.includes(0)
                            ? "bg-primary/20 border-primary text-primary"
                            : "bg-muted/60 border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        🤖 Auto (Highest RMS)
                      </button>
                      {[1, 2, 3, 4].map((chId) => {
                        const label = CHANNEL_LABELS[`ch${chId}` as Channel] || `CH${chId}`;
                        const isActive = activeChannels.includes(chId);
                        return (
                          <button
                            key={chId}
                            onClick={() => {
                              let next: number[] = [];
                              if (activeChannels.includes(0)) {
                                next = [chId];
                              } else {
                                const idx = activeChannels.indexOf(chId);
                                if (idx !== -1) {
                                  // Don't empty entirely
                                  if (activeChannels.length > 1) {
                                    next = activeChannels.filter((c) => c !== chId);
                                  } else {
                                    next = activeChannels;
                                  }
                                } else {
                                  next = [...activeChannels, chId].sort();
                                }
                              }
                              setActiveChannels(next);
                            }}
                            className={`px-2.5 py-1.5 text-[10px] font-mono tracking-wider border rounded-sm transition-all ${
                              isActive
                                ? "bg-primary/20 border-primary text-primary"
                                : "bg-muted/60 border-border text-muted-foreground hover:border-primary/40"
                            }`}
                          >
                            CH{chId} · {label.split(" (")[0]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Multi-muscle select mode */}
                  {activeChannels.length > 1 && (
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                        Multi-Muscle Control Mode
                      </label>
                      <select
                        value={combMode}
                        onChange={(e) => setCombMode(e.target.value as any)}
                        className="w-full bg-muted border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
                      >
                        <option value="avg">Average RMS (Smooth combined effort)</option>
                        <option value="max">Max RMS (Any muscle above threshold)</option>
                        <option value="min">
                          Min RMS (All muscles above threshold simultaneously)
                        </option>
                      </select>
                    </div>
                  )}

                  {/* Live RMS Meter Preview */}
                  <div className="bg-muted/50 border border-border/80 rounded-sm p-2.5 flex items-center justify-between text-xs tracking-wider">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">
                      Live Signal Preview:
                    </span>
                    <span className="font-mono text-primary font-bold">
                      {liveCombinedRms} mV{" "}
                      <span className="text-[9px] text-muted-foreground">
                        [{selectedChannelText}]
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Step 2: Calibration settings card */}
              <div className="panel p-3 flex flex-col gap-3">
                <header className="text-glow-green text-primary font-bold text-xs uppercase tracking-widest border-b border-border/60 pb-2 mb-2">
                  Calibration Target Threshold
                </header>

                <div className="text-[11px] leading-relaxed text-muted-foreground mb-1">
                  Flex your target muscle(s) at your desired contraction level to set threshold
                  limit. Baseline represents resting levels.
                </div>

                {calibrated ? (
                  <div className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/30 text-primary rounded-sm text-xs font-bold uppercase tracking-wider">
                    <CheckCircle className="size-4 shrink-0" />
                    <span>
                      Target Strength Active:{" "}
                      <span className="font-mono text-glow-green">{threshold} mV</span> (Baseline:{" "}
                      {baseline} mV)
                    </span>
                  </div>
                ) : (
                  <div className="text-[10px] font-mono uppercase text-glow-amber text-orange-400 bg-orange-400/5 border border-orange-400/25 p-2 rounded-sm mb-1">
                    ⚠ Calibration Pending — flex target set to 30 mV default.
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    className="flex-1 uppercase font-bold tracking-wider text-xs border border-primary/50 text-glow-green"
                    onClick={runCalibration}
                    disabled={!connected}
                  >
                    📡 Start Calibration (6.5s)
                  </Button>
                  <Button
                    variant="secondary"
                    className="uppercase font-bold tracking-wider text-xs border border-border"
                    onClick={skipCalibration}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Column: Electrode placement and targeted instructions */}
            <div className="md:col-span-5 flex flex-col gap-3">
              <div className="panel p-3 flex flex-col">
                <header className="flex items-center justify-between border-b border-border/60 pb-2 mb-3">
                  <span className="text-glow-cyan text-[var(--neon-cyan)] font-bold text-xs uppercase tracking-widest">
                    Electrode Guide
                  </span>
                  <button
                    onClick={() => setAnatomyZoom((z) => (z === 1.0 ? 1.6 : 1.0))}
                    className="flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-sm hover:border-primary/50 text-[9px] font-bold uppercase tracking-wider"
                  >
                    {anatomyZoom === 1.0 ? (
                      <ZoomIn className="size-3" />
                    ) : (
                      <ZoomOut className="size-3" />
                    )}{" "}
                    Zoom
                  </button>
                </header>

                <div className="flex justify-center items-center py-4 bg-black/40 border border-border rounded-sm relative mb-4 overflow-hidden" style={{minHeight: '400px'}}>
                  <canvas ref={anatomyCanvasRef} className="w-[220px] h-[320px] block" />
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-sm p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  <h4 className="text-glow-green text-primary font-bold text-xs uppercase tracking-wider mb-2">
                    Muscle Target Placement
                  </h4>
                  <div className="space-y-3 whitespace-pre-line">
                    {(targetLimb === "arm" || targetLimb === "weightlifting"
                      ? ARM_MUSCLES
                      : LEG_MUSCLES
                    )
                      .filter((m) => activeChannels.includes(0) || activeChannels.includes(m.ch))
                      .map((m) => `• CH${m.ch} - ${m.name}:\n${m.desc}`)
                      .join("\n\n") ||
                      "Select a muscle channel in settings to display electrode instructions."}
                  </div>
                  {activeChannels.length > 1 && (
                    <div className="mt-3 border-t border-border/40 pt-2 text-[var(--neon-amber)] text-glow-amber font-semibold">
                      ⚠ Multi-Muscle Mode constraint:{" "}
                      {combMode === "min"
                        ? "All selected muscles must flex above threshold simultaneously to trigger hurdle jump."
                        : combMode === "max"
                          ? "Any of the selected muscles flexing above threshold will trigger jump."
                          : "Average activation level across muscles must cross threshold to jump."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Launch button */}
            <div className="col-span-12 mt-3 px-3">
              <Button
                onClick={beginProtocol}
                disabled={!calibrated}
                className="w-full py-6 uppercase font-bold tracking-widest text-sm bg-gradient-to-r from-primary to-[#006eff] text-black shadow-lg shadow-primary/20 rounded-sm disabled:opacity-40 hover:scale-[1.01] transition-all"
              >
                Begin Game Protocol →
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CALIBRATION OVERLAY SCREEN */}
      {phase === "calibrating" && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background/95">
          <div className="panel max-w-sm w-full p-6 text-center flex flex-col gap-4 border-primary">
            <header className="border-b border-border pb-3">
              <h2 className="text-glow-green text-primary font-bold text-base uppercase tracking-widest">
                System Calibration
              </h2>
              <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase mt-1 block">
                {calibPhase === "relax" ? "PHASE 1 / 2 — BASELINE" : "PHASE 2 / 2 — TARGET FLEX"}
              </span>
            </header>

            <div className="font-mono text-5xl font-black text-primary text-glow-green my-2 select-none animate-pulse">
              {calibPhase === "relax"
                ? `${Math.max(0, Math.ceil(3.0 - calibElapsed))} s`
                : `${Math.max(0, Math.ceil(3.5 - calibElapsed))} s`}
            </div>

            <div className="text-xs leading-relaxed font-bold tracking-wide text-foreground min-h-[36px]">
              {calibPhase === "relax"
                ? "🧘 Relax targeted muscles completely..."
                : "💪 Flex your target muscles at DESIRED effort level!"}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
                <span>RMS Level</span>
                <span className="text-primary font-bold">{calibRms} mV</span>
              </div>
              <div className="h-2 bg-muted border border-border/80 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-75"
                  style={{ width: `${Math.min((calibRms / 200) * 100, 100)}%` }}
                />
              </div>
            </div>

            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider pt-2 border-t border-border/40 mt-1">
              {calibPhase === "relax"
                ? "Analyzing resting baseline noise floor..."
                : "Capturing target active amplitude limits..."}
            </div>

            <button
              onClick={skipCalibration}
              className="mt-2 text-[10px] font-mono uppercase text-muted-foreground/60 hover:text-primary transition-colors cursor-pointer"
            >
              Skip & Use Defaults
            </button>
          </div>
        </div>
      )}

      {/* 3. REST COUNTDOWN / READY OVERLAYS */}
      {(phase === "resting" || phase === "ready") && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background/95">
          <div className="text-center select-none">
            <div
              className="font-mono text-8xl font-black tracking-tight leading-none text-glow-cyan"
              style={{ color: cdSubColor }}
            >
              {cdBigText}
            </div>
            <div
              className="font-mono text-xs font-black tracking-[0.25em] uppercase mt-4 transition-all duration-200"
              style={{ color: cdSubColor }}
            >
              {cdSubText}
            </div>
          </div>
        </div>
      )}

      {/* 4. AT-HURDLE INTERACTIVE FLEX BAR */}
      {phase === "at_hurdle" && (
        <div className="flex-1 p-3 flex flex-col items-center justify-center bg-background/95">
          <div className="panel max-w-lg w-full p-4 flex flex-col gap-4 border-primary">
            {/* Header row */}
            <div className="flex justify-between items-center border-b border-border pb-2.5">
              <div>
                <h3 className="font-mono text-xs font-bold tracking-widest text-foreground/90">
                  HURDLE {currentHurdle + 1} / {numHurdles}
                </h3>
                <div className="font-mono text-[9px] text-muted-foreground mt-1">
                  Time: {Math.max(0, sessionTimeRemaining).toFixed(1)}s / {sessionTimeLimit * 60}s
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-orange-400 bg-orange-400/10 border border-orange-400/25 px-2.5 py-0.5 rounded-full uppercase tracking-widest">
                  Attempt {totalAttempts}
                </span>

                {/* Large countdown timer display */}
                <div className="font-mono font-bold text-2xl text-primary text-glow-green ml-auto">
                  {countdownDisplay}s
                </div>

                {/* Micro SVG ring timer */}
                <div className="relative size-7 flex items-center justify-center">
                  <svg className="size-full" viewBox="0 0 32 32">
                    <circle
                      cx="16"
                      cy="16"
                      r="13"
                      fill="none"
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="3"
                    />
                    <circle
                      cx="16"
                      cy="16"
                      r="13"
                      fill="none"
                      stroke="#00e5c8"
                      strokeWidth="3"
                      strokeDasharray="81.6"
                      // Countdown mapping
                      strokeDashoffset={
                        81.6 *
                        (1.0 -
                          Math.min(
                            1.0,
                            (attemptTimeLimit -
                              (Date.now() - gameRef.current.currentAttemptStart) / 1000) /
                              attemptTimeLimit,
                          ))
                      }
                      strokeLinecap="round"
                      transform="rotate(-90 16 16)"
                      className="transition-all duration-100"
                    />
                  </svg>
                  <span className="absolute font-mono text-[8px] font-bold text-primary">
                    {Math.max(
                      0,
                      attemptTimeLimit - (Date.now() - gameRef.current.currentAttemptStart) / 1000,
                    ).toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            {/* EMG Power bar indicator */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
                <span>Rest</span>
                <span className="text-primary text-glow-green">Target Flex ({threshold} mV)</span>
              </div>

              <div className="h-10 bg-muted border border-border/80 rounded-sm relative overflow-hidden flex items-center">
                {/* Contraction level fill bar */}
                <div
                  className={`h-full transition-all duration-75 ${
                    liveCombinedRms >= threshold
                      ? "bg-gradient-to-r from-emerald-500 to-primary glow-green"
                      : liveCombinedRms >= threshold * 0.75
                        ? "bg-gradient-to-r from-orange-500 to-amber-400"
                        : "bg-gradient-to-r from-blue-600 to-[#00b0ff]"
                  }`}
                  style={{ width: `${Math.min((liveCombinedRms / 300) * 100, 100)}%` }}
                />

                {/* Target line indicator */}
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-slate-100 z-10 shadow-[0_0_8px_white]"
                  style={{ left: `${Math.min((threshold / 300) * 100, 96)}%` }}
                />
              </div>

              <div className="font-mono text-3xl font-bold tracking-tight text-glow-green text-primary text-center">
                {liveCombinedRms} <span className="text-[11px] text-muted-foreground">mV</span>
              </div>

              <div
                className={`text-[9px] font-mono tracking-widest uppercase text-center ${
                  liveCombinedRms >= threshold
                    ? "text-primary text-glow-green"
                    : liveCombinedRms >= threshold * 0.75
                      ? "text-orange-400 active text-glow-amber animate-pulse"
                      : "text-muted-foreground"
                }`}
              >
                {liveCombinedRms >= threshold
                  ? "HOLD TARGET VALUE! JUMPING!"
                  : liveCombinedRms >= threshold * 0.75
                    ? "ALMOST THERE - FLEX HARDER!"
                    : "FLEX YOUR MUSCLE TO CLEAR HURDLE"}
              </div>
            </div>

            {/* Waves Canvas Scope section */}
            <div className="bg-muted/70 border border-border/60 p-2 rounded-sm relative">
              <canvas ref={waveCanvasRef} className="w-full h-[60px] block" />
              <span className="absolute bottom-1 right-2 font-mono text-[7px] text-muted-foreground/30 tracking-widest uppercase">
                Live EMG Scope
              </span>
            </div>

            {/* Stats list footer */}
            <div className="grid grid-cols-4 gap-1.5 text-center font-mono mt-1">
              <div className="bg-muted/50 border border-border/40 p-1.5 rounded-sm">
                <span className="block text-[15px] font-bold text-foreground/90">
                  {Math.round(gameRef.current.currentPeakEMG)} mV
                </span>
                <span className="block text-[7px] text-muted-foreground tracking-widest uppercase mt-0.5">
                  Peak flex
                </span>
              </div>
              <div className="bg-muted/50 border border-border/40 p-1.5 rounded-sm">
                <span className="block text-[15px] font-bold text-primary">
                  {Math.round(threshold)} mV
                </span>
                <span className="block text-[7px] text-muted-foreground tracking-widest uppercase mt-0.5">
                  Target
                </span>
              </div>
              <div className="bg-muted/50 border border-border/40 p-1.5 rounded-sm">
                <span className="block text-[15px] font-bold text-orange-400">{totalAttempts}</span>
                <span className="block text-[7px] text-muted-foreground tracking-widest uppercase mt-0.5">
                  Attempts
                </span>
              </div>
              <div className="bg-muted/50 border border-border/40 p-1.5 rounded-sm">
                <span className="block text-[15px] font-bold text-foreground/80">
                  {gameRef.current.liveChLabel}
                </span>
                <span className="block text-[7px] text-muted-foreground tracking-widest uppercase mt-0.5">
                  Muscle
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. PROTOCOL RESULTS SUMMARY BOARD */}
      {phase === "results" && (
        <div className="flex-1 p-3 overflow-auto">
          <div className="panel p-4 flex flex-col gap-4 max-w-3xl mx-auto border-primary">
            <header className="border-b border-border pb-2.5">
              <h2 className="text-glow-green text-primary font-bold text-sm uppercase tracking-widest">
                🎮 Game Session Complete!
              </h2>
              <span className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase mt-1 block">
                Session Finished · {participant}_trial{trialNo}_{exercise}
              </span>
            </header>

            {/* BIG SCORE CARD */}
            <div className="bg-gradient-to-br from-primary/20 to-primary/5 border-2 border-primary rounded-md p-6 text-center">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                  Your Final Score
                </h3>
                <div className="font-mono space-y-1">
                  <div className="text-3xl font-black text-primary text-glow-green">
                    {gameRef.current.currentHurdle} / {numHurdles}
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    Hurdles Completed
                  </div>
                  <div className="text-4xl font-black text-glow-green text-primary mt-2">
                    {Math.round((gameRef.current.currentHurdle / numHurdles) * 100)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Quick stats cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-primary text-glow-green">
                  {gameRef.current.currentHurdle}
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Completed
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-foreground/90">
                  {numHurdles}
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Total Hurdles
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-foreground/90">
                  {gameRef.current.hurdleLog.reduce((s, h) => s + (h ? h.attempts.length : 0), 0)}
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Total Attempts
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-[var(--neon-cyan)] text-glow-cyan">
                  {(((gameRef.current.sessionEndTime || Date.now()) - gameRef.current.sessionStartTime) / 1000).toFixed(1)}s
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Session Duration
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-orange-400 text-glow-amber">
                  {(
                    (numHurdles /
                      Math.max(
                        1,
                        gameRef.current.hurdleLog.reduce(
                          (s, h) => s + (h ? h.attempts.length : 0),
                          0,
                        ),
                      )) *
                    100
                  ).toFixed(1)}
                  %
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Clear Efficiency
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono mt-[-8px]">
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-foreground/90">
                  {Math.round(
                    gameRef.current.hurdleLog.reduce((s, h) => {
                      if (!h) return s;
                      const succ = h.attempts.find((a) => a.outcome === "success");
                      return s + (succ ? succ.peakEMG_mV : 0);
                    }, 0) / numHurdles,
                  )}{" "}
                  mV
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Avg Peak EMG
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-primary">
                  {Math.round(threshold)} mV
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Target Limit
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-foreground/80">{participant}</span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Participant
                </span>
              </div>
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-foreground/80">
                  {exercise.replace("_", " ")}
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Exercise
                </span>
              </div>
            </div>

            {/* Hurdle alignment log table */}
            <div className="overflow-x-auto border border-border/60 rounded-sm">
              <table className="w-full font-mono text-[11px] tabular-nums text-left border-collapse">
                <thead className="bg-muted/80 text-[8px] tracking-widest text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="p-2">Hurdle #</th>
                    <th className="p-2 text-right">Attempts</th>
                    <th className="p-2 text-right">Completed</th>
                    <th className="p-2 text-right">Peak EMG</th>
                    <th className="p-2 text-right">Target</th>
                    <th className="p-2 text-right">Latency (ms)</th>
                    <th className="p-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {gameRef.current.hurdleLog.map((h, i) => {
                    if (!h) return null;
                    const success = h.attempts.find((a) => a.outcome === "success");
                    const clearedTime = h.completedAt
                      ? `${(h.completedAt / 1000).toFixed(1)}s`
                      : "—";
                    const count = h.attempts.length;
                    return (
                      <tr key={i} className="border-b border-border/40 hover:bg-slate-800/20">
                        <td className="p-2 font-bold text-foreground/80">Hurdle {i + 1}</td>
                        <td className="p-2 text-right">{count}</td>
                        <td className="p-2 text-right text-muted-foreground">{clearedTime}</td>
                        <td className="p-2 text-right text-primary">
                          {success ? `${Math.round(success.peakEMG_mV)} mV` : "—"}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">
                          {Math.round(threshold)} mV
                        </td>
                        <td className="p-2 text-right text-[var(--neon-cyan)]">
                          {success && success.timeToThreshold_ms != null
                            ? Math.round(success.timeToThreshold_ms)
                            : "—"}
                        </td>
                        <td
                          className={`p-2 text-right font-bold ${count === 1 ? "text-emerald-400" : count > 3 ? "text-orange-400" : "text-amber-300"}`}
                        >
                          {count === 1 ? "✓ 1st Try" : `${count} tries`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Actions grid layout */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border mt-1">
              <Button
                onClick={handleExportJSON}
                className="flex-1 uppercase font-bold tracking-wider text-[10px] size-8 border border-border"
              >
                <Download className="size-3 mr-1" /> Session JSON
              </Button>
              <Button
                onClick={handleExportAttemptsCSV}
                className="flex-1 uppercase font-bold tracking-wider text-[10px] size-8 border border-border"
              >
                <Download className="size-3 mr-1" /> Attempts CSV
              </Button>

              {connected && (
                <>
                  <Button
                    onClick={() => handleExportEMGCSV(true)}
                    className="flex-1 uppercase font-bold tracking-wider text-[10px] size-8 border border-border"
                  >
                    <Download className="size-3 mr-1" /> EMG Filtered
                  </Button>
                  <Button
                    onClick={() => handleExportEMGCSV(false)}
                    className="flex-1 uppercase font-bold tracking-wider text-[10px] size-8 border border-border"
                  >
                    <Download className="size-3 mr-1" /> EMG Raw
                  </Button>
                  <Button
                    onClick={() => setShowAlignModal(true)}
                    className="uppercase font-bold tracking-wider text-[10px] size-8 border border-border/80 text-[var(--neon-cyan)]"
                  >
                    📊 Alignment %
                  </Button>
                </>
              )}

              <Button
                onClick={handleResetToSetup}
                variant="secondary"
                className="w-full uppercase font-bold tracking-wider text-[10px] size-8 border border-border mt-1"
              >
                Start New Game Session
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --- Alignment Details Modal Overlay --- */}
      {showAlignModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="panel max-w-sm w-full p-5 bg-card text-foreground border-border relative flex flex-col gap-4 font-mono text-xs">
            <header className="flex justify-between items-center border-b border-border/60 pb-2">
              <h3 className="font-bold text-sm text-foreground">📊 Multi-Channel Data Alignment</h3>
              <button
                onClick={() => setShowAlignModal(false)}
                className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none cursor-pointer"
              >
                &times;
              </button>
            </header>

            {(() => {
              const alignedStats = getAlignmentStats();
              if (!alignedStats) {
                return (
                  <div className="text-center p-4 text-muted-foreground">
                    No physical streaming records found.
                  </div>
                );
              }

              const verdict =
                alignedStats.alignedPct >= 95
                  ? "Excellent Sync (Stable)"
                  : alignedStats.alignedPct >= 80
                    ? "Good Sync (Acceptable)"
                    : "Poor / Bad Sync";
              const valColor =
                alignedStats.alignedPct >= 95
                  ? "text-emerald-400"
                  : alignedStats.alignedPct >= 80
                    ? "text-amber-400"
                    : "text-destructive";

              const channelColors = ["#00e5c8", "#ffb300", "#9d4edd", "#ff357a"];

              return (
                <>
                  <div className="text-center space-y-1 py-2">
                    <div className={`text-4xl font-extrabold ${valColor}`}>
                      {alignedStats.alignedPct}%
                    </div>
                    <div className={`text-[10px] font-bold uppercase tracking-wider ${valColor}`}>
                      {verdict}
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      of session frames are fully time-synchronized
                    </div>
                  </div>

                  <div className="bg-muted/60 border border-border/40 rounded-sm p-2.5 text-[10px] space-y-1.5 leading-relaxed text-foreground/80">
                    <div className="flex justify-between">
                      <span>Active Channels:</span>
                      <strong className="text-foreground">
                        {alignedStats.active.map((c) => `CH${c}`).join(", ")}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Samples:</span>
                      <strong className="text-foreground">
                        {alignedStats.totalFrames.toLocaleString()}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Aligned Samples:</span>
                      <strong className="text-foreground">
                        {alignedStats.alignedFrames.toLocaleString()}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration:</span>
                      <strong className="text-foreground">
                        {alignedStats.durationS.toFixed(1)}s
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-2 mt-1">
                    <div className="font-bold text-[10px] uppercase text-foreground/80">
                      Channel Coverage Details:
                    </div>
                    {alignedStats.active.map((chId) => {
                      const pct = alignedStats.alignedPct; // estimate overall
                      const col = channelColors[chId - 1] || "#4d9fff";
                      return (
                        <div key={chId} className="space-y-1">
                          <div className="flex justify-between text-[9px] text-muted-foreground">
                            <span>
                              Channel {chId} ·{" "}
                              {CHANNEL_LABELS[`ch${chId}` as Channel].split(" (")[0]}
                            </span>
                            <span>{pct}% sync</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: col }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            <Button
              onClick={() => setShowAlignModal(false)}
              className="uppercase font-bold tracking-wider text-[10px] size-8 border border-border mt-2"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
