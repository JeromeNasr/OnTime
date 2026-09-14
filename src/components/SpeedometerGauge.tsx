import React from 'react';
import { Gauge, Zap, AlertTriangle } from 'lucide-react';

interface SpeedometerGaugeProps {
  speedKmH: number;
  maxSpeedKmH?: number;
  speedLimit?: number;
  compact?: boolean;
}

export const SpeedometerGauge: React.FC<SpeedometerGaugeProps> = ({
  speedKmH,
  maxSpeedKmH = 0,
  speedLimit = 80,
  compact = false,
}) => {
  const roundedSpeed = Math.round(speedKmH);
  const isOverLimit = roundedSpeed > speedLimit;

  // Arc calculation for radial gauge (0 to 140 km/h scale)
  const maxScale = 140;
  const clampedSpeed = Math.min(Math.max(roundedSpeed, 0), maxScale);
  const percentage = clampedSpeed / maxScale;
  // Circumference for r=42 is 2 * PI * 42 ≈ 263.89
  const strokeDashoffset = 263.89 * (1 - percentage * 0.75); // 270 degree sweep

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-xl">
        <div className="flex items-baseline gap-1">
          <span className={`text-2xl font-black font-mono tracking-tight ${isOverLimit ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>
            {roundedSpeed}
          </span>
          <span className="text-[10px] uppercase font-bold text-slate-400">km/h</span>
        </div>
        <div className="border-l border-slate-800 pl-3">
          <div className="text-[10px] text-slate-500">SPEED LIMIT</div>
          <div className="text-xs font-bold text-slate-300 font-mono">{speedLimit} km/h</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center p-4 bg-slate-900/95 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-xl">
      {/* Top status bar */}
      <div className="w-full flex items-center justify-between mb-2 px-2 text-xs font-medium text-slate-400">
        <div className="flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-blue-400" />
          <span>Phone Speedometer</span>
        </div>
        {isOverLimit ? (
          <div className="flex items-center gap-1 text-rose-400 bg-rose-950/60 border border-rose-800/80 px-2 py-0.5 rounded-full text-[11px] font-bold">
            <AlertTriangle className="w-3 h-3" />
            <span>Over Limit ({speedLimit})</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full text-[11px] font-bold">
            <Zap className="w-3 h-3" />
            <span>GPS Calibrated</span>
          </div>
        )}
      </div>

      {/* Radial Speed Dial */}
      <div className="relative w-48 h-48 flex items-center justify-center">
        <svg className="w-full h-full -rotate-135 transform" viewBox="0 0 100 100">
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="8"
            strokeDasharray="263.89"
            strokeDashoffset="65.97" // leave bottom 90 deg open
            strokeLinecap="round"
            className="text-slate-800"
          />
          {/* Speed Fill Arc */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="8"
            strokeDasharray="263.89"
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`transition-all duration-300 ${
              isOverLimit
                ? 'text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                : roundedSpeed > 50
                ? 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                : 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]'
            }`}
          />
        </svg>

        {/* Center Digital Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pt-2">
          <div className={`text-5xl font-black font-mono tracking-tighter transition-colors ${
            isOverLimit ? 'text-rose-500' : 'text-slate-100'
          }`}>
            {roundedSpeed}
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 -mt-1">
            km / h
          </div>
          <div className="mt-2 text-[11px] text-slate-500 font-medium">
            Limit: <span className="text-slate-300 font-semibold">{speedLimit}</span>
          </div>
        </div>
      </div>

      {/* Speedometer Footer Stats */}
      <div className="w-full grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-slate-800/80">
        <div className="text-center p-2 rounded-xl bg-slate-950/60 border border-slate-850">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Max Speed</div>
          <div className="text-base font-bold font-mono text-amber-400">
            {Math.round(maxSpeedKmH)} <span className="text-[10px] font-normal text-slate-500">km/h</span>
          </div>
        </div>
        <div className="text-center p-2 rounded-xl bg-slate-950/60 border border-slate-850">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Zone Limit</div>
          <div className="text-base font-bold font-mono text-blue-400">
            {speedLimit} <span className="text-[10px] font-normal text-slate-500">km/h</span>
          </div>
        </div>
      </div>
    </div>
  );
};
