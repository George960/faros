// ─────────────────────────────────────────────────────────────
// src/ui/ChatScreen.tsx — primary screen
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import MeshRadar from './MeshRadar';
import { useMeshStore } from '../store/useMeshStore';
import { ChatMessage, Peer } from '../mesh/types';
import { T, colorFor } from '../theme';

export default function ChatScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    ready, mock, peers, messages, channel, sosActive,
    init, send, triggerSOS, setChannel, wipe,
  } = useMeshStore();
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<Peer | undefined>();
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    init();
  }, [init]);

  const visible = messages.filter(
    (m) => m.from === 'sys' || m.channel === channel || (channel === 'sos' && m.sos),
  );

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [visible.length]);

  const onSend = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  };

  const confirmSOS = () =>
    Alert.alert('Σήμα κινδύνου', 'Να εκπέμψω SOS + τοποθεσία σε όλο το mesh;', [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'ΕΚΠΟΜΠΗ', style: 'destructive', onPress: () => triggerSOS() },
    ]);

  const confirmWipe = () =>
    Alert.alert('PANIC WIPE', 'Διαγραφή ταυτότητας και όλων των δεδομένων; Μη αναστρέψιμο.', [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'ΔΙΑΓΡΑΦΗ', style: 'destructive', onPress: () => wipe() },
    ]);

  return (
    <KeyboardAvoidingView
      style={st.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* header */}
      <View style={st.header}>
        <View style={st.row}>
          <View style={st.beacon}>
            <Text style={st.beaconIcon}>◉</Text>
          </View>
          <View>
            <Text style={st.wordmark}>ΦΑΡΟΣ</Text>
            <Text style={st.subline}>
              {mock ? 'MOCK MODE' : 'OFFLINE MESH'} · {peers.length} nodes
            </Text>
          </View>
        </View>
        <View style={[st.row, { gap: 8 }]}>
          <Pressable onPress={onOpenSettings} style={st.gearBtn}>
            <Text style={st.gearTxt}>⚙</Text>
          </Pressable>
          <Pressable onPress={confirmWipe} style={st.wipeBtn}>
            <Text style={st.wipeTxt}>WIPE</Text>
          </Pressable>
        </View>
      </View>

      {/* radar */}
      <View style={st.radarWrap}>
        <MeshRadar peers={peers} sos={sosActive} onSelect={setSelected} selectedId={selected?.id} />
        {selected && (
          <View style={[st.peerCard, { borderColor: colorFor(selected.id) }]}>
            <Text style={[st.peerName, { color: colorFor(selected.id) }]}>{selected.handle}</Text>
            <Text style={st.peerMeta}>RSSI {selected.rssi} dBm</Text>
            <Text style={st.peerMeta}>
              {selected.hops === 1 ? 'άμεση σύνδεση' : `relay · ${selected.hops} hops`}
            </Text>
            <Text style={[st.peerMeta, { color: T.green }]}>
              {selected.verified ? '🔑 κλειδί επαληθεύτηκε' : '… αναμονή ταυτότητας'}
            </Text>
          </View>
        )}
      </View>

      {/* tabs */}
      <View style={st.tabs}>
        {(['mesh', 'sos'] as const).map((c) => (
          <Pressable key={c} onPress={() => setChannel(c)} style={st.tab}>
            <Text
              style={[
                st.tabTxt,
                channel === c && { color: c === 'sos' ? T.danger : T.green },
                channel === c && st.tabActive,
                channel === c && { borderBottomColor: c === 'sos' ? T.danger : T.green },
              ]}>
              {c === 'sos' ? '⚠ #sos' : '# mesh'}
            </Text>
          </Pressable>
        ))}
        <Text style={st.privacy}>χωρίς λογαριασμό · χωρίς σέρβερ</Text>
      </View>

      {/* stream */}
      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(m) => m.id}
        style={st.stream}
        contentContainerStyle={{ padding: 14 }}
        renderItem={({ item }) => <Bubble m={item} />}
      />

      {/* composer */}
      <View style={st.composer}>
        <Pressable onPress={confirmSOS} style={[st.sosBtn, sosActive && st.sosBtnActive]}>
          <Text style={st.sosIcon}>⚠</Text>
        </Pressable>
        <View style={st.inputWrap}>
          <Text style={{ color: T.green }}>🔒</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={onSend}
            placeholder="Κρυπτογραφημένο μήνυμα…"
            placeholderTextColor={T.faint}
            style={st.input}
            editable={ready}
          />
        </View>
        <Pressable onPress={onSend} style={st.sendBtn}>
          <Text style={st.sendIcon}>➤</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.from === 'sys') return <Text style={st.sysMsg}>{m.text}</Text>;
  if (m.sos) {
    const [body, loc] = m.text.split('\n@');
    return (
      <View style={st.sosMsg}>
        <Text style={st.sosMsgTxt}>⚠ {body}</Text>
        {loc && (
          <Text style={st.sosLoc}>
            📍 {loc.split(',').slice(0, 2).join(', ')}  (±{loc.split(',')[2]}m)
          </Text>
        )}
        {!m.mine && <Text style={st.sosFrom}>— {m.handle}</Text>}
      </View>
    );
  }
  const c = colorFor(m.from);
  return (
    <View style={[st.bubbleRow, { alignItems: m.mine ? 'flex-end' : 'flex-start' }]}>
      {!m.mine && <Text style={[st.sender, { color: c }]}>{m.handle}</Text>}
      <View
        style={[
          st.bubble,
          m.mine ? st.bubbleMine : { borderColor: c + '55' },
        ]}>
        <Text style={st.bubbleTxt}>{m.text}</Text>
      </View>
      <Text style={st.meta}>
        {m.encrypted ? '🔒 ' : ''}
        {m.hops > 0 ? (m.hops === 1 ? 'direct' : `${m.hops} hops`) : ''}{' '}
        {m.mine ? statusGlyph(m.status) : ''}
      </Text>
    </View>
  );
}

