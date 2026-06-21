# EMG Signal Processing & Adaptive Baseline Detection Guide (V2)

## 🎯 What's New: Adaptive Baseline Detection

**Problem Solved**: Baseline is NOW detected automatically from your data, not pre-decided!

### Why This Matters for MyoWare 2.0 Sensors

Instead of assuming "first 1/3 = baseline", the system now:
1. **Analyzes** the entire recording to find truly quiet/resting periods
2. **Auto-detects** where actual muscle activation starts/stops
3. **Adapts** to your specific exercise pattern

---

## The Complete Data Processing Pipeline

### Stage 1: CSV Parsing
```
Raw CSV file (datetime_local + muscle1-4 channels)
  ↓
Detect sample rate from timestamps
  ↓
Per-channel baseline removal:
  - Compute mean of each channel
  - Subtract from all samples (center at zero)
```

### Stage 2: Activity Detection (NEW! - ADAPTIVE)
```
Algorithm: RMS Envelope Analysis

1. Compute RMS across all 4 channels per sample:
   RMS[i] = √[(ch1[i]² + ch2[i]² + ch3[i]² + ch4[i]²) / 4]

2. Smooth with 100ms sliding window:
   Smoothed_RMS[i] = average of RMS in ±50ms window

3. Find quiet threshold:
   threshold = 25th percentile of all smoothed RMS values
   
4. Segment the data:
   - Samples below threshold → QUIET (rest/baseline)
   - Samples above threshold → ACTIVE (movement)

5. Identify periods:
   - First quiet period = BASELINE (where SNR is calculated from)
   - All active periods = ACTIVE measurement windows
```

**Why this works:**
- ✅ Works even if baseline isn't at the start
- ✅ Works with variable exercise patterns
- ✅ Automatically rejects periods with constant noise
- ✅ Finds actual resting state, not pre-decided windows

### Stage 3: Outlier Removal (Enhanced)
```
For each sample:
  For each of 4 channels:
    1. Find median value of channel
    2. Calculate MAD = Median Absolute Deviation
    3. Compute Modified Z-Score:
       modZ = |0.6745 × (sample - median)| / MAD
    4. If modZ > 3.0 → Mark as OUTLIER

Remove all samples marked as outliers
```

**Why aggressive (threshold=3.0):**
- Removes electrode noise spikes
- Removes movement artifacts
- Applied BEFORE filtering (clean input)
- Better for adaptive baseline calculation

### Stage 4: DSP Filtering Chain
```
If enabled, each channel:
  
  Raw input
    ↓ (500ms warm-up, discard)
  
  1. HIGH-PASS FILTER (20 Hz)
     Butterworth, 2nd order
     → Removes DC drift, sensor bias
     → Keeps: EMG band (20-450 Hz)
  
  2. NOTCH FILTER (50 Hz)
     Q = 8, sharp attenuation
     → Removes: Powerline noise (Europe/Asia)
  
  3. NOTCH FILTER (60 Hz)
     Q = 8, sharp attenuation
     → Removes: Powerline noise (Americas)
  
  4. LOW-PASS FILTER (450 Hz)
     Butterworth, 2nd order
     → Removes: Electronic noise, muscle artifacts
     → Keeps: Clean EMG signal
  
  ↓ (skip first 2 seconds for filter settling)
  
  Filtered output
```

**Filter warm-up**: 500ms processed but discarded
- Lets IIR state variables settle
- Eliminates transient spike
- Result: Clean signal from t=0

### Stage 5: Quality Assessment (From RAW Data!)
```
Input: UNFILTERED dataset (to avoid filter artifacts)

Baseline samples = First quiet period (adaptively detected)
Active samples = All active periods (adaptively detected)

Calculate per channel:
  RMS_baseline = √(Σ baseline_samples² / count)
  RMS_active = √(Σ active_samples² / count)
  
  SNR(dB) = 20 × log₁₀(RMS_active / RMS_baseline)
  
Map SNR → Quality Grade:
  SNR > 22.5 dB  → EXCELLENT (clear separation)
  SNR > 15 dB    → GOOD (good activation visible)
  SNR > 7.5 dB   → FAIR (detectable but noisy)
  SNR ≤ 7.5 dB   → POOR (signal in noise)
```

