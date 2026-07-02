import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';

const ScanIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="5" width="16" height="10" rx="2" stroke="var(--accent)" strokeWidth="1.5"/>
    <path d="M6 5V3M10 5V2M14 5V3" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M6 15v2M10 15v3M14 15v2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M5 10h10" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="10" cy="10" r="1.5" fill="var(--accent)"/>
  </svg>
);

const SCAN_MESSAGES = [
  'Parsing source files...',
  'Extracting symbols...',
  'Building dependency graph...',
  'Detecting communities...',
  'Computing layouts...',
  'Finalizing graph...',
];

export const IndexingProgress: React.FC = () => {
  const { isIndexing, indexingProgress } = useAppStore();
  const [messageIndex, setMessageIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dots, setDots] = useState('');

  // Fade in/out
  useEffect(() => {
    if (isIndexing) {
      setVisible(true);
    } else {
      const timer = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isIndexing]);

  // Rotate messages
  useEffect(() => {
    if (!isIndexing) return;
    const interval = setInterval(() => {
      setMessageIndex(i => (i + 1) % SCAN_MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [isIndexing]);

  // Animated dots
  useEffect(() => {
    if (!isIndexing) return;
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 400);
    return () => clearInterval(interval);
  }, [isIndexing]);

  if (!visible) return null;

  const current = indexingProgress.current ?? 0;
  const total = indexingProgress.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const hasProgress = total > 0;

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(245, 246, 248, 0.9)',
    backdropFilter: 'blur(4px)',
    zIndex: 50,
    animation: isIndexing ? 'fadeIn 0.3s ease' : undefined,
    opacity: isIndexing ? 1 : 0,
    transition: 'opacity 0.5s ease',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    padding: '28px 36px',
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  };

  const iconWrapStyle: React.CSSProperties = {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'var(--accent-dim)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'pulse 2s ease infinite',
  };

  const progressTrackStyle: React.CSSProperties = {
    width: '100%',
    height: 4,
    background: 'var(--border)',
    borderRadius: 2,
    overflow: 'hidden',
  };

  const progressFillStyle: React.CSSProperties = {
    height: '100%',
    borderRadius: 2,
    background: `linear-gradient(90deg, var(--accent), var(--accent-hover))`,
    width: hasProgress ? `${percent}%` : '0%',
    transition: hasProgress ? 'width 0.4s ease' : undefined,
    backgroundImage: !hasProgress
      ? `repeating-linear-gradient(90deg, var(--accent) 0px, var(--accent) 20px, var(--accent-hover) 20px, var(--accent-hover) 40px)`
      : undefined,
    backgroundSize: !hasProgress ? '40px 100%' : undefined,
    animation: !hasProgress ? 'progressBar 0.8s linear infinite' : undefined,
  } as React.CSSProperties;

  // Override width for indeterminate
  const fillWidth = hasProgress ? `${percent}%` : '60%';

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {/* Animated scan icon */}
        <div style={iconWrapStyle}>
          <ScanIcon />
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 6,
          }}>
            Indexing Codebase
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            minHeight: 18,
          }}>
            {SCAN_MESSAGES[messageIndex]}{dots}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: '100%' }}>
          <div style={progressTrackStyle}>
            <div style={{ ...progressFillStyle, width: fillWidth }} />
          </div>

          {/* File counter */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
            fontSize: 11,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>
              {hasProgress
                ? `Scanning ${current.toLocaleString()} of ${total.toLocaleString()} files`
                : 'Preparing...'}
            </span>
            {hasProgress && (
              <span style={{
                color: 'var(--accent)',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {percent}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
