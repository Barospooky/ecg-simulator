import React, { useState, useEffect, useRef } from 'react';

interface ECGParams {
  heart_rate: number;
  h_p: number;
  b_p: number;
  h_q: number;
  b_q: number;
  h_r: number;
  b_r: number;
  h_s: number;
  b_s: number;
  h_t: number;
  b_t: number;
  l_pq: number;
  l_st: number;
  l_tp: number;
  n_p: number;
}

interface Point {
  x: number;
  y: number;
}

const ECGGraph: React.FC = () => {
  // Refs for DOM elements
  const svgRef = useRef<SVGSVGElement>(null);
  const animationFrameRef = useRef<number>(0);
  
  // State for parameters
  const [params, setParams] = useState<ECGParams>({
    heart_rate: 70,
    h_p: 0.15,
    b_p: 0.08,
    h_q: -0.1,
    b_q: 0.025,
    h_r: 1.2,
    b_r: 0.05,
    h_s: -0.25,
    b_s: 0.025,
    h_t: 0.2,
    b_t: 0.16,
    l_pq: 0.08,
    l_st: 0.12,
    l_tp: 0.3,
    n_p: 1
  });
  
  const [pixelsPerMv, setPixelsPerMv] = useState(100);
  const [rWaveEnabled, setRWaveEnabled] = useState(false);
  const [rWaveCount, setRWaveCount] = useState(2);
  const [rWaveInterval, setRWaveInterval] = useState(5);
  const [pWaveEnabled, setPWaveEnabled] = useState(false);
  const [pWaveCount, setPWaveCount] = useState(0);
  const [pWaveInterval, setPWaveInterval] = useState(3);
  const [useCustomBeatParameters, setUseCustomBeatParameters] = useState(false);
  const [repeatInterval, setRepeatInterval] = useState(10);
  const [customBeats, setCustomBeats] = useState<Partial<ECGParams>[]>([]);

  // Animation state
  const [lastTimestamp, setLastTimestamp] = useState(0);
  const [pointerX, setPointerX] = useState(0);
  const [firstSweep, setFirstSweep] = useState(true);
  const [pathPoints, setPathPoints] = useState<Point[]>([]);
  const [drawnPoints, setDrawnPoints] = useState<(Point | null)[]>([]);
  const [globalCounters, setGlobalCounters] = useState({
    rCycleCounter: 0,
    pCycleCounter: 0,
    beatCounter: 0,
    customIdx: 0,
    waitingNormalBeats: 0
  });

  // Constants
  const PIXELS_PER_SECOND = 150;
  const POINTER_RADIUS = 6;
  const ERASE_WIDTH = 12;

  // Initialize SVG elements
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = svgRef.current;
    
    // Create waveform path
    const waveformPath = document.createElementNS(svg.namespaceURI, "path");
    waveformPath.setAttribute("stroke", "#2c3e50");
    waveformPath.setAttribute("fill", "none");
    waveformPath.setAttribute("stroke-width", "2");
    svg.appendChild(waveformPath);

    // Create pointer head
    const pointerHead = document.createElementNS(svg.namespaceURI, "circle");
    pointerHead.setAttribute("r", POINTER_RADIUS.toString());
    pointerHead.setAttribute("fill", "#fff");
    pointerHead.setAttribute("stroke", "#fff");
    pointerHead.setAttribute("stroke-width", "2");
    svg.appendChild(pointerHead);

    // Draw grid
    drawGridSVG();

    return () => {
      // Clean up
      svg.innerHTML = '';
    };
  }, []);

  // Draw grid function
  const drawGridSVG = () => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const gridGroup = document.createElementNS(svg.namespaceURI, "g");
    svg.appendChild(gridGroup);

    const small = 8, large = small * 5;
    for (let x = 0; x <= svg.width.baseVal.value; x += small) {
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", x.toString());
      line.setAttribute("y1", "0");
      line.setAttribute("x2", x.toString());
      line.setAttribute("y2", svg.height.baseVal.value.toString());
      line.setAttribute("stroke", "#eee");
      gridGroup.appendChild(line);
    }

    for (let y = 0; y <= svg.height.baseVal.value; y += small) {
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", y.toString());
      line.setAttribute("x2", svg.width.baseVal.value.toString());
      line.setAttribute("y2", y.toString());
      line.setAttribute("stroke", "#eee");
      gridGroup.appendChild(line);
    }
  };

  // Raised cosine pulse function
  const raisedCosinePulse = (t: number, h: number, b: number, t0: number) => {
    if (b === 0 || t < t0 || t > t0 + b) return 0;
    return (h / 2) * (1 - Math.cos((2 * Math.PI * (t - t0)) / b));
  };

  // Generate waveform points
  const generateWaveformPoints = (): Point[] => {
    if (!svgRef.current) return [];
    
    const svg = svgRef.current;
    const totalTime = svg.width.baseVal.value / PIXELS_PER_SECOND;
    const y0 = svg.height.baseVal.value / 2;
    const pts: Point[] = [];
    const dt = 1 / PIXELS_PER_SECOND;

    let {
      rCycleCounter,
      pCycleCounter,
      beatCounter,
      customIdx,
      waitingNormalBeats
    } = globalCounters;

    let tElapsed = 0;

    while (tElapsed <= totalTime) {
      let pCurrent = params;

      if (useCustomBeatParameters) {
        if (customBeats.length > 0 && waitingNormalBeats === 0) {
          pCurrent = { ...params, ...customBeats[customIdx] };
          customIdx++;
          if (customIdx >= customBeats.length) {
            customIdx = 0;
            waitingNormalBeats = repeatInterval;
          }
        } else if (waitingNormalBeats > 0) {
          waitingNormalBeats--;
        }
      }

      let curPCount = pCurrent.n_p;
      if (pWaveEnabled) {
        pCycleCounter++;
        if (pWaveInterval > 0 && pCycleCounter >= pWaveInterval) {
          curPCount = pWaveCount;
          pCycleCounter = 0;
        }
      }

      let curRCount = 1;
      if (rWaveEnabled) {
        rCycleCounter++;
        if (rWaveInterval > 0 && rCycleCounter >= rWaveInterval) {
          curRCount = rWaveCount;
          rCycleCounter = 0;
        }
      }

      const base = curPCount * (pCurrent.b_p + pCurrent.l_pq)
        + (pCurrent.b_q + pCurrent.b_r + pCurrent.b_s) * (curRCount > 0 ? 1 : 0)
        + pCurrent.l_st + pCurrent.b_t + pCurrent.l_tp;

      const heart_period = 60 / (pCurrent.heart_rate || 60);
      const sf = heart_period / base;

      const s = {
        b_p: pCurrent.b_p * sf,
        l_pq: pCurrent.l_pq * sf,
        b_q: pCurrent.b_q * sf,
        b_r: pCurrent.b_r * sf,
        b_s: pCurrent.b_s * sf,
        l_st: pCurrent.l_st * sf,
        b_t: pCurrent.b_t * sf,
        l_tp: pCurrent.l_tp * sf
      };

      const cycleDuration = curPCount * (s.b_p + s.l_pq)
        + (curRCount > 0 ? (s.b_q + s.b_r + s.b_s) : 0)
        + s.l_st + s.b_t + s.l_tp;

      const times = (() => {
        let off = tElapsed;
        const t: { P: number[], Q: number, R: number[], S: number[], T: number } = {
          P: [], Q: 0, R: [], S: [], T: 0
        };

        for (let i = 0; i < curPCount; i++) {
          t.P.push(off + i * (s.b_p + s.l_pq));
        }
        off += curPCount * (s.b_p + s.l_pq);

        if (curRCount > 0) {
          for (let i = 0; i < curRCount; i++) {
            t.Q = off;
            off += s.b_q;
            t.R.push(off);
            off += s.b_r;
            t.S.push(off);
            off += s.b_s;
            if (i < curRCount - 1) off += s.l_pq / 2;
          }
        }
        off += s.l_st;
        t.T = off;
        return t;
      })();

      const tEnd = tElapsed + cycleDuration;

      for (let t = tElapsed; t < tEnd; t += dt) {
        let v = 0;
        for (let start of times.P) {
          if (t >= start && t < start + s.b_p) {
            v = raisedCosinePulse(t, pCurrent.h_p, s.b_p, start);
            break;
          }
        }
        if (!v && curRCount > 0 && t >= times.Q && t < times.Q + s.b_q) {
          v = raisedCosinePulse(t, pCurrent.h_q, s.b_q, times.Q);
        }
        if (!v && curRCount > 0) {
          for (let r of times.R) {
            if (t >= r && t < r + s.b_r) {
              v = raisedCosinePulse(t, pCurrent.h_r, s.b_r, r);
              break;
            }
          }
        }
        if (!v && curRCount > 0) {
          for (let sWave of times.S) {
            if (t >= sWave && t < sWave + s.b_s) {
              v = raisedCosinePulse(t, pCurrent.h_s, s.b_s, sWave);
              break;
            }
          }
        }
        if (!v && t >= times.T && t < times.T + s.b_t) {
          v = raisedCosinePulse(t, pCurrent.h_t, s.b_t, times.T);
        }

        pts.push({
          x: t * PIXELS_PER_SECOND,
          y: y0 - v * pixelsPerMv
        });
      }

      tElapsed += cycleDuration;
      beatCounter++;
    }

    // Update global counters
    setGlobalCounters({
      rCycleCounter,
      pCycleCounter,
      beatCounter,
      customIdx,
      waitingNormalBeats
    });

    return pts;
  };

  // Convert points to SVG path string
  const pointsToPath = (pts: (Point | null)[]): string => {
    return pts.reduce((str, p, i) => {
      if (!p) return str;
      return str + (i ? " L" : "M") + ` ${p.x} ${p.y}`;
    }, "");
  };

  // Animation loop
  const animationLoop = (timestamp: number) => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const waveformPath = svg.querySelector('path');
    const pointerHead = svg.querySelector('circle');
    
    if (!waveformPath || !pointerHead) return;

    const w = svg.width.baseVal.value;
    const dt = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0;
    setLastTimestamp(timestamp);
    
    const newPointerX = pointerX + PIXELS_PER_SECOND * dt;
    setPointerX(newPointerX);

    let idx = pathPoints.findIndex(pt => pt.x >= newPointerX);
    if (idx < 0) idx = pathPoints.length - 1;

    if (firstSweep) {
      const newDrawnPoints = pathPoints.slice(0, idx + 1);
      setDrawnPoints(newDrawnPoints);
      waveformPath.setAttribute("d", pointsToPath(newDrawnPoints));
      if (newPointerX > w) setFirstSweep(false);
    } else {
      if (newPointerX > w) {
        setPointerX(0);
        const newPathPoints = generateWaveformPoints();
        setPathPoints(newPathPoints);
      }
      
      const es = newPointerX - ERASE_WIDTH / 2;
      const ee = newPointerX + ERASE_WIDTH / 2;
      const newDrawnPoints = [...drawnPoints];
      
      const si = newDrawnPoints.findIndex(pt => pt && pt.x >= es);
      const ei = newDrawnPoints.findIndex(pt => pt && pt.x > ee);
      
      for (let i = (si < 0 ? 0 : si); i < (ei < 0 ? newDrawnPoints.length : ei); i++) {
        if (pathPoints[i]) {
          newDrawnPoints[i] = pathPoints[i];
        }
      }
      
      setDrawnPoints(newDrawnPoints);
      waveformPath.setAttribute("d", pointsToPath(newDrawnPoints));
    }

    const cur = pathPoints[idx];
    if (cur) {
      pointerHead.setAttribute("cx", cur.x.toString());
      pointerHead.setAttribute("cy", cur.y.toString());
    }
    
    animationFrameRef.current = requestAnimationFrame(animationLoop);
  };

  // Apply new parameters
  const applyNewParams = () => {
    const newPathPoints = generateWaveformPoints();
    setPathPoints(newPathPoints);
    setDrawnPoints(Array(newPathPoints.length).fill(null));
    setFirstSweep(true);
    setPointerX(0);
  };

  // Start/stop animation
  useEffect(() => {
    if (pathPoints.length > 0) {
      animationFrameRef.current = requestAnimationFrame(animationLoop);
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [pathPoints]);

  // Initialize on mount
  useEffect(() => {
    const initialPoints = generateWaveformPoints();
    setPathPoints(initialPoints);
    setDrawnPoints(Array(initialPoints.length).fill(null));
  }, []);

  // Add custom beat
  const addCustomBeat = () => {
    setCustomBeats([...customBeats, {
      h_p: 0.15, b_p: 0.08, h_q: -0.1, b_q: 0.025,
      h_r: 1.2, b_r: 0.05, h_s: -0.25, b_s: 0.025,
      h_t: 0.2, b_t: 0.16, l_pq: 0.08, l_st: 0.12, l_tp: 0.3
    }]);
  };

  // Remove custom beat
  const removeCustomBeat = (index: number) => {
    const newCustomBeats = [...customBeats];
    newCustomBeats.splice(index, 1);
    setCustomBeats(newCustomBeats);
  };

  // Update custom beat parameter
  const updateCustomBeat = (index: number, param: string, value: number) => {
    const newCustomBeats = [...customBeats];
    newCustomBeats[index] = { ...newCustomBeats[index], [param]: value };
    setCustomBeats(newCustomBeats);
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      backgroundColor: '#f4f4f9',
      color: '#333',
      margin: 0,
      padding: '20px'
    }}>
      <h1 style={{ color: '#2c3e50' }}>ECG Waveform Animator (Custom Beats)</h1>
      <div style={{
        display: 'flex',
        gap: '30px',
        flexWrap: 'wrap'
      }}>
        <div style={{
          flex: 1,
          minWidth: '320px',
          background: '#fff',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          overflowY: 'auto',
          maxHeight: '95vh'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>Heart Rate (bpm):</label>
            <input
              type="number"
              value={params.heart_rate}
              onChange={(e) => setParams({...params, heart_rate: parseFloat(e.target.value)})}
              step="1"
              min="20"
              max="250"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>Pixels per mV:</label>
            <input
              type="number"
              value={pixelsPerMv}
              onChange={(e) => setPixelsPerMv(parseFloat(e.target.value))}
              step="10"
              min="10"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>

          <h3>Wave Parameters (mV, sec)</h3>
          {Object.entries({
            h_p: 'P Wave Height',
            b_p: 'P Wave Breadth',
            h_q: 'Q Wave Height',
            b_q: 'Q Wave Breadth',
            h_r: 'R Wave Height',
            b_r: 'R Wave Breadth',
            h_s: 'S Wave Height',
            b_s: 'S Wave Breadth',
            h_t: 'T Wave Height',
            b_t: 'T Wave Breadth',
            l_pq: 'PQ Segment Length',
            l_st: 'ST Segment Length',
            l_tp: 'TP Segment Length',
            n_p: 'Default P Waves per QRS'
          }).map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
              <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>{label}:</label>
              <input
                type="number"
                value={params[key as keyof ECGParams]}
                onChange={(e) => setParams({...params, [key]: parseFloat(e.target.value)})}
                step={key.startsWith('h_') || key.startsWith('b_') || key.startsWith('l_') ? '0.01' : '1'}
                style={{ flex: '1 0 70px', padding: '4px' }}
              />
            </div>
          ))}

          <h3>Dynamic R Wave Pattern</h3>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label>
              <input
                type="checkbox"
                checked={rWaveEnabled}
                onChange={(e) => setRWaveEnabled(e.target.checked)}
              /> Enable R Wave Pattern
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>R Waves in Pattern:</label>
            <input
              type="number"
              value={rWaveCount}
              onChange={(e) => setRWaveCount(parseInt(e.target.value, 10))}
              step="1"
              min="0"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>Apply After N QRS:</label>
            <input
              type="number"
              value={rWaveInterval}
              onChange={(e) => setRWaveInterval(parseInt(e.target.value, 10))}
              step="1"
              min="0"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>

          <h3>Dynamic P Wave Pattern</h3>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label>
              <input
                type="checkbox"
                checked={pWaveEnabled}
                onChange={(e) => setPWaveEnabled(e.target.checked)}
              /> Enable P Wave Pattern
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>P Waves in Pattern:</label>
            <input
              type="number"
              value={pWaveCount}
              onChange={(e) => setPWaveCount(parseInt(e.target.value, 10))}
              step="1"
              min="0"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>Apply After N QRS:</label>
            <input
              type="number"
              value={pWaveInterval}
              onChange={(e) => setPWaveInterval(parseInt(e.target.value, 10))}
              step="1"
              min="0"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>

          <h3>Custom Beat Sequence</h3>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label>
              <input
                type="checkbox"
                checked={useCustomBeatParameters}
                onChange={(e) => setUseCustomBeatParameters(e.target.checked)}
              /> Enable Custom Beat Sequence
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <label style={{ flex: '1 0 145px', fontSize: '0.95em', color: '#555' }}>Normal Beats Before Repeat:</label>
            <input
              type="number"
              value={repeatInterval}
              onChange={(e) => setRepeatInterval(parseInt(e.target.value, 10))}
              step="1"
              min="0"
              style={{ flex: '1 0 70px', padding: '4px' }}
            />
          </div>
          
          {customBeats.map((beat, index) => (
            <div key={index} style={{
              border: '1px solid #ddd',
              padding: '10px',
              marginBottom: '10px',
              background: '#fafafa'
            }}>
              {Object.entries({
                h_p: 'P Height', b_p: 'P Breadth',
                h_q: 'Q Height', b_q: 'Q Breadth',
                h_r: 'R Height', b_r: 'R Breadth',
                h_s: 'S Height', b_s: 'S Breadth',
                h_t: 'T Height', b_t: 'T Breadth',
                l_pq: 'PQ Length', l_st: 'ST Length', l_tp: 'TP Length'
              }).map(([param, label]) => (
                <div key={param} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <label style={{ flex: '1 0 100px', fontSize: '0.85em' }}>{label}:</label>
                  <input
                    type="number"
                    value={beat[param as keyof typeof beat] || 0}
                    onChange={(e) => {
                      const newValue = parseFloat(e.target.value);
                      updateCustomBeat(index, param, newValue);
                    }}
                    step="0.01"
                    style={{ flex: '1 0 60px', padding: '2px' }}
                  />
                </div>
              ))}
              <button
                onClick={() => removeCustomBeat(index)}
                style={{
                  marginTop: '5px',
                  background: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  padding: '4px 8px',
                  cursor: 'pointer'
                }}
              >
                Remove Beat
              </button>
            </div>
          ))}
          
          <button
            onClick={addCustomBeat}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px',
              fontSize: '1rem',
              fontWeight: 600,
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              marginTop: '10px',
              background: '#27ae60',
              color: 'white'
            }}
          >
            + Add Custom Beat
          </button>

          <button
            onClick={applyNewParams}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px',
              fontSize: '1rem',
              fontWeight: 600,
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              marginTop: '10px',
              background: '#20a4f3',
              color: 'white'
            }}
          >
            Apply Changes
          </button>
        </div>
        <div style={{ flex: 2, minWidth: '600px' }}>
          <svg
            ref={svgRef}
            width="1000"
            height="400"
            style={{
              border: '1px solid #ccc',
              background: '#fff',
              borderRadius: '8px'
            }}
          ></svg>
        </div>
      </div>
    </div>
  );
};

export default ECGGraph;