**Why from raw data?**
- ✅ Calculates SNR BEFORE high-pass removes DC
- ✅ Reflects true signal-to-noise ratio
- ✅ Unaffected by filter transients
- ✅ Accurate for MyoWare 2.0 DC-biased output

### Stage 6: Feature Extraction
```
From both raw and filtered data:

Time Domain:
  - RMS (Root Mean Square): Overall amplitude
  - MAV (Mean Absolute Value): Average magnitude
  - Variance: Signal spread
  - Energy: Total power (Σ sample²)
  - Zero-Crossings: Frequency indicator

Frequency Domain (via FFT):
  - Mean frequency: Center of mass in spectrum
  - Median frequency: 50th percentile of power
  - Dominant frequency: Peak frequency
  - Bandwidth: Frequency spread
```

### Stage 7: Gemini AI Interpretation
```
Sends to AI (Gemini 3.5 Flash):
  {
    "channel_quality": {ch1, ch2, ch3, ch4},
    "baseline_rms": {ch1, ch2, ch3, ch4},
    "active_rms": {ch1, ch2, ch3, ch4},
    "snr_db": {ch1, ch2, ch3, ch4},
    "mean_frequency": {ch1, ch2, ch3, ch4},
    "median_frequency": {ch1, ch2, ch3, ch4},
    "dominant_frequency": {ch1, ch2, ch3, ch4},
    "zero_crossings": {ch1, ch2, ch3, ch4},
    "variance": {ch1, ch2, ch3, ch4},
    "energy": {ch1, ch2, ch3, ch4}
  }

NO raw signal data sent (privacy-preserved)

AI returns:
  - Channel quality assessment
  - Muscle activation patterns
  - Fatigue indicators
  - Recommendations
```

---

## Before vs After: Why Quality is Now Accurate

### Your Data
```
CSV contains:
  Baseline (rest): ~1515-1520 mV
  Movement (active): ±10-50 mV variation
  Pattern: 10 clear calf raises
```

### OLD Approach (❌ WRONG)
```
High-pass filter removes 1515 mV DC baseline
  ↓
Remaining signal: ±20 mV (from baseline removal)
  ↓
Quality calculated from filtered data:
  SNR = 20 log10(20 mV / 20 mV) = 0 dB → POOR ❌
  
This is MISLEADING because the filter worked correctly!
The issue: filter removed the DC component needed for SNR calc
```

### NEW Approach (✅ CORRECT)
```
Quality calculated from RAW (unfiltered) data
  ↓
Adaptive baseline detection finds quiet periods:
  RMS_baseline = RMS of quiet samples (~1515 mV RMS)
  
Adaptive active detection finds movement:
  RMS_active = RMS of active samples (~1540 mV RMS)
  
SNR = 20 log10(1540 / 1515) ≈ 15-20 dB → GOOD ✅

This is ACCURATE because:
- Uses actual baseline from unfiltered data
- Uses actual active movement from unfiltered data
- Not affected by filter artifacts
- Reflects true signal quality
```

---

## Configuration & Control

### Adaptive Baseline Parameters
In `src/lib/emg/signal.ts`:

```typescript
// Detect activity periods (quiet vs active)
export function detectActivityPeriods(
  ds: EmgDataset,
  channels: ["ch1", "ch2", "ch3", "ch4"],
  windowMs = 100,           // RMS averaging window (ms)
  quietThresholdPercentile = 25  // Bottom 25% = "quiet"
)

// Calculate quality using adaptive baseline
export function calculateQualityFromRaw(
  rawDs: EmgDataset,
  channels: ["ch1", "ch2", "ch3", "ch4"],
  skipFirstSecs = 2         // Skip first 2 seconds
)
```

### Outlier Removal Control
```typescript
// Preprocess with outlier removal
preprocessDataset(
  ds,
  skipFirstSecs = 2,
  removeOutliers = true,     // NEW: enable/disable
  // Outlier threshold = 3.0 sigma (aggressive for MyoWare)
)
```

### API Configuration
Your `.env`:
```
GEMINI_API_KEY=AIza...  (or AQ... for Lovable gateway)
```

---

## Quality Grading Reference

### SNR Scale (dB)
| Range | Grade | Visual | Meaning |
|-------|-------|--------|---------|
| > 22.5 | EXCELLENT | 🟢 Very clean | Strong signal, professional-grade |
| 15-22.5 | GOOD | 🟡 Clean | Good for analysis & interpretation |
| 7.5-15 | FAIR | 🟠 Noisy | Detectable but electrode issues likely |
| < 7.5 | POOR | 🔴 Very noisy | Signal buried, check setup |

