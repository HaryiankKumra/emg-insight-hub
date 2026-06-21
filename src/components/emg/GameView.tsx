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
    gameRef.current.activeChannels = activeChannels;
    gameRef.current.combMode = combMode;
  }, [threshold, baseline, numHurdles, attemptTimeLimit, activeChannels, combMode]);

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
      gameRef.current.approachStartFrac = gameRef.current.charFrac;

      const nextHFrac = (hurdleIndex + 1) / (gameRef.current.numHurdles + 1);
      gameRef.current.approachTargetFrac = Math.max(gameRef.current.charFrac, nextHFrac - 0.018);

      const dist = Math.abs(gameRef.current.approachTargetFrac - gameRef.current.charFrac);
      gameRef.current.approachDur = Math.max(0.6, dist * (gameRef.current.numHurdles + 1) * 1.4);
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
      let t = Math.min(gameRef.current.approachT / gameRef.current.approachDur, 1);
      // Ease in-out
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      gameRef.current.charFrac =
        gameRef.current.approachStartFrac +
        (gameRef.current.approachTargetFrac - gameRef.current.approachStartFrac) * t;

      if (gameRef.current.approachT >= gameRef.current.approachDur) {
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
      const elapsed = (Date.now() - gameRef.current.currentAttemptStart) / 1000;
      const remaining = Math.max(0, gameRef.current.attemptTimeLimit - elapsed);
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

      // Flash & particles
      const canvas = gameCanvasRef.current;
      if (canvas) {
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        const nextHFrac = (hIdx + 1) / (gameRef.current.numHurdles + 1);
        const hx = w * 0.06 + w * (0.94 - 0.06) * nextHFrac;
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

      // Shake & particles
      gameRef.current.shake = { x: 0, y: 0, t: 0.35, mag: 10 };

      const canvas = gameCanvasRef.current;
      if (canvas) {
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        const nextHFrac = (hIdx + 1) / (gameRef.current.numHurdles + 1);
        const hx = w * 0.06 + w * (0.94 - 0.06) * nextHFrac;
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
      gameRef.current.charFrac += 0.7 * dt * (1 / (gameRef.current.numHurdles + 1));

      if (gameRef.current.charY >= 0) {
        gameRef.current.charY = 0;
        gameRef.current.charVy = 0;
        onLanded();
      }
    };

    const updateHit = (dt: number) => {
      gameRef.current.hitTimer -= dt;
      if (gameRef.current.hitTimer <= 0) {
        // Reset player fraction back slightly and enforce rest phase to prevent automatic passing
        const hIdx = gameRef.current.currentHurdle;
        const prevFrac = (hIdx + 1) / (gameRef.current.numHurdles + 1) - 0.15;
        gameRef.current.charFrac = Math.max(0, prevFrac);
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
      changePhase("results");

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

      // Handle Shake
      ctx.save();
      const shake = gameRef.current.shake;
      if (shake.t > 0) {
        shake.t -= dt;
        const mag = shake.mag * (shake.t > 0 ? 1 : 0);
        ctx.translate((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag);
      }

      ctx.clearRect(-20, -20, w + 40, h + 40);

      // 1. Draw Background Gradient
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#090d16");
      bg.addColorStop(0.55, "#0b1220");
      bg.addColorStop(1, "#070b13");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle Grid lines
      ctx.strokeStyle = "rgba(0, 229, 200, 0.02)";
      ctx.lineWidth = 1;
      const grid = 50;
      for (let gx = 0; gx < w; gx += grid) {
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

      // Title watermark
      ctx.font = "bold 9px var(--font-mono)";
      ctx.fillStyle = "rgba(0, 229, 200, 0.05)";
      ctx.textAlign = "right";
      ctx.fillText("MyoHurdle Protocol v2.0", w - 20, h - 18);
      ctx.textAlign = "left";

      // 2. Draw Track
      const ty = h * 0.7;
      const tx = w * 0.06;
      const tr = w * 0.94;

      // Ground fill
      const gGrad = ctx.createLinearGradient(0, ty, 0, h);
      gGrad.addColorStop(0, "rgba(0, 80, 60, 0.2)");
      gGrad.addColorStop(0.4, "rgba(0, 20, 20, 0.1)");
      gGrad.addColorStop(1, "rgba(0, 0, 0, 0.05)");
      ctx.fillStyle = gGrad;
      ctx.fillRect(0, ty, w, h - ty);

      // Glowing track line
      ctx.shadowColor = "rgba(0, 229, 200, 0.4)";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "rgba(0, 229, 200, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tr, ty);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Start/Finish indicators
      ctx.fillStyle = "rgba(0, 229, 200, 0.4)";
      ctx.font = "8px var(--font-mono)";
      ctx.textAlign = "center";
      ctx.fillText("START", tx + 2, ty + 18);
      ctx.fillText("FINISH", tr - 2, ty + 18);

      // 3. Draw Hurdles
      const hH = hurdleVisualH(h);
      const now = Date.now();
      for (let i = 0; i < gameRef.current.numHurdles; i++) {
        const nextHFrac = (i + 1) / (gameRef.current.numHurdles + 1);
        const hx = tx + (tr - tx) * nextHFrac;
        const top = ty - hH;
        const hw = 12;

        let state = "future";
        if (i < gameRef.current.currentHurdle) state = "done";
        else if (i === gameRef.current.currentHurdle) state = "current";

        if (state === "done") {
          ctx.fillStyle = "rgba(0, 201, 122, 0.1)";
          ctx.strokeStyle = "rgba(0, 201, 122, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(hx - hw / 2, top, hw, hH);
          ctx.fill();
          ctx.stroke();

          // Green check mark
          ctx.strokeStyle = "#00c97a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx - 4, ty - hH / 2 + 2);
          ctx.lineTo(hx - 1, ty - hH / 2 + 5);
          ctx.lineTo(hx + 5, ty - hH / 2 - 4);
          ctx.stroke();

          ctx.fillStyle = "rgba(0, 201, 122, 0.5)";
          ctx.font = "8px var(--font-mono)";
          ctx.fillText((i + 1).toString(), hx, ty + 16);
        } else if (state === "current") {
          const pulse = 0.65 + 0.35 * Math.sin(now / 280);
          ctx.shadowColor = `rgba(0, 229, 200, ${0.5 * pulse})`;
          ctx.shadowBlur = 20 * pulse;
          ctx.fillStyle = `rgba(0, 229, 200, ${0.1 * pulse})`;
          ctx.strokeStyle = `rgba(0, 229, 200, ${0.9 * pulse})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(hx - hw / 2, top, hw, hH);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Band subdivisions
          for (let b = 1; b < 4; b++) {
            ctx.strokeStyle = `rgba(0, 229, 200, ${0.12 * pulse})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx - hw / 2, top + (hH * b) / 4);
            ctx.lineTo(hx + hw / 2, top + (hH * b) / 4);
            ctx.stroke();
          }

          // Floating pointer
          ctx.fillStyle = `rgba(0, 229, 200, ${0.7 * pulse})`;
          ctx.font = "8px var(--font-mono)";
          ctx.fillText("▼", hx, top - 8);

          ctx.font = "bold 9px var(--font-mono)";
          ctx.fillStyle = "rgba(0, 229, 200, 0.9)";
          ctx.fillText((i + 1).toString(), hx, ty + 16);
        } else {
          // Future grey hurdle
          ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(hx - hw / 2, top, hw, hH);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
          ctx.font = "8px var(--font-mono)";
          ctx.fillText((i + 1).toString(), hx, ty + 16);
        }
      }

      // 4. Draw character
      gameRef.current.charAnimT += dt;
      const cx = tx + (tr - tx) * gameRef.current.charFrac;
      const cy = ty - 36 + gameRef.current.charY;

      let color = "#00e5c8";
      if (gameRef.current.phase === "jumping") color = "#7fffcf";
      else if (gameRef.current.phase === "hit") color = "#ff7043";

      ctx.save();
      ctx.translate(cx, cy);
      ctx.shadowColor = color;
      ctx.shadowBlur = gameRef.current.phase === "jumping" ? 28 : 10;

      // Handle hit crash rotation
      if (gameRef.current.phase === "hit") {
        const rot = (1.2 - gameRef.current.hitTimer) * (Math.PI * 2);
        ctx.translate(0, -18);
        ctx.rotate(rot);
        ctx.translate(0, 18);
        ctx.globalAlpha = Math.max(0, gameRef.current.hitTimer / 1.2);
      }

      // Skeletal Coordinates
      const hipY = -14;
      const hipXLeft = -2.5;
      const hipXRight = 2.5;
      const torsoLean =
        gameRef.current.phase === "approaching"
          ? 0.22
          : gameRef.current.phase === "jumping"
            ? -0.15
            : 0;
      const shoulderY = -26;
      const shoulderXLeft = -3 + Math.sin(torsoLean) * 12;
      const shoulderXRight = 3 + Math.sin(torsoLean) * 12;

      // Cycle-dependent joints angles
      const cycle = gameRef.current.charAnimT * 15;
      let thighAngle1 = 0.05,
        kneeAngle1 = 0.05,
        thighAngle2 = -0.05,
        kneeAngle2 = 0.05;
      let armAngle1 = 0.1,
        forearmAngle1 = 0.1,
        armAngle2 = -0.1,
        forearmAngle2 = 0.1;

      if (gameRef.current.phase === "approaching") {
        thighAngle1 = Math.sin(cycle) * 0.7 + 0.15;
        thighAngle2 = Math.sin(cycle + Math.PI) * 0.7 + 0.15;
        kneeAngle1 = (Math.cos(cycle + Math.PI / 3) * 0.5 + 0.5) * 1.25 + 0.1;
        kneeAngle2 = (Math.cos(cycle + Math.PI + Math.PI / 3) * 0.5 + 0.5) * 1.25 + 0.1;
        armAngle1 = -Math.sin(cycle) * 0.8;
        forearmAngle1 = (Math.sin(cycle + Math.PI / 2) * 0.35 + 0.65) * 1.3;
        armAngle2 = -Math.sin(cycle + Math.PI) * 0.8;
        forearmAngle2 = (Math.sin(cycle + Math.PI + Math.PI / 2) * 0.35 + 0.65) * 1.3;
      } else if (gameRef.current.phase === "jumping") {
        thighAngle1 = 1.3;
        kneeAngle1 = 0.9;
        thighAngle2 = -0.9;
        kneeAngle2 = 0.3;
        armAngle1 = -1.1;
        forearmAngle1 = 0.5;
        armAngle2 = 1.1;
        forearmAngle2 = 0.5;
      } else if (gameRef.current.phase === "hit") {
        thighAngle1 = 0.9;
        kneeAngle1 = 1.1;
        thighAngle2 = -0.5;
        kneeAngle2 = 1.3;
        armAngle1 = -1.3;
        forearmAngle1 = 0.8;
        armAngle2 = 1.3;
        forearmAngle2 = 0.8;
      }

      // Helper function to draw limbs
      const drawLimbPath = (
        lx1: number,
        ly1: number,
        len1: number,
        len2: number,
        a1: number,
        a2: number,
        col: string,
        thick: number,
      ) => {
        const lx2 = lx1 + Math.sin(a1) * len1;
        const ly2 = ly1 + Math.cos(a1) * len1;
        const lx3 = lx2 + Math.sin(a1 - a2) * len2;
        const ly3 = ly2 + Math.cos(a1 - a2) * len2;
        ctx.strokeStyle = col;
        ctx.lineWidth = thick;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.lineTo(lx3, ly3);
        ctx.stroke();
      };

      // Draw limbs (Back limbs -> Torso -> Front limbs)
      drawLimbPath(shoulderXLeft, shoulderY, 7, 7, armAngle2, -forearmAngle2, color + "aa", 2.2);
      drawLimbPath(hipXLeft, hipY, 9, 9, thighAngle2, kneeAngle2, color + "aa", 3.0);

      // Torso
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, hipY);
      ctx.lineTo(Math.sin(torsoLean) * 12, shoulderY);
      ctx.stroke();

      // Head
      const headX = Math.sin(torsoLean) * 12 + Math.sin(torsoLean) * 4;
      const headY = shoulderY - 7;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(headX, headY, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Front limbs
      drawLimbPath(hipXRight, hipY, 9, 9, thighAngle1, kneeAngle1, color, 3.3);
      drawLimbPath(shoulderXRight, shoulderY, 7, 7, armAngle1, -forearmAngle1, color, 2.5);

      ctx.restore(); // Character coords

      // 5. Draw Particles
      for (let i = gameRef.current.particles.length - 1; i >= 0; i--) {
        const p = gameRef.current.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 350 * dt;
        p.life -= dt;
        if (p.life <= 0) {
          gameRef.current.particles.splice(i, 1);
          continue;
        }
        const a = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;

      ctx.restore(); // Shake
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
    changePhase("setup");
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
        threshold_mV: threshold,
        baseline_mV: baseline,
      },
      summary: {
        totalAttempts: totalAttemptsCount,
        totalTime_s: Math.round(totalTimeSec * 100) / 100,
        efficiency_pct:
          Math.round((numHurdles / Math.max(totalAttemptsCount, 1)) * 100 * 100) / 100,
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
      <div className="relative w-full h-[220px] shrink-0 border-b border-border select-none">
        <canvas ref={gameCanvasRef} className="w-full h-full block" />

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
                      max={30}
                      value={numHurdles}
                      onChange={(e) => setNumHurdles(parseInt(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>

                  {/* Time limit slider */}
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

                <div className="flex justify-center items-center py-4 bg-black/40 border border-border rounded-sm relative mb-4">
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
            <div className="col-span-12 mt-2">
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
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-orange-400 bg-orange-400/10 border border-orange-400/25 px-2.5 py-0.5 rounded-full uppercase tracking-widest">
                  Attempt {totalAttempts}
                </span>

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
                Protocol Session Summary
              </h2>
              <span className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase mt-1 block">
                Session Finished · {participant}_trial{trialNo}_{exercise}
              </span>
            </header>

            {/* Quick stats cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
              <div className="border border-border/60 bg-muted/55 rounded-sm p-3">
                <span className="block text-2xl font-bold text-primary text-glow-green">
                  {numHurdles}
                </span>
                <span className="block text-[8px] text-muted-foreground tracking-widest uppercase mt-1">
                  Hurdles Cleared
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
                  {((Date.now() - gameRef.current.sessionStartTime) / 1000).toFixed(1)}s
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
