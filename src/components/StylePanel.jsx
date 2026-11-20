import { useMemo, useState } from 'react';
import { CAPTION_STYLES, FONT_CHOICES, GROUPS, stylesByGroup } from '../../shared/captions.js';

function StyleTile({ item, active, onClick }) {
  const preview = {
    fontFamily: `'${item.font}', system-ui, sans-serif`,
    color: item.color,
    textTransform: item.uppercase ? 'uppercase' : 'none',
    WebkitTextStroke: item.outlineWidth ? `${Math.min(1.6, item.outlineWidth * 0.35)}px ${item.outline}` : '0',
    paintOrder: 'stroke fill',
    background: item.box
      ? `color-mix(in srgb, ${item.box} ${Math.round((item.boxOpacity ?? 0.88) * 100)}%, transparent)`
      : 'transparent',
    padding: item.box ? '2px 5px' : '0',
    borderRadius: '3px',
    transform: `rotate(${item.tilt || 0}deg)`,
  };
  return (
    <button type="button" className={`style-tile ${active ? 'active' : ''}`} onClick={onClick} title={`${item.group} · ${item.name}`}>
      <span className="style-tile-preview" style={preview}>
        Aa
      </span>
      <span className="style-tile-name">{item.name}</span>
    </button>
  );
}

export default function StylePanel({ styleId, onStyle, options, onChange, style }) {
  const [group, setGroup] = useState('All');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return stylesByGroup()
      .filter((entry) => group === 'All' || entry.group === group)
      .map((entry) => ({
        ...entry,
        styles: entry.styles.filter((item) => !search || item.name.toLowerCase().includes(search)),
      }))
      .filter((entry) => entry.styles.length);
  }, [group, query]);

  const tilt = options.tilt ?? style.tilt ?? 0;

  return (
    <div className="style-panel">
      <div className="panel-intro">
        <h2>Captions</h2>
        <p>
          {CAPTION_STYLES.length} styles across {GROUPS.length} groups. Everything is burned into the export with
          libass, so what you see in the phone is what renders.
        </p>
      </div>

      <input
        className="search"
        placeholder="Search styles"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="group-chips">
        {['All', ...GROUPS].map((name) => (
          <button
            key={name}
            type="button"
            className={group === name ? 'active' : ''}
            onClick={() => setGroup(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="style-gallery">
        {filtered.map((entry) => (
          <section key={entry.group}>
            <h3>
              {entry.group} <span>{entry.styles.length}</span>
            </h3>
            <div className="style-grid">
              {entry.styles.map((item) => (
                <StyleTile
                  key={item.id}
                  item={item}
                  active={item.id === styleId}
                  onClick={() => onStyle(item.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {!filtered.length && <p className="rail-empty">No style matches that search.</p>}
      </div>

      <div className="controls">
        <h3 className="controls-title">
          Style controls
          <button
            type="button"
            className="link"
            onClick={() => {
              onChange('font', null);
              onChange('color', null);
              onChange('accent', null);
              onChange('outline', null);
              onChange('uppercase', null);
              onChange('tilt', null);
              onChange('size', 1);
              onChange('opacity', 1);
              onChange('boxOpacity', null);
              onChange('position', 'bottom');
            }}
          >
            Reset
          </button>
        </h3>

        <label className="field">
          <span>Font</span>
          <select value={style.font} onChange={(event) => onChange('font', event.target.value)}>
            {FONT_CHOICES.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>

        <div className="field-row">
          <label className="field color">
            <span>Text</span>
            <input type="color" value={style.color} onChange={(event) => onChange('color', event.target.value)} />
          </label>
          <label className="field color">
            <span>Highlight</span>
            <input
              type="color"
              value={style.accent}
              onChange={(event) => onChange('accent', event.target.value)}
            />
          </label>
          <label className="field color">
            <span>Outline</span>
            <input
              type="color"
              value={style.outline}
              onChange={(event) => onChange('outline', event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>
            Size <b>{Math.round((options.size ?? 1) * 100)}%</b>
          </span>
          <input
            type="range"
            min="0.7"
            max="1.6"
            step="0.01"
            value={options.size ?? 1}
            onChange={(event) => onChange('size', Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>
            Tilt <b>{Math.round(tilt)}°</b>
          </span>
          <input
            type="range"
            min="-8"
            max="8"
            step="0.5"
            value={tilt}
            onChange={(event) => onChange('tilt', Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>
            Opacity <b>{Math.round((options.opacity ?? 1) * 100)}%</b>
          </span>
          <input
            type="range"
            min="0.3"
            max="1"
            step="0.01"
            value={options.opacity ?? 1}
            onChange={(event) => onChange('opacity', Number(event.target.value))}
          />
        </label>

        {style.box && (
          <label className="field">
            <span>
              Box strength <b>{Math.round((options.boxOpacity ?? style.boxOpacity ?? 0.88) * 100)}%</b>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={options.boxOpacity ?? style.boxOpacity ?? 0.88}
              onChange={(event) => onChange('boxOpacity', Number(event.target.value))}
            />
          </label>
        )}

        <div className="field-row two">
          <label className="field">
            <span>Placement</span>
            <select value={options.position || 'bottom'} onChange={(event) => onChange('position', event.target.value)}>
              <option value="bottom">Lower third</option>
              <option value="middle">Centre</option>
              <option value="top">Upper third</option>
            </select>
          </label>
          <label className="field switch">
            <span>Uppercase</span>
            <input
              type="checkbox"
              checked={options.uppercase ?? style.uppercase}
              onChange={(event) => onChange('uppercase', event.target.checked)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