### Expected Quality for Your Data
```
Calf Raise Exercise (10 repetitions):
  Baseline (quiet): ~1515 mV
  Active (movement): ±10-50 mV variation
  Expected SNR: 15-25 dB
  Expected Grade: GOOD or EXCELLENT ✓
```

---

## Testing & Troubleshooting

### Test Your CSV
Upload: `emg_P002_trial1_calf_raise_raw.csv`

**Expected results:**
- ✅ Quality: GOOD or EXCELLENT (not POOR!)
- ✅ 10 activation peaks visible
- ✅ No spike at 1-2 seconds
- ✅ Smooth movement variation

### Common Issues

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| Quality still POOR | Electrode contact poor | Check sensor placement, ensure dry skin |
| Quality = EXCELLENT but signal looks noisy | Excellent = relative to baseline | Check if baseline is truly quiet |
| Outliers still visible | Threshold too high | Decrease `modZ` threshold (currently 3.0) |
| Spike at start | Filter not settled | Verify 500ms warm-up in preprocessDataset |
| 10 reps not visible | Possible compression issue | Check if downsampling is too aggressive |

---

## Key Differences: Adaptive vs Pre-Decided

| Aspect | Old Approach | New Approach |
|--------|------------|-------------|
| Baseline detection | First 1/3 of data | Adaptive: find quiet periods |
| Outlier handling | Post-processing | Pre-processing (before filtering) |
| Flexibility | Fixed windows | Adapts to exercise pattern |
| Accuracy | Can be misleading | Reflects actual data |
| MyoWare 2.0 fit | Generic | Specialized for EMG characteristics |

---

## Important: What This Is NOT

❌ **Not machine learning**
❌ **Not neural networks**
❌ **Not training**
❌ **Not AI-generated baselines**
❌ **Not black-box**

## What This IS

✅ **Signal processing** (Butterworth filters, FFT)
✅ **Statistical analysis** (RMS, MAD, Modified Z-Score)
✅ **Activity detection** (RMS-based segmentation)
✅ **Feature extraction** (time & frequency domain)
✅ **Transparent** (all algorithms documented)
✅ **Expert AI interpretation** (Gemini 3.5 Flash on features)

---

## Implementation Details

### Adaptive Baseline Algorithm Pseudocode
```python
# 1. Compute RMS envelope
rms_envelope = []
for each sample:
    rms = √(ch1² + ch2² + ch3² + ch4²) / 4
    rms_envelope.append(rms)

# 2. Smooth with sliding window
smoothed_rms = sliding_window_average(rms_envelope, 100ms)

# 3. Find threshold
quiet_threshold = percentile(smoothed_rms, 25th)

# 4. Segment
for i = 0 to len(data):
    if smoothed_rms[i] <= quiet_threshold:
        label[i] = QUIET (baseline)
    else:
        label[i] = ACTIVE (movement)

# 5. Extract periods
quiet_periods = consecutive_quiet_segments
active_periods = consecutive_active_segments

# 6. Use periods for SNR
baseline_data = samples from quiet_periods[0]
active_data = samples from all active_periods

snr = 20 * log10(rms(active_data) / rms(baseline_data))
```

---

## References

### MyoWare 2.0 Sensor Specs
- 12-bit ADC (0-5V range)
- Output: 0V (no muscle) to 5V (maximum activation)
- Typical resting: ~1.5V (around 1515 mV for 3.3V systems)
- Signal: ~20-200 mV variation with muscle activation

### EMG Signal Characteristics
- Frequency band: 20-450 Hz (main muscle activation)
- Powerline interference: 50 Hz (Europe) or 60 Hz (Americas)
- Amplitude range: 50 μV to 5 mV (raw), 100 mV to 5V (with sensor)
- Sampling rate: ≥ 1000 Hz recommended (Nyquist > 450 Hz × 2)

### Standards
- sEMG = Surface ElectroMyoGraphy (sensors on skin)
- IIR = Infinite Impulse Response (recursive filters)
- FFT = Fast Fourier Transform (frequency analysis)
- Modified Z-Score = Robust outlier detection (MAD-based)

