import React from 'react';
import { 
  Volume2, 
  VolumeX, 
  X, 
  CornerUpRight, 
  CornerUpLeft, 
  ArrowUp, 
  RotateCw, 
  MapPin,
  Play
} from 'lucide-react';

export default function NavigationBanner({
  currentStep,
  distToNextTurnM,
  userSpeedKmh,
  voiceEnabled,
  onToggleVoice,
  onExitNav,
  isSimulating,
}) {
  if (!currentStep) return null;

  const instruction = currentStep.instruction || 'Continue on route';
  const isRight = instruction.toLowerCase().includes('right');
  const isLeft = instruction.toLowerCase().includes('left');
  const isArrive = instruction.toLowerCase().includes('arrived') || instruction.toLowerCase().includes('destination');
  const isRoundabout = instruction.toLowerCase().includes('rotary') || instruction.toLowerCase().includes('roundabout');

  return (
    <div className="nav-hud-banner">
      <div className="maneuver-icon-box">
        {isArrive ? (
          <MapPin size={28} className="text-emerald" />
        ) : isRoundabout ? (
          <RotateCw size={28} />
        ) : isRight ? (
          <CornerUpRight size={28} />
        ) : isLeft ? (
          <CornerUpLeft size={28} />
        ) : (
          <ArrowUp size={28} />
        )}
      </div>

      <div className="nav-hud-center">
        <div className="nav-hud-meta">
          <span className="speed-tag">
            {userSpeedKmh} KM/H
          </span>
          {distToNextTurnM !== null ? (
            <span className="turn-dist-tag">
              IN {distToNextTurnM} METERS
            </span>
          ) : (
            <span className="turn-dist-tag">FOLLOW ROUTE</span>
          )}
          {isSimulating && (
            <span className="sim-mode-tag">
              <Play size={10} />
              <span>TEST DRIVE SIMULATION</span>
            </span>
          )}
        </div>

        <div className="nav-hud-instruction">
          {instruction}
        </div>
      </div>

      <div className="nav-hud-actions">
        <button
          type="button"
          onClick={onToggleVoice}
          className={`hud-icon-btn ${voiceEnabled ? 'active' : ''}`}
          title={voiceEnabled ? 'Mute voice guidance' : 'Unmute voice guidance'}
          aria-label={voiceEnabled ? 'Mute voice guidance' : 'Unmute voice guidance'}
        >
          {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>

        <button
          type="button"
          onClick={onExitNav}
          className="hud-exit-btn"
          title="Exit Navigation"
          aria-label="Exit Navigation"
        >
          <X size={18} />
          <span>Exit</span>
        </button>
      </div>
    </div>
  );
}
