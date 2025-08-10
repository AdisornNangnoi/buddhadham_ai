import React, { useState } from 'react';
import {
  Animated,
  FlatList,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';


export default function ChatScreen({ navigation }) {
  const [messages, setMessages] = useState([
    { id: '1', from: 'bot', text: 'ศาสนาอายุเก่าแก่กว่า 2,500 ปี', time: '1 Feb 00:00' }
  ]);
  const [inputText, setInputText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarAnim = useState(new Animated.Value(-250))[0]; // sidebar กว้าง 250

  const toggleSidebar = () => {
    Animated.timing(sidebarAnim, {
      toValue: sidebarOpen ? -250 : 0,
      duration: 250,
      useNativeDriver: false
    }).start(() => setSidebarOpen(!sidebarOpen));
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const userMessage = {
      id: Date.now().toString(),
      from: 'user',
      text: inputText.trim(),
      time: new Date().toLocaleTimeString()
    };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setTimeout(() => {
      const botReply = generateBotReply(userMessage.text);
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          from: 'bot',
          text: botReply,
          time: new Date().toLocaleTimeString()
        }
      ]);
    }, 800);
  };

  const generateBotReply = (text) => {
    if (text.includes('พุทธ')) return 'ใช่ครับ ศาสนาพุทธ';
    return 'ขอโทษครับ ผมยังไม่เข้าใจ';
  };

  const renderItem = ({ item }) => (
    <View style={[styles.messageWrapper, item.from === 'user' ? styles.userWrapper : styles.botWrapper]}>
      <Text style={item.from === 'user' ? styles.userMessageText : styles.botMessageText}>{item.text}</Text>
      <Text style={styles.timeText}>{item.time}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, Platform.OS !== 'web' && { paddingTop: StatusBar.currentHeight || 20 }]}>
      {/* Sidebar */}
      <Animated.View style={[styles.sidebar, { left: sidebarAnim }]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>ประวัติการแชท</Text>
          <TouchableOpacity onPress={toggleSidebar}>
            <Icon name="close" size={24} color="#333" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.sidebarItem}>
          <Text>ศาสนาพุทธ</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sidebarItem}>
          <Text>พระพุทธศาสนา คือ</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sidebarItem}>
          <Text>ฉากจบที่วรรณคดีเกี่ยวกับอะไร</Text>
        </TouchableOpacity>

        <View style={{ marginTop: 'auto' }}>
          <TouchableOpacity style={styles.sidebarButton}>
            <Text>ลบประวัติแชท</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={toggleSidebar}>
          <Icon name="menu" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>พุทธธรรม</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <View style={styles.loginButton} >
            <Text style={styles.loginText}>ลงชื่อเข้าใช้</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Chat */}
      <ImageBackground
        source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Dharmachakra_Outline.svg' }}
        style={styles.background}
        imageStyle={{ opacity: 0.1, resizeMode: 'contain' }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <FlatList
            data={messages}
            renderItem={renderItem}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 10 }}
          />
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="พิมพ์ข้อความ..."
            />
            <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
              <Icon name="send" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2f3640' },
  header: {
    backgroundColor: '#1e272e',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 60,
    paddingHorizontal: 10,
    // padding: 10
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  loginButton: { backgroundColor: '#ccc', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  loginText: { fontSize: 14 },
  background: { flex: 1 },
  messageWrapper: {
    maxWidth: '80%',
    marginVertical: 5,
    padding: 10,
    borderRadius: 15
  },
  userWrapper: {
    backgroundColor: '#fff',
    alignSelf: 'flex-end'
  },
  botWrapper: {
    backgroundColor: '#333',
    alignSelf: 'flex-start'
  },
  botMessageText: { fontSize: 16, color: '#fff' },
  userMessageText: { fontSize: 16, color: '#333' },
  timeText: { fontSize: 10, color: '#bbb', marginTop: 3, alignSelf: 'flex-end' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    height: 100,
    borderTopWidth: 1,
    borderColor: '#444',
    backgroundColor: '#1e272e'
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 12,
    fontSize: 16,
    marginRight: 8,
    height: 50
  },
  sendButton: {
    backgroundColor: '#0097e6',
    padding: 10,
    borderRadius: 50
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 250,
    backgroundColor: '#dcdde1',
    padding: 15,
    zIndex: 10
  },
  sidebarTitle: { fontWeight: 'bold', fontSize: 16, marginBottom: 10 },
  sidebarItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#ccc'
  },
  sidebarButton: {
    backgroundColor: '#ff6b6b',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  }
});
