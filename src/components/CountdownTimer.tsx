'use client';

import { useState, useEffect } from 'react';

interface CountdownTimerProps {
  serverTime: string; // ISO string from server
  deadlineTime: string; // ISO string from server
  onDeadlinePassed?: () => void;
}

export default function CountdownTimer({
  serverTime,
  deadlineTime,
  onDeadlinePassed,
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
    isPassed: boolean;
  }>({ hours: 0, minutes: 0, seconds: 0, isPassed: false });

  useEffect(() => {
    if (!serverTime || !deadlineTime) return;

    // Anchor: record local time when server time was received
    const clientFetchTime = Date.now();
    const serverEpoch = new Date(serverTime).getTime();
    const deadlineEpoch = new Date(deadlineTime).getTime();

    function update() {
      // Local elapsed time since the server payload was received
      const elapsedSinceFetch = Date.now() - clientFetchTime;
      // Synthesized current server time (NOT client clock)
      const currentServerTime = serverEpoch + elapsedSinceFetch;
      const diffMs = deadlineEpoch - currentServerTime;

      if (diffMs <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0, isPassed: true });
        if (onDeadlinePassed) {
          onDeadlinePassed();
        }
        return;
      }

      const totalSeconds = Math.ceil(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      setTimeLeft({ hours, minutes, seconds, isPassed: false });
    }

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [serverTime, deadlineTime, onDeadlinePassed]);

  const pad = (n: number) => String(n).padStart(2, '0');

  if (timeLeft.isPassed) {
    return (
      <div className="countdown-container" style={{ color: '#ef4444' }}>
        <span className="countdown-digits" style={{ fontSize: '1.25rem' }}>
          Deadline Passed
        </span>
      </div>
    );
  }

  return (
    <div className="countdown-container" aria-label="Deadline Countdown">
      <span className="countdown-digits">
        {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
      </span>
      <span className="countdown-label" style={{ marginLeft: '6px' }}>
        left to decide
      </span>
    </div>
  );
}
