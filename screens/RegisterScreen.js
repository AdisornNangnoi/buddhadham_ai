// screens/RegisterScreen.js
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleRegister = () => {
    // ตรงนี้สามารถต่อ API สมัครสมาชิกได้
    navigation.replace('Chat');
  };

  return (
    <SafeAreaView style={[styles.container, Platform.OS !== 'web' && { paddingTop: StatusBar.currentHeight || 20 }]}>
      <Text style={styles.title}>สมัครสมาชิก</Text>

      <TextInput
        style={styles.input}
        placeholder="อีเมล"
        placeholderTextColor="#aaa"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="รหัสผ่าน"
        placeholderTextColor="#aaa"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        placeholder="ยืนยันรหัสผ่าน"
        placeholderTextColor="#aaa"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />

      <TouchableOpacity style={styles.button} onPress={handleRegister}>
        <Text style={styles.buttonText}>สมัครสมาชิก</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.linkText}>มีบัญชีแล้ว? เข้าสู่ระบบ</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2f3640', paddingTop: 20 ,paddingLeft: 30 ,paddingRight: 30},
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20, textAlign: 'center' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 15
  },
  button: {
    backgroundColor: '#0097e6',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 5
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  linkText: { color: '#ccc', marginTop: 15, textAlign: 'center' }
});
