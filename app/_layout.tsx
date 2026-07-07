import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthProvider';
import { GoalMetaProvider } from '@/data/goalMeta';
import { queryClient } from '@/data/query';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GoalMetaProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="login" />
              <Stack.Screen name="chat" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="goals" />
              <Stack.Screen name="goal-edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="budget-new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            </Stack>
          </GoalMetaProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
