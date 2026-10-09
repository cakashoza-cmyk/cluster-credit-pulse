// Generated industry artwork (no publisher images are used).
const paths = {
  tiles: <g>{[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={14 + c * 26} y={14 + r * 26} width="22" height="22" rx="3" />))}</g>,
  sanitary: <path d="M50 12 C50 12 22 46 22 62 a28 28 0 0 0 56 0 C78 46 50 12 50 12z" />,
  paper: <g><rect x="18" y="22" width="64" height="14" rx="3" /><rect x="18" y="42" width="64" height="14" rx="3" /><rect x="18" y="62" width="64" height="14" rx="3" /></g>,
  textile: <g fill="none" strokeWidth="7" strokeLinecap="round"><path d="M12 30 q19 -16 38 0 t38 0" /><path d="M12 52 q19 -16 38 0 t38 0" /><path d="M12 74 q19 -16 38 0 t38 0" /></g>,
  loom: <g fill="none" strokeWidth="5">{[20, 35, 50, 65, 80].map((x) => <line key={x} x1={x} y1="12" x2={x} y2="88" />)}{[28, 50, 72].map((y) => <line key={y} x1="12" y1={y} x2="88" y2={y} strokeWidth="8" />)}</g>,
  embroidery: <g fill="none" strokeWidth="6" strokeLinecap="round"><circle cx="50" cy="50" r="34" /><path d="M30 50 l12 12 l26 -26" /></g>,
  diamond: <path d="M30 18 h40 l18 22 l-38 46 l-38 -46z M12 40 h76 M38 18 l-8 22 l20 46 l20 -46 l-8 -22" strokeWidth="3" />,
};
export function IndustryArt({ icon, size = 84 }) {
  const fill = ['textile', 'loom', 'embroidery'].includes(icon) ? 'none' : 'rgba(255,255,255,.88)';
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill={fill} stroke="rgba(255,255,255,.88)" aria-hidden="true">
      {paths[icon] || paths.tiles}
    </svg>
  );
}
