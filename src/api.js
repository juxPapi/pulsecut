import { useEffect, useRef } from 'react';

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export function useEvents(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const source = new EventSource('/api/events');
    const names = ['ready', 'project', 'progress', 'log', 'job'];
    const listeners = names.map((name) => {
      const listener = (event) => {
        try {
          ref.current(name, JSON.parse(event.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      source.addEventListener(name, listener);
      return [name, listener];
    });
    return () => {
      for (const [name, listener] of listeners) source.removeEventListener(name, listener);
      source.close();
    };
  }, []);
}

export function formatTime(seconds, withHours = false) {
  const value = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(value / 3600);
  const mins = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  if (hrs || withHours) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export function useDebouncedCallback(callback, delay = 500) {
  const timer = useRef(null);
  const ref = useRef(callback);
  ref.current = callback;
  return (...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(...args), delay);
  };
}
