// ─────────────────────────────────────────────────────────────
// src/ui/SettingsScreen.tsx — identity + safety controls
// ─────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useMeshStore } from '../store/useMeshStore';
import { T } from '../theme';

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { myId, myHandle, mock, peers, updateHandle, wipe } = useMeshStore();
  const [handle, setHandle] = useState(myHandle);

  const save = async () => {
    const h = handle.trim();
    if (h.length < 2) {
      Alert.alert('Άκυρο όνομα', 'Διάλεξε ένα όνομα τουλάχιστον 2 χαρακτήρων.');
      return;
    }
    await updateHandle(h);
    onClose();
  };

  const confirmWipe = () =>
    Alert.alert('PANIC WIPE', 'Θα διαγραφούν η ταυτότητα και όλα τα μηνύματα. Μη αναστρέψιμο.', [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'ΔΙΑΓΡΑΦΗ ΟΛΩΝ', style: 'destructive', onPress: () => wipe() },
    ]);

  return (
    <ScrollView style={st.root} contentContainerStyle={{ padding: 20 }}>
      <View style={st.headerRow}>
        <Text style={st.title}>Ρυθμίσεις</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={st.close}>✕</Text>
        </Pressable>
      </View>

      <Text style={st.label}>ΤΟ ΟΝΟΜΑ ΣΟΥ ΣΤΟ MESH</Text>
      <TextInput
        value={handle}
        onChangeText={setHandle}
        style={st.input}
        placeholder="π.χ. ΓΙΩΡΓΟΣ"
        placeholderTextColor={T.faint}
        autoCapitalize="characters"
        maxLength={20}
      />
      <Pressable onPress={save} style={st.saveBtn}>
        <Text style={st.saveTxt}>ΑΠΟΘΗΚΕΥΣΗ</Text>
      </Pressable>

      <View style={st.card}>
        <Text style={st.cardLabel}>Η ΤΑΥΤΟΤΗΤΑ ΣΟΥ (peer id)</Text>
        <Text style={st.mono}>{myId}</Text>
        <Text style={st.note}>
          Παράγεται τοπικά από το κρυπτογραφικό σου κλειδί. Δεν υπάρχει λογαριασμός, email ή
          τηλέφωνο πουθενά.
        </Text>
      </View>

      <View style={st.card}>
        <Text style={st.cardLabel}>ΚΑΤΑΣΤΑΣΗ ΔΙΚΤΥΟΥ</Text>
        <Text style={st.statRow}>Λειτουργία: {mock ? 'MOCK (προσομοίωση)' : 'BLUETOOTH MESH'}</Text>
        <Text style={st.statRow}>Συνδεδεμένοι κόμβοι: {peers.length}</Text>
        <Text style={st.statRow}>Internet: ✕ δεν χρησιμοποιείται ποτέ</Text>
      </View>

      <View style={[st.card, st.privacyCard]}>
        <Text style={st.cardLabel}>🔒 ΑΠΟΡΡΗΤΟ</Text>
        <Text style={st.note}>
          Μηνύματα κρυπτογραφημένα άκρο-σε-άκρο (X25519). Καμία αποθήκευση σε σέρβερ, καμία
          διαφήμιση, καμία παρακολούθηση. Δωρεάν για πάντα.
        </Text>
      </View>

      <Pressable onPress={confirmWipe} style={st.wipeBtn}>
        <Text style={st.wipeTxt}>💨 PANIC WIPE — ΔΙΑΓΡΑΦΗ ΟΛΩΝ</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  title: { color: T.accent2, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  close: { color: T.dim, fontSize: 22 },
  label: { color: T.dim, fontSize: 10, letterSpacing: 2, marginBottom: 8 },
  input: {
    backgroundColor: 'rgba(22,34,29,0.8)', borderWidth: 1, borderColor: '#28392f',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: T.text, fontSize: 16,
    letterSpacing: 1,
  },
  saveBtn: {
    backgroundColor: T.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    marginTop: 12,
  },
  saveTxt: { color: T.bg, fontWeight: '800', letterSpacing: 1 },
  card: {
    backgroundColor: T.panel, borderWidth: 1, borderColor: T.border, borderRadius: 14,
    padding: 16, marginTop: 18,
  },
  privacyCard: { borderColor: '#2f6f59' },
  cardLabel: { color: T.dim, fontSize: 10, letterSpacing: 2, marginBottom: 10 },
  mono: { color: T.green, fontSize: 12, fontFamily: 'monospace' },
  note: { color: '#9bb3ab', fontSize: 12, lineHeight: 18, marginTop: 8 },
  statRow: { color: T.text, fontSize: 13, marginTop: 4 },
  wipeBtn: {
    borderWidth: 1, borderColor: '#6b2b2b', backgroundColor: 'rgba(60,20,20,0.4)',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 26, marginBottom: 40,
  },
  wipeTxt: { color: '#ff8a8a', fontWeight: '700', letterSpacing: 0.5 },
});
