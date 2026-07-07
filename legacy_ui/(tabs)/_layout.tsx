import React from 'react';
import { Platform, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/data/store';
import { colors, fontWeight, radius, shadow } from '@/theme';

export default function TabsLayout() {
  const { isAuthed } = useApp();
  if (!isAuthed) return <Redirect href="/login" />;

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
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size - 2} color={color} /> }}
      />
      <Tabs.Screen
        name="transactions"
        options={{ title: 'Ledger', tabBarIcon: ({ color, size }) => <Ionicons name="swap-vertical" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarIcon: () => (
            <View style={{ width: 46, height: 34, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', ...shadow.soft }}>
              <Ionicons name="add" size={26} color="#fff" />
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{ title: 'Insights', tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" size={size - 2} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size - 1} color={color} /> }}
      />
    </Tabs>
  );
}
