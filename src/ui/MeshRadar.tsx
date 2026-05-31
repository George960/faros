// ─────────────────────────────────────────────────────────────
// src/ui/MeshRadar.tsx — live mesh map (react-native-svg)
// ─────────────────────────────────────────────────────────────
import React from 'react';
import Svg, { Circle, Line, Text as SvgText, G } from 'react-native-svg';
import { Peer } from '../mesh/types';
import { T, colorFor } from '../theme';

export default function MeshRadar({
  peers,
  sos,
  onSelect,
  selectedId,
}: {
  peers: Peer[];
  sos: boolean;
  onSelect: (p: Peer) => void;
  selectedId?: string;
}) {
  const cx = 130;
  const cy = 130;
  const pos = (i: number, n: number, hops: number) => {
    const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = 42 + hops * 22;
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  };

  return (
    <Svg viewBox="0 0 260 260" width="100%" height={220}>
      {[40, 75, 110].map((r) => (
        <Circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="#1d2a26" strokeWidth={1} />
      ))}
      <Line x1={cx} y1={20} x2={cx} y2={240} stroke="#16201d" strokeWidth={1} />
      <Line x1={20} y1={cy} x2={240} y2={cy} stroke="#16201d" strokeWidth={1} />
      {peers.map((p, i) => {
        const { x, y } = pos(i, peers.length, p.hops);
        const c = colorFor(p.id);
        return (
          <Line
            key={'l' + p.id}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke={c}
            strokeWidth={1}
            strokeDasharray="3,4"
            opacity={0.45}
          />
        );
      })}
      {peers.map((p, i) => {
        const { x, y } = pos(i, peers.length, p.hops);
        const c = colorFor(p.id);
        const on = selectedId === p.id;
        return (
          <G key={p.id} onPress={() => onSelect(p)}>
            <Circle cx={x} cy={y} r={on ? 13 : 9} fill={c} opacity={0.22} />
            <Circle cx={x} cy={y} r={on ? 6 : 5} fill={c} />
          </G>
        );
      })}
      <Circle cx={cx} cy={cy} r={13} fill={sos ? T.danger : T.accent2} />
      <Circle cx={cx} cy={cy} r={6} fill={T.bg} />
      <SvgText x={cx} y={cy + 30} fill="#8aa" fontSize={9} textAnchor="middle">
        ΕΣΥ
      </SvgText>
    </Svg>
  );
}
