import React from 'react';

interface SpeedometerGaugeProps {
  speedKmH: number;
  maxSpeedKmH?: number;
  speedLimit?: number;
  compact?: boolean;
}

export const SpeedometerGauge: React.FC<SpeedometerGaugeProps> = ({
  speedKmH,
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
  // 240-degree sweep
  const arcLength = 263.89 * (240 / 360);
  const strokeDashoffset = arcLength * (1 - percentage);

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-[#13131a] border border-white/[0.06] px-3 py-2 rounded-lg">
        <div className="flex items-baseline gap-1">
          <span
            className={`text-xl font-bold font-mono tabular-nums ${
              isOverLimit ? 'text-[#ef4444]' : 'text-white'
            }`}
          >
            {roundedSpeed}
          </span>
          <span className="text-[10px] text-[#94a3b8]">km/h</span>
        </div>
        <div className="border-l border-white/[0.06] pl-2 text-[10px] text-[#4a5568]">
          Limit: <span className="text-white">{speedLimit}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center select-none py-2">
      {/* Radial Speed Dial Arc */}
      <div className="relative w-56 h-56 flex items-center justify-center">
        <svg className="w-full h-full -rotate-[210deg] transform" viewBox="0 0 100 100">
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="transparent"
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth="6"
            strokeDasharray={`${arcLength} 300`}
            strokeLinecap="round"
          />
          {/* Active Speed Arc */}
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="transparent"
            stroke={isOverLimit ? '#ef4444' : '#3b82f6'}
            strokeWidth="6"
            strokeDasharray={`${arcLength} 300`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
        </svg>

        {/* Center Speed Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div
            className={`text-[64px] font-bold leading-none tracking-tight tabular-nums transition-colors ${
              isOverLimit ? 'text-[#ef4444]' : 'text-white'
            }`}
          >
            {roundedSpeed}
          </div>
          <div className="text-xs text-[#94a3b8] uppercase tracking-wider mt-1">
            km/h
          </div>
          {isOverLimit && (
            <div className="mt-1 text-[11px] font-medium text-[#ef4444]">
              Over Limit ({speedLimit})
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