const statusGlyph = (s: ChatMessage['status']) =>
  s === 'delivered' ? '✓✓' : s === 'relayed' ? '✓' : s === 'failed' ? '✕' : '…';

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  beacon: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: T.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  beaconIcon: { color: T.bg, fontSize: 18, fontWeight: '900' },
  wordmark: { color: T.accent2, fontSize: 20, fontWeight: '800', letterSpacing: 4 },
  subline: { color: T.dim, fontSize: 9, letterSpacing: 2, marginTop: 2 },
  wipeBtn: {
    borderWidth: 1, borderColor: '#6b2b2b', borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(60,20,20,0.4)',
  },
  wipeTxt: { color: '#ff8a8a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  gearBtn: {
    borderWidth: 1, borderColor: T.border, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 6, backgroundColor: 'rgba(20,32,28,0.5)',
  },
  gearTxt: { color: T.dim, fontSize: 16 },
  radarWrap: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: T.border },
  peerCard: {
    position: 'absolute', right: 14, top: 14, borderWidth: 1, borderRadius: 10,
    padding: 10, backgroundColor: 'rgba(15,25,21,0.92)', minWidth: 150,
  },
  peerName: { fontWeight: '800', letterSpacing: 1, marginBottom: 3 },
  peerMeta: { color: '#9bb3ab', fontSize: 11, marginTop: 1 },
  tabs: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: T.border, paddingRight: 12,
  },
  tab: { paddingHorizontal: 14, paddingVertical: 10 },
  tabTxt: { color: T.faint, fontWeight: '700', fontSize: 13, paddingBottom: 6, letterSpacing: 0.5 },
  tabActive: { borderBottomWidth: 2 },
  privacy: { marginLeft: 'auto', color: '#4f7a6c', fontSize: 9 },
  stream: { flex: 1 },
  sysMsg: { color: T.faint, fontSize: 11, textAlign: 'center', marginVertical: 8 },
  sosMsg: {
    backgroundColor: T.dangerBg, borderWidth: 1, borderColor: '#a23',
    borderRadius: 10, padding: 10, marginVertical: 6,
  },
  sosMsgTxt: { color: '#ffb3b3', fontWeight: '700', fontSize: 12 },
  sosLoc: { color: '#ffd0a0', fontSize: 12, marginTop: 5, fontFamily: 'monospace' },
  sosFrom: { color: '#c98', fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  bubbleRow: { marginBottom: 10 },
  sender: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 3, marginLeft: 3 },
  bubble: {
    maxWidth: '82%', padding: 11, borderRadius: 13,
    backgroundColor: 'rgba(24,38,33,0.85)', borderWidth: 1, borderColor: '#26352f',
  },
  bubbleMine: { backgroundColor: 'rgba(47,111,89,0.4)', borderColor: '#3f8f6f' },
  bubbleTxt: { color: T.text, fontSize: 14, lineHeight: 20 },
  meta: { color: T.faint, fontSize: 9, marginTop: 3, marginHorizontal: 3 },
  composer: {
    flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  sosBtn: {
    width: 44, height: 44, borderRadius: 13, borderWidth: 1, borderColor: '#b33',
    backgroundColor: 'rgba(90,20,20,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  sosBtnActive: { backgroundColor: T.danger, borderColor: '#ff6b6b' },
  sosIcon: { color: '#ff7676', fontSize: 18, fontWeight: '900' },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(22,34,29,0.8)', borderWidth: 1, borderColor: '#28392f',
    borderRadius: 13, paddingHorizontal: 12,
  },
  input: { flex: 1, color: T.text, fontSize: 14, paddingVertical: 11 },
  sendBtn: {
    width: 44, height: 44, borderRadius: 13, backgroundColor: T.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  sendIcon: { color: T.bg, fontSize: 18, fontWeight: '900' },
});
