import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../types';
import { useTheme } from '../contexts/ThemeContext';

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  function cycle() {
    const order: ThemePreference[] = ['light', 'dark', 'system'];
    const i = order.indexOf(preference);
    setPreference(order[(i + 1) % order.length]!);
  }

  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;

  return (
    <button type="button" className="theme-toggle-btn" onClick={cycle} aria-label="Toggle theme">
      <Icon size={18} strokeWidth={2} />
      <span className="theme-toggle-label">
        {preference === 'light' ? 'Light' : preference === 'dark' ? 'Dark' : 'System'}
      </span>
    </button>
  );
}
