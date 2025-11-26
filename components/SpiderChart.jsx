import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

const SpiderChart = ({ preferences, setPreferences, compact = false, frameless = false, showTitle = true }) => {
  const data = [
    { subject: 'Confort', A: preferences.comfort, fullMark: 100 },
    { subject: 'Eau', A: preferences.water, fullMark: 100 },
    { subject: 'Acces', A: preferences.access, fullMark: 100 },
    { subject: 'Infos', A: preferences.info, fullMark: 100 },
    { subject: 'Vue', A: preferences.view, fullMark: 100 },
  ];

  const handleChange = (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: parseInt(value, 10) }));
  };

  return (
    <div
      className={frameless ? '' : 'glass-panel'}
      style={{
        padding: compact ? '1rem' : '2rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1.5rem',
        alignItems: 'center',
        background: frameless ? 'transparent' : undefined,
        border: frameless ? 'none' : undefined,
        boxShadow: frameless ? 'none' : undefined,
      }}
    >
      <div style={{ flex: '1 1 260px' }}>
        {!compact && showTitle && <h2 style={{ marginBottom: '1.5rem' }}>Definir votre refuge ideal</h2>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {Object.keys(preferences).map((key) => (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', textTransform: 'capitalize' }}>
                <label>{key === 'view' ? 'Qualite Visuelle' : key}</label>
                <span style={{ color: 'var(--accent)' }}>{preferences[key]}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={preferences[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                style={{
                  width: '100%',
                  accentColor: 'var(--accent)',
                  height: '6px',
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '3px',
                  appearance: 'none',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: '1 1 320px', height: '320px', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minHeight={280}>
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
            <PolarGrid stroke="var(--card-border)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
            <Radar
              name="Preferences"
              dataKey="A"
              stroke="var(--accent)"
              strokeWidth={3}
              fill="var(--accent)"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SpiderChart;
