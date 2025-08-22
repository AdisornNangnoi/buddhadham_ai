import React, { useRef, useState, useEffect } from "react";
import {
  Animated,
  FlatList,
  ImageBackground,
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
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import Icon from "react-native-vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthContext";

/** ===== Config ช่องพิมพ์ ===== */
const MIN_H = 40;
const MAX_H = 140;
const LINE_H = 20;
const PAD_V_TOP = 10;
const PAD_V_BOTTOM = 10;

export default function ChatScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const [messages, setMessages] = useState([
    { id: "1", from: "bot", text: "อะฮิอะเฮียะอะฮ่อ", time: new Date().toLocaleTimeString() },
  ]);

  // ใช้ contentAnim ขยับ “เฉพาะเนื้อหา” ไม่รวม Header
  const contentAnim = useState(new Animated.Value(0))[0];
  const [inputText, setInputText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarAnim = useState(new Animated.Value(-250))[0];

  // ====== Auto-resize (input) ======
  const [inputHeight, setInputHeight] = useState(MIN_H);
  const clampH = (h) => Math.min(MAX_H, Math.max(MIN_H, Math.ceil(h || MIN_H)));

  // ====== WEB: textarea + scrollHeight ======
  const webRef = useRef(null);
  const adjustWebHeight = () => {
    if (Platform.OS !== "web") return;
    const el = webRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_H);
    el.style.height = `${next}px`;
    el.style.overflowY = next >= MAX_H ? "auto" : "hidden";
    setInputHeight(next < MIN_H ? MIN_H : next);
  };
  useEffect(() => {
    if (Platform.OS === "web") adjustWebHeight();
  }, [inputText]);

  // ====== ดัน input bar เหนือคีย์บอร์ด ======
  const kbBottom = useRef(new Animated.Value(0)).current;
  const [kbBtmNum, setKbBtmNum] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e) => {
      const kh = e?.endCoordinates?.height ?? 0;
      const bottom = Math.max(0, kh - (insets.bottom || 0));
      setKbBtmNum(bottom);
      Animated.timing(kbBottom, {
        toValue: bottom,
        duration: e?.duration ?? 220,
        useNativeDriver: false,
      }).start();
    };
    const onHide = (e) => {
      setKbBtmNum(0);
      Animated.timing(kbBottom, {
        toValue: 0,
        duration: e?.duration ?? 200,
        useNativeDriver: false,
      }).start();
    };

    const s1 = Keyboard.addListener(showEvt, onShow);
    const s2 = Keyboard.addListener(hideEvt, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, [insets.bottom, kbBottom]);

  const listRef = useRef(null);

  // เวลา messages เพิ่ม ให้เลื่อนลงล่าง
  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  // ====== Sidebar ======
  const [chats, setChats] = useState([
    { id: "c1", title: "ศาสนาพุทธ" },
    { id: "c2", title: "พระพุทธศาสนา คือ" },
    { id: "c3", title: "ฉากจบที่วรรณคดีเกี่ยวกับอะไร" },
  ]);
  const [menuFor, setMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const addNewChat = () => setChats((prev) => [{ id: Date.now().toString(), title: "แชตใหม่" }, ...prev]);
  const deleteChat = (id) => setChats((prev) => prev.filter((c) => c.id !== id));

  const toggleSidebar = () => {
    const toOpen = !sidebarOpen;
    Animated.parallel([
      Animated.timing(sidebarAnim, { toValue: toOpen ? 0 : -250, duration: 250, useNativeDriver: false }),
      Animated.timing(contentAnim, { toValue: toOpen ? 250 : 0, duration: 250, useNativeDriver: false }),
    ]).start(() => setSidebarOpen(toOpen));
  };

  const openItemMenu = (id, x, y) => { setMenuFor(id); setMenuPos({ x, y }); };
  const closeItemMenu = () => setMenuFor(null);

  const getPopupStyle = () => {
    const { width, height } = Dimensions.get("window");
    const MW = 180, MH = 120, PAD = 10;
    return { left: Math.min(menuPos.x, width - MW - PAD), top: Math.min(menuPos.y, height - MH - PAD), width: MW };
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const userMessage = {
      id: Date.now().toString(),
      from: "user",
      text: inputText.trim(),
      time: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setInputHeight(MIN_H);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    setTimeout(() => {
      const botReply = userMessage.text.includes("น้ำตาลสด") ? "ใช่ครับ อร่อยมาก" : "ขอโทษครับ ผมยังไม่เข้าใจ";
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), from: "bot", text: botReply, time: new Date().toLocaleTimeString() },
      ]);
    }, 800);
  };

  const renderItem = ({ item }) => (
    <View style={[styles.messageWrapper, item.from === "user" ? styles.userWrapper : styles.botWrapper]}>
      <Text style={item.from === "user" ? styles.userMessageText : styles.botMessageText}>{item.text}</Text>
      <Text style={styles.timeText}>{item.time}</Text>
    </View>
  );

  // เผื่อพื้นที่ล่าง: อินพุต + padding + safe-area + ความสูงคีย์บอร์ด
  const listBottomPad = 10 + inputHeight + 12 + (insets.bottom || 0) + kbBtmNum;

  return (
    <SafeAreaView style={[styles.container, Platform.OS !== "web" && { paddingTop: StatusBar.currentHeight || 20 }]}>
      {/* Sidebar (ซ้อนทับ) */}
      <Animated.View style={[styles.sidebar, { left: sidebarAnim }]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>ประวัติการแชท</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TouchableOpacity onPress={addNewChat}><Icon name="add" size={24} color="#333" /></TouchableOpacity>
            <TouchableOpacity onPress={toggleSidebar}><Icon name="close" size={24} color="#333" /></TouchableOpacity>
          </View>
        </View>

        {chats.map((chat) => (
          <View key={chat.id} style={styles.sidebarItemRow}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => { /* TODO */ closeItemMenu(); }}>
              <Text numberOfLines={1} style={styles.sidebarItemText}>{chat.title}</Text>
            </TouchableOpacity>
            <Pressable
              onPress={(e) => openItemMenu(chat.id, e?.nativeEvent?.pageX ?? 0, e?.nativeEvent?.pageY ?? 0)}
              style={styles.dotButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="ellipsis-vertical" size={20} color="#555" />
            </Pressable>
          </View>
        ))}

        <View style={{ marginTop: "auto" }}>
          <TouchableOpacity style={styles.sidebarButton}><Text>ลบประวัติแชท</Text></TouchableOpacity>
        </View>
      </Animated.View>

      {sidebarOpen && <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={toggleSidebar} />}

      {/* Header (fixed center) */}
      <View style={styles.header}>
        {/* ซ้าย: เมนู */}
        <View style={styles.headerSideLeft}>
          <TouchableOpacity onPress={toggleSidebar}>
            <Icon name="menu" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* กลาง: Title ตรึงกึ่งกลางเสมอ */}
        <View pointerEvents="none" style={styles.headerCenter}>
          <Text style={styles.headerTitle}>พุทธธรรม</Text>
        </View>

        {/* ขวา: ปุ่มล็อกอิน หรือ ชื่อผู้ใช้ + ออกระบบ */}
        <View style={styles.headerSideRight}>
          {user ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.userBadge}>
                <Text style={styles.userNameText} numberOfLines={1}>{user.name || "ผู้ใช้"}</Text>
              </View>
              <TouchableOpacity onPress={logout}>
                <View style={styles.logoutButton}><Text style={styles.logoutText}>ออกจากระบบ</Text></View>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => navigation.navigate("Login")}>
              <View style={styles.loginButton}><Text style={styles.loginText}>ลงชื่อเข้าใช้</Text></View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Body (ขยับได้) */}
      <Animated.View style={{ flex: 1, transform: [{ translateX: contentAnim }] }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ImageBackground
            source={{ uri: "https://upload.wikimedia.org/wikipedia/commons/3/3c/Dharmachakra_Outline.svg" }}
            style={styles.background}
            imageStyle={{ opacity: 0.1, resizeMode: "contain" }}
          >
            <FlatList
              ref={listRef}
              data={messages}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 10, paddingBottom: listBottomPad }}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            />

            {/* ===== Input Row ===== */}
            <Animated.View
              style={[
                styles.inputContainerAbs,
                { bottom: kbBottom, paddingBottom: 12 + (insets.bottom || 0) },
              ]}
            >
              {Platform.OS === "web" ? (
                <textarea
                  ref={webRef}
                  value={inputText}
                  placeholder="พิมพ์ข้อความ..."
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  style={{
                    flex: 1,
                    marginRight: 8,
                    backgroundColor: "#fff",
                    borderRadius: 20,
                    border: "none",
                    outline: "none",
                    resize: "none",
                    padding: `${PAD_V_TOP}px 12px ${PAD_V_BOTTOM}px`,
                    fontSize: 16,
                    lineHeight: `${LINE_H}px`,
                    minHeight: MIN_H,
                    maxHeight: MAX_H,
                    overflowY: inputHeight >= MAX_H ? "auto" : "hidden",
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <TextInput
                  style={[
                    styles.input,
                    {
                      height: inputHeight,
                      maxHeight: MAX_H,
                      textAlignVertical: "top",
                      lineHeight: LINE_H,
                      paddingTop: PAD_V_TOP,
                      paddingBottom: PAD_V_BOTTOM,
                    },
                  ]}
                  value={inputText}
                  placeholder="พิมพ์ข้อความ..."
                  multiline
                  onChangeText={setInputText}
                  onContentSizeChange={(e) => {
                    const h = e.nativeEvent.contentSize?.height ?? MIN_H;
                    setInputHeight((prev) => {
                      const next = clampH(h);
                      return next === prev ? prev : next;
                    });
                  }}
                  scrollEnabled={inputHeight >= MAX_H}
                  returnKeyType="send"
                  onSubmitEditing={sendMessage}
                />
              )}
              <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
                <Icon name="send" size={22} color="#fff" />
              </TouchableOpacity>
            </Animated.View>
          </ImageBackground>
        </TouchableWithoutFeedback>
      </Animated.View>

      {/* Popup Menu */}
      <Modal transparent visible={!!menuFor} animationType="fade" onRequestClose={closeItemMenu}>
        <TouchableOpacity style={styles.popupBackdrop} activeOpacity={1} onPress={closeItemMenu} />
        <View style={[styles.popupMenu, getPopupStyle()]}>
          <View style={styles.popupArrow} />
          <TouchableOpacity style={styles.popupItem} onPress={() => { if (menuFor) deleteChat(menuFor); closeItemMenu(); }}>
            <Text style={{ color: "#e74c3c" }}>ลบแชตนี้</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popupItem} onPress={closeItemMenu}><Text>ยกเลิก</Text></TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#2f3640" },

  // Header: ใช้ตำแหน่ง absolute ของลูกๆ เพื่อให้ title ตรึงกลาง
  header: {
    backgroundColor: "#1e272e",
    height: 60,
    paddingHorizontal: 10,
    justifyContent: "center",
    zIndex: 2, // ให้ลอยเหนือ body ที่ขยับ
  },
  headerCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  headerSideLeft: {
    position: "absolute",
    left: 10,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  headerSideRight: {
    position: "absolute",
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  loginButton: { backgroundColor: "#ccc", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  loginText: { fontSize: 14 },

  userBadge: { maxWidth: 160, backgroundColor: "#2f3640", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  userNameText: { color: "#fff", fontSize: 16 },
  logoutButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  logoutText: { color: "#fff", fontSize: 14 },

  background: { flex: 1 },

  messageWrapper: { maxWidth: "80%", marginVertical: 5, padding: 10, borderRadius: 15 },
  userWrapper: { backgroundColor: "#fff", alignSelf: "flex-end" },
  botWrapper: { backgroundColor: "#333", alignSelf: "flex-start" },
  botMessageText: { fontSize: 16, color: "#fff" },
  userMessageText: { fontSize: 16, color: "#333" },
  timeText: { fontSize: 10, color: "#bbb", marginTop: 3, alignSelf: "flex-end" },

  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingHorizontal: 12,
    fontSize: 16,
    marginRight: 8,
    minHeight: MIN_H,
  },

  inputContainerAbs: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 30,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "#444",
    backgroundColor: "#1e272e",
  },

  sendButton: { backgroundColor: "#0097e6", padding: 10, borderRadius: 50 },

  // Sidebar
  sidebar: {
    position: "absolute", top: 0, bottom: 0, left: 0, width: 250,
    backgroundColor: "#dcdde1", padding: 15, zIndex: 5,
  },
  sidebarTitle: { fontWeight: "bold", fontSize: 16 },
  sidebarHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sidebarItemRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderColor: "#ccc" },
  sidebarItemText: { paddingRight: 8 },
  dotButton: { paddingHorizontal: 4, paddingVertical: 4 },
  sidebarButton: { backgroundColor: "#ff6b6b", padding: 10, borderRadius: 8, alignItems: "center", marginTop: 10 },

  backdrop: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.3)", zIndex: 4 },

  // Popup
  popupBackdrop: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "transparent" },
  popupMenu: {
    position: "absolute", backgroundColor: "#fff", borderRadius: 12, paddingVertical: 6,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 8, zIndex: 1000,
  },
  popupArrow: {
    position: "absolute", top: -8, left: 16, width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#fff",
  },
  popupItem: { paddingVertical: 10, paddingHorizontal: 14 },
});
