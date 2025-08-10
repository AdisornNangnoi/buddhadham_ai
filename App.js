import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import ChatScreen from './screens/ChatScreen'; // เอาโค้ดแชทเดิมมาใส่ในนี้

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Chat" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'เข้าสู่ระบบ' }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'สมัครสมาชิก' }} />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'พุทธธรรม' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
