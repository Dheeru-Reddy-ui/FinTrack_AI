import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import { useRealtimeSync } from '@/data/api';
import { colors, fontWeight, radius, shadow } from '@/theme';

export default function TabsLayout() {
  const { initializing, session } = useAuth();
  useRealtimeSync(); // keep React Query live-synced with Supabase for this user

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: fontWeight.semibold },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 66,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          ...shadow.soft,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="ledger" options={{ title: 'Ledger', tabBarIcon: ({ color, size }) => <Ionicons name="swap-vertical" size={size} color={color} /> }} />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarLabel: () => null,
          tabBarIcon: () => (
            <View style={{ width: 46, height: 34, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', ...shadow.soft }}>
              <Ionicons name="add" size={26} color="#fff" />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="insights" options={{ title: 'Insights', tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" size={size - 2} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size - 1} color={color} /> }} />
    </Tabs>
  );
}
