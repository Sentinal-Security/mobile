import { Stack, DarkTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

export default function RootLayout() {
  useEffect(() => {
    // Dismiss splash screen immediately once layout is rendered safely
    try {
      SplashScreen.hideAsync().catch(() => {});
    } catch {
      // Ignore splash screen lifecycle notice
    }
  }, []);

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000000' } }}>
        <Stack.Screen name="index" />
      </Stack>
    </ThemeProvider>
  );
}
