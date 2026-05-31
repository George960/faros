// ─────────────────────────────────────────────────────────────
// src/App.tsx
// ─────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import ChatScreen from './ui/ChatScreen';
import SettingsScreen from './ui/SettingsScreen';
import { T } from './theme';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      {showSettings ? (
        <SettingsScreen onClose={() => setShowSettings(false)} />
      ) : (
        <ChatScreen onOpenSettings={() => setShowSettings(true)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
});
