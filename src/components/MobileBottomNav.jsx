import React from 'react';
import { 
  Navigation, 
  Ticket, 
  Code2 
} from 'lucide-react';

export default function MobileBottomNav({
  activeView,
  onSelectView,
  hasActivePass,
}) {
  return (
    <nav className="mobile-bottom-nav">
      <button
        className={`mobile-nav-item ${activeView === 'map' ? 'active' : ''}`}
        onClick={() => onSelectView('map')}
      >
        <Navigation size={20} />
        <span>Map</span>
      </button>

      {hasActivePass && (
        <button
          className={`mobile-nav-item ${activeView === 'pass' ? 'active' : ''}`}
          onClick={() => onSelectView('pass')}
        >
          <div className="icon-with-dot">
            <Ticket size={20} />
            <span className="active-badge">1</span>
          </div>
          <span>My Pass</span>
        </button>
      )}

      <button
        className={`mobile-nav-item ${activeView === 'developer' ? 'active' : ''}`}
        onClick={() => onSelectView('developer')}
      >
        <Code2 size={20} />
        <span>Dev Mode</span>
      </button>
    </nav>
  );
}
