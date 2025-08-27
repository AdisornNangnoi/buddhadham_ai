// ChatScreen.js
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
  ActivityIndicator,
  Alert,
} from "react-native";
import Icon from "react-native-vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthContext";

import {
  getUserChats,
  createChat,
  deleteChat as apiDeleteChat,
  getChatQna,
  askQuestion,
  editChat as apiEditChat,
} from "../src/api/chat";

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
    { id: "seed1", from: "bot", text: "อะฮิอะเฮียะอะฮ่อ", time: new Date().toLocaleTimeString() },
  ]);

  // ไม่ขยับหน้าจอเวลาเปิด sidebar
  const [inputText, setInputText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarAnim = useState(new Animated.Value(-250))[0];

  // Auto-resize input
  const [inputHeight, setInputHeight] = useState(MIN_H);
  const clampH = (h) => Math.min(MAX_H, Math.max(MIN_H, Math.ceil(h || MIN_H)));

  // Web textarea
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

  // Keyboard push-up
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
  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  // Sidebar / chats
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);

  const [menuFor, setMenuFor] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const openItemMenu = (id, x, y) => { setMenuFor(id); setMenuPos({ x, y }); };
  const closeItemMenu = () => setMenuFor(null);

  // === Inline rename states ===
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");

  const getPopupStyle = () => {
    const { width, height } = Dimensions.get("window");
    const MW = 200, MH = 160, PAD = 10;
    return { left: Math.min(menuPos.x, width - MW - PAD), top: Math.min(menuPos.y, height - MH - PAD), width: MW };
  };

  const toggleSidebar = () => {
    const toOpen = !sidebarOpen;
    Animated.timing(sidebarAnim, { toValue: toOpen ? 0 : -250, duration: 250, useNativeDriver: false })
      .start(() => setSidebarOpen(toOpen));
  };

  // โหลดรายชื่อแชตเมื่อมี user (ล็อกอินเท่านั้น)
  const loadUserChats = async () => {
    if (!user?.id && !user?._id) return; // guest = ข้าม
    setLoadingChats(true);
    try {
      const list = await getUserChats(user.id || user._id);
      const mapped = (list || []).map((c) => ({
        id: c.chatId || c.id,
        title: c.chatHeader || "แชต",
      }));
      setChats(mapped);

      if (mapped.length === 0) {
        const created = await createChat({
          userId: user.id || user._id,   // << ส่ง userId ไปด้วย
          chatHeader: "แชตใหม่",
        });
        const newChatId = created.chatId || created.id;
        const newChats = [{ id: newChatId, title: created.chatHeader || "แชตใหม่" }];
        setChats(newChats);
        setSelectedChatId(newChatId);
        setMessages([]);
      } else {
        setSelectedChatId(mapped[0].id);
      }
    } catch (err) {
      console.error("loadUserChats error:", err);
      Alert.alert("ผิดพลาด", "ไม่สามารถโหลดรายชื่อแชตได้");
    } finally {
      setLoadingChats(false);
    }
  };

  const loadHistory = async (chatId) => {
    if (!chatId) return; // guest = ไม่มี
    setLoadingHistory(true);
    try {
      const rows = await getChatQna(chatId);
      const msgs = (rows || []).map((r, idx) => ({
        id: String(r.qNaId || idx),
        from: r.qNaType === "Q" ? "user" : "bot",
        text: r.qNaWords,
        time: new Date(r.createdAt || r.createAt || Date.now()).toLocaleTimeString(),
      }));
      setMessages(msgs);
    } catch (err) {
      console.error("loadHistory error:", err);
      Alert.alert("ผิดพลาด", "ไม่สามารถโหลดประวัติแชตได้");
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  // init
  useEffect(() => {
    if (!user) {
      setChats([]);
      setSelectedChatId(null);
      return;
    }
    loadUserChats();
  }, [user]);

  useEffect(() => {
    if (!selectedChatId) return;
    loadHistory(selectedChatId);
  }, [selectedChatId]);

  const addNewChat = async () => {
    if (!user) {
      Alert.alert("โหมดไม่บันทึก", "กรุณาเข้าสู่ระบบเพื่อสร้างห้องแชตและบันทึกประวัติ");
      return;
    }
    try {
      const created = await createChat({
        userId: user?.id || user?._id, // << ส่ง userId ไปด้วย
        chatHeader: "แชตใหม่",
      });
      const newChatId = created.chatId || created.id;
      const item = { id: newChatId, title: created.chatHeader || "แชตใหม่" };
      setChats((prev) => [item, ...prev]);
      setSelectedChatId(newChatId);
      setMessages([]);
    } catch (err) {
      console.error("createChat error:", err);
      Alert.alert("ผิดพลาด", "ไม่สามารถสร้างแชตใหม่ได้");
    }
  };

  const deleteChat = async (id) => {
    Alert.alert("ยืนยัน", "ต้องการลบแชตนี้หรือไม่?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ลบ",
        style: "destructive",
        onPress: async () => {
          try {
            await apiDeleteChat(id);
            setChats((prev) => prev.filter((c) => c.id !== id));
            if (selectedChatId === id) {
              if (chats.length > 1) {
                const next = chats.find((c) => c.id !== id);
                setSelectedChatId(next?.id || null);
              } else {
                setSelectedChatId(null);
                setMessages([]);
              }
            }
          } catch (err) {
            console.error("deleteChat error:", err);
            Alert.alert("ผิดพลาด", "ลบแชตไม่สำเร็จ");
          }
        },
      },
    ]);
  };

  // === Inline rename ===
  const startRenameInline = (id) => {
    const current = chats.find((c) => c.id === id);
    setEditingId(id);
    setEditingText(current?.title || "");
    closeItemMenu();
  };

  const cancelRenameInline = () => {
    setEditingId(null);
    setEditingText("");
  };

  const confirmRenameInline = async () => {
    const id = editingId;
    const title = (editingText || "").trim();
    if (!id) return;
    if (!title) {
      Alert.alert("กรุณาระบุชื่อแชต");
      return;
    }
    try {
      await apiEditChat(id, { chatHeader: title });
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      setEditingId(null);
      setEditingText("");
    } catch (e) {
      console.error("rename chat error:", e);
      Alert.alert("ผิดพลาด", "แก้ไขชื่อแชตไม่สำเร็จ");
    }
  };

  // === ✅ sendMessage กลับมาแล้ว
  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text) {
      Alert.alert("แจ้งเตือน", "กรุณาพิมพ์คำถาม");
      return;
    }
    const userMessage = {
      id: Date.now().toString(),
      from: "user",
      text,
      time: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setInputHeight(MIN_H);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    setSending(true);
    try {
      const resp = await askQuestion({
        chatId: user ? selectedChatId : undefined, // guest = ไม่ส่ง chatId
        question: text,
      });

      const isRejected = Boolean(resp?.rejected);
      const botText = resp?.answer || (isRejected ? "กรุณาพิมพ์คำถาม" : "ขอโทษครับ ผมยังไม่เข้าใจ");
      const botReply = {
        id: (Date.now() + 1).toString(),
        from: "bot",
        text: botText,
        time: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, botReply]);
    } catch (error) {
      console.error("askQuestion error:", error);
      const botReply = {
        id: (Date.now() + 1).toString(),
        from: "bot",
        text: "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์",
        time: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, botReply]);
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }) => (
    <View style={[styles.messageWrapper, item.from === "user" ? styles.userWrapper : styles.botWrapper]}>
      <Text style={item.from === "user" ? styles.userMessageText : styles.botMessageText}>{item.text}</Text>
      <Text style={styles.timeText}>{item.time}</Text>
    </View>
  );

  const listBottomPad = 10 + inputHeight + 12 + (insets.bottom || 0) + kbBtmNum;

  return (
    <SafeAreaView style={[styles.container, Platform.OS !== "web" && { paddingTop: StatusBar.currentHeight || 20 }]}>
      {/* Sidebar */}
      <Animated.View style={[styles.sidebar, { left: sidebarAnim }]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>
            {user ? `ประวัติการแชท (${chats.length})` : "โหมดไม่บันทึก (Guest)"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {/* ปุ่มปิด sidebar */}
            <TouchableOpacity onPress={toggleSidebar} style={{ paddingLeft: 8 }}>
              <Icon name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {user ? (
          loadingChats ? (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
            </View>
          ) : (
            chats.map((chat) => {
              const isEditing = editingId === chat.id;
              return (
                <View key={chat.id} style={styles.sidebarItemRow}>
                  {isEditing ? (
                    <View style={styles.renameInlineRow}>
                      <TextInput
                        value={editingText}
                        onChangeText={setEditingText}
                        placeholder="ชื่อแชต"
                        style={styles.renameInlineInput}
                        autoFocus
                        onSubmitEditing={confirmRenameInline}
                        returnKeyType="done"
                      />
                      <View style={styles.renameInlineBtns}>
                        <TouchableOpacity onPress={confirmRenameInline} style={styles.inlineIconBtn}>
                          <Icon name="checkmark" size={18} color="#2ecc71" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={cancelRenameInline} style={styles.inlineIconBtn}>
                          <Icon name="close" size={18} color="#e74c3c" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={{ flex: 1, minWidth: 0 }}
                        onPress={() => {
                          setSelectedChatId(chat.id);
                          closeItemMenu();
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={[styles.sidebarItemText, selectedChatId === chat.id && { fontWeight: "bold" }]}
                        >
                          {chat.title}
                        </Text>
                      </TouchableOpacity>

                      <Pressable
                        onPress={(e) =>
                          openItemMenu(chat.id, e?.nativeEvent?.pageX ?? 0, e?.nativeEvent?.pageY ?? 0)
                        }
                        style={styles.dotButton}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="ellipsis-vertical" size={20} color="#555" />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })
          )
        ) : (
          <Text style={{ color: "#555" }}>เข้าสู่ระบบเพื่อสร้างห้องและบันทึกประวัติการสนทนา</Text>
        )}

        {user && (
          <View style={{ marginTop: "auto" }}>
            {/* ปุ่มเพิ่มแชตใหม่ */}
            <TouchableOpacity style={styles.sidebarButton} onPress={addNewChat}>
              <Text style={{ color: "#fff" }}>เพิ่มแชตใหม่</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {sidebarOpen && <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={toggleSidebar} />}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerSideLeft}>
          <TouchableOpacity onPress={toggleSidebar}>
            <Icon name="menu" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View pointerEvents="none" style={styles.headerCenter}>
          <Text style={styles.headerTitle}>พุทธธรรม</Text>
        </View>

        <View style={styles.headerSideRight}>
          {user ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
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

      {/* Body */}
      <Animated.View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ImageBackground
            source={{ uri: "https://upload.wikimedia.org/wikipedia/commons/3/3c/Dharmachakra_Outline.svg" }}
            style={styles.background}
            imageStyle={{ opacity: 0.1, resizeMode: "contain" }}
          >
            {user && loadingHistory ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator />
                <Text style={{ color: "#ddd", marginTop: 8 }}>กำลังโหลดประวัติ...</Text>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 10, paddingBottom: listBottomPad }}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              />
            )}

            {/* Input */}
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
                      if (!sending) sendMessage();
                    }
                  }}
                  disabled={sending}
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
                    opacity: sending ? 0.6 : 1,
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
                      opacity: sending ? 0.6 : 1,
                    },
                  ]}
                  value={inputText}
                  placeholder="พิมพ์ข้อความ..."
                  editable={!sending}
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
                  onSubmitEditing={() => { if (!sending) sendMessage(); }}
                />
              )}
              <TouchableOpacity
                onPress={() => { if (!sending) sendMessage(); }}
                disabled={sending || !inputText.trim()}
                style={[styles.sendButton, (sending || !inputText.trim()) && { opacity: 0.6 }]}
              >
                {sending ? <ActivityIndicator color="#fff" /> : <Icon name="send" size={22} color="#fff" />}
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
          <TouchableOpacity
            style={styles.popupItem}
            onPress={() => {
              const id = menuFor;
              if (!id) return;
              startRenameInline(id);
              closeItemMenu();
            }}
          >
            <Text>แก้ไขชื่อแชต</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.popupItem}
            onPress={() => {
              if (menuFor) deleteChat(menuFor);
              closeItemMenu();
            }}
          >
            <Text style={{ color: "#e74c3c" }}>ลบแชตนี้</Text>
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
  container: { flex: 1, backgroundColor: "#2f3640" },

  header: {
    backgroundColor: "#1e272e",
    height: 60,
    paddingHorizontal: 10,
    justifyContent: "center",
    zIndex: 2,
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
    position: "absolute",
    top: 0, bottom: 0, left: 0, width: 250,
    backgroundColor: "#dcdde1", padding: 15, zIndex: 5,
  },
  sidebarTitle: { fontWeight: "bold", fontSize: 16 },
  sidebarHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sidebarItemRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderColor: "#ccc" },
  sidebarItemText: { paddingRight: 8 },
  dotButton: { paddingHorizontal: 4, paddingVertical: 4 },

  // ปุ่มล่าง
  sidebarButton: { backgroundColor: "#1e272e", padding: 10, borderRadius: 8, alignItems: "center", marginTop: 10 },

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

  // Inline rename
  renameInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "100%",
  },
  renameInlineInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
    fontSize: 14,
  },
  renameInlineBtns: {
    flexDirection: "row",
    alignItems: "center",
  },
  inlineIconBtn: { paddingHorizontal: 6, paddingVertical: 4 },
});
