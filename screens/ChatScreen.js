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
  StatusBar,
  Modal,
  Dimensions,
  Pressable,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

export default function ChatScreen({ navigation }) {
  const [messages, setMessages] = useState([
    { id: '1', from: 'bot', text: 'อะฮิอะเฮียะอะฮ่อ', time: new Date().toLocaleTimeString() }
  ]);

  const contentAnim = useState(new Animated.Value(0))[0];
  const [inputText, setInputText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarAnim = useState(new Animated.Value(-250))[0]; // sidebar กว้าง 250

  // แชตใน sidebar
  const [chats, setChats] = useState([
    { id: 'c1', title: 'ศาสนาพุทธ' },
    { id: 'c2', title: 'พระพุทธศาสนา คือ' },
    { id: 'c3', title: 'ฉากจบที่วรรณคดีเกี่ยวกับอะไร' }
  ]);

  // ป็อปอัพเมนู (ตำแหน่ง + แชตไหน)
  const [menuFor, setMenuFor] = useState(null);              // id แชตที่เปิดเมนู
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });    // ตำแหน่งกดบนหน้าจอ

  const addNewChat = () => {
    setChats(prev => [{ id: Date.now().toString(), title: 'แชตใหม่' }, ...prev]);
  };

  const deleteChat = (id) => {
    setChats(prev => prev.filter(c => c.id !== id));
  };

  // เปิด/ปิด sidebar + ดันคอนเทนต์
  const toggleSidebar = () => {
    const toOpen = !sidebarOpen;
    Animated.parallel([
      Animated.timing(sidebarAnim, {
        toValue: toOpen ? 0 : -250,
        duration: 250,
        useNativeDriver: false
      }),
      Animated.timing(contentAnim, {
        toValue: toOpen ? 250 : 0,
        duration: 250,
        useNativeDriver: false
      })
    ]).start(() => setSidebarOpen(toOpen));
  };

  // ป๊อปอัพ: เปิด/ปิด + คุมตำแหน่ง
  const openItemMenu = (id, x, y) => { setMenuFor(id); setMenuPos({ x, y }); };
  const closeItemMenu = () => setMenuFor(null);

  const getPopupStyle = () => {
    const { width, height } = Dimensions.get('window');
    const MW = 180;   // ความกว้างเมนู
    const MH = 120;   // ความสูงโดยประมาณ
    const PAD = 10;
    const left = Math.min(menuPos.x, width - MW - PAD);
    const top = Math.min(menuPos.y, height - MH - PAD);
    return { left, top, width: MW };
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
    if (text.includes('น้ำตาลสด')) return 'ใช่ครับ อร่อยมาก';
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity onPress={addNewChat}>
              <Icon name="add" size={24} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleSidebar}>
              <Icon name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {/* รายการแชต */}
        {chats.map(chat => (
          <View key={chat.id} style={styles.sidebarItemRow}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => { /* TODO: โหลดแชต */ closeItemMenu(); }}>
              <Text numberOfLines={1} style={styles.sidebarItemText}>{chat.title}</Text>
            </TouchableOpacity>

            {/* จุดไข่ปลา -> เปิดป็อปอัพตามตำแหน่งคลิก */}
            <Pressable
              onPress={(e) => {
                const nx = e?.nativeEvent?.pageX ?? 0;
                const ny = e?.nativeEvent?.pageY ?? 0;
                openItemMenu(chat.id, nx, ny);
              }}
              style={styles.dotButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="ellipsis-vertical" size={20} color="#555" />
            </Pressable>
          </View>
        ))}

        <View style={{ marginTop: 'auto' }}>
          <TouchableOpacity style={styles.sidebarButton}>
            <Text>ลบประวัติแชท</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ปิด sidebar เมื่อแตะฉากทึบ */}
      {sidebarOpen && (
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={toggleSidebar} />
      )}

      {/* คอนเทนต์หลัก (ถูกดันออกเมื่อเปิด sidebar) */}
      <Animated.View style={{ flex: 1, transform: [{ translateX: contentAnim }] }}>
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
      </Animated.View>

      {/* POPUP MENU (Modal) */}
      <Modal
        transparent
        visible={!!menuFor}
        animationType="fade"
        onRequestClose={closeItemMenu}
      >
        {/* คลิกรอบนอกเพื่อปิด */}
        <TouchableOpacity style={styles.popupBackdrop} activeOpacity={1} onPress={closeItemMenu} />
        {/* กล่องเมนู */}
        <View style={[styles.popupMenu, getPopupStyle()]}>
          <View style={styles.popupArrow} />
          {/* ปุ่มเมนู – เพิ่มรายการอื่นได้ เช่น เปลี่ยนชื่อ */}
          <TouchableOpacity
            style={styles.popupItem}
            onPress={() => { deleteChat(menuFor); closeItemMenu(); }}
          >
            <Text style={{ color: '#e74c3c' }}>ลบแชตนี้</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popupItem} onPress={closeItemMenu}>
            <Text>ยกเลิก</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
    paddingHorizontal: 30,
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

  // Sidebar
  sidebar: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    width: 250,
    backgroundColor: '#dcdde1',
    padding: 15,
    zIndex: 10
  },
  sidebarTitle: { fontWeight: 'bold', fontSize: 16 },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  sidebarItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#ccc'
  },
  sidebarItemText: { paddingRight: 8 },
  dotButton: { paddingHorizontal: 4, paddingVertical: 4 },
  sidebarButton: {
    backgroundColor: '#ff6b6b',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10
  },

  // Backdrop สำหรับ sidebar
  backdrop: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 5
  },

  // Popup menu (Modal)
  popupBackdrop: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'transparent'
  },
  popupMenu: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 6,
    // เงา
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 1000
  },
  popupArrow: {
    position: 'absolute',
    top: -8,
    left: 16,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#fff'
  },
  popupItem: {
    paddingVertical: 10,
    paddingHorizontal: 14
  },
});